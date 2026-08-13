import { afterEach, describe, expect, test, vi } from "bun:test";
import * as path from "node:path";
import { TempDir } from "@oh-my-pi/pi-utils";
import {
	AgentSessionApplicationRuntime,
	ApplicationController,
	type ApplicationRuntime,
	type ApplicationRuntimeSnapshot,
	ApplicationStaleRevisionError,
	describeSessionEntry,
} from "../src/application/application-controller";
import type { ApplicationChangedEvent, ApplicationIntent } from "../src/application/application-types";
import type { AgentSession } from "../src/session/agent-session";
import * as foreignSessionImport from "../src/session/foreign-session-import";
import * as sessionLoader from "../src/session/session-loader";
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
			tree: { nodes: [], leafId: null },
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

function fakeSession(overrides: Record<string, unknown> = {}): AgentSession {
	return {
		sessionId: "active",
		sessionFile: undefined,
		sessionName: "Active",
		model: undefined,
		thinkingLevel: undefined,
		isStreaming: false,
		isCompacting: false,
		queuedMessageCount: 0,
		messages: [],
		getQueuedMessageItems: () => [],
		newSession: vi.fn(async () => true),
		switchSession: vi.fn(async () => true),
		fork: vi.fn(async () => true),
		navigateTree: vi.fn(async () => ({ cancelled: false })),
		exportToHtml: vi.fn(async () => "/exported.html"),
		setSessionName: vi.fn(async () => true),
		removeQueuedMessage: vi.fn(() => undefined),
		clearQueue: () => ({ steering: [], followUp: [] }),
		subscribe: () => () => {},
		sessionManager: {
			getCwd: () => "/workspace/project",
			getTree: () => [],
			getLeafId: () => null,
			appendLabelChange: vi.fn(() => "label-entry"),
			flush: vi.fn(async () => {}),
		},
		...overrides,
	} as unknown as AgentSession;
}

