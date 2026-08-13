export interface DesktopImageContent {
	type: "image";
	mimeType: string;
	data: string;
}

export type DesktopRpcCommand =
	| { type: "negotiate_protocol"; protocolVersion: 2 }
	| { type: "get_state" }
	| { type: "get_messages" }
	| { type: "get_application_snapshot" }
	| { type: "get_workspace_review" }
	| {
			type: "execute_application_intent";
			intentId: string;
			expectedRevision: number;
			intent:
				| { type: "new_session"; parentSession?: string }
				| { type: "switch_session"; sessionPath: string }
				| { type: "rename_session"; sessionPath: string; title: string }
				| { type: "delete_session"; sessionPath: string }
				| { type: "clone_session"; sessionPath: string }
				| { type: "fork_session"; sessionPath: string }
				| { type: "import_session"; path: string; source: "claude" | "codex" }
				| { type: "export_session"; sessionPath: string; format: "html" | "markdown"; outputPath: string }
				| { type: "tree_navigate"; entryId: string }
				| { type: "tree_fork"; entryId: string }
				| { type: "tree_label"; entryId: string; label?: string }
				| { type: "remove_queue_item"; queueItemId: string }
				| { type: "clear_queue" };
	  }
	| { type: "prompt"; message: string; images?: DesktopImageContent[]; streamingBehavior?: "steer" | "followUp" }
	| { type: "steer"; message: string; images?: DesktopImageContent[] }
	| { type: "follow_up"; message: string; images?: DesktopImageContent[] }
	| { type: "abort" }
	| { type: "new_session"; parentSession?: string }
	| { type: "cycle_model" }
	| { type: "cycle_thinking_level" }
	| { type: "bash"; command: string; excludeFromContext?: boolean }
	| { type: "abort_bash" }
	| { type: "get_available_models" }
	| { type: "set_model"; provider: string; modelId: string }
	| { type: "set_thinking_level"; level: string }
	| { type: "get_approval_policies" }
	| { type: "set_approval_policy"; scope: "project" | "global"; policyKey: string; policy: "allow" | "deny" }
	| { type: "clear_approval_policy"; scope: "project" | "global"; policyKey: string }
	| { type: "compact"; customInstructions?: string }
	| { type: "set_auto_compaction"; enabled: boolean }
	| { type: "set_auto_retry"; enabled: boolean }
	| { type: "abort_retry" }
	| { type: "get_async_jobs" }
	| { type: "abort_async_job"; jobId: string }
	| { type: "get_settings_schema" }
	| { type: "get_settings_values" }
	| { type: "set_setting_value"; path: string; scope: "project" | "global"; value: unknown }
	| { type: "clear_setting_value"; path: string; scope: "project" | "global" }
	| { type: "get_resources" }
	| { type: "reload_resources" }
	| { type: "get_subagents" }
	| { type: "set_subagent_subscription"; level: "off" | "progress" | "events" }
	| { type: "get_workflow_state" }
	| { type: "enter_plan_mode"; workflow?: "parallel" | "iterative" }
	| { type: "exit_plan_mode" }
	| { type: "goal_set"; objective: string; tokenBudget?: number }
	| { type: "goal_pause" }
	| { type: "goal_resume" }
	| { type: "goal_drop" }
	| { type: "goal_set_budget"; tokenBudget?: number }
	| { type: "get_update_status" }
	| { type: "get_session_stats" }
	| { type: "handoff"; customInstructions?: string }
	| { type: "collab_start"; relayUrl?: string; webUrl?: string }
	| { type: "collab_stop" }
	| { type: "get_collab_state" }
	| { type: "collab_join"; link: string }
	| { type: "collab_leave" };

export interface DesktopRpcSuccess {
	id?: string;
	type: "response";
	command: string;
	success: true;
	data?: unknown;
}

export interface DesktopRpcFailure {
	id?: string;
	type: "response";
	command: string;
	success: false;
	error: string;
	code?: string;
}

export type DesktopRpcResponse = DesktopRpcSuccess | DesktopRpcFailure;

export interface DesktopReadyFrame {
	type: "ready";
	protocolVersion: number;
	supportedProtocolVersions: number[];
	maxFrameBytes: number;
	maxReassembledFrameBytes: number;
}

export interface DesktopSessionState {
	model?: {
		provider: string;
		id: string;
		name?: string;
	};
	thinkingLevel?: string;
	isStreaming: boolean;
	isCompacting: boolean;
	sessionFile?: string;
	sessionId: string;
	sessionName?: string;
	messageCount: number;
	queuedMessageCount: number;
	queue: {
		items: DesktopQueuedMessage[];
		hiddenCount: number;
	};
	tree: DesktopSessionTree;
}

export interface DesktopSessionTreeNode {
	id: string;
	parentId: string | null;
	type: string;
	label?: string;
	timestamp: string;
	preview: string;
}

export interface DesktopSessionTree {
	nodes: DesktopSessionTreeNode[];
	leafId: string | null;
}

export interface DesktopQueuedMessage {
	id: string;
	delivery: "steer" | "followUp";
	text: string;
	images?: DesktopImageContent[];
}

export interface DesktopApplicationSession {
	path: string;
	id: string;
	title?: string;
	createdAt: string;
	modifiedAt: string;
	messageCount: number;
	firstMessage: string;
	parentSessionPath?: string;
	status: "complete" | "interrupted" | "aborted" | "error" | "pending" | "unknown";
}

export interface DesktopApplicationSnapshot {
	protocolVersion: number;
	sequence: number;
	revision: number;
	project: { path: string; name: string };
	activeSession: DesktopSessionState;
	sessions: DesktopApplicationSession[];
	capabilities: string[];
}

