/**
 * RPC protocol types for headless operation.
 *
 * Commands are sent as JSON lines on stdin.
 * Responses and events are emitted as JSON lines on stdout.
 */
import type { AgentMessage, AgentToolResult, ThinkingLevel, ToolLoadMode } from "@oh-my-pi/pi-agent-core";
import type { CompactionResult } from "@oh-my-pi/pi-agent-core/compaction";
import type { Effort, ImageContent, Model, ToolExample } from "@oh-my-pi/pi-ai";
import type { AdvisorRuntimeStatus } from "../../advisor/config";
import type {
	ApplicationIntentRequest,
	ApplicationIntentResult,
	ApplicationSnapshot,
	WorkspaceReview,
} from "../../application/application-types";
import type { CollabSessionState } from "../../collab/protocol";
import type { BashResult } from "../../exec/bash-executor";
import type { ContextUsage, ToolApprovalChoice, ToolApprovalUIRequest } from "../../extensibility/extensions/types";
import type { GoalModeState } from "../../goals/state";
import type { PlanModeState } from "../../plan-mode/state";
import type { AgentSessionEvent, SessionStats } from "../../session/agent-session";
import type { FileEntry } from "../../session/session-entries";
import type { AvailableSlashCommandSource } from "../../slash-commands/available-commands";
import type {
	AgentProgress,
	SubagentEventPayload,
	SubagentLifecyclePayload,
	SubagentProgressPayload,
} from "../../task";
import type { TodoPhase } from "../../tools/todo";
import type { RpcMessagesPage } from "./rpc-messages";

// ============================================================================
// RPC Commands (stdin)
// ============================================================================

