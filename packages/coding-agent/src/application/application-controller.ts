import * as path from "node:path";
import type { AgentSession } from "../session/agent-session";
import type { SessionInfo } from "../session/session-listing";
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
	type ApplicationSnapshot,
} from "./application-types";

const IDEMPOTENCY_CACHE_LIMIT = 256;
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

	subscribe(listener: () => void): () => void {
		return this.#session.subscribe(event => {
			if (SNAPSHOT_EVENT_TYPES.has(event.type)) listener();
		});
	}
}