export type DesktopApplicationIntent =
	| { type: "new_session"; parentSession?: string }
	| { type: "switch_session"; sessionPath: string }
	| { type: "rename_session"; sessionPath: string; title: string }
	| { type: "delete_session"; sessionPath: string }
	| { type: "clone_session"; sessionPath: string }
	| { type: "fork_session"; sessionPath: string }
	| { type: "import_session"; path: string; source: "claude" | "codex" }
	| { type: "export_session"; sessionPath: string; format: "html" | "markdown"; outputPath: string }
	| { type: "tree_navigate"; entryId: string }
	| { type: "tree_fork"; entryId: string }
	| { type: "tree_label"; entryId: string; label?: string }
	| { type: "remove_queue_item"; queueItemId: string }
	| { type: "clear_queue" };

export interface DesktopApplicationIntentResult {
	intentId: string;
	applied: boolean;
	snapshot: DesktopApplicationSnapshot;
}

export interface DesktopWorkspaceReviewChange {
	path: string;
	staged: boolean;
	unstaged: boolean;
	untracked: boolean;
	diff: string;
}

export interface DesktopWorkspaceReview {
	repository?: {
		root: string;
		branch?: string;
	};
	changes: {
		summary: { staged: number; unstaged: number; untracked: number };
		entries: DesktopWorkspaceReviewChange[];
		truncated: boolean;
	};
	files: Array<{ path: string; kind: "file" | "directory" }>;
	filesTruncated: boolean;
}

export interface DesktopBashResult {
	output: string;
	exitCode?: number;
	cancelled: boolean;
	timedOut?: boolean;
	truncated: boolean;
	totalLines: number;
	totalBytes: number;
	outputLines: number;
	outputBytes: number;
	artifactId?: string;
	workingDir?: string;
}

export function readBashResult(value: unknown): DesktopBashResult {
	if (!isRecord(value) || typeof value.output !== "string" || typeof value.cancelled !== "boolean") {
		throw new Error("Sidecar returned an invalid bash result");
	}
	return {
		output: value.output,
		exitCode: typeof value.exitCode === "number" ? value.exitCode : undefined,
		cancelled: value.cancelled,
		timedOut: value.timedOut === true,
		truncated: value.truncated === true,
		totalLines: typeof value.totalLines === "number" ? value.totalLines : 0,
		totalBytes: typeof value.totalBytes === "number" ? value.totalBytes : 0,
		outputLines: typeof value.outputLines === "number" ? value.outputLines : 0,
		outputBytes: typeof value.outputBytes === "number" ? value.outputBytes : 0,
		artifactId: typeof value.artifactId === "string" ? value.artifactId : undefined,
		workingDir: typeof value.workingDir === "string" ? value.workingDir : undefined,
	};
}

/** Incremental output pushed while a `bash` command with a matching `id` is still running. */
export interface DesktopBashOutputFrame {
	type: "bash_output";
	id: string;
	chunk: string;
}

export function isBashOutput(value: DesktopRpcFrame): value is DesktopBashOutputFrame {
	return (
		value.type === "bash_output" && "id" in value && typeof value.id === "string" && typeof value.chunk === "string"
	);
}

/** Ordered least → most intensive; mirrors `@oh-my-pi/pi-agent-core`'s `ThinkingLevel`. */
export const DESKTOP_THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"] as const;

export interface DesktopAvailableModel {
	provider: string;
	id: string;
	name: string;
	contextWindow: number | null;
	reasoning: boolean;
	/** Valid thinking efforts for this model, ordered least → most intensive; absent when it has no controllable effort. */
	thinkingEfforts?: string[];
}

function readAvailableModel(value: unknown): DesktopAvailableModel {
	if (!isRecord(value) || typeof value.provider !== "string" || typeof value.id !== "string") {
		throw new Error("Sidecar returned an invalid model entry");
	}
	const thinking = isRecord(value.thinking) ? value.thinking : undefined;
	const efforts = Array.isArray(thinking?.efforts)
		? thinking.efforts.filter((effort): effort is string => typeof effort === "string")
		: undefined;
	return {
		provider: value.provider,
		id: value.id,
		name: typeof value.name === "string" ? value.name : value.id,
		contextWindow: typeof value.contextWindow === "number" ? value.contextWindow : null,
		reasoning: value.reasoning === true,
		...(efforts && efforts.length > 0 ? { thinkingEfforts: efforts } : {}),
	};
}

export function readAvailableModels(value: unknown): DesktopAvailableModel[] {
	if (!isRecord(value) || !Array.isArray(value.models)) {
		throw new Error("Sidecar returned invalid available models");
	}
	return value.models.map(readAvailableModel);
}

export interface DesktopApprovalPolicies {
	project: Record<string, "allow" | "deny" | "prompt">;
	global: Record<string, "allow" | "deny" | "prompt">;
}

function readApprovalPolicyRecord(value: unknown): Record<string, "allow" | "deny" | "prompt"> {
	if (!isRecord(value)) return {};
	const result: Record<string, "allow" | "deny" | "prompt"> = {};
	for (const key in value) {
		if (!Object.hasOwn(value, key)) continue;
		const policy = value[key];
		if (policy === "allow" || policy === "deny" || policy === "prompt") result[key] = policy;
	}
	return result;
}

export function readApprovalPolicies(value: unknown): DesktopApprovalPolicies {
	if (!isRecord(value)) throw new Error("Sidecar returned invalid approval policies");
	return {
		project: readApprovalPolicyRecord(value.project),
		global: readApprovalPolicyRecord(value.global),
	};
}

export type DesktopTodoStatus = "pending" | "in_progress" | "completed" | "abandoned" | "blocked";

export interface DesktopTodoItem {
	content: string;
	status: DesktopTodoStatus;
	blocker?: string;
}

export interface DesktopTodoPhase {
	name: string;
	tasks: DesktopTodoItem[];
}

export interface DesktopContextUsage {
	tokens: number;
	contextWindow: number;
	percent: number;
}

export interface DesktopContextState {
	todoPhases: DesktopTodoPhase[];
	contextUsage?: DesktopContextUsage;
	isCompacting: boolean;
	autoCompactionEnabled: boolean;
	autoRetryEnabled: boolean;
}

