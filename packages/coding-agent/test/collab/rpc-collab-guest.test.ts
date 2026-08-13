/**
 * RPC-side guest contract: `RpcCollabGuest` (the headless counterpart to the
 * TUI's `CollabGuestLink`, written for `modes/rpc/rpc-mode.ts`) against a real
 * `CollabHost` over the in-memory relay. Proves the join handshake writes a
 * replica and switches the session, that live `entry`/`event` frames replay
 * onto the real session/agent state and the RPC output stream respectively,
 * that a read-only join refuses to send prompts/aborts, and that leaving
 * restores the previous session — all without a real relay, LLM, or process
 * spawn.
 */

import { afterAll, afterEach, beforeAll, describe, expect, it } from "bun:test";
import * as path from "node:path";
import type { AgentMessage } from "@oh-my-pi/pi-agent-core";
import { CollabHost, type CollabHostContext } from "@oh-my-pi/pi-coding-agent/collab/host";
import { RpcCollabGuest, type RpcCollabGuestDeps } from "@oh-my-pi/pi-coding-agent/modes/rpc/rpc-collab-guest";
import type { RpcCollabGuestStateFrame } from "@oh-my-pi/pi-coding-agent/modes/rpc/rpc-types";
import type { AgentSession, AgentSessionEvent } from "@oh-my-pi/pi-coding-agent/session/agent-session";
import type { SessionEntry } from "@oh-my-pi/pi-coding-agent/session/session-entries";
import { getConfigRootDir } from "@oh-my-pi/pi-utils";
import { installInMemoryRelay, uninstallInMemoryRelay } from "./helpers/in-memory-relay";

interface HostHarness {
	ctx: CollabHostContext;
	emit(event: AgentSessionEvent): void;
	appendEntry(entry: SessionEntry): void;
}

/** Minimal CollabHostContext double whose subscribe/onEntryAppended hooks the test can drive directly. */
function makeHostContext(): HostHarness {
	let listener: ((event: AgentSessionEvent) => void) | undefined;
	const ctx: CollabHostContext = {
		settings: { get: () => "" } as CollabHostContext["settings"],
		sessionManager: {
			getSessionId: () => "host-sess-1",
			getCwd: () => "/tmp/host-project",
			snapshotForReplication: () => ({
				header: {
					type: "session",
					id: "host-sess-1",
					timestamp: new Date().toISOString(),
					cwd: "/tmp/host-project",
				},
				entries: [],
			}),
			onEntryAppended: undefined,
		} as unknown as CollabHostContext["sessionManager"],
		session: {
			isStreaming: false,
			isAborting: false,
			queuedMessageCount: 0,
			sessionName: "host session",
			model: { provider: "anthropic", id: "claude-sonnet-5" },
			thinkingLevel: undefined,
			subscribe: (fn: (event: AgentSessionEvent) => void) => {
				listener = fn;
				return () => {
					listener = undefined;
				};
			},
			emitNotice: () => {},
			promptCustomMessage: () => Promise.resolve(),
			abort: () => Promise.resolve(),
		} as unknown as CollabHostContext["session"],
		eventBus: undefined,
		statusLine: {
			setCollabStatus: () => {},
			invalidate: () => {},
			getCachedContextBreakdown: () => ({ usedTokens: 0, contextWindow: 0 }),
		},
		ui: { requestRender: () => {} },
		showStatus: () => {},
		updatePendingMessagesDisplay: () => {},
		collabHost: undefined,
	};
	return {
		ctx,
		emit: event => listener?.(event),
		appendEntry: entry => ctx.sessionManager.onEntryAppended?.(entry),
	};
}

interface GuestHarness {
	guest: RpcCollabGuest;
	frames: object[];
	switchedTo: string[];
	replicaMessages: AgentMessage[];
	applicationChangedCount: number;
	modelSets: unknown[];
}

function makeGuest(): GuestHarness {
	const frames: object[] = [];
	const switchedTo: string[] = [];
	const replicaMessages: AgentMessage[] = [];
	const modelSets: unknown[] = [];
	let applicationChangedCount = 0;
	const fakeAgentModel: { id: string; provider: string } | undefined = undefined;
	const fakeSession = {
		sessionFile: "/tmp/guest-project/sessions/previous.jsonl",
		messages: replicaMessages,
		switchSession: async (path: string) => {
			switchedTo.push(path);
			return true;
		},
		sessionManager: {
			ingestReplicatedEntry: (_entry: SessionEntry) => {},
		},
		agent: {
			state: { model: fakeAgentModel },
			replaceMessages: (messages: AgentMessage[]) => {
				replicaMessages.length = 0;
				replicaMessages.push(...messages);
			},
			setModel: (model: unknown) => modelSets.push(model),
			setThinkingLevel: () => {},
			setDisableReasoning: () => {},
		},
	} as unknown as AgentSession;

	const deps: RpcCollabGuestDeps = {
		session: fakeSession,
		settings: { get: () => "" } as RpcCollabGuestDeps["settings"],
		eventBus: undefined,
		output: frame => frames.push(frame),
		uiContext: {
			select: async () => "chosen",
			editor: async () => "typed",
		},
		notifyApplicationChanged: () => {
			applicationChangedCount++;
		},
	};
	const guest = new RpcCollabGuest(deps);
	return {
		guest,
		frames,
		switchedTo,
		replicaMessages,
		get applicationChangedCount() {
			return applicationChangedCount;
		},
		modelSets,
	};
}

