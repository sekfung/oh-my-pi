import * as fs from "node:fs/promises";
import * as path from "node:path";
import { exportFromFile } from "../export/html";
import type { AgentSession } from "../session/agent-session";
import { createForeignSessionStore, persistForeignSession } from "../session/foreign-session-import";
import type { ForeignSessionInfo } from "../session/foreign-session-store";
import type { SessionEntry, SessionTreeNode } from "../session/session-entries";
import { formatSessionHistoryMarkdown } from "../session/session-history-format";
import type { SessionInfo } from "../session/session-listing";
import { loadSessionMessagesReadOnly } from "../session/session-loader";
import { SessionManager } from "../session/session-manager";
import { FileSessionStorage } from "../session/session-storage";
import {
	APPLICATION_PROTOCOL_VERSION,
	type ApplicationActiveSession,
	type ApplicationChangedEvent,
	type ApplicationIntent,
	type ApplicationIntentRequest,
	type ApplicationIntentResult,
	type ApplicationProject,
	type ApplicationSessionSummary,
	type ApplicationSessionTreeNode,
	type ApplicationSnapshot,
} from "./application-types";

const IDEMPOTENCY_CACHE_LIMIT = 256;
const TREE_PREVIEW_MAX_CHARS = 200;
const SNAPSHOT_EVENT_TYPES = new Set([
	"agent_start",
	"agent_end",
	"message_start",
	"message_end",
	"auto_compaction_start",
	"auto_compaction_end",
	"model_changed",
	"thinking_level_changed",
	"queue_changed",
]);

interface CachedIntentResult {
	promise: Promise<ApplicationIntentResult>;
	settled: boolean;
}

export interface ApplicationRuntimeSnapshot {
	project: ApplicationProject;
	activeSession: ApplicationActiveSession;
	sessions: ApplicationSessionSummary[];
}

export interface ApplicationRuntime {
	readSnapshot(): Promise<ApplicationRuntimeSnapshot>;
	execute(intent: ApplicationIntent): Promise<boolean>;
	subscribe(listener: () => void): () => void;
}

export class ApplicationStaleRevisionError extends Error {
	readonly expectedRevision: number;
	readonly actualRevision: number;

	constructor(expectedRevision: number, actualRevision: number) {
		super(`Application revision is stale: expected ${expectedRevision}, current ${actualRevision}`);
		this.name = "ApplicationStaleRevisionError";
		this.expectedRevision = expectedRevision;
		this.actualRevision = actualRevision;
	}
}

export class ApplicationController {
	readonly #runtime: ApplicationRuntime;
	readonly #emit: (event: ApplicationChangedEvent) => void;
	readonly #unsubscribe: () => void;
	#sequence = 0;
	#revision = 1;
	#mutationTail: Promise<void> = Promise.resolve();
	#intentResults = new Map<string, CachedIntentResult>();

	constructor(runtime: ApplicationRuntime, emit: (event: ApplicationChangedEvent) => void) {
		this.#runtime = runtime;
		this.#emit = emit;
		this.#unsubscribe = runtime.subscribe(() => this.#changed("runtime"));
	}

	async snapshot(): Promise<ApplicationSnapshot> {
		const runtime = await this.#runtime.readSnapshot();
		return {
			protocolVersion: APPLICATION_PROTOCOL_VERSION,
			sequence: this.#sequence,
			revision: this.#revision,
			...runtime,
			capabilities: [
				"conversation.read",
				"conversation.send",
				"sessions.list",
				"sessions.create",
				"sessions.switch",
				"sessions.rename",
				"sessions.delete",
				"sessions.clone",
				"sessions.fork",
				"sessions.import",
				"sessions.export",
				"sessionTree.read",
				"sessionTree.navigate",
				"sessionTree.label",
				"sessionTree.fork",
				"review.read",
				"queue.read",
				"queue.remove",
				"queue.clear",
			],
		};
	}

	execute(request: ApplicationIntentRequest): Promise<ApplicationIntentResult> {
		const existing = this.#intentResults.get(request.intentId);
		if (existing) return existing.promise;

		const result = this.#enqueueMutation(request);
		const cached = { promise: result, settled: false };
		this.#intentResults.set(request.intentId, cached);
		void result.then(
			() => {
				cached.settled = true;
				this.#trimIntentResults();
			},
			() => {
				cached.settled = true;
				this.#trimIntentResults();
			},
		);
		this.#trimIntentResults();
		return result;
	}