const TODO_STATUSES: readonly DesktopTodoStatus[] = ["pending", "in_progress", "completed", "abandoned", "blocked"];

function readTodoPhase(value: unknown): DesktopTodoPhase | undefined {
	if (!isRecord(value) || typeof value.name !== "string" || !Array.isArray(value.tasks)) return undefined;
	const tasks: DesktopTodoItem[] = [];
	for (const task of value.tasks) {
		if (!isRecord(task) || typeof task.content !== "string") continue;
		const status = TODO_STATUSES.includes(task.status as DesktopTodoStatus)
			? (task.status as DesktopTodoStatus)
			: "pending";
		tasks.push({
			content: task.content,
			status,
			blocker: typeof task.blocker === "string" ? task.blocker : undefined,
		});
	}
	return { name: value.name, tasks };
}

export function readContextState(value: unknown): DesktopContextState {
	if (!isRecord(value)) throw new Error("Sidecar returned an invalid session state");
	const todoPhases = Array.isArray(value.todoPhases)
		? value.todoPhases.map(readTodoPhase).filter((phase): phase is DesktopTodoPhase => phase !== undefined)
		: [];
	const usage = isRecord(value.contextUsage) ? value.contextUsage : undefined;
	const contextUsage =
		usage &&
		typeof usage.tokens === "number" &&
		typeof usage.contextWindow === "number" &&
		typeof usage.percent === "number"
			? { tokens: usage.tokens, contextWindow: usage.contextWindow, percent: usage.percent }
			: undefined;
	return {
		todoPhases,
		contextUsage,
		isCompacting: value.isCompacting === true,
		autoCompactionEnabled: value.autoCompactionEnabled === true,
		autoRetryEnabled: value.autoRetryEnabled === true,
	};
}

export type DesktopAsyncJobStatus = "running" | "completed" | "failed" | "cancelled";

export interface DesktopAsyncJob {
	id: string;
	type: "bash" | "task";
	status: DesktopAsyncJobStatus;
	label: string;
	startTime: number;
	queued?: boolean;
	resultText?: string;
	errorText?: string;
}

function readAsyncJob(value: unknown): DesktopAsyncJob | undefined {
	if (
		!isRecord(value) ||
		typeof value.id !== "string" ||
		(value.type !== "bash" && value.type !== "task") ||
		typeof value.label !== "string" ||
		typeof value.startTime !== "number"
	) {
		return undefined;
	}
	const status: DesktopAsyncJobStatus =
		value.status === "running" ||
		value.status === "completed" ||
		value.status === "failed" ||
		value.status === "cancelled"
			? value.status
			: "completed";
	return {
		id: value.id,
		type: value.type,
		status,
		label: value.label,
		startTime: value.startTime,
		queued: value.queued === true,
		resultText: typeof value.resultText === "string" ? value.resultText : undefined,
		errorText: typeof value.errorText === "string" ? value.errorText : undefined,
	};
}

export function readAsyncJobs(value: unknown): DesktopAsyncJob[] {
	if (!isRecord(value) || !Array.isArray(value.jobs)) throw new Error("Sidecar returned invalid async jobs");
	return value.jobs.map(readAsyncJob).filter((job): job is DesktopAsyncJob => job !== undefined);
}

export interface DesktopSettingOption {
	value: string;
	label: string;
	description?: string;
}

export type DesktopSettingType = "boolean" | "string" | "number" | "enum" | "array" | "record";

export interface DesktopSettingDef {
	path: string;
	tab: string;
	group?: string;
	label: string;
	description: string;
	type: DesktopSettingType;
	enumValues?: string[];
	options?: DesktopSettingOption[] | "runtime";
	secret?: boolean;
}

export interface DesktopSettingsSchema {
	tabs: Array<{ id: string; label: string }>;
	groups: Record<string, string[]>;
	settings: DesktopSettingDef[];
}

function readSettingOption(value: unknown): DesktopSettingOption | undefined {
	if (!isRecord(value) || typeof value.value !== "string" || typeof value.label !== "string") return undefined;
	return {
		value: value.value,
		label: value.label,
		description: typeof value.description === "string" ? value.description : undefined,
	};
}

function readSettingDef(value: unknown): DesktopSettingDef | undefined {
	if (
		!isRecord(value) ||
		typeof value.path !== "string" ||
		typeof value.tab !== "string" ||
		typeof value.label !== "string" ||
		typeof value.description !== "string" ||
		typeof value.type !== "string"
	) {
		return undefined;
	}
	const options =
		value.options === "runtime"
			? ("runtime" as const)
			: Array.isArray(value.options)
				? value.options
						.map(readSettingOption)
						.filter((option): option is DesktopSettingOption => option !== undefined)
				: undefined;
	return {
		path: value.path,
		tab: value.tab,
		group: typeof value.group === "string" ? value.group : undefined,
		label: value.label,
		description: value.description,
		type: value.type as DesktopSettingType,
		enumValues: Array.isArray(value.enumValues)
			? value.enumValues.filter((entry): entry is string => typeof entry === "string")
			: undefined,
		options,
		secret: value.secret === true,
	};
}

export function readSettingsSchema(value: unknown): DesktopSettingsSchema {
	if (!isRecord(value) || !Array.isArray(value.tabs) || !isRecord(value.groups) || !Array.isArray(value.settings)) {
		throw new Error("Sidecar returned an invalid settings schema");
	}
	const tabs = value.tabs
		.filter(
			(tab): tab is { id: string; label: string } =>
				isRecord(tab) && typeof tab.id === "string" && typeof tab.label === "string",
		)
		.map(tab => ({ id: tab.id, label: tab.label }));
	const groups: Record<string, string[]> = {};
	for (const key in value.groups) {
		if (!Object.hasOwn(value.groups, key)) continue;
		const list = value.groups[key];
		if (Array.isArray(list)) groups[key] = list.filter((entry): entry is string => typeof entry === "string");
	}
	const settings = value.settings.map(readSettingDef).filter((def): def is DesktopSettingDef => def !== undefined);
	return { tabs, groups, settings };
}