export type RpcCommand =
	// Protocol
	| { id?: string; type: "negotiate_protocol"; protocolVersion: number }

	// Prompting
	| { id?: string; type: "prompt"; message: string; images?: ImageContent[]; streamingBehavior?: "steer" | "followUp" }
	| { id?: string; type: "steer"; message: string; images?: ImageContent[] }
	| { id?: string; type: "follow_up"; message: string; images?: ImageContent[] }
	| { id?: string; type: "abort" }
	| { id?: string; type: "abort_and_prompt"; message: string; images?: ImageContent[] }
	| { id?: string; type: "new_session"; parentSession?: string }

	// State
	| { id?: string; type: "get_state" }
	| { id?: string; type: "get_application_snapshot" }
	| ({ id?: string; type: "execute_application_intent" } & ApplicationIntentRequest)
	| { id?: string; type: "get_workspace_review" }
	| { id?: string; type: "set_fast_mode"; enabled: boolean }
	| { id?: string; type: "get_available_commands" }
	| { id?: string; type: "set_todos"; phases: TodoPhase[] }
	| { id?: string; type: "set_host_tools"; tools: RpcHostToolDefinition[] }
	| { id?: string; type: "set_host_uri_schemes"; schemes: RpcHostUriSchemeDefinition[] }
	| { id?: string; type: "set_subagent_subscription"; level: RpcSubagentSubscriptionLevel }
	| { id?: string; type: "get_subagents" }
	| { id?: string; type: "get_subagent_messages"; subagentId?: string; sessionFile?: string; fromByte?: number }

	// OMP workflows (plan/goal mode, advisor status)
	| { id?: string; type: "get_workflow_state" }
	| { id?: string; type: "enter_plan_mode"; workflow?: "parallel" | "iterative" }
	| { id?: string; type: "exit_plan_mode" }
	| { id?: string; type: "goal_set"; objective: string; tokenBudget?: number }
	| { id?: string; type: "goal_pause" }
	| { id?: string; type: "goal_resume" }
	| { id?: string; type: "goal_drop" }
	| { id?: string; type: "goal_set_budget"; tokenBudget?: number }

	// Model
	| { id?: string; type: "set_model"; provider: string; modelId: string }
	| { id?: string; type: "cycle_model" }
	| { id?: string; type: "get_available_models" }

	// Thinking
	| { id?: string; type: "set_thinking_level"; level: ThinkingLevel }
	| { id?: string; type: "cycle_thinking_level" }

	// Queue modes
	| { id?: string; type: "set_steering_mode"; mode: "all" | "one-at-a-time" }
	| { id?: string; type: "set_follow_up_mode"; mode: "all" | "one-at-a-time" }
	| { id?: string; type: "set_interrupt_mode"; mode: "immediate" | "wait" }

	// Compaction
	| { id?: string; type: "compact"; customInstructions?: string }
	| { id?: string; type: "set_auto_compaction"; enabled: boolean }

	// Retry
	| { id?: string; type: "set_auto_retry"; enabled: boolean }
	| { id?: string; type: "abort_retry" }

	// Bash
	| { id?: string; type: "bash"; command: string; excludeFromContext?: boolean }
	| { id?: string; type: "abort_bash" }

	// Approval policy management (global promotion/revocation; the four-state
	// once/project choices live on the toolApproval extension UI request instead)
	| { id?: string; type: "get_approval_policies" }
	| {
			id?: string;
			type: "set_approval_policy";
			scope: "project" | "global";
			policyKey: string;
			policy: "allow" | "deny";
	  }
	| { id?: string; type: "clear_approval_policy"; scope: "project" | "global"; policyKey: string }

	// Session
	| { id?: string; type: "get_session_stats" }
	| { id?: string; type: "export_html"; outputPath?: string }
	| { id?: string; type: "switch_session"; sessionPath: string }
	| { id?: string; type: "branch"; entryId: string }
	| { id?: string; type: "get_branch_messages" }
	| { id?: string; type: "get_last_assistant_text" }
	| { id?: string; type: "set_session_name"; name: string }
	| { id?: string; type: "handoff"; customInstructions?: string }

	// Messages
	| { id?: string; type: "get_messages" }
	| { id?: string; type: "get_messages_page"; cursor?: string; limit?: number }

	// Async jobs (background bash/task jobs; distinct from the queued-message queue)
	| { id?: string; type: "get_async_jobs" }
	| { id?: string; type: "abort_async_job"; jobId: string }

	// Settings (GUI-relevant schema, global/project scope)
	| { id?: string; type: "get_settings_schema" }
	| { id?: string; type: "get_settings_values" }
	| { id?: string; type: "set_setting_value"; path: string; scope: "project" | "global"; value: unknown }
	| { id?: string; type: "clear_setting_value"; path: string; scope: "project" | "global" }

	// Resources (read-only skills/prompts/plugins/MCP/agents/tools inventory)
	| { id?: string; type: "get_resources" }
	| { id?: string; type: "reload_resources" }

	// Login
	| { id?: string; type: "get_login_providers" }
	| { id?: string; type: "login"; providerId: string }

	// Provider API keys (BYO-key credential entry, distinct from OAuth login above)
	| { id?: string; type: "get_provider_credentials" }
	| { id?: string; type: "set_provider_api_key"; providerId: string; apiKey: string }
	| { id?: string; type: "clear_provider_api_key"; providerId: string }

	// Release updates (check-only; no signed auto-updater yet)
	| { id?: string; type: "get_update_status" }

	// Collaboration (host side)
	| { id?: string; type: "collab_start"; relayUrl?: string; webUrl?: string }
	| { id?: string; type: "collab_stop" }
	| { id?: string; type: "get_collab_state" }

	// Collaboration (guest side — join another host's session)
	| { id?: string; type: "collab_join"; link: string }
	| { id?: string; type: "collab_leave" };

// ============================================================================
// RPC State
// ============================================================================

export interface RpcSessionState {
	model?: Model;
	thinkingLevel: ThinkingLevel | undefined;
	isStreaming: boolean;
	isCompacting: boolean;
	steeringMode: "all" | "one-at-a-time";
	followUpMode: "all" | "one-at-a-time";
	interruptMode: "immediate" | "wait";
	sessionFile?: string;
	sessionId: string;
	sessionName?: string;
	autoCompactionEnabled: boolean;
	autoRetryEnabled: boolean;
	fastModeEnabled: boolean;
	fastModeActive: boolean;
	tokensPerSecond: number | null;
	messageCount: number;
	queuedMessageCount: number;
	todoPhases: TodoPhase[];
	/** For session dump / export (plain-text parity with /dump). */
	systemPrompt?: string[];
	dumpTools?: Array<{ name: string; description: string; parameters: unknown; examples?: readonly ToolExample[] }>;
	/** Current context window usage. */
	contextUsage?: ContextUsage;
}

