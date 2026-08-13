import { describe, expect, test } from "bun:test";
import {
	isBashOutput,
	isHostInteraction,
	isSubagentFrame,
	readApplicationSnapshot,
	readApprovalPolicies,
	readAsyncJobs,
	readAvailableModels,
	readBashResult,
	readCollabGuestState,
	readCollabState,
	readContextState,
	readGoalUpdatedFrame,
	readMessages,
	readResourcesSnapshot,
	readSessionState,
	readSessionStats,
	readSettingsSchema,
	readSettingValues,
	readSlashCommands,
	readSubagents,
	readUpdateStatus,
	readWorkflowState,
	readWorkspaceReview,
} from "../src/lib/desktop-protocol";

describe("desktop protocol validation", () => {
	test("projects a valid sidecar state without trusting unknown fields", () => {
		const state = readSessionState({
			sessionId: "session-1",
			sessionName: "Desktop work",
			model: { provider: "openai", id: "gpt-5", name: "GPT-5", ignored: true },
			thinkingLevel: "high",
			isStreaming: true,
			isCompacting: false,
			messageCount: 7,
			queuedMessageCount: 2,
			queue: {
				items: [{ id: "queue-1", delivery: "steer", text: "Check the tests" }],
				hiddenCount: 1,
			},
			ignored: "not projected",
		});

		expect(state).toEqual({
			sessionId: "session-1",
			sessionName: "Desktop work",
			model: { provider: "openai", id: "gpt-5", name: "GPT-5" },
			thinkingLevel: "high",
			isStreaming: true,
			isCompacting: false,
			messageCount: 7,
			queuedMessageCount: 2,
			queue: {
				items: [{ id: "queue-1", delivery: "steer", text: "Check the tests", images: undefined }],
				hiddenCount: 1,
			},
			tree: { nodes: [], leafId: null },
		});
	});

	test("rejects malformed state and message responses at the presentation boundary", () => {
		expect(() => readSessionState({ isStreaming: false })).toThrow("invalid session state");
		expect(() => readMessages({ messages: "not-an-array" })).toThrow("invalid messages");
	});

	test("recognizes extension interactions while leaving other events generic", () => {
		expect(
			isHostInteraction({
				type: "extension_ui_request",
				id: "interaction-1",
				method: "confirm",
				title: "Run?",
				message: "Run tool",
			}),
		).toBe(true);
		expect(isHostInteraction({ type: "agent_start" })).toBe(false);
	});

	test("validates the authoritative application snapshot and session catalog", () => {
		const snapshot = readApplicationSnapshot({
			protocolVersion: 1,
			sequence: 4,
			revision: 7,
			project: { path: "/workspace/project", name: "project" },
			activeSession: {
				id: "session-1",
				path: "/sessions/session-1.jsonl",
				title: "Desktop work",
				isStreaming: false,
				isCompacting: false,
				queuedMessageCount: 0,
				queue: {
					items: [{ id: "queue-2", delivery: "followUp", text: "Then package it" }],
					hiddenCount: 0,
				},
				transcript: { messageCount: 3 },
			},
			sessions: [
				{
					path: "/sessions/session-1.jsonl",
					id: "session-1",
					createdAt: "2026-08-13T00:00:00.000Z",
					modifiedAt: "2026-08-13T00:01:00.000Z",
					messageCount: 3,
					firstMessage: "Continue the desktop app",
					status: "complete",
				},
			],
			capabilities: ["sessions.list", false],
		});

		expect(snapshot).toMatchObject({
			sequence: 4,
			revision: 7,
			activeSession: {
				sessionId: "session-1",
				sessionFile: "/sessions/session-1.jsonl",
				sessionName: "Desktop work",
				messageCount: 3,
				queue: { items: [{ id: "queue-2", delivery: "followUp", text: "Then package it" }] },
			},
			capabilities: ["sessions.list"],
			sessions: [{ id: "session-1", status: "complete" }],
		});
	});

	test("projects session tree nodes with labels and the active leaf", () => {
		const state = readSessionState({
			sessionId: "session-1",
			tree: {
				leafId: "entry-1",
				nodes: [
					{
						id: "entry-1",
						parentId: null,
						type: "message",
						label: "start",
						timestamp: "2026-08-13T00:00:00.000Z",
						preview: "user: hello",
						ignored: true,
					},
				],
			},
		});

		expect(state.tree).toEqual({
			leafId: "entry-1",
			nodes: [
				{
					id: "entry-1",
					parentId: null,
					type: "message",
					label: "start",
					timestamp: "2026-08-13T00:00:00.000Z",
					preview: "user: hello",
				},
			],
		});
	});

	test("validates the read-only workspace review projection", () => {
		const review = readWorkspaceReview({
			repository: { root: "/workspace/project", branch: "main" },
			changes: {
				summary: { staged: 1, unstaged: 2, untracked: 3 },
				entries: [{ path: "src/app.ts", staged: true, unstaged: false, untracked: false, diff: "+line" }],
				truncated: true,
			},
			files: [{ path: "src/app.ts", kind: "file" }],
			filesTruncated: false,
		});

		expect(review).toEqual({
			repository: { root: "/workspace/project", branch: "main" },
			changes: {
				summary: { staged: 1, unstaged: 2, untracked: 3 },
				entries: [{ path: "src/app.ts", staged: true, unstaged: false, untracked: false, diff: "+line" }],
				truncated: true,
			},
			files: [{ path: "src/app.ts", kind: "file" }],
			filesTruncated: false,
		});
		expect(() => readWorkspaceReview({ files: [] })).toThrow("invalid workspace review");
	});

	test("validates bash results and recognizes streaming bash output frames", () => {
		const result = readBashResult({
			output: "hello\n",
			exitCode: 0,
			cancelled: false,
			truncated: false,
			totalLines: 1,
			totalBytes: 6,
			outputLines: 1,
			outputBytes: 6,
			ignored: true,
		});
		expect(result).toEqual({
			output: "hello\n",
			exitCode: 0,
			cancelled: false,
			timedOut: false,
			truncated: false,
			totalLines: 1,
			totalBytes: 6,
			outputLines: 1,
			outputBytes: 6,
			artifactId: undefined,
			workingDir: undefined,
		});
		expect(() => readBashResult({ output: "x" })).toThrow("invalid bash result");

		expect(isBashOutput({ type: "bash_output", id: "desktop-1", chunk: "partial\n" })).toBe(true);
		expect(isBashOutput({ type: "notice", message: "hi" })).toBe(false);
	});

	test("projects the available model catalog, keeping only usable thinking efforts", () => {
		const models = readAvailableModels({
			models: [
				{
					provider: "anthropic",
					id: "claude-sonnet-4-5",
					name: "Claude Sonnet 4.5",
					contextWindow: 200000,
					reasoning: true,
					thinking: { mode: "effort", efforts: ["low", "medium", "high"] },
					apiKey: "should-not-leak",
				},
				{ provider: "openai", id: "gpt-5", contextWindow: null, reasoning: false },
			],
		});

		expect(models).toEqual([
			{
				provider: "anthropic",
				id: "claude-sonnet-4-5",
				name: "Claude Sonnet 4.5",
				contextWindow: 200000,
				reasoning: true,
				thinkingEfforts: ["low", "medium", "high"],
			},
			{
				provider: "openai",
				id: "gpt-5",
				name: "gpt-5",
				contextWindow: null,
				reasoning: false,
			},
		]);
		expect(() => readAvailableModels({ models: "not-an-array" })).toThrow("invalid available models");
	});

	test("projects approval policies per scope, dropping unrecognized decisions", () => {
		const policies = readApprovalPolicies({
			project: { bash: "allow", read: "prompt" },
			global: { bash: "allow", weird: "revoked-somehow" },
		});
		expect(policies).toEqual({
			project: { bash: "allow", read: "prompt" },
			global: { bash: "allow" },
		});
		expect(readApprovalPolicies({})).toEqual({ project: {}, global: {} });
		expect(() => readApprovalPolicies(null)).toThrow("invalid approval policies");
	});

	test("projects the available-commands push frame for slash-command completion", () => {
		expect(
			readSlashCommands([
				{ name: "compact", description: "Compact the transcript", source: "builtin", ignored: true },
				{ name: "deploy", input: { hint: "<target>" }, source: "extension" },
				{ notName: "skip me" },
			]),
		).toEqual([
			{ name: "compact", description: "Compact the transcript", hint: undefined },
			{ name: "deploy", description: undefined, hint: "<target>" },
		]);
		expect(readSlashCommands("not-an-array")).toEqual([]);
	});

	test("projects context state (todos, context usage, compaction/retry flags) from get_state data", () => {
		const state = readContextState({
			todoPhases: [
				{
					name: "Phase 1",
					tasks: [
						{ content: "Read the file", status: "completed" },
						{ content: "Fix the bug", status: "blocked", blocker: "waiting on review" },
						{ content: "unknown status falls back", status: "not-a-real-status" },
					],
				},
				{ notName: "skipped phase" },
			],
			contextUsage: { tokens: 1000, contextWindow: 200000, percent: 0.5 },
			isCompacting: false,
			autoCompactionEnabled: true,
			autoRetryEnabled: false,
			ignored: "not projected",
		});
		expect(state).toEqual({
			todoPhases: [
				{
					name: "Phase 1",
					tasks: [
						{ content: "Read the file", status: "completed", blocker: undefined },
						{ content: "Fix the bug", status: "blocked", blocker: "waiting on review" },
						{ content: "unknown status falls back", status: "pending", blocker: undefined },
					],
				},
			],
			contextUsage: { tokens: 1000, contextWindow: 200000, percent: 0.5 },
			isCompacting: false,
			autoCompactionEnabled: true,
			autoRetryEnabled: false,
		});
		expect(() => readContextState(null)).toThrow("invalid session state");
	});

	test("projects background async jobs, dropping malformed entries", () => {
		const jobs = readAsyncJobs({
			jobs: [
				{ id: "job-1", type: "bash", status: "running", label: "npm test", startTime: 100 },
				{ id: "job-2", type: "task", status: "completed", label: "Explore", startTime: 50, resultText: "done" },
				{ notId: "malformed" },
			],
		});
		expect(jobs).toEqual([
			{
				id: "job-1",
				type: "bash",
				status: "running",
				label: "npm test",
				startTime: 100,
				queued: false,
				resultText: undefined,
				errorText: undefined,
			},
			{
				id: "job-2",
				type: "task",
				status: "completed",
				label: "Explore",
				startTime: 50,
				queued: false,
				resultText: "done",
				errorText: undefined,
			},
		]);
		expect(() => readAsyncJobs({})).toThrow("invalid async jobs");
	});

	test("projects the settings schema and per-scope setting values", () => {
		const schema = readSettingsSchema({
			tabs: [{ id: "appearance", label: "Appearance" }],
			groups: { appearance: ["Theme"], ignoredTab: "not-an-array" },
			settings: [
				{
					path: "theme.dark",
					tab: "appearance",
					group: "Theme",
					label: "Dark theme",
					description: "Pick a dark theme",
					type: "enum",
					enumValues: ["anthracite", "midnight"],
					options: [{ value: "anthracite", label: "Anthracite" }],
				},
				{ path: "secretKey", tab: "appearance", label: "API key", description: "…", type: "string", secret: true },
				{ notPath: "malformed" },
			],
		});
		expect(schema).toEqual({
			tabs: [{ id: "appearance", label: "Appearance" }],
			groups: { appearance: ["Theme"] },
			settings: [
				{
					path: "theme.dark",
					tab: "appearance",
					group: "Theme",
					label: "Dark theme",
					description: "Pick a dark theme",
					type: "enum",
					enumValues: ["anthracite", "midnight"],
					options: [{ value: "anthracite", label: "Anthracite", description: undefined }],
					secret: false,
				},
				{
					path: "secretKey",
					tab: "appearance",
					group: undefined,
					label: "API key",
					description: "…",
					type: "string",
					enumValues: undefined,
					options: undefined,
					secret: true,
				},
			],
		});
		expect(() => readSettingsSchema(null)).toThrow("invalid settings schema");

		const values = readSettingValues({
			values: [
				{ path: "theme.dark", value: "anthracite", scope: "project" },
				{ path: "secretKey", configured: true, scope: "global" },
				{ path: "unscoped", value: 1, scope: "not-a-scope" },
			],
		});
		expect(values).toEqual([
			{ path: "theme.dark", value: "anthracite", configured: undefined, scope: "project" },
			{ path: "secretKey", value: undefined, configured: true, scope: "global" },
		]);
		expect(() => readSettingValues({})).toThrow("invalid setting values");
	});

	test("projects a resources snapshot, dropping unrecognized entries", () => {
		const snapshot = readResourcesSnapshot({
			skills: [{ name: "deploy", description: "Deploy the app", source: "project", hide: false }, { notName: "x" }],
			skillWarnings: ["skill x failed to load"],
			prompts: [{ name: "review", path: "/p/review.md", sourceLevel: "project", providerName: "prompts" }],
			promptWarnings: [],
			plugins: [{ name: "@omp/git", version: "1.0.0", enabled: true, enabledFeatures: ["commit"] }],
			mcpServers: [{ name: "github", status: "connected", toolCount: 5, sourceLevel: "user" }],
			agents: [{ name: "reviewer", description: "Reviews code", source: "bundled" }],
			tools: [{ name: "read", description: "Read a file" }],
		});
		expect(snapshot).toEqual({
			skills: [{ name: "deploy", description: "Deploy the app", source: "project", hide: false }],
			skillWarnings: ["skill x failed to load"],
			prompts: [{ name: "review", path: "/p/review.md", sourceLevel: "project", providerName: "prompts" }],
			promptWarnings: [],
			plugins: [{ name: "@omp/git", version: "1.0.0", enabled: true, enabledFeatures: ["commit"] }],
			mcpServers: [{ name: "github", status: "connected", toolCount: 5, sourceLevel: "user" }],
			agents: [{ name: "reviewer", description: "Reviews code", source: "bundled" }],
			tools: [{ name: "read", description: "Read a file" }],
		});
		expect(() => readResourcesSnapshot(null)).toThrow("invalid resources snapshot");
		expect(readResourcesSnapshot({})).toEqual({
			skills: [],
			skillWarnings: [],
			prompts: [],
			promptWarnings: [],
			plugins: [],
			mcpServers: [],
			agents: [],
			tools: [],
		});
	});

	test("projects workflow state (plan/goal/advisor), dropping an invalid goal", () => {
		const state = readWorkflowState({
			planSettingEnabled: true,
			goalSettingEnabled: true,
			plan: { enabled: true, planFilePath: "local://PLAN.md", workflow: "parallel" },
			goal: {
				enabled: true,
				mode: "active",
				goal: {
					id: "goal-1",
					objective: "Ship the feature",
					status: "active",
					tokenBudget: 50000,
					tokensUsed: 1200,
					timeUsedSeconds: 30,
					createdAt: 1000,
					updatedAt: 2000,
				},
			},
			advisor: { configured: true, advisors: [{ name: "reviewer", status: "running" }] },
		});
		expect(state).toEqual({
			planSettingEnabled: true,
			goalSettingEnabled: true,
			plan: { enabled: true, planFilePath: "local://PLAN.md", workflow: "parallel" },
			goal: {
				enabled: true,
				mode: "active",
				goal: {
					id: "goal-1",
					objective: "Ship the feature",
					status: "active",
					tokenBudget: 50000,
					tokensUsed: 1200,
					timeUsedSeconds: 30,
					createdAt: 1000,
					updatedAt: 2000,
				},
			},
			advisor: { configured: true, advisors: [{ name: "reviewer", status: "running" }] },
		});
		expect(() => readWorkflowState(null)).toThrow("invalid workflow state");
		// A goal object missing required fields drops the whole `goal` state instead of throwing.
		expect(readWorkflowState({ goal: { enabled: true, mode: "active", goal: { id: "g" } } }).goal).toBeUndefined();
		expect(readWorkflowState({}).advisor).toEqual({ configured: false, advisors: [] });
	});

	test("projects subagent snapshots, filtering malformed entries and defaulting unknown status", () => {
		const subagents = readSubagents({
			subagents: [
				{
					id: "sub-1",
					index: 0,
					agent: "explorer",
					description: "Find callers",
					status: "running",
					task: "grep for callers",
					lastUpdate: 1700,
					progress: {
						currentTool: "grep",
						toolCount: 3,
						tokens: 1500,
						cost: 0.02,
						durationMs: 4000,
						retryState: { attempt: 1 },
					},
				},
				{ id: "sub-2", index: 1, agent: "bad-status", status: "not-a-real-status", lastUpdate: 1701 },
				{ notAnId: true },
			],
		});
		expect(subagents).toEqual([
			{
				id: "sub-1",
				index: 0,
				agent: "explorer",
				description: "Find callers",
				status: "running",
				task: "grep for callers",
				assignment: undefined,
				lastUpdate: 1700,
				progress: {
					currentTool: "grep",
					lastIntent: undefined,
					toolCount: 3,
					tokens: 1500,
					cost: 0.02,
					durationMs: 4000,
					contextTokens: undefined,
					contextWindow: undefined,
					retrying: true,
				},
			},
			{
				id: "sub-2",
				index: 1,
				agent: "bad-status",
				description: undefined,
				status: "running",
				task: undefined,
				assignment: undefined,
				lastUpdate: 1701,
				progress: undefined,
			},
		]);
		expect(() => readSubagents(null)).toThrow("invalid subagents");
	});

	test("recognizes subagent push frames and leaves other frame types alone", () => {
		expect(isSubagentFrame({ type: "subagent_lifecycle" })).toBe(true);
		expect(isSubagentFrame({ type: "subagent_progress" })).toBe(true);
		expect(isSubagentFrame({ type: "subagent_event" })).toBe(true);
		expect(isSubagentFrame({ type: "message_start" })).toBe(false);
	});

	test("projects update status, tolerating a failed check", () => {
		const available = readUpdateStatus({
			currentVersion: "17.2.15",
			latestVersion: "17.3.0",
			updateAvailable: true,
			downloadUrl: "https://omp.sh",
			checkedAt: 1000,
		});
		expect(available).toEqual({
			currentVersion: "17.2.15",
			latestVersion: "17.3.0",
			updateAvailable: true,
			downloadUrl: "https://omp.sh",
			checkedAt: 1000,
			error: undefined,
		});
		const failed = readUpdateStatus({
			currentVersion: "17.2.15",
			updateAvailable: false,
			downloadUrl: "https://omp.sh",
			checkedAt: 1000,
			error: "registry unreachable",
		});
		expect(failed.updateAvailable).toBe(false);
		expect(failed.latestVersion).toBeUndefined();
		expect(failed.error).toBe("registry unreachable");
		expect(() => readUpdateStatus(null)).toThrow("invalid update status");
	});

	test("projects session stats, defaulting missing numeric fields to zero", () => {
		const stats = readSessionStats({
			userMessages: 5,
			assistantMessages: 5,
			toolCalls: 12,
			totalMessages: 22,
			tokens: { input: 1000, output: 500, reasoning: 100, cacheRead: 800, cacheWrite: 200, total: 2600 },
			cost: 0.15,
		});
		expect(stats).toEqual({
			userMessages: 5,
			assistantMessages: 5,
			toolCalls: 12,
			totalMessages: 22,
			tokens: { input: 1000, output: 500, reasoning: 100, cacheRead: 800, cacheWrite: 200, total: 2600 },
			cost: 0.15,
		});
		expect(readSessionStats({ tokens: {} })).toEqual({
			userMessages: 0,
			assistantMessages: 0,
			toolCalls: 0,
			totalMessages: 0,
			tokens: { input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
			cost: 0,
		});
		expect(() => readSessionStats(null)).toThrow("invalid session stats");
		expect(() => readSessionStats({})).toThrow("invalid session stats");
	});

	test("projects collab host state and drops malformed participants", () => {
		const hosting = readCollabState({
			hosting: true,
			link: "relay.example.com/r/room.key",
			webLink: "https://relay.example.com/#room.key",
			viewLink: "relay.example.com/r/room.viewkey",
			webViewLink: "https://relay.example.com/#room.viewkey",
			participants: [
				{ name: "sekfung", role: "host" },
				{ name: "guest-1", role: "guest", readOnly: true },
				{ notName: true },
			],
		});
		expect(hosting).toEqual({
			hosting: true,
			link: "relay.example.com/r/room.key",
			webLink: "https://relay.example.com/#room.key",
			viewLink: "relay.example.com/r/room.viewkey",
			webViewLink: "https://relay.example.com/#room.viewkey",
			participants: [
				{ name: "sekfung", role: "host", readOnly: undefined },
				{ name: "guest-1", role: "guest", readOnly: true },
			],
		});
		expect(readCollabState({})).toEqual({
			hosting: false,
			link: undefined,
			webLink: undefined,
			viewLink: undefined,
			webViewLink: undefined,
			participants: [],
		});
		expect(() => readCollabState(null)).toThrow("invalid collab state");
	});

	test("projects collab guest state, treating a malformed host state as not-yet-synced", () => {
		const joined = readCollabGuestState({
			joined: true,
			readOnly: false,
			state: { sessionName: "Debugging together", cwd: "/workspace/project", isStreaming: true, participants: [] },
		});
		expect(joined).toEqual({
			joined: true,
			readOnly: false,
			state: { sessionName: "Debugging together", cwd: "/workspace/project", isStreaming: true, participants: [] },
		});
		expect(readCollabGuestState({ joined: true, state: {} })).toEqual({ joined: true, readOnly: false, state: null });
		expect(readCollabGuestState({})).toEqual({ joined: false, readOnly: false, state: null });
		expect(() => readCollabGuestState(null)).toThrow("invalid collab guest state");
	});

	test("reads a goal_updated push frame's goal and state", () => {
		const frame = readGoalUpdatedFrame({
			type: "goal_updated",
			goal: {
				id: "goal-1",
				objective: "Ship the feature",
				status: "complete",
				tokensUsed: 4000,
				timeUsedSeconds: 90,
				createdAt: 1000,
				updatedAt: 5000,
			},
			state: undefined,
		});
		expect(frame.goal).toEqual({
			id: "goal-1",
			objective: "Ship the feature",
			status: "complete",
			tokenBudget: undefined,
			tokensUsed: 4000,
			timeUsedSeconds: 90,
			createdAt: 1000,
			updatedAt: 5000,
		});
		expect(frame.state).toBeUndefined();

		const dropped = readGoalUpdatedFrame({ type: "goal_updated", goal: null });
		expect(dropped.goal).toBeNull();
	});
});