export type DesktopSettingScope = "project" | "global" | "default";

export interface DesktopSettingValueEntry {
	path: string;
	value?: unknown;
	configured?: boolean;
	scope: DesktopSettingScope;
}

function readSettingValueEntry(value: unknown): DesktopSettingValueEntry | undefined {
	if (
		!isRecord(value) ||
		typeof value.path !== "string" ||
		(value.scope !== "project" && value.scope !== "global" && value.scope !== "default")
	) {
		return undefined;
	}
	return {
		path: value.path,
		value: value.value,
		configured: typeof value.configured === "boolean" ? value.configured : undefined,
		scope: value.scope,
	};
}

export function readSettingValues(value: unknown): DesktopSettingValueEntry[] {
	if (!isRecord(value) || !Array.isArray(value.values)) throw new Error("Sidecar returned invalid setting values");
	return value.values
		.map(readSettingValueEntry)
		.filter((entry): entry is DesktopSettingValueEntry => entry !== undefined);
}

export interface DesktopResourceSkill {
	name: string;
	description: string;
	source: string;
	hide?: boolean;
}

export interface DesktopResourcePrompt {
	name: string;
	path: string;
	sourceLevel: "user" | "project" | "native";
	providerName: string;
}

export interface DesktopResourcePlugin {
	name: string;
	version: string;
	enabled: boolean;
	enabledFeatures: string[] | null;
}

export interface DesktopResourceMcpServer {
	name: string;
	status: "connected" | "connecting" | "disconnected";
	toolCount?: number;
	sourceLevel?: "user" | "project" | "native";
}

export interface DesktopResourceAgent {
	name: string;
	description: string;
	source: "bundled" | "user" | "project";
}

export interface DesktopResourceTool {
	name: string;
	description: string;
}

export interface DesktopResourcesSnapshot {
	skills: DesktopResourceSkill[];
	skillWarnings: string[];
	prompts: DesktopResourcePrompt[];
	promptWarnings: string[];
	plugins: DesktopResourcePlugin[];
	mcpServers: DesktopResourceMcpServer[];
	agents: DesktopResourceAgent[];
	tools: DesktopResourceTool[];
}

function isStringArray(value: unknown): value is string[] {
	return Array.isArray(value) && value.every(entry => typeof entry === "string");
}

const SOURCE_LEVELS = ["user", "project", "native"] as const;
function readSourceLevel(value: unknown): "user" | "project" | "native" {
	return (SOURCE_LEVELS as readonly unknown[]).includes(value) ? (value as "user" | "project" | "native") : "native";
}

export function readResourcesSnapshot(value: unknown): DesktopResourcesSnapshot {
	if (!isRecord(value)) throw new Error("Sidecar returned an invalid resources snapshot");
	const skills = Array.isArray(value.skills)
		? value.skills
				.filter(
					(skill): skill is Record<string, unknown> =>
						isRecord(skill) && typeof skill.name === "string" && typeof skill.description === "string",
				)
				.map(skill => ({
					name: skill.name as string,
					description: skill.description as string,
					source: typeof skill.source === "string" ? skill.source : "",
					hide: skill.hide === true,
				}))
		: [];
	const prompts = Array.isArray(value.prompts)
		? value.prompts
				.filter((prompt): prompt is Record<string, unknown> => isRecord(prompt) && typeof prompt.name === "string")
				.map(prompt => ({
					name: prompt.name as string,
					path: typeof prompt.path === "string" ? prompt.path : "",
					sourceLevel: readSourceLevel(prompt.sourceLevel),
					providerName: typeof prompt.providerName === "string" ? prompt.providerName : "",
				}))
		: [];
	const plugins = Array.isArray(value.plugins)
		? value.plugins
				.filter((plugin): plugin is Record<string, unknown> => isRecord(plugin) && typeof plugin.name === "string")
				.map(plugin => ({
					name: plugin.name as string,
					version: typeof plugin.version === "string" ? plugin.version : "",
					enabled: plugin.enabled === true,
					enabledFeatures: isStringArray(plugin.enabledFeatures) ? plugin.enabledFeatures : null,
				}))
		: [];
	const mcpServers: DesktopResourceMcpServer[] = Array.isArray(value.mcpServers)
		? value.mcpServers
				.filter((server): server is Record<string, unknown> => isRecord(server) && typeof server.name === "string")
				.map(server => ({
					name: server.name as string,
					status:
						server.status === "connected" || server.status === "connecting" || server.status === "disconnected"
							? server.status
							: "disconnected",
					toolCount: typeof server.toolCount === "number" ? server.toolCount : undefined,
					sourceLevel: server.sourceLevel === undefined ? undefined : readSourceLevel(server.sourceLevel),
				}))
		: [];
	const agents: DesktopResourceAgent[] = Array.isArray(value.agents)
		? value.agents
				.filter((agent): agent is Record<string, unknown> => isRecord(agent) && typeof agent.name === "string")
				.map(agent => ({
					name: agent.name as string,
					description: typeof agent.description === "string" ? agent.description : "",
					source:
						agent.source === "bundled" || agent.source === "user" || agent.source === "project"
							? agent.source
							: "project",
				}))
		: [];
	const tools = Array.isArray(value.tools)
		? value.tools
				.filter((tool): tool is Record<string, unknown> => isRecord(tool) && typeof tool.name === "string")
				.map(tool => ({
					name: tool.name as string,
					description: typeof tool.description === "string" ? tool.description : "",
				}))
		: [];
	return {
		skills,
		skillWarnings: isStringArray(value.skillWarnings) ? value.skillWarnings : [],
		prompts,
		promptWarnings: isStringArray(value.promptWarnings) ? value.promptWarnings : [],
		plugins,
		mcpServers,
		agents,
		tools,
	};
}