export interface RpcAvailableSlashCommand {
	name: string;
	aliases?: string[];
	description?: string;
	input?: { hint?: string };
	subcommands?: Array<{ name: string; description?: string; usage?: string }>;
	source: AvailableSlashCommandSource;
}

export interface RpcAvailableCommandsUpdateFrame {
	type: "available_commands_update";
	commands: RpcAvailableSlashCommand[];
}

export interface RpcPromptResultFrame {
	type: "prompt_result";
	id?: string;
	agentInvoked: boolean;
}

export interface RpcReadyFrame {
	type: "ready";
	protocolVersion: 1;
	supportedProtocolVersions: [1, 2];
	maxFrameBytes: number;
	maxReassembledFrameBytes: number;
}

export interface RpcChunkFrame {
	type: "rpc_chunk";
	chunkId: string;
	index: number;
	count: number;
	byteLength: number;
	data: string;
}

/** Incremental output pushed while a `bash` command with a matching `id` is still running. */
export interface RpcBashOutputFrame {
	type: "bash_output";
	id: string;
	chunk: string;
}

export interface RpcHandoffResult {
	savedPath?: string;
}

/** Serializable projection of an {@link AsyncJob} for RPC hosts — omits the live AbortController/Promise. */
export interface RpcAsyncJobSummary {
	id: string;
	type: "bash" | "task";
	status: "running" | "completed" | "failed" | "cancelled";
	label: string;
	startTime: number;
	queued?: boolean;
	resultText?: string;
	errorText?: string;
}

export interface RpcSettingOption {
	value: string;
	label: string;
	description?: string;
}

export interface RpcSettingDef {
	path: string;
	tab: string;
	group?: string;
	label: string;
	description: string;
	type: "boolean" | "string" | "number" | "enum" | "array" | "record";
	enumValues?: readonly string[];
	options?: readonly RpcSettingOption[] | "runtime";
	secret?: boolean;
}

export interface RpcSettingsSchema {
	tabs: Array<{ id: string; label: string }>;
	groups: Record<string, readonly string[]>;
	settings: RpcSettingDef[];
}

export interface RpcSettingValueEntry {
	path: string;
	/** Omitted for credential/secret settings — never sent to RPC hosts. */
	value?: unknown;
	/** Whether a credential/secret setting has a value configured, without revealing it. */
	configured?: boolean;
	scope: "project" | "global" | "default";
}

export interface RpcResourceSkill {
	name: string;
	description: string;
	source: string;
	hide?: boolean;
}

export interface RpcResourcePrompt {
	name: string;
	path: string;
	sourceLevel: "user" | "project" | "native";
	providerName: string;
}

export interface RpcResourcePlugin {
	name: string;
	version: string;
	enabled: boolean;
	enabledFeatures: string[] | null;
}

export interface RpcResourceMcpServer {
	name: string;
	status: "connected" | "connecting" | "disconnected";
	toolCount?: number;
	sourceLevel?: "user" | "project" | "native";
}

export interface RpcResourceAgent {
	name: string;
	description: string;
	source: "bundled" | "user" | "project";
}

export interface RpcResourceTool {
	name: string;
	description: string;
}

export interface RpcResourcesSnapshot {
	skills: RpcResourceSkill[];
	skillWarnings: string[];
	prompts: RpcResourcePrompt[];
	promptWarnings: string[];
	plugins: RpcResourcePlugin[];
	mcpServers: RpcResourceMcpServer[];
	agents: RpcResourceAgent[];
	tools: RpcResourceTool[];
}

export type RpcSubagentSubscriptionLevel = "off" | "progress" | "events";

export interface RpcSubagentSnapshot {
	id: string;
	index: number;
	agent: string;
	agentSource: AgentProgress["agentSource"];
	description?: string;
	status: AgentProgress["status"];
	task?: string;
	assignment?: string;
	sessionFile?: string;
	lastUpdate: number;
	progress?: AgentProgress;
	parentToolCallId?: string;
}

