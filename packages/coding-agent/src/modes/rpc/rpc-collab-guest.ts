/**
 * RPC-native guest side of a collab live session.
 *
 * Mirrors `../../collab/guest.ts` (the TUI's `CollabGuestLink`) at the wire
 * level — same join/welcome/snapshot-chunk handshake, same strict
 * in-arrival-order frame application via `#applyChain` — but with RPC-shaped
 * side effects instead of terminal rendering: `event` frames forward straight
 * through the RPC output stream (the same `session.subscribe(event =>
 * output(event))` vocabulary every RPC client already consumes), `entry`
 * frames replay onto the real session/agent state exactly like the TUI guest
 * does, and `state` frames become a dedicated push frame. Written fresh
 * rather than sharing code with `CollabGuestLink`: that class is entangled
 * with the TUI's live render state (EventController, chat container,
 * streaming component, hook dialogs) at nearly every frame type, so forcing
 * it through a shared interface would be riskier than a parallel
 * implementation of the (much simpler, headless) RPC side.
 */
import * as path from "node:path";
import { getConfigRootDir, logger } from "@oh-my-pi/pi-utils";
import { importRoomKey } from "../../collab/crypto";
import { collabDisplayName } from "../../collab/display-name";
import {
	type AgentSnapshot,
	COLLAB_PROTO,
	type CollabFrame,
	type CollabSessionState,
	type CollabUiRequest,
	parseCollabLink,
} from "../../collab/protocol";
import { CollabSocket } from "../../collab/relay-client";
import type { Settings } from "../../config/settings";
import type { ExtensionUIContext } from "../../extensibility/extensions";
import type { AgentSession, AgentSessionEvent } from "../../session/agent-session";
import type { SessionEntry } from "../../session/session-entries";
import { shouldDisableReasoning, toReasoningEffort } from "../../thinking";
import type { EventBus } from "../../utils/event-bus";
import type { RpcCollabGuestStateFrame } from "./rpc-types";

const WELCOME_TIMEOUT_MS = 30_000;
const SNAPSHOT_PROGRESS_TIMEOUT_MS = 30_000;

type WelcomeFrame = Extract<CollabFrame, { t: "welcome" }>;
type SnapshotChunkFrame = Extract<CollabFrame, { t: "snapshot-chunk" }>;

interface PendingSnapshot {
	header: WelcomeFrame["header"];
	state: WelcomeFrame["state"];
	agents: AgentSnapshot[];
	readOnly: boolean;
	entryCount: number;
	entries: SessionEntry[];
	isResync: boolean;
}

export interface RpcCollabGuestDeps {
	session: AgentSession;
	settings: Pick<Settings, "get">;
	eventBus: EventBus | undefined;
	/** Push an arbitrary frame to the RPC client (same sink `session.subscribe` events use). */
	output: (frame: object) => void;
	/** Bridges the host's `select`/`editor` ui-requests through the existing extension UI dialog pipeline. */
	uiContext: Pick<ExtensionUIContext, "select" | "editor">;
	/** Bumps the ApplicationController's revision so `execute_application_intent` callers don't race a stale snapshot. */
	notifyApplicationChanged: () => void;
}

export class RpcCollabGuest {
	readonly #deps: RpcCollabGuestDeps;
	#socket: CollabSocket | null = null;
	#roomId = "";
	#returnSessionFile: string | null = null;
	#applyChain: Promise<void> = Promise.resolve();
	#welcomed = false;
	#left = false;
	#pendingSnapshot: PendingSnapshot | null = null;
	#joinReject: ((err: Error) => void) | null = null;
	#welcomeTimer: Timer | null = null;
	#snapshotProgressTimer: Timer | null = null;
	#writeToken: string | undefined;
	#readOnly = false;
	#assistantStreamSynced = false;
	#pendingUiAborts = new Map<number, AbortController>();
	state: CollabSessionState | null = null;

	constructor(deps: RpcCollabGuestDeps) {
		this.#deps = deps;
	}

	get readOnly(): boolean {
		return this.#readOnly;
	}

	get roomId(): string {
		return this.#roomId;
	}

	get left(): boolean {
		return this.#left;
	}