export type DesktopGoalStatus = "active" | "paused" | "budget-limited" | "complete" | "dropped";

export interface DesktopGoal {
	id: string;
	objective: string;
	status: DesktopGoalStatus;
	tokenBudget?: number;
	tokensUsed: number;
	timeUsedSeconds: number;
	createdAt: number;
	updatedAt: number;
}

export interface DesktopGoalModeState {
	enabled: boolean;
	mode: "active" | "exiting";
	goal: DesktopGoal;
}

export interface DesktopPlanModeState {
	enabled: boolean;
	planFilePath: string;
	workflow?: "parallel" | "iterative";
}

export type DesktopAdvisorRuntimeStatus = "running" | "paused" | "quota_exhausted" | "error" | "no_model";

export interface DesktopAdvisorOverview {
	configured: boolean;
	advisors: Array<{ name: string; status: DesktopAdvisorRuntimeStatus }>;
}

export interface DesktopWorkflowState {
	planSettingEnabled: boolean;
	goalSettingEnabled: boolean;
	plan?: DesktopPlanModeState;
	goal?: DesktopGoalModeState;
	advisor: DesktopAdvisorOverview;
}

const GOAL_STATUSES: readonly DesktopGoalStatus[] = ["active", "paused", "budget-limited", "complete", "dropped"];
const ADVISOR_STATUSES: readonly DesktopAdvisorRuntimeStatus[] = [
	"running",
	"paused",
	"quota_exhausted",
	"error",
	"no_model",
];

function readGoal(value: unknown): DesktopGoal | undefined {
	if (
		!isRecord(value) ||
		typeof value.id !== "string" ||
		typeof value.objective !== "string" ||
		typeof value.tokensUsed !== "number" ||
		typeof value.timeUsedSeconds !== "number" ||
		typeof value.createdAt !== "number" ||
		typeof value.updatedAt !== "number"
	) {
		return undefined;
	}
	return {
		id: value.id,
		objective: value.objective,
		status: GOAL_STATUSES.includes(value.status as DesktopGoalStatus)
			? (value.status as DesktopGoalStatus)
			: "active",
		tokenBudget: typeof value.tokenBudget === "number" ? value.tokenBudget : undefined,
		tokensUsed: value.tokensUsed,
		timeUsedSeconds: value.timeUsedSeconds,
		createdAt: value.createdAt,
		updatedAt: value.updatedAt,
	};
}

function readGoalModeState(value: unknown): DesktopGoalModeState | undefined {
	if (!isRecord(value) || typeof value.enabled !== "boolean") return undefined;
	const goal = readGoal(value.goal);
	if (!goal) return undefined;
	return { enabled: value.enabled, mode: value.mode === "exiting" ? "exiting" : "active", goal };
}

function readPlanModeState(value: unknown): DesktopPlanModeState | undefined {
	if (!isRecord(value) || typeof value.enabled !== "boolean" || typeof value.planFilePath !== "string") {
		return undefined;
	}
	return {
		enabled: value.enabled,
		planFilePath: value.planFilePath,
		workflow: value.workflow === "iterative" ? "iterative" : value.workflow === "parallel" ? "parallel" : undefined,
	};
}

function readAdvisorOverview(value: unknown): DesktopAdvisorOverview {
	if (!isRecord(value)) return { configured: false, advisors: [] };
	const advisors = Array.isArray(value.advisors)
		? value.advisors
				.filter(
					(entry): entry is Record<string, unknown> =>
						isRecord(entry) &&
						typeof entry.name === "string" &&
						ADVISOR_STATUSES.includes(entry.status as DesktopAdvisorRuntimeStatus),
				)
				.map(entry => ({ name: entry.name as string, status: entry.status as DesktopAdvisorRuntimeStatus }))
		: [];
	return { configured: value.configured === true, advisors };
}

export function readWorkflowState(value: unknown): DesktopWorkflowState {
	if (!isRecord(value)) throw new Error("Sidecar returned an invalid workflow state");
	return {
		planSettingEnabled: value.planSettingEnabled === true,
		goalSettingEnabled: value.goalSettingEnabled === true,
		plan: readPlanModeState(value.plan),
		goal: readGoalModeState(value.goal),
		advisor: readAdvisorOverview(value.advisor),
	};
}

export type DesktopSubagentStatus = "pending" | "running" | "completed" | "failed" | "aborted";

export interface DesktopSubagentProgress {
	currentTool?: string;
	lastIntent?: string;
	toolCount: number;
	tokens: number;
	cost: number;
	durationMs: number;
	contextTokens?: number;
	contextWindow?: number;
	retrying: boolean;
}

export interface DesktopSubagentSnapshot {
	id: string;
	index: number;
	agent: string;
	description?: string;
	status: DesktopSubagentStatus;
	task?: string;
	assignment?: string;
	lastUpdate: number;
	progress?: DesktopSubagentProgress;
}

const SUBAGENT_STATUSES: readonly DesktopSubagentStatus[] = ["pending", "running", "completed", "failed", "aborted"];

function readSubagentProgress(value: unknown): DesktopSubagentProgress | undefined {
	if (!isRecord(value)) return undefined;
	return {
		currentTool: typeof value.currentTool === "string" ? value.currentTool : undefined,
		lastIntent: typeof value.lastIntent === "string" ? value.lastIntent : undefined,
		toolCount: typeof value.toolCount === "number" ? value.toolCount : 0,
		tokens: typeof value.tokens === "number" ? value.tokens : 0,
		cost: typeof value.cost === "number" ? value.cost : 0,
		durationMs: typeof value.durationMs === "number" ? value.durationMs : 0,
		contextTokens: typeof value.contextTokens === "number" ? value.contextTokens : undefined,
		contextWindow: typeof value.contextWindow === "number" ? value.contextWindow : undefined,
		retrying: isRecord(value.retryState),
	};
}