/** Advisor runtime status projection — mirrors `AgentSession#getAdvisorStatusOverview`. */
export interface RpcAdvisorOverview {
	configured: boolean;
	advisors: Array<{ name: string; status: AdvisorRuntimeStatus }>;
}

/**
 * Combined plan/goal/advisor projection for the desktop Workflows panel.
 * Subagents are surfaced separately via {@link RpcSubagentSnapshot} — this
 * type is refetched after every plan/goal mutation and is otherwise kept in
 * sync client-side from `goal_updated` session events.
 */
export interface RpcWorkflowState {
	/** `settings.get("plan.enabled")` — plan mode is unavailable when false. */
	planSettingEnabled: boolean;
	/** `settings.get("goal.enabled")` — goal mode is unavailable when false. */
	goalSettingEnabled: boolean;
	plan?: PlanModeState;
	goal?: GoalModeState;
	advisor: RpcAdvisorOverview;
}

/**
 * Best-effort release check against the npm registry — the same catalog
 * `omp update` uses. `error` is set (and `latestVersion`/`updateAvailable`
 * omitted) when the check itself failed (offline, registry unreachable);
 * hosts should treat that as "no update known", not as a fatal condition.
 */
export interface RpcUpdateStatus {
	currentVersion: string;
	latestVersion?: string;
	updateAvailable: boolean;
	downloadUrl: string;
	checkedAt: number;
	error?: string;
}

export interface RpcCollabParticipant {
	name: string;
	role: "host" | "guest";
	readOnly?: boolean;
}

/** Host-side collab state — mirrors `CollabHost`'s public getters (see `../../collab/host`). */
export interface RpcCollabState {
	hosting: boolean;
	link?: string;
	webLink?: string;
	viewLink?: string;
	webViewLink?: string;
	participants: RpcCollabParticipant[];
}

/** Pushed whenever a guest joins/leaves a hosted collab session. */
export interface RpcCollabStateChangedFrame {
	type: "collab_state_changed";
	data: RpcCollabState;
}

/** This RPC session's own guest membership in someone else's hosted collab session. */
export interface RpcCollabGuestState {
	joined: boolean;
	readOnly: boolean;
	/** Debounced footer snapshot from the host — model/thinking/cwd/streaming/participants. */
	state: CollabSessionState | null;
}

/** Pushed on join/leave/reconnect/state-update while this RPC session is a collab guest. */
export interface RpcCollabGuestStateFrame {
	type: "collab_guest_state";
	data: RpcCollabGuestState;
}

export interface RpcSubagentMessagesResult {
	sessionFile: string;
	fromByte: number;
	nextByte: number;
	reset: boolean;
	entries: FileEntry[];
	messages: AgentMessage[];
}

// ============================================================================
// RPC Responses (stdout)
// ============================================================================