	dispose(): void {
		this.#unsubscribe();
	}

	#enqueueMutation(request: ApplicationIntentRequest): Promise<ApplicationIntentResult> {
		const result = this.#mutationTail.then(async () => {
			if (request.expectedRevision !== this.#revision) {
				throw new ApplicationStaleRevisionError(request.expectedRevision, this.#revision);
			}
			const applied = await this.#runtime.execute(request.intent);
			if (applied) this.#changed("intent");
			return {
				intentId: request.intentId,
				applied,
				snapshot: await this.snapshot(),
			};
		});
		this.#mutationTail = result.then(
			() => undefined,
			() => undefined,
		);
		return result;
	}

	#changed(reason: ApplicationChangedEvent["reason"]): void {
		this.#revision += 1;
		this.#sequence += 1;
		this.#emit({
			type: "application_changed",
			sequence: this.#sequence,
			revision: this.#revision,
			reason,
		});
	}

	#trimIntentResults(): void {
		while (this.#intentResults.size > IDEMPOTENCY_CACHE_LIMIT) {
			const oldestSettled = Array.from(this.#intentResults).find(([, cached]) => cached.settled)?.[0];
			if (oldestSettled === undefined) return;
			this.#intentResults.delete(oldestSettled);
		}
	}
}

export interface AgentSessionApplicationRuntimeOptions {
	onSessionChanged?: () => void;
}

function sessionSummary(info: SessionInfo): ApplicationSessionSummary {
	return {
		path: info.path,
		id: info.id,
		title: info.title,
		createdAt: info.created.toISOString(),
		modifiedAt: info.modified.toISOString(),
		messageCount: info.messageCount,
		firstMessage: info.firstMessage,
		...(info.parentSessionPath ? { parentSessionPath: info.parentSessionPath } : {}),
		status: info.status ?? "unknown",
	};
}

export class AgentSessionApplicationRuntime implements ApplicationRuntime {
	readonly #session: AgentSession;
	readonly #onSessionChanged?: () => void;

	constructor(session: AgentSession, options: AgentSessionApplicationRuntimeOptions = {}) {
		this.#session = session;
		this.#onSessionChanged = options.onSessionChanged;
	}