function readSubagentSnapshot(value: unknown): DesktopSubagentSnapshot | undefined {
	if (
		!isRecord(value) ||
		typeof value.id !== "string" ||
		typeof value.index !== "number" ||
		typeof value.agent !== "string" ||
		typeof value.lastUpdate !== "number"
	) {
		return undefined;
	}
	return {
		id: value.id,
		index: value.index,
		agent: value.agent,
		description: typeof value.description === "string" ? value.description : undefined,
		status: SUBAGENT_STATUSES.includes(value.status as DesktopSubagentStatus)
			? (value.status as DesktopSubagentStatus)
			: "running",
		task: typeof value.task === "string" ? value.task : undefined,
		assignment: typeof value.assignment === "string" ? value.assignment : undefined,
		lastUpdate: value.lastUpdate,
		progress: readSubagentProgress(value.progress),
	};
}

export function readSubagents(value: unknown): DesktopSubagentSnapshot[] {
	if (!isRecord(value) || !Array.isArray(value.subagents)) throw new Error("Sidecar returned invalid subagents");
	return value.subagents
		.map(readSubagentSnapshot)
		.filter((entry): entry is DesktopSubagentSnapshot => entry !== undefined);
}

export interface DesktopUpdateStatus {
	currentVersion: string;
	latestVersion?: string;
	updateAvailable: boolean;
	downloadUrl: string;
	checkedAt: number;
	error?: string;
}

export function readUpdateStatus(value: unknown): DesktopUpdateStatus {
	if (
		!isRecord(value) ||
		typeof value.currentVersion !== "string" ||
		typeof value.downloadUrl !== "string" ||
		typeof value.checkedAt !== "number"
	) {
		throw new Error("Sidecar returned an invalid update status");
	}
	return {
		currentVersion: value.currentVersion,
		latestVersion: typeof value.latestVersion === "string" ? value.latestVersion : undefined,
		updateAvailable: value.updateAvailable === true,
		downloadUrl: value.downloadUrl,
		checkedAt: value.checkedAt,
		error: typeof value.error === "string" ? value.error : undefined,
	};
}

export interface DesktopSessionStats {
	userMessages: number;
	assistantMessages: number;
	toolCalls: number;
	totalMessages: number;
	tokens: { input: number; output: number; reasoning: number; cacheRead: number; cacheWrite: number; total: number };
	cost: number;
}

export function readSessionStats(value: unknown): DesktopSessionStats {
	if (!isRecord(value) || !isRecord(value.tokens)) throw new Error("Sidecar returned invalid session stats");
	const tokens = value.tokens;
	const num = (v: unknown): number => (typeof v === "number" ? v : 0);
	return {
		userMessages: num(value.userMessages),
		assistantMessages: num(value.assistantMessages),
		toolCalls: num(value.toolCalls),
		totalMessages: num(value.totalMessages),
		tokens: {
			input: num(tokens.input),
			output: num(tokens.output),
			reasoning: num(tokens.reasoning),
			cacheRead: num(tokens.cacheRead),
			cacheWrite: num(tokens.cacheWrite),
			total: num(tokens.total),
		},
		cost: num(value.cost),
	};
}

export interface DesktopCollabParticipant {
	name: string;
	role: "host" | "guest";
	readOnly?: boolean;
}

export interface DesktopCollabState {
	hosting: boolean;
	link?: string;
	webLink?: string;
	viewLink?: string;
	webViewLink?: string;
	participants: DesktopCollabParticipant[];
}

function readCollabParticipant(value: unknown): DesktopCollabParticipant | undefined {
	if (!isRecord(value) || typeof value.name !== "string") return undefined;
	return {
		name: value.name,
		role: value.role === "host" ? "host" : "guest",
		readOnly: value.readOnly === true ? true : undefined,
	};
}

export function readCollabState(value: unknown): DesktopCollabState {
	if (!isRecord(value)) throw new Error("Sidecar returned an invalid collab state");
	return {
		hosting: value.hosting === true,
		link: typeof value.link === "string" ? value.link : undefined,
		webLink: typeof value.webLink === "string" ? value.webLink : undefined,
		viewLink: typeof value.viewLink === "string" ? value.viewLink : undefined,
		webViewLink: typeof value.webViewLink === "string" ? value.webViewLink : undefined,
		participants: Array.isArray(value.participants)
			? value.participants.map(readCollabParticipant).filter((entry): entry is DesktopCollabParticipant => !!entry)
			: [],
	};
}

export interface DesktopCollabGuestHostState {
	sessionName?: string;
	cwd: string;
	isStreaming: boolean;
	participants: DesktopCollabParticipant[];
}

export interface DesktopCollabGuestState {
	joined: boolean;
	readOnly: boolean;
	state: DesktopCollabGuestHostState | null;
}

function readCollabGuestHostState(value: unknown): DesktopCollabGuestHostState | null {
	if (!isRecord(value) || typeof value.cwd !== "string") return null;
	return {
		sessionName: typeof value.sessionName === "string" ? value.sessionName : undefined,
		cwd: value.cwd,
		isStreaming: value.isStreaming === true,
		participants: Array.isArray(value.participants)
			? value.participants.map(readCollabParticipant).filter((entry): entry is DesktopCollabParticipant => !!entry)
			: [],
	};
}

export function readCollabGuestState(value: unknown): DesktopCollabGuestState {
	if (!isRecord(value)) throw new Error("Sidecar returned an invalid collab guest state");
	return {
		joined: value.joined === true,
		readOnly: value.readOnly === true,
		state: readCollabGuestHostState(value.state),
	};
}

export interface DesktopSlashCommand {
	name: string;
	description?: string;
	hint?: string;
}