let hostHarness: HostHarness;
let host: CollabHost;
const guestCleanups: (() => void)[] = [];

beforeAll(async () => {
	installInMemoryRelay();
	hostHarness = makeHostContext();
	host = new CollabHost(hostHarness.ctx);
	await host.start("ws://localhost:8787");
});

afterEach(() => {
	for (const cleanup of guestCleanups.splice(0).reverse()) cleanup();
});

afterAll(async () => {
	uninstallInMemoryRelay();
	await host.stop("test done");
});

function stateFrames(frames: object[]): RpcCollabGuestStateFrame["data"][] {
	return frames
		.filter((frame): frame is RpcCollabGuestStateFrame => (frame as { type?: string }).type === "collab_guest_state")
		.map(frame => frame.data);
}

/**
 * Poll `check` until it returns true or `timeoutMs` elapses. Frame delivery
 * crosses a real AES-GCM seal/open (async Web Crypto) plus the in-memory
 * relay's own microtask hops, so a fixed delay is not a reliable bound —
 * poll instead of guessing a sleep duration.
 */
async function waitFor(check: () => boolean, timeoutMs = 2000): Promise<void> {
	const deadline = Date.now() + timeoutMs;
	while (!check()) {
		if (Date.now() >= deadline) throw new Error(`waitFor: condition not met within ${timeoutMs}ms`);
		await new Promise(resolve => setTimeout(resolve, 5));
	}
}

describe("RpcCollabGuest against a real CollabHost", () => {
	it("joins, replicates the welcome snapshot, and applies the host's model state", async () => {
		const harness = makeGuest();
		guestCleanups.push(() => void harness.guest.leave());

		await harness.guest.join(host.link);

		const expectedReplicaPath = path.join(getConfigRootDir(), "collab", `${harness.guest.roomId}.jsonl`);
		expect(harness.switchedTo).toEqual([expectedReplicaPath]);
		expect(harness.guest.readOnly).toBe(false);
		expect(harness.applicationChangedCount).toBe(1);
		expect(harness.modelSets).toEqual([{ provider: "anthropic", id: "claude-sonnet-5" }]);

		const states = stateFrames(harness.frames);
		expect(states.at(-1)).toMatchObject({ joined: true, readOnly: false });
	});

	it("replays a live entry onto the replica session and forwards live events", async () => {
		const harness = makeGuest();
		guestCleanups.push(() => void harness.guest.leave());
		await harness.guest.join(host.link);
		harness.frames.length = 0;

		const message: AgentMessage = { role: "user", content: "hello from host", timestamp: Date.now() } as AgentMessage;
		hostHarness.appendEntry({
			type: "message",
			id: "entry-1",
			timestamp: new Date().toISOString(),
			message,
		} as unknown as SessionEntry);

		await waitFor(() => harness.replicaMessages.length > 0);
		expect(harness.replicaMessages).toEqual([message]);

		hostHarness.emit({ type: "agent_start" } as AgentSessionEvent);
		await waitFor(() => harness.frames.some(frame => (frame as { type?: string }).type === "agent_start"));
		expect(harness.frames).toContainEqual({ type: "agent_start" });
	});

	it("refuses to send prompts/aborts on a read-only (view) link", async () => {
		const harness = makeGuest();
		guestCleanups.push(() => void harness.guest.leave());

		await harness.guest.join(host.viewLink);
		expect(harness.guest.readOnly).toBe(true);

		expect(harness.guest.sendPrompt("should not go through")).toBe(false);
		expect(harness.guest.sendAbort()).toBe(false);
	});

	it("restores the previous session and re-notifies on leave", async () => {
		const harness = makeGuest();
		await harness.guest.join(host.link);
		const changesAfterJoin = harness.applicationChangedCount;

		await harness.guest.leave();

		expect(harness.switchedTo.at(-1)).toBe("/tmp/guest-project/sessions/previous.jsonl");
		expect(harness.applicationChangedCount).toBe(changesAfterJoin + 1);
		expect(harness.guest.left).toBe(true);
		const states = stateFrames(harness.frames);
		expect(states.at(-1)).toMatchObject({ joined: false });
	});
});