	async readSnapshot(): Promise<ApplicationRuntimeSnapshot> {
		const cwd = this.#session.sessionManager.getCwd();
		const model = this.#session.model;
		const sessions = await SessionManager.list(cwd);
		const queueItems = this.#session.getQueuedMessageItems();
		const treeNodes = flattenSessionTree(this.#session.sessionManager.getTree());
		return {
			project: { path: cwd, name: path.basename(cwd) || cwd },
			activeSession: {
				id: this.#session.sessionId,
				path: this.#session.sessionFile,
				title: this.#session.sessionName,
				model: model
					? {
							provider: model.provider,
							id: model.id,
							...(model.name ? { name: model.name } : {}),
						}
					: undefined,
				thinkingLevel: this.#session.thinkingLevel,
				isStreaming: this.#session.isStreaming,
				isCompacting: this.#session.isCompacting,
				queuedMessageCount: this.#session.queuedMessageCount,
				queue: {
					items: queueItems,
					hiddenCount: Math.max(0, this.#session.queuedMessageCount - queueItems.length),
				},
				transcript: { messageCount: this.#session.messages.length },
				tree: { nodes: treeNodes, leafId: this.#session.sessionManager.getLeafId() },
			},
			sessions: sessions.map(sessionSummary),
		};
	}

	async execute(intent: ApplicationIntent): Promise<boolean> {
		let applied: boolean;
		let sessionChanged = false;
		switch (intent.type) {
			case "new_session":
				applied = await this.#session.newSession(
					intent.parentSession ? { parentSession: intent.parentSession } : undefined,
				);
				sessionChanged = applied;
				break;
			case "switch_session":
				applied = await this.#projectSessionPath(intent.sessionPath).then(sessionPath =>
					sessionPath ? this.#session.switchSession(sessionPath) : false,
				);
				sessionChanged = applied;
				break;
			case "rename_session": {
				const sessionPath = await this.#projectSessionPath(intent.sessionPath);
				if (!sessionPath) {
					applied = false;
					break;
				}
				if (this.#isActiveSessionPath(sessionPath)) {
					applied = await this.#session.setSessionName(intent.title, "user");
					break;
				}
				const manager = await SessionManager.open(sessionPath, undefined, new FileSessionStorage(), {
					suppressBreadcrumb: true,
				});
				try {
					applied = await manager.setSessionName(intent.title, "user");
				} finally {
					await manager.close();
				}
				break;
			}
			case "delete_session": {
				const sessionPath = await this.#projectSessionPath(intent.sessionPath);
				if (!sessionPath) {
					applied = false;
					break;
				}
				if (this.#isActiveSessionPath(sessionPath)) {
					throw new Error("Cannot delete the active desktop session");
				}
				await new FileSessionStorage().deleteSessionWithArtifacts(sessionPath);
				applied = true;
				break;
			}
			case "clone_session": {
				const sessionPath = await this.#projectSessionPath(intent.sessionPath);
				if (!sessionPath) {
					applied = false;
					break;
				}
				if (this.#isActiveSessionPath(sessionPath)) await this.#assertSessionIdle("clone");
				if (this.#isActiveSessionPath(sessionPath)) await this.#session.sessionManager.flush();
				const clone = await SessionManager.cloneFrom(
					sessionPath,
					this.#session.sessionManager.getCwd(),
					undefined,
					new FileSessionStorage(),
					{ suppressBreadcrumb: true },
				);
				const cloneFile = clone.getSessionFile();
				await clone.close();
				if (!cloneFile) throw new Error("Cloned session has no persisted file");
				applied = await this.#session.switchSession(cloneFile);
				sessionChanged = applied;
				break;
			}
			case "fork_session": {
				const sessionPath = await this.#projectSessionPath(intent.sessionPath);
				if (!sessionPath) {
					applied = false;
					break;
				}
				if (this.#isActiveSessionPath(sessionPath)) {
					applied = await this.#session.fork();
				} else {
					const fork = await SessionManager.forkFrom(
						sessionPath,
						this.#session.sessionManager.getCwd(),
						undefined,
						new FileSessionStorage(),
						{ suppressBreadcrumb: true },
					);
					const forkFile = fork.getSessionFile();
					await fork.close();
					if (!forkFile) throw new Error("Forked session has no persisted file");
					applied = await this.#session.switchSession(forkFile);
				}
				sessionChanged = applied;
				break;
			}
			case "import_session": {
				await this.#assertSessionIdle("import a session");
				const resolved = path.resolve(intent.path);
				const stat = await fs.stat(resolved);
				if (!stat.isFile()) throw new Error("Session import path is not a file");
				const info: ForeignSessionInfo = {
					source: intent.source,
					id: path.basename(resolved),
					path: resolved,
					cwd: this.#session.sessionManager.getCwd(),
					created: stat.mtime,
					modified: stat.mtime,
				};
				const imported = await persistForeignSession(createForeignSessionStore(intent.source), info, {
					fallbackCwd: this.#session.sessionManager.getCwd(),
					suppressBreadcrumb: true,
				});
				const importedFile = imported.getSessionFile();
				await imported.close();
				if (!importedFile) throw new Error("Imported session has no persisted file");
				applied = await this.#session.switchSession(importedFile);
				sessionChanged = applied;
				break;
			}
			case "export_session": {
				const sessionPath = await this.#projectSessionPath(intent.sessionPath);
				if (!sessionPath) {
					applied = false;
					break;
				}
				const outputPath = path.resolve(intent.outputPath);
				if (intent.format === "html") {
					if (this.#isActiveSessionPath(sessionPath)) await this.#session.exportToHtml(outputPath);
					else await exportFromFile(sessionPath, { outputPath });
				} else {
					const messages = this.#isActiveSessionPath(sessionPath)
						? this.#session.messages
						: await loadSessionMessagesReadOnly(sessionPath);
					await Bun.write(outputPath, formatSessionHistoryMarkdown(messages));
				}
				applied = true;
				break;
			}
			case "tree_navigate": {
				const result = await this.#session.navigateTree(intent.entryId, {});
				applied = !result.cancelled;
				break;
			}
			case "tree_fork": {
				const navigation = await this.#session.navigateTree(intent.entryId, {});
				if (navigation.cancelled) {
					applied = false;
					break;
				}
				applied = await this.#session.fork();
				sessionChanged = applied;
				break;
			}
			case "tree_label": {
				this.#session.sessionManager.appendLabelChange(intent.entryId, intent.label);
				applied = true;
				break;
			}
			case "remove_queue_item":
				applied = this.#session.removeQueuedMessage(intent.queueItemId) !== undefined;
				break;
			case "clear_queue": {
				const cleared = this.#session.clearQueue();
				applied = cleared.steering.length > 0 || cleared.followUp.length > 0;
				break;
			}
		}
		if (sessionChanged) this.#onSessionChanged?.();
		return applied;
	}

	async #projectSessionPath(candidate: string): Promise<string | undefined> {
		const resolved = path.resolve(candidate);
		const sessions = await SessionManager.list(this.#session.sessionManager.getCwd());
		return sessions.find(session => path.resolve(session.path) === resolved)?.path;
	}

	#isActiveSessionPath(candidate: string): boolean {
		const active = this.#session.sessionFile;
		return active !== undefined && path.resolve(active) === path.resolve(candidate);
	}

	#assertSessionIdle(operation: string): void {
		if (this.#session.isStreaming) throw new Error(`Cannot ${operation} while a turn is streaming`);
	}

	subscribe(listener: () => void): () => void {
		return this.#session.subscribe(event => {
			if (SNAPSHOT_EVENT_TYPES.has(event.type)) listener();
		});
	}
}

function flattenSessionTree(roots: readonly SessionTreeNode[]): ApplicationSessionTreeNode[] {
	const nodes: ApplicationSessionTreeNode[] = [];
	const stack = [...roots].reverse();
	while (stack.length > 0) {
		const node = stack.pop();
		if (!node) continue;
		nodes.push({
			id: node.entry.id,
			parentId: node.entry.parentId,
			type: node.entry.type,
			...(node.label ? { label: node.label } : {}),
			timestamp: node.entry.timestamp,
			preview: describeSessionEntry(node.entry),
		});
		for (let index = node.children.length - 1; index >= 0; index--) stack.push(node.children[index]);
	}
	return nodes;
}

/** Bounded, theme-free preview of one journal entry for application hosts. */
export function describeSessionEntry(entry: SessionEntry): string {
	const normalize = (value: string) =>
		value
			.replace(/[\t\n\r]+/g, " ")
			.replace(/\s+/g, " ")
			.trim()
			.slice(0, TREE_PREVIEW_MAX_CHARS);
	const textContent = (content: unknown): string => {
		if (typeof content === "string") return content;
		if (Array.isArray(content)) {
			let text = "";
			for (const block of content) {
				if (
					typeof block === "object" &&
					block !== null &&
					"type" in block &&
					block.type === "text" &&
					"text" in block &&
					typeof block.text === "string"
				) {
					text += block.text;
					if (text.length >= TREE_PREVIEW_MAX_CHARS) break;
				}
			}
			return text;
		}
		return "";
	};

	switch (entry.type) {
		case "message": {
			const message = entry.message;
			if (!("content" in message)) return `[${message.role}]`;
			const text = normalize(textContent(message.content));
			if (text) return `${message.role}: ${text}`;
			if (message.role === "toolResult" && message.toolName) return `[${message.toolName}]`;
			return `[${message.role}]`;
		}
		case "custom_message": {
			const content = typeof entry.content === "string" ? entry.content : textContent(entry.content);
			return normalize(`[${entry.customType}]: ${content}`);
		}
		case "compaction":
			return `[compaction: ${Math.round(entry.tokensBefore / 1000)}k tokens]`;
		case "branch_summary":
			return normalize(`[branch summary]: ${entry.summary}`);
		case "model_change":
			return `[model: ${entry.model}]`;
		case "thinking_level_change":
			return `[thinking: ${entry.thinkingLevel ?? "off"}]`;
		case "service_tier_change": {
			if (!entry.serviceTier) return "[service tier: default]";
			const tiers = Object.entries(entry.serviceTier)
				.map(([family, tier]) => `${family}:${tier}`)
				.join(" ");
			return `[service tier: ${tiers}]`;
		}
		case "label":
			return entry.label ? `[label: ${entry.label}]` : "[label: cleared]";
		case "title_change":
			return `[title: ${entry.title}]`;
		case "mode_change":
			return `[mode: ${entry.mode}]`;
		case "credential_pin":
			return `[credential pin: ${entry.provider}]`;
		case "custom":
			return `[${entry.customType}]`;
		case "reset_boundary":
			return "[reset]";
		case "ttsr_injection":
			return `[ttsr: ${entry.injectedRules.length} rules]`;
		case "session_init":
			return normalize(`[agent: ${entry.agent ?? "session"}] ${entry.task}`);
		default:
			return `[${(entry as { type?: string }).type?.replaceAll("_", " ") ?? "entry"}]`;
	}
}