function readSlashCommand(value: unknown): DesktopSlashCommand | undefined {
	if (!isRecord(value) || typeof value.name !== "string") return undefined;
	const input = isRecord(value.input) ? value.input : undefined;
	return {
		name: value.name,
		description: typeof value.description === "string" ? value.description : undefined,
		hint: typeof input?.hint === "string" ? input.hint : undefined,
	};
}

/** Projects the sidecar's proactive `available_commands_update` push frame (built-in + extension slash commands). */
export function readSlashCommands(value: unknown): DesktopSlashCommand[] {
	if (!Array.isArray(value)) return [];
	const commands: DesktopSlashCommand[] = [];
	for (const entry of value) {
		const command = readSlashCommand(entry);
		if (command) commands.push(command);
	}
	return commands;
}

export type DesktopToolApprovalChoice = "allow_once" | "allow_project" | "deny_once" | "deny_project";

export type DesktopHostInteraction =
	| {
			type: "extension_ui_request";
			id: string;
			method: "toolApproval";
			sessionId: string;
			toolCallId: string;
			toolName: string;
			policyKey: string;
			tier: "read" | "write" | "exec";
			reason?: string;
			preview: string;
			choices: DesktopToolApprovalChoice[];
	  }
	| { type: "extension_ui_request"; id: string; method: "select"; title: string; options: string[]; timeout?: number }
	| { type: "extension_ui_request"; id: string; method: "confirm"; title: string; message: string; timeout?: number }
	| {
			type: "extension_ui_request";
			id: string;
			method: "input";
			title: string;
			placeholder?: string;
			timeout?: number;
	  }
	| {
			type: "extension_ui_request";
			id: string;
			method: "editor";
			title: string;
			prefill?: string;
			promptStyle?: boolean;
	  }
	| { type: "extension_ui_request"; id: string; method: "cancel"; targetId: string }
	| {
			type: "extension_ui_request";
			id: string;
			method: "notify";
			message: string;
			notifyType?: "info" | "warning" | "error";
	  }
	| { type: "extension_ui_request"; id: string; method: "setStatus"; statusKey: string; statusText?: string }
	| {
			type: "extension_ui_request";
			id: string;
			method: "setWidget";
			widgetKey: string;
			widgetLines?: string[];
			widgetPlacement?: "aboveEditor" | "belowEditor";
	  }
	| { type: "extension_ui_request"; id: string; method: "setTitle"; title: string }
	| { type: "extension_ui_request"; id: string; method: "set_editor_text"; text: string }
	| {
			type: "extension_ui_request";
			id: string;
			method: "open_url";
			url: string;
			launchUrl?: string;
			instructions?: string;
	  };

export type DesktopHostInteractionResponse =
	| { type: "extension_ui_response"; id: string; value: string }
	| { type: "extension_ui_response"; id: string; approvalChoice: DesktopToolApprovalChoice }
	| { type: "extension_ui_response"; id: string; confirmed: boolean }
	| { type: "extension_ui_response"; id: string; cancelled: true; timedOut?: boolean };

export type DesktopRpcFrame =
	| DesktopRpcResponse
	| DesktopReadyFrame
	| DesktopHostInteraction
	| DesktopBashOutputFrame
	| ({ type: string } & Record<string, unknown>);

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readQueuedMessage(value: unknown): DesktopQueuedMessage {
	if (
		!isRecord(value) ||
		typeof value.id !== "string" ||
		(value.delivery !== "steer" && value.delivery !== "followUp") ||
		typeof value.text !== "string"
	) {
		throw new Error("Sidecar returned an invalid queued message");
	}
	const images = Array.isArray(value.images)
		? value.images.map(image => {
				if (
					!isRecord(image) ||
					image.type !== "image" ||
					typeof image.mimeType !== "string" ||
					typeof image.data !== "string"
				) {
					throw new Error("Sidecar returned an invalid queued image");
				}
				return { type: "image" as const, mimeType: image.mimeType, data: image.data };
			})
		: undefined;
	return { id: value.id, delivery: value.delivery, text: value.text, images };
}

function readSessionTreeNode(value: unknown): DesktopSessionTreeNode {
	if (
		!isRecord(value) ||
		typeof value.id !== "string" ||
		(value.parentId !== null && typeof value.parentId !== "string") ||
		typeof value.type !== "string" ||
		typeof value.timestamp !== "string" ||
		typeof value.preview !== "string"
	) {
		throw new Error("Sidecar returned an invalid session tree node");
	}
	return {
		id: value.id,
		parentId: value.parentId as string | null,
		type: value.type,
		...(typeof value.label === "string" ? { label: value.label } : {}),
		timestamp: value.timestamp,
		preview: value.preview,
	};
}

export function readSessionState(value: unknown): DesktopSessionState {
	if (!isRecord(value) || typeof value.sessionId !== "string")
		throw new Error("Sidecar returned invalid session state");
	const model =
		isRecord(value.model) && typeof value.model.provider === "string" && typeof value.model.id === "string"
			? {
					provider: value.model.provider,
					id: value.model.id,
					...(typeof value.model.name === "string" ? { name: value.model.name } : {}),
				}
			: undefined;
	const queue = isRecord(value.queue) ? value.queue : undefined;
	const tree = isRecord(value.tree) ? value.tree : undefined;
	return {
		model,
		thinkingLevel: typeof value.thinkingLevel === "string" ? value.thinkingLevel : undefined,
		isStreaming: value.isStreaming === true,
		isCompacting: value.isCompacting === true,
		sessionFile: typeof value.sessionFile === "string" ? value.sessionFile : undefined,
		sessionId: value.sessionId,
		sessionName: typeof value.sessionName === "string" ? value.sessionName : undefined,
		messageCount: typeof value.messageCount === "number" ? value.messageCount : 0,
		queuedMessageCount: typeof value.queuedMessageCount === "number" ? value.queuedMessageCount : 0,
		queue: {
			items: Array.isArray(queue?.items) ? queue.items.map(readQueuedMessage) : [],
			hiddenCount: typeof queue?.hiddenCount === "number" ? queue.hiddenCount : 0,
		},
		tree: {
			nodes: Array.isArray(tree?.nodes) ? tree.nodes.map(readSessionTreeNode) : [],
			leafId: typeof tree?.leafId === "string" ? tree.leafId : null,
		},
	};
}