// Success responses with data
export type RpcResponse =
	// Protocol
	| {
			id?: string;
			type: "response";
			command: "negotiate_protocol";
			success: true;
			data: { protocolVersion: 2 };
	  }

	// Prompting (async - events follow)
	| { id?: string; type: "response"; command: "prompt"; success: true; data?: { agentInvoked: boolean } }
	| { id?: string; type: "response"; command: "steer"; success: true }
	| { id?: string; type: "response"; command: "follow_up"; success: true }
	| { id?: string; type: "response"; command: "abort"; success: true }
	| { id?: string; type: "response"; command: "abort_and_prompt"; success: true }
	| { id?: string; type: "response"; command: "new_session"; success: true; data: { cancelled: boolean } }

	// State
	| { id?: string; type: "response"; command: "get_state"; success: true; data: RpcSessionState }
	| {
			id?: string;
			type: "response";
			command: "get_application_snapshot";
			success: true;
			data: ApplicationSnapshot;
	  }
	| {
			id?: string;
			type: "response";
			command: "execute_application_intent";
			success: true;
			data: ApplicationIntentResult;
	  }
	| {
			id?: string;
			type: "response";
			command: "get_workspace_review";
			success: true;
			data: WorkspaceReview;
	  }
	| {
			id?: string;
			type: "response";
			command: "set_fast_mode";
			success: true;
			data: { enabled: boolean; active: boolean };
	  }
	| {
			id?: string;
			type: "response";
			command: "get_available_commands";
			success: true;
			data: { commands: RpcAvailableSlashCommand[] };
	  }
	| { id?: string; type: "response"; command: "set_todos"; success: true; data: { todoPhases: TodoPhase[] } }
	| { id?: string; type: "response"; command: "set_host_tools"; success: true; data: { toolNames: string[] } }
	| { id?: string; type: "response"; command: "set_host_uri_schemes"; success: true; data: { schemes: string[] } }
	| {
			id?: string;
			type: "response";
			command: "set_subagent_subscription";
			success: true;
			data: { level: RpcSubagentSubscriptionLevel };
	  }
	| {
			id?: string;
			type: "response";
			command: "get_subagents";
			success: true;
			data: { subagents: RpcSubagentSnapshot[] };
	  }
	| {
			id?: string;
			type: "response";
			command: "get_subagent_messages";
			success: true;
			data: RpcSubagentMessagesResult;
	  }

	// OMP workflows
	| { id?: string; type: "response"; command: "get_workflow_state"; success: true; data: RpcWorkflowState }
	| { id?: string; type: "response"; command: "enter_plan_mode"; success: true; data: RpcWorkflowState }
	| { id?: string; type: "response"; command: "exit_plan_mode"; success: true; data: RpcWorkflowState }
	| { id?: string; type: "response"; command: "goal_set"; success: true; data: RpcWorkflowState }
	| { id?: string; type: "response"; command: "goal_pause"; success: true; data: RpcWorkflowState }
	| { id?: string; type: "response"; command: "goal_resume"; success: true; data: RpcWorkflowState }
	| { id?: string; type: "response"; command: "goal_drop"; success: true; data: RpcWorkflowState }
	| { id?: string; type: "response"; command: "goal_set_budget"; success: true; data: RpcWorkflowState }

	// Model
	| {
			id?: string;
			type: "response";
			command: "set_model";
			success: true;
			data: Model;
	  }
	| {
			id?: string;
			type: "response";
			command: "cycle_model";
			success: true;
			data: { model: Model; thinkingLevel: ThinkingLevel | undefined; isScoped: boolean } | null;
	  }
	| {
			id?: string;
			type: "response";
			command: "get_available_models";
			success: true;
			data: { models: Model[] };
	  }

	// Thinking
	| { id?: string; type: "response"; command: "set_thinking_level"; success: true }
	| {
			id?: string;
			type: "response";
			command: "cycle_thinking_level";
			success: true;
			data: { level: Effort } | null;
	  }

	// Queue modes
	| { id?: string; type: "response"; command: "set_steering_mode"; success: true }
	| { id?: string; type: "response"; command: "set_follow_up_mode"; success: true }
	| { id?: string; type: "response"; command: "set_interrupt_mode"; success: true }

	// Compaction
	| { id?: string; type: "response"; command: "compact"; success: true; data: CompactionResult }
	| { id?: string; type: "response"; command: "set_auto_compaction"; success: true }

	// Retry
	| { id?: string; type: "response"; command: "set_auto_retry"; success: true }
	| { id?: string; type: "response"; command: "abort_retry"; success: true }

	// Bash
	| { id?: string; type: "response"; command: "bash"; success: true; data: BashResult }
	| { id?: string; type: "response"; command: "abort_bash"; success: true }

	// Approval policy management
	| {
			id?: string;
			type: "response";
			command: "get_approval_policies";
			success: true;
			data: {
				project: Record<string, "allow" | "deny" | "prompt">;
				global: Record<string, "allow" | "deny" | "prompt">;
			};
	  }
	| { id?: string; type: "response"; command: "set_approval_policy"; success: true }
	| { id?: string; type: "response"; command: "clear_approval_policy"; success: true }

	// Session
	| { id?: string; type: "response"; command: "get_session_stats"; success: true; data: SessionStats }
	| { id?: string; type: "response"; command: "export_html"; success: true; data: { path: string } }
	| { id?: string; type: "response"; command: "switch_session"; success: true; data: { cancelled: boolean } }
	| { id?: string; type: "response"; command: "branch"; success: true; data: { text: string; cancelled: boolean } }
	| {
			id?: string;
			type: "response";
			command: "get_branch_messages";
			success: true;
			data: { messages: Array<{ entryId: string; text: string }> };
	  }
	| {
			id?: string;
			type: "response";
			command: "get_last_assistant_text";
			success: true;
			data: { text: string | null };
	  }
	| { id?: string; type: "response"; command: "set_session_name"; success: true }
	| { id?: string; type: "response"; command: "handoff"; success: true; data: RpcHandoffResult | null }

	// Messages
	| { id?: string; type: "response"; command: "get_messages"; success: true; data: { messages: AgentMessage[] } }
	| { id?: string; type: "response"; command: "get_messages_page"; success: true; data: RpcMessagesPage }

	// Async jobs
	| { id?: string; type: "response"; command: "get_async_jobs"; success: true; data: { jobs: RpcAsyncJobSummary[] } }
	| { id?: string; type: "response"; command: "abort_async_job"; success: true; data: { cancelled: boolean } }

	// Settings
	| { id?: string; type: "response"; command: "get_settings_schema"; success: true; data: RpcSettingsSchema }
	| {
			id?: string;
			type: "response";
			command: "get_settings_values";
			success: true;
			data: { values: RpcSettingValueEntry[] };
	  }
	| { id?: string; type: "response"; command: "set_setting_value"; success: true }
	| { id?: string; type: "response"; command: "clear_setting_value"; success: true }

	// Resources
	| { id?: string; type: "response"; command: "get_resources"; success: true; data: RpcResourcesSnapshot }
	| { id?: string; type: "response"; command: "reload_resources"; success: true }

	// Login
	| {
			id?: string;
			type: "response";
			command: "get_login_providers";
			success: true;
			data: { providers: Array<{ id: string; name: string; available: boolean; authenticated: boolean }> };
	  }
	| { id?: string; type: "response"; command: "login"; success: true; data: { providerId: string } }

	// Provider API keys
	| {
			id?: string;
			type: "response";
			command: "get_provider_credentials";
			success: true;
			data: { providers: Array<{ id: string; label: string; configured: boolean }> };
	  }
	| { id?: string; type: "response"; command: "set_provider_api_key"; success: true }
	| { id?: string; type: "response"; command: "clear_provider_api_key"; success: true }

	// Release updates
	| { id?: string; type: "response"; command: "get_update_status"; success: true; data: RpcUpdateStatus }

	// Collaboration (host side)
	| { id?: string; type: "response"; command: "collab_start"; success: true; data: RpcCollabState }
	| { id?: string; type: "response"; command: "collab_stop"; success: true; data: RpcCollabState }
	| { id?: string; type: "response"; command: "get_collab_state"; success: true; data: RpcCollabState }

	// Collaboration (guest side)
	| { id?: string; type: "response"; command: "collab_join"; success: true; data: RpcCollabGuestState }
	| { id?: string; type: "response"; command: "collab_leave"; success: true }

	// Error response (any command can fail); `code` is an optional machine-readable reason.
	| { id?: string; type: "response"; command: string; success: false; error: string; code?: string };

