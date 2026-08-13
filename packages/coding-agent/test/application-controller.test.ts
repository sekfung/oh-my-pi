import { afterEach, describe, expect, test, vi } from "bun:test";
import {
	AgentSessionApplicationRuntime,
	ApplicationController,
	type ApplicationRuntime,
	type ApplicationRuntimeSnapshot,
	ApplicationStaleRevisionError,
} from "../src/application/application-controller";
import type { ApplicationChangedEvent, ApplicationIntent } from "../src/application/application-types";
import { SessionManager } from "../src/session/session-manager";

afterEach(() => vi.restoreAllMocks());

class TestApplicationRuntime implements ApplicationRuntime {
	readonly executed: ApplicationIntent[] = [];
	readonly #listeners = new Set<() => void>();
	#snapshot: ApplicationRuntimeSnapshot = {
		project: { path: "/workspace/project", name: "project" },
		activeSession: {
			id: "session-1",
			isStreaming: false,
			isCompacting: false,
			queuedMessageCount: 0,
			queue: { items: [], hiddenCount: 0 },
			transcript: { messageCount: 0 },
		},
		sessions: [],
	};

	readSnapshot(): Promise<ApplicationRuntimeSnapshot> {
		return Promise.resolve(this.#snapshot);
	}

	execute(intent: ApplicationIntent): Promise<boolean> {
		this.executed.push(intent);
		if (intent.type === "new_session") {
			this.#snapshot = {
				...this.#snapshot,
				activeSession: { ...this.#snapshot.activeSession, id: `session-${this.executed.length + 1}` },
			};
		}
		return Promise.resolve(true);
	}

	subscribe(listener: () => void): () => void {
		this.#listeners.add(listener);
		return () => this.#listeners.delete(listener);
	}

	emitRuntimeChange(): void {
		for (const listener of this.#listeners) listener();
	}
}

describe("ApplicationController", () => {
	test("publishes authoritative revisions and gap-free change sequences", async () => {
		const runtime = new TestApplicationRuntime();
		const events: ApplicationChangedEvent[] = [];
		const application = new ApplicationController(runtime, event => events.push(event));

		expect(await application.snapshot()).toMatchObject({ sequence: 0, revision: 1 });
		runtime.emitRuntimeChange();
		runtime.emitRuntimeChange();

		expect(events).toEqual([
			{ type: "application_changed", sequence: 1, revision: 2, reason: "runtime" },
			{ type: "application_changed", sequence: 2, revision: 3, reason: "runtime" },
		]);
		expect(await application.snapshot()).toMatchObject({ sequence: 2, revision: 3 });
		application.dispose();
	});

	test("deduplicates a repeated intent identifier and returns the resulting snapshot", async () => {
		const runtime = new TestApplicationRuntime();
		const application = new ApplicationController(runtime, () => {});
		const request = {
			intentId: "intent-1",
			expectedRevision: 1,
			intent: { type: "new_session" as const },
		};

		const [first, repeated] = await Promise.all([application.execute(request), application.execute(request)]);

		expect(runtime.executed).toEqual([{ type: "new_session" }]);
		expect(first).toEqual(repeated);
		expect(first).toMatchObject({
			intentId: "intent-1",
			applied: true,
			snapshot: { revision: 2, activeSession: { id: "session-2" } },
		});
		application.dispose();
	});

	test("serializes mutations and rejects a selection based on a stale revision", async () => {
		const runtime = new TestApplicationRuntime();
		const application = new ApplicationController(runtime, () => {});
		const first = application.execute({
			intentId: "intent-1",
			expectedRevision: 1,
			intent: { type: "new_session" },
		});
		const stale = application.execute({
			intentId: "intent-2",
			expectedRevision: 1,
			intent: { type: "switch_session", sessionPath: "/workspace/session.jsonl" },
		});

		await expect(first).resolves.toMatchObject({ applied: true, snapshot: { revision: 2 } });
		await expect(stale).rejects.toBeInstanceOf(ApplicationStaleRevisionError);
		expect(runtime.executed).toEqual([{ type: "new_session" }]);
		application.dispose();
	});
});

describe("AgentSessionApplicationRuntime session boundaries", () => {
	test("rejects deletion of the active session even when a host submits the intent directly", async () => {
		const activePath = "/sessions/active.jsonl";
		vi.spyOn(SessionManager, "list").mockResolvedValue([{ path: activePath }] as never);
		const runtime = new AgentSessionApplicationRuntime({
			sessionFile: activePath,
			sessionManager: { getCwd: () => "/workspace/project" },
		} as never);

		await expect(runtime.execute({ type: "delete_session", sessionPath: activePath })).rejects.toThrow(
			"Cannot delete the active desktop session",
		);
	});

	test("does not mutate a session path outside the active project catalog", async () => {
		vi.spyOn(SessionManager, "list").mockResolvedValue([]);
		const runtime = new AgentSessionApplicationRuntime({
			sessionFile: "/sessions/active.jsonl",
			sessionManager: { getCwd: () => "/workspace/project" },
		} as never);

		await expect(runtime.execute({ type: "delete_session", sessionPath: "/outside/session.jsonl" })).resolves.toBe(
			false,
		);
	});
});