export function readMessages(value: unknown): unknown[] {
	if (!isRecord(value) || !Array.isArray(value.messages)) throw new Error("Sidecar returned invalid messages");
	return value.messages;
}

function readApplicationSession(value: unknown): DesktopApplicationSession {
	if (
		!isRecord(value) ||
		typeof value.path !== "string" ||
		typeof value.id !== "string" ||
		typeof value.createdAt !== "string" ||
		typeof value.modifiedAt !== "string"
	) {
		throw new Error("Sidecar returned an invalid application session");
	}
	const status =
		value.status === "complete" ||
		value.status === "interrupted" ||
		value.status === "aborted" ||
		value.status === "error" ||
		value.status === "pending"
			? value.status
			: "unknown";
	return {
		path: value.path,
		id: value.id,
		title: typeof value.title === "string" ? value.title : undefined,
		createdAt: value.createdAt,
		modifiedAt: value.modifiedAt,
		messageCount: typeof value.messageCount === "number" ? value.messageCount : 0,
		firstMessage: typeof value.firstMessage === "string" ? value.firstMessage : "",
		...(typeof value.parentSessionPath === "string" ? { parentSessionPath: value.parentSessionPath } : {}),
		status,
	};
}

export function readApplicationSnapshot(value: unknown): DesktopApplicationSnapshot {
	if (
		!isRecord(value) ||
		!Number.isSafeInteger(value.protocolVersion) ||
		!Number.isSafeInteger(value.sequence) ||
		!Number.isSafeInteger(value.revision) ||
		!isRecord(value.project) ||
		typeof value.project.path !== "string" ||
		typeof value.project.name !== "string" ||
		!isRecord(value.activeSession) ||
		!Array.isArray(value.sessions) ||
		!Array.isArray(value.capabilities)
	) {
		throw new Error("Sidecar returned an invalid application snapshot");
	}
	const transcript = isRecord(value.activeSession.transcript) ? value.activeSession.transcript : undefined;
	return {
		protocolVersion: value.protocolVersion as number,
		sequence: value.sequence as number,
		revision: value.revision as number,
		project: { path: value.project.path, name: value.project.name },
		activeSession: readSessionState({
			...value.activeSession,
			sessionId: value.activeSession.id,
			sessionFile: value.activeSession.path,
			sessionName: value.activeSession.title,
			messageCount: transcript?.messageCount,
		}),
		sessions: value.sessions.map(readApplicationSession),
		capabilities: value.capabilities.filter((capability): capability is string => typeof capability === "string"),
	};
}

export function readApplicationIntentResult(value: unknown): DesktopApplicationIntentResult {
	if (!isRecord(value) || typeof value.intentId !== "string" || typeof value.applied !== "boolean") {
		throw new Error("Sidecar returned an invalid application intent result");
	}
	return {
		intentId: value.intentId,
		applied: value.applied,
		snapshot: readApplicationSnapshot(value.snapshot),
	};
}

export function readWorkspaceReview(value: unknown): DesktopWorkspaceReview {
	if (
		!isRecord(value) ||
		!isRecord(value.changes) ||
		!Array.isArray(value.changes.entries) ||
		!Array.isArray(value.files)
	) {
		throw new Error("Sidecar returned an invalid workspace review");
	}
	const summary = isRecord(value.changes.summary) ? value.changes.summary : {};
	const repositorySource = isRecord(value.repository) ? value.repository : undefined;
	const repositoryRoot =
		repositorySource && typeof repositorySource.root === "string" ? repositorySource.root : undefined;
	return {
		...(repositoryRoot
			? {
					repository: {
						root: repositoryRoot,
						...(repositorySource && typeof repositorySource.branch === "string"
							? { branch: repositorySource.branch }
							: {}),
					},
				}
			: {}),
		changes: {
			summary: {
				staged: typeof summary.staged === "number" ? summary.staged : 0,
				unstaged: typeof summary.unstaged === "number" ? summary.unstaged : 0,
				untracked: typeof summary.untracked === "number" ? summary.untracked : 0,
			},
			entries: value.changes.entries.map(entry => {
				if (!isRecord(entry) || typeof entry.path !== "string" || typeof entry.diff !== "string") {
					throw new Error("Sidecar returned an invalid workspace change");
				}
				return {
					path: entry.path,
					staged: entry.staged === true,
					unstaged: entry.unstaged === true,
					untracked: entry.untracked === true,
					diff: entry.diff,
				};
			}),
			truncated: value.changes.truncated === true,
		},
		files: value.files.map(file => {
			if (!isRecord(file) || typeof file.path !== "string" || (file.kind !== "file" && file.kind !== "directory")) {
				throw new Error("Sidecar returned an invalid workspace file");
			}
			return { path: file.path, kind: file.kind };
		}),
		filesTruncated: value.filesTruncated === true,
	};
}

export function isHostInteraction(value: DesktopRpcFrame): value is DesktopHostInteraction {
	return value.type === "extension_ui_request" && "method" in value && typeof value.method === "string";
}

export function isSubagentFrame(value: DesktopRpcFrame): boolean {
	return value.type === "subagent_lifecycle" || value.type === "subagent_progress" || value.type === "subagent_event";
}

export interface DesktopGoalUpdatedFrame {
	goal: DesktopGoal | null;
	state?: DesktopGoalModeState;
}

/** Call only after checking `frame.type === "goal_updated"`. */
export function readGoalUpdatedFrame(value: DesktopRpcFrame): DesktopGoalUpdatedFrame {
	const record = value as unknown as Record<string, unknown>;
	return {
		goal: readGoal(record.goal) ?? null,
		state: readGoalModeState(record.state),
	};
}