	async join(link: string): Promise<void> {
		const parsed = parseCollabLink(link);
		if ("error" in parsed) throw new Error(parsed.error);
		this.#roomId = parsed.roomId;
		this.#writeToken = parsed.writeToken ? Buffer.from(parsed.writeToken).toString("base64url") : undefined;
		const key = await importRoomKey(parsed.key);

		this.#returnSessionFile = this.#deps.session.sessionFile ?? null;

		const socket = new CollabSocket({ wsUrl: parsed.wsUrl, role: "guest", key });
		this.#socket = socket;

		const firstWelcome = Promise.withResolvers<void>();
		let joined = false;
		this.#joinReject = err => firstWelcome.reject(err);
		const finishJoin = (): void => {
			if (joined) return;
			joined = true;
			firstWelcome.resolve();
		};

		socket.onOpen = () => {
			this.#welcomed = false;
			this.#pendingSnapshot = null;
			this.#clearSnapshotProgressTimer();
			this.#armWelcomeTimer();
			socket.send({
				t: "hello",
				proto: COLLAB_PROTO,
				name: collabDisplayName(this.#deps),
				writeToken: this.#writeToken,
			});
		};
		socket.onFrame = frame => {
			this.#applyChain = this.#applyChain
				.then(async () => {
					if (frame.t === "welcome") {
						this.#clearWelcomeTimer();
						this.#beginWelcome(frame, joined);
						if (frame.entryCount === 0) {
							await this.#finalizeSnapshot();
							finishJoin();
						}
						return;
					}
					if (frame.t === "snapshot-chunk") {
						const ready = this.#accumulateSnapshotChunk(frame);
						if (ready) {
							await this.#finalizeSnapshot();
							finishJoin();
						}
						return;
					}
					if (frame.t === "error" && !this.#welcomed && !this.#left) {
						this.#clearWelcomeTimer();
						if (joined) this.#emitNotice("error", `Collab host: ${frame.message}`);
						else firstWelcome.reject(new Error(frame.message));
						return;
					}
					if (!this.#welcomed || this.#left) return;
					this.#applyFrame(frame);
				})
				.catch(err => {
					logger.warn("collab guest frame apply failed", { type: frame.t, error: String(err) });
					if (!joined && (frame.t === "welcome" || frame.t === "snapshot-chunk")) {
						firstWelcome.reject(err instanceof Error ? err : new Error(String(err)));
					}
				});
		};
		socket.onClose = (reason, willReconnect) => {
			this.#clearWelcomeTimer();
			this.#clearSnapshotProgressTimer();
			if (this.#left) return;
			if (!joined) {
				firstWelcome.reject(new Error(reason));
				return;
			}
			if (willReconnect) {
				this.#emitNotice("warning", `Collab connection lost (${reason}), reconnecting…`);
				return;
			}
			this.#emitNotice("warning", `Collab session ended (${reason})`);
			void this.#restoreLocalSession();
		};
		socket.connect();
		this.#armWelcomeTimer();

		try {
			await firstWelcome.promise;
		} catch (err) {
			this.#left = true;
			socket.close();
			this.#socket = null;
			throw err;
		} finally {
			this.#joinReject = null;
			this.#clearWelcomeTimer();
			this.#clearSnapshotProgressTimer();
		}
	}

	/** User-initiated leave (or post-disconnect cleanup): restore the previous session. */
	async leave(): Promise<void> {
		if (this.#left) return;
		this.#socket?.close();
		await this.#restoreLocalSession();
	}

	sendPrompt(text: string, images?: { type: "image"; mimeType: string; data: string }[]): boolean {
		if (this.#readOnly) return false;
		this.#socket?.send({ t: "prompt", text, images: images && images.length > 0 ? images : undefined });
		return true;
	}

	sendAbort(): boolean {
		if (this.#readOnly) return false;
		this.#socket?.send({ t: "abort" });
		return true;
	}

	#emitNotice(level: "info" | "warning" | "error", message: string): void {
		this.#deps.output({ type: "notice", level, message, source: "collab" });
	}

	#buildStateFrame(): RpcCollabGuestStateFrame {
		return { type: "collab_guest_state", data: { joined: !this.#left, readOnly: this.#readOnly, state: this.state } };
	}

	#beginWelcome(frame: WelcomeFrame, isResync: boolean): void {
		if (this.#left) return;
		this.#pendingSnapshot = {
			header: frame.header,
			state: frame.state,
			agents: frame.agents,
			readOnly: frame.readOnly === true,
			entryCount: frame.entryCount,
			entries: [],
			isResync,
		};
		this.#armSnapshotProgressTimer();
	}

	#accumulateSnapshotChunk(frame: SnapshotChunkFrame): boolean {
		const pending = this.#pendingSnapshot;
		if (!pending) {
			logger.debug("collab guest dropping orphan snapshot-chunk");
			return false;
		}
		pending.entries.push(...frame.entries);
		const complete = frame.final || pending.entries.length >= pending.entryCount;
		if (complete) this.#clearSnapshotProgressTimer();
		else this.#armSnapshotProgressTimer();
		return complete;
	}

	async #finalizeSnapshot(): Promise<void> {
		const pending = this.#pendingSnapshot;
		this.#pendingSnapshot = null;
		this.#clearSnapshotProgressTimer();
		if (!pending || this.#left) return;
		const replicaPath = path.join(getConfigRootDir(), "collab", `${this.#roomId}.jsonl`);
		const lines = [pending.header, ...pending.entries].map(entry => JSON.stringify(entry)).join("\n");
		await Bun.write(replicaPath, `${lines}\n`);

		await this.#deps.session.switchSession(replicaPath);
		this.state = pending.state;
		this.#applyHostState(pending.state);
		this.#readOnly = pending.readOnly;
		this.#welcomed = true;
		this.#assistantStreamSynced = false;
		this.#deps.notifyApplicationChanged();
		this.#deps.output(this.#buildStateFrame());
		const suffix = this.#readOnly ? " (read-only)" : "";
		this.#emitNotice(
			"info",
			pending.isResync ? `Reconnected to collab session${suffix}` : `Joined collab session${suffix}`,
		);
	}

	#armWelcomeTimer(): void {
		if (this.#joinReject === null) return;
		this.#clearWelcomeTimer();
		this.#welcomeTimer = setTimeout(() => {
			this.#welcomeTimer = null;
			this.#joinReject?.(new Error("timed out waiting for the host's welcome"));
		}, WELCOME_TIMEOUT_MS);
	}

	#clearWelcomeTimer(): void {
		if (this.#welcomeTimer !== null) {
			clearTimeout(this.#welcomeTimer);
			this.#welcomeTimer = null;
		}
	}

	#armSnapshotProgressTimer(): void {
		if (this.#joinReject === null) return;
		this.#clearSnapshotProgressTimer();
		this.#snapshotProgressTimer = setTimeout(() => {
			this.#snapshotProgressTimer = null;
			this.#joinReject?.(new Error("timed out waiting for the host's session snapshot"));
		}, SNAPSHOT_PROGRESS_TIMEOUT_MS);
	}

	#clearSnapshotProgressTimer(): void {
		if (this.#snapshotProgressTimer !== null) {
			clearTimeout(this.#snapshotProgressTimer);
			this.#snapshotProgressTimer = null;
		}
	}

	#applyFrame(frame: CollabFrame): void {
		switch (frame.t) {
			case "entry": {
				// Entries are never rendered directly — event frames drive rendering
				// (prevents double-render). They keep the replica file, the agent's
				// message array (get_messages, context estimates), and todos current.
				this.#deps.session.sessionManager.ingestReplicatedEntry(frame.entry);
				if (frame.entry.type === "message") {
					this.#deps.session.agent.replaceMessages([...this.#deps.session.messages, frame.entry.message]);
				}
				break;
			}
			case "event":
				this.#applyEvent(frame.event);
				break;
			case "state":
				this.state = frame.state;
				this.#applyHostState(frame.state);
				this.#deps.output(this.#buildStateFrame());
				break;
			case "bus":
				// Mirrors the host's task-subagent lifecycle/progress traffic onto the
				// SAME EventBus channels RpcSubagentRegistry already listens on, so
				// get_subagents/subagent_* frames work for a guest with no extra code.
				this.#deps.eventBus?.emit(frame.channel, frame.data);
				break;
			case "agents":
				// Host agent-registry snapshot (Agent Hub table). Not mirrored into a
				// local registry in RPC mode yet — subagent progress already reaches
				// the guest via `bus` frames above; only the historical/idle roster a
				// fresh `agents` snapshot would restore is missing for now.
				break;
			case "ui-request":
				this.#presentUiRequest(frame.request);
				break;
			case "ui-request-end":
				this.#pendingUiAborts.get(frame.reqId)?.abort();
				this.#pendingUiAborts.delete(frame.reqId);
				break;
			case "bye":
				this.#emitNotice("info", `Collab session ended (${frame.reason})`);
				this.#socket?.close();
				void this.#restoreLocalSession();
				break;
			case "error":
				this.#emitNotice("error", `Collab host: ${frame.message}`);
				break;
			default:
				logger.debug("collab guest ignoring unexpected frame", { type: (frame as { t: string }).t });
		}
	}

	#applyEvent(event: AgentSessionEvent): void {
		// Orphan-delta guard: when joining mid-turn the message_start for the
		// in-flight assistant message predates the snapshot. message_update
		// carries the full accumulating message, so synthesize the missing start
		// before the first orphaned update.
		if (event.type === "message_start" && event.message.role === "assistant") {
			this.#assistantStreamSynced = true;
		} else if (
			event.type === "message_update" &&
			event.message.role === "assistant" &&
			!this.#assistantStreamSynced
		) {
			this.#assistantStreamSynced = true;
			this.#deps.output({ type: "message_start", message: event.message });
		}
		this.#deps.output(event);
	}

	/** Apply the host's real model/thinking state to the replica agent so display and context-window math are native. */
	#applyHostState(state: CollabSessionState): void {
		const session = this.#deps.session;
		if (
			state.model &&
			(session.agent.state.model?.id !== state.model.id ||
				session.agent.state.model?.provider !== state.model.provider)
		) {
			session.agent.setModel(state.model);
		}
		const level = state.thinkingLevel as Parameters<typeof toReasoningEffort>[0];
		session.agent.setThinkingLevel(toReasoningEffort(level));
		session.agent.setDisableReasoning(shouldDisableReasoning(level));
	}

	/**
	 * Bridge a host `select`/`editor` ui-request through the existing extension
	 * UI dialog pipeline (the same one tool-approval/select/editor extension
	 * requests already use). `CollabUiResponseValue` is a single optional
	 * string on the wire regardless of request kind, so this covers `select`
	 * (single choice — multi-select checkbox affordances are a terminal-only
	 * presentation detail, not a wire capability) and `editor` uniformly.
	 */
	#presentUiRequest(request: CollabUiRequest): void {
		if (this.#readOnly || this.#pendingUiAborts.has(request.reqId)) return;
		const abort = new AbortController();
		this.#pendingUiAborts.set(request.reqId, abort);
		const settle = (value: string | undefined): void => {
			if (this.#pendingUiAborts.get(request.reqId) !== abort) return;
			this.#pendingUiAborts.delete(request.reqId);
			this.#socket?.send({ t: "ui-response", reqId: request.reqId, value });
		};
		const dialog =
			request.kind === "select"
				? this.#deps.uiContext.select(
						request.title,
						request.options.map(option =>
							typeof option === "string" ? option : { label: option.label, description: option.description },
						),
						{ signal: abort.signal },
					)
				: this.#deps.uiContext.editor(request.title, request.prefill, { signal: abort.signal });
		dialog.then(settle).catch(err => {
			if (this.#pendingUiAborts.get(request.reqId) === abort) this.#pendingUiAborts.delete(request.reqId);
			logger.warn("collab guest ui-request presentation failed", { reqId: request.reqId, error: String(err) });
		});
	}

	#clearUiRequests(): void {
		const aborts = [...this.#pendingUiAborts.values()];
		this.#pendingUiAborts.clear();
		for (const abort of aborts.reverse()) abort.abort();
	}

	async #restoreLocalSession(): Promise<void> {
		if (this.#left) return;
		this.#left = true;
		this.#socket = null;
		this.#clearUiRequests();
		this.#deps.output(this.#buildStateFrame());
		// Replica file stays on disk: a valid session file outside the sessions
		// dir, so it never shows up in list/search but remains readable.
		if (this.#returnSessionFile) {
			await this.#deps.session.switchSession(this.#returnSessionFile);
		} else {
			await this.#deps.session.newSession();
		}
		this.#deps.notifyApplicationChanged();
	}
}