// ============================================================================
// Subagent Events (stdout)
// ============================================================================

export interface RpcSubagentLifecycleFrame {
	type: "subagent_lifecycle";
	payload: SubagentLifecyclePayload;
}

export interface RpcSubagentProgressFrame {
	type: "subagent_progress";
	payload: SubagentProgressPayload;
}

export interface RpcSubagentEventFrame {
	type: "subagent_event";
	payload: SubagentEventPayload;
}

export type RpcSubagentFrame = RpcSubagentLifecycleFrame | RpcSubagentProgressFrame | RpcSubagentEventFrame;

export type RpcSessionEventFrame = AgentSessionEvent | RpcSubagentFrame;

// ============================================================================
// Extension UI Events (stdout)
// ============================================================================

/** Emitted when an extension needs user input */
export type RpcExtensionUIRequest =
	| ({ type: "extension_ui_request"; id: string; method: "toolApproval" } & ToolApprovalUIRequest)
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
	| {
			type: "extension_ui_request";
			id: string;
			method: "setStatus";
			statusKey: string;
			statusText: string | undefined;
	  }
	| {
			type: "extension_ui_request";
			id: string;
			method: "setWidget";
			widgetKey: string;
			widgetLines: string[] | undefined;
			widgetPlacement?: "aboveEditor" | "belowEditor";
	  }
	| { type: "extension_ui_request"; id: string; method: "setTitle"; title: string }
	| { type: "extension_ui_request"; id: string; method: "set_editor_text"; text: string }
	| {
			type: "extension_ui_request";
			id: string;
			method: "open_url";
			url: string;
			/**
			 * Short loopback URL that 302-redirects to {@link url}. When present,
			 * hosts SHOULD surface it as the copy target so terminal viewport
			 * truncation cannot corrupt OAuth query parameters on the full URL.
			 */
			launchUrl?: string;
			instructions?: string;
	  };