describe("AgentSessionApplicationRuntime session operations", () => {
	test("clones a catalog session into an independent copy and switches to it", async () => {
		const sourcePath = "/sessions/source.jsonl";
		vi.spyOn(SessionManager, "list").mockResolvedValue([{ path: sourcePath }] as never);
		vi.spyOn(SessionManager, "cloneFrom").mockResolvedValue({
			getSessionFile: () => "/sessions/clone.jsonl",
			close: vi.fn(async () => {}),
		} as never);
		const session = fakeSession();
		const runtime = new AgentSessionApplicationRuntime(session);

		await expect(runtime.execute({ type: "clone_session", sessionPath: sourcePath })).resolves.toBe(true);

		expect(SessionManager.cloneFrom).toHaveBeenCalledWith(
			sourcePath,
			"/workspace/project",
			undefined,
			expect.anything(),
			{
				suppressBreadcrumb: true,
			},
		);
		expect(session.switchSession).toHaveBeenCalledWith("/sessions/clone.jsonl");
	});

	test("flushes the live journal before cloning the active session", async () => {
		const activePath = "/sessions/active.jsonl";
		vi.spyOn(SessionManager, "list").mockResolvedValue([{ path: activePath }] as never);
		vi.spyOn(SessionManager, "cloneFrom").mockResolvedValue({
			getSessionFile: () => "/sessions/clone.jsonl",
			close: vi.fn(async () => {}),
		} as never);
		const session = fakeSession({ sessionFile: activePath });
		const runtime = new AgentSessionApplicationRuntime(session);

		await expect(runtime.execute({ type: "clone_session", sessionPath: activePath })).resolves.toBe(true);

		expect(session.sessionManager.flush).toHaveBeenCalledTimes(1);
		expect(SessionManager.cloneFrom).toHaveBeenCalledWith(
			activePath,
			"/workspace/project",
			undefined,
			expect.anything(),
			{
				suppressBreadcrumb: true,
			},
		);
	});

	test("refuses to clone the active session while a turn is streaming", async () => {
		const activePath = "/sessions/active.jsonl";
		vi.spyOn(SessionManager, "list").mockResolvedValue([{ path: activePath }] as never);
		const cloneSpy = vi.spyOn(SessionManager, "cloneFrom").mockResolvedValue({} as never);
		const runtime = new AgentSessionApplicationRuntime(fakeSession({ sessionFile: activePath, isStreaming: true }));

		await expect(runtime.execute({ type: "clone_session", sessionPath: activePath })).rejects.toThrow(
			"Cannot clone while a turn is streaming",
		);
		expect(cloneSpy).not.toHaveBeenCalled();
	});

	test("forks the active session in place through the live session", async () => {
		const activePath = "/sessions/active.jsonl";
		vi.spyOn(SessionManager, "list").mockResolvedValue([{ path: activePath }] as never);
		const session = fakeSession({ sessionFile: activePath });
		const runtime = new AgentSessionApplicationRuntime(session);

		await expect(runtime.execute({ type: "fork_session", sessionPath: activePath })).resolves.toBe(true);

		expect(session.fork).toHaveBeenCalledTimes(1);
		expect(session.switchSession).not.toHaveBeenCalled();
	});

	test("forks an inactive catalog session and switches to the fork", async () => {
		const sourcePath = "/sessions/source.jsonl";
		vi.spyOn(SessionManager, "list").mockResolvedValue([{ path: sourcePath }] as never);
		vi.spyOn(SessionManager, "forkFrom").mockResolvedValue({
			getSessionFile: () => "/sessions/fork.jsonl",
			close: vi.fn(async () => {}),
		} as never);
		const session = fakeSession();
		const runtime = new AgentSessionApplicationRuntime(session);

		await expect(runtime.execute({ type: "fork_session", sessionPath: sourcePath })).resolves.toBe(true);

		expect(SessionManager.forkFrom).toHaveBeenCalledWith(
			sourcePath,
			"/workspace/project",
			undefined,
			expect.anything(),
			{
				suppressBreadcrumb: true,
			},
		);
		expect(session.switchSession).toHaveBeenCalledWith("/sessions/fork.jsonl");
	});

	test("imports a foreign transcript file and switches to the persisted copy", async () => {
		using tempDir = TempDir.createSync("@omp-app-import-");
		const sourceFile = path.join(tempDir.path(), "claude.jsonl");
		await Bun.write(sourceFile, '{"type":"user","uuid":"1","message":{"role":"user","content":"hi"}}\n');
		vi.spyOn(foreignSessionImport, "persistForeignSession").mockResolvedValue({
			getSessionFile: () => "/sessions/imported.jsonl",
			close: vi.fn(async () => {}),
		} as never);
		const session = fakeSession();
		const runtime = new AgentSessionApplicationRuntime(session);

		await expect(runtime.execute({ type: "import_session", path: sourceFile, source: "claude" })).resolves.toBe(true);

		expect(foreignSessionImport.persistForeignSession).toHaveBeenCalledWith(
			expect.anything(),
			expect.objectContaining({ source: "claude", path: sourceFile }),
			{ fallbackCwd: "/workspace/project", suppressBreadcrumb: true },
		);
		expect(session.switchSession).toHaveBeenCalledWith("/sessions/imported.jsonl");
	});

	test("exports the active session to HTML without switching", async () => {
		const activePath = "/sessions/active.jsonl";
		vi.spyOn(SessionManager, "list").mockResolvedValue([{ path: activePath }] as never);
		const session = fakeSession({ sessionFile: activePath });
		const runtime = new AgentSessionApplicationRuntime(session);

		await expect(
			runtime.execute({ type: "export_session", sessionPath: activePath, format: "html", outputPath: "/out.html" }),
		).resolves.toBe(true);

		expect(session.exportToHtml).toHaveBeenCalledWith("/out.html");
		expect(session.switchSession).not.toHaveBeenCalled();
	});

	test("exports an inactive catalog session to markdown from its persisted messages", async () => {
		using tempDir = TempDir.createSync("@omp-app-export-");
		const sourcePath = "/sessions/source.jsonl";
		const outputPath = path.join(tempDir.path(), "export.md");
		vi.spyOn(SessionManager, "list").mockResolvedValue([{ path: sourcePath }] as never);
		vi.spyOn(sessionLoader, "loadSessionMessagesReadOnly").mockResolvedValue([
			{ role: "user", content: "hello", timestamp: 0 },
		] as never);
		const runtime = new AgentSessionApplicationRuntime(fakeSession());

		await expect(
			runtime.execute({ type: "export_session", sessionPath: sourcePath, format: "markdown", outputPath }),
		).resolves.toBe(true);

		expect(sessionLoader.loadSessionMessagesReadOnly).toHaveBeenCalledWith(sourcePath);
		expect(await Bun.file(outputPath).exists()).toBe(true);
	});

	test("labels a tree entry through the session manager", async () => {
		const session = fakeSession();
		const runtime = new AgentSessionApplicationRuntime(session);

		await expect(runtime.execute({ type: "tree_label", entryId: "entry-1", label: "checkpoint" })).resolves.toBe(
			true,
		);

		expect(session.sessionManager.appendLabelChange).toHaveBeenCalledWith("entry-1", "checkpoint");
	});

	test("reports cancelled tree navigation without a session change", async () => {
		const navigateTree = vi.fn(async () => ({ cancelled: true }));
		const session = fakeSession({ navigateTree });
		const runtime = new AgentSessionApplicationRuntime(session);

		await expect(runtime.execute({ type: "tree_navigate", entryId: "entry-1" })).resolves.toBe(false);
		expect(navigateTree).toHaveBeenCalledWith("entry-1", {});
	});

	test("forks from a tree entry after navigating to it", async () => {
		const session = fakeSession();
		const runtime = new AgentSessionApplicationRuntime(session);

		await expect(runtime.execute({ type: "tree_fork", entryId: "entry-1" })).resolves.toBe(true);

		expect(session.navigateTree).toHaveBeenCalledWith("entry-1", {});
		expect(session.fork).toHaveBeenCalledTimes(1);
	});
});