// ============================================================================
// Host Tool Frames (bidirectional)
// ============================================================================

export interface RpcHostToolDefinition {
	name: string;
	label?: string;
	description: string;
	parameters: Record<string, unknown>;
	hidden?: boolean;
	/** How this host tool is presented when enabled; omission normalizes to `"discoverable"` at the adapter boundary. */
	loadMode?: ToolLoadMode;
}

/** Emitted by the RPC server when it needs the host to execute a registered tool. */
export interface RpcHostToolCallRequest {
	type: "host_tool_call";
	id: string;
	toolCallId: string;
	toolName: string;
	arguments: Record<string, unknown>;
}

/** Emitted by the RPC server when a pending host tool call should be aborted. */
export interface RpcHostToolCancelRequest {
	type: "host_tool_cancel";
	id: string;
	targetId: string;
}

/** Sent by the host to stream partial tool updates back to the RPC server. */
export interface RpcHostToolUpdate {
	type: "host_tool_update";
	id: string;
	partialResult: AgentToolResult<unknown>;
}

/** Sent by the host to complete a pending tool call. */
export interface RpcHostToolResult {
	type: "host_tool_result";
	id: string;
	result: AgentToolResult<unknown>;
	isError?: boolean;
}

// ============================================================================
// Host URI Frames (bidirectional)
// ============================================================================

export interface RpcHostUriSchemeDefinition {
	/** URL scheme without trailing `://` (e.g. `db`, `notion`). */
	scheme: string;
	/** Optional human-readable description for logs/diagnostics. */
	description?: string;
	/** When true, the write tool is allowed to dispatch writes to this scheme. */
	writable?: boolean;
	/** When true, downstream callers suppress hashline anchors for resolved content. */
	immutable?: boolean;
}

export type RpcHostUriOperation = "read" | "write";

/** Emitted by the RPC server when it needs the host to satisfy a URI operation. */
export interface RpcHostUriRequest {
	type: "host_uri_request";
	id: string;
	operation: RpcHostUriOperation;
	url: string;
	/** Present for write operations. */
	content?: string;
}

/** Emitted by the RPC server when a pending URI request should be aborted. */
export interface RpcHostUriCancelRequest {
	type: "host_uri_cancel";
	id: string;
	targetId: string;
}

/** Sent by the host to complete a pending URI request. */
export interface RpcHostUriResult {
	type: "host_uri_result";
	id: string;
	/**
	 * Required for successful `read` results. Ignored for `write` success.
	 * Set on errors when a textual explanation accompanies `isError`.
	 */
	content?: string;
	/** Defaults to `text/plain` when omitted. */
	contentType?: "text/markdown" | "application/json" | "text/plain";
	/** Optional resolution notes propagated to the read tool. */
	notes?: string[];
	/** Overrides the scheme-level `immutable` flag for this single resolution. */
	immutable?: boolean;
	/** When true, surface the result content as an error to the caller. */
	isError?: boolean;
	/** Optional error message; preferred over `content` for error surfacing. */
	error?: string;
}

// ============================================================================
// Extension UI Commands (stdin)
// ============================================================================

/** Response to an extension UI request */
export type RpcExtensionUIResponse =
	| { type: "extension_ui_response"; id: string; value: string }
	| { type: "extension_ui_response"; id: string; approvalChoice: ToolApprovalChoice }
	| { type: "extension_ui_response"; id: string; confirmed: boolean }
	| { type: "extension_ui_response"; id: string; cancelled: true; timedOut?: boolean };

// ============================================================================
// Helper type for extracting command types
// ============================================================================

export type RpcCommandType = RpcCommand["type"];