describe("AgentSessionApplicationRuntime tree projection", () => {
	test("projects the active journal tree with bounded previews and the live leaf", async () => {
		vi.spyOn(SessionManager, "list").mockResolvedValue([]);
		const session = fakeSession({
			sessionManager: {
				getCwd: () => "/workspace/project",
				getLeafId: () => "message-1",
				getTree: () => [
					{
						entry: {
							type: "message",
							id: "message-1",
							parentId: null,
							timestamp: "2026-08-13T00:00:00.000Z",
							message: { role: "user", content: [{ type: "text", text: "hello" }], timestamp: 0 },
						},
						children: [],
						label: "start",
					},
				],
			},
		});
		const runtime = new AgentSessionApplicationRuntime(session);

		const snapshot = await runtime.readSnapshot();

		expect(snapshot.activeSession.tree).toEqual({
			leafId: "message-1",
			nodes: [
				{
					id: "message-1",
					parentId: null,
					type: "message",
					label: "start",
					timestamp: "2026-08-13T00:00:00.000Z",
					preview: "user: hello",
				},
			],
		});
	});
});

describe("describeSessionEntry", () => {
	test("previews message content with a bounded length", () => {
		expect(
			describeSessionEntry({
				type: "message",
				id: "m1",
				parentId: null,
				timestamp: "2026-08-13T00:00:00.000Z",
				message: { role: "user", content: "hello world", timestamp: 0 },
			}),
		).toBe("user: hello world");
	});

	test("falls back to the entry type for bookkeeping entries", () => {
		expect(
			describeSessionEntry({
				type: "reset_boundary",
				id: "r1",
				parentId: null,
				timestamp: "2026-08-13T00:00:00.000Z",
			}),
		).toBe("[reset]");
	});
});
