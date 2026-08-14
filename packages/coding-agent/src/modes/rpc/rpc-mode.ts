/**
 * RPC mode: Headless operation with JSON stdin/stdout protocol.
 *
 * Used for embedding the agent in other applications.
 * Receives commands as JSON on stdin, outputs events and responses as JSON on stdout.
 *
 * Protocol:
 * - Commands: JSON objects with `type` field, optional `id` for correlation
 * - Responses: JSON objects with `type: "response"`, `command`, `success`, and optional `data`/`error`
 * - Events: AgentSessionEvent objects streamed as they occur
 * - Extension UI: Extension UI requests are emitted, client responds with extension_ui_response
 */
import { once } from "node:events";
import { getOAuthProviders } from "@oh-my-pi/pi-ai/oauth";
import { toolWireSchema } from "@oh-my-pi/pi-ai/utils/schema";
import { CATALOG_PROVIDERS, type ProviderCatalogEntry } from "@oh-my-pi/pi-catalog";
import { $env, compareVersions, isRecord, logger, readLines, Snowflake, VERSION } from "@oh-my-pi/pi-utils";
import {
	AgentSessionApplicationRuntime,
	ApplicationController,
	ApplicationStaleRevisionError,
} from "../../application/application-controller";
import { buildWorkspaceReview } from "../../application/workspace-review";
import { loadCapability, reset as resetCapabilities } from "../../capability";
import type { Prompt } from "../../capability/prompt";
import { getLatestRelease } from "../../cli/update-cli";
import { CollabHost, type CollabHostContext } from "../../collab/host";
import {
	getDefault,
	getEnumValues,
	getPathsForTab,
	getType,
	getUi,
	isCredential,
	SETTING_TABS,
	type SettingPath,
	TAB_GROUPS,
	TAB_METADATA,
} from "../../config/settings-schema";
import { clearPluginRootsAndCaches, resolveActiveProjectRegistryPath } from "../../discovery/helpers";
import {
	type ExtensionUIContext,
	type ExtensionUIDialogOptions,
	type ExtensionUISelectItem,
	type ExtensionWidgetOptions,
	getExtensionUISelectOptionLabel,
	type ToolApprovalChoice,
	type ToolApprovalUIRequest,
} from "../../extensibility/extensions";
import { PluginManager } from "../../extensibility/plugins/manager";
import { buildSkillPromptMessage, parseSkillInvocation } from "../../extensibility/skills";
import { loadSlashCommands } from "../../extensibility/slash-commands";
import { MCPManager } from "../../mcp/manager";
import { type Theme, theme } from "../../modes/theme/theme";
import type { AgentSession } from "../../session/agent-session";
import { SKILL_PROMPT_MESSAGE_TYPE, USER_INTERRUPT_LABEL } from "../../session/messages";
import { executeAcpBuiltinSlashCommand } from "../../slash-commands/acp-builtins";
import { buildAvailableSlashCommands } from "../../slash-commands/available-commands";
import { discoverAgents } from "../../task/discovery";
import { defaultLoadModeForToolName } from "../../tools/essential-tools";
import type { EventBus } from "../../utils/event-bus";
import { calculateTokensPerSecond } from "../../utils/token-rate";
import { initializeExtensions } from "../runtime-init";
import { isRpcHostToolResult, isRpcHostToolUpdate, RpcHostToolBridge } from "./host-tools";
import { isRpcHostUriResult, RpcHostUriBridge } from "./host-uris";
import { RpcCollabGuest } from "./rpc-collab-guest";
import { MAX_RPC_FRAME_BYTES, MAX_RPC_REASSEMBLED_BYTES, RpcFrameEncoder } from "./rpc-frame";
import { claimRpcInput } from "./rpc-input";
import { pageRpcMessages, RPC_MESSAGES_PAGE_BUSY_ERROR, RpcMessagesPageError } from "./rpc-messages";
import { RpcSubagentRegistry, readRpcSubagentTranscript } from "./rpc-subagents";
import type {
	RpcCollabState,
	RpcCommand,
	RpcExtensionUIRequest,
	RpcExtensionUIResponse,
	RpcHostToolCallRequest,
	RpcHostToolCancelRequest,
	RpcHostToolDefinition,
	RpcHostToolResult,
	RpcHostToolUpdate,
	RpcHostUriCancelRequest,
	RpcHostUriRequest,
	RpcHostUriResult,
	RpcResourcesSnapshot,
	RpcResponse,
	RpcSessionState,
	RpcSettingDef,
	RpcSettingValueEntry,
	RpcSubagentSubscriptionLevel,
	RpcWorkflowState,
} from "./rpc-types";

// Re-export types for consumers
export type * from "./rpc-types";

/** Official homepage/download page — matches the repo's own `homepage` field and README links. */
const OFFICIAL_DOWNLOAD_URL = "https://omp.sh";

export type PendingExtensionRequest = {
	resolve: (response: RpcExtensionUIResponse) => void;
	reject: (error: Error) => void;
};

/** Pending extension UI request map that can fail closed when the RPC client disconnects. */
export class RpcPendingExtensionRequests extends Map<string, PendingExtensionRequest> {
	#closedError: Error | undefined;

	override set(id: string, request: PendingExtensionRequest): this {
		if (this.#closedError) {
			request.reject(this.#closedError);
			return this;
		}
		return super.set(id, request);
	}

	/** Reject every active and future extension UI request. */
	rejectAll(message: string): void {
		if (!this.#closedError) this.#closedError = new Error(message);
		const requests = Array.from(this.values());
		this.clear();
		for (const request of requests) {
			request.reject(this.#closedError);
		}
	}
}

type RpcOutput = (
	obj:
		| RpcResponse
		| RpcExtensionUIRequest
		| RpcHostToolCallRequest
		| RpcHostToolCancelRequest
		| RpcHostUriRequest
		| RpcHostUriCancelRequest
		| object,
) => void;

export type RpcSessionChangeCommand = Extract<
	RpcCommand,
	{ type: "new_session" } | { type: "switch_session" } | { type: "branch" }
>;

export type RpcSessionChangeResult =
	| { type: "new_session"; data: { cancelled: boolean } }
	| { type: "switch_session"; data: { cancelled: boolean } }
	| { type: "branch"; data: { text: string; cancelled: boolean } };

export type RpcSessionChangeSession = Pick<AgentSession, "newSession" | "switchSession" | "branch">;

export type RpcSkillCommandSession = Pick<AgentSession, "promptCustomMessage" | "skills" | "skillsSettings">;
export type RpcSkillCommandResult = { agentInvoked: true };

export async function tryRunRpcSkillCommand(
	session: RpcSkillCommandSession,
	text: string,
	streamingBehavior: "steer" | "followUp" = "steer",
): Promise<RpcSkillCommandResult | false> {
	if (!session.skillsSettings?.enableSkillCommands) return false;
	const parsed = parseSkillInvocation(text);
	if (!parsed) return false;
	const skill = session.skills.find(candidate => candidate.name === parsed.name);
	if (!skill) return false;
	const built = await buildSkillPromptMessage(skill, parsed.args, "user");
	await session.promptCustomMessage(
		{
			customType: SKILL_PROMPT_MESSAGE_TYPE,
			content: built.message,
			display: true,
			details: built.details,
			attribution: "user",
		},
		{ streamingBehavior },
	);
	return { agentInvoked: true };
}

export function reportLocalOnlyPromptResult(input: {
	id: string | undefined;
	prompt: Promise<boolean>;
	output: (obj: object) => void;
	onError: (error: Error) => void;
	hasExtensionAgentMessageTask?: () => boolean;
	waitForExtensionAgentMessageTasks?: () => Promise<void>;
}): void {
	void input.prompt
		.then(async agentInvoked => {
			if (agentInvoked) return;
			await input.waitForExtensionAgentMessageTasks?.();
			if (!input.hasExtensionAgentMessageTask?.()) {
				input.output({ type: "prompt_result", id: input.id, agentInvoked: false });
			}
		})
		.catch(error => {
			input.onError(error instanceof Error ? error : new Error(String(error)));
		});
}

type RpcExtensionUserMessageScope = {
	hasAgentMessageTask: boolean;
	pendingAgentMessageTasks: Set<Promise<void>>;
};

/**
 * Tracks extension-originated messages while an RPC prompt is executing.
 * A slash command can resolve the outer prompt as local-only while also
 * scheduling agent work through pi.sendUserMessage() or pi.sendMessage()
 * with triggerTurn; that prompt must not report agentInvoked:false to the host.
 */
export class RpcExtensionUserMessageTracker {
	#activePromptScopes = new Set<RpcExtensionUserMessageScope>();

	markAgentMessageTask(): void {
		for (const scope of this.#activePromptScopes) {
			scope.hasAgentMessageTask = true;
		}
	}

	trackAgentMessageTask(task: Promise<unknown>): void {
		for (const scope of this.#activePromptScopes) {
			this.#trackAgentMessageTaskForScope(scope, task);
		}
	}

	#trackAgentMessageTaskForScope(scope: RpcExtensionUserMessageScope, task: Promise<unknown>): void {
		const scopedTask = task.then(
			() => {
				scope.hasAgentMessageTask = true;
			},
			() => {},
		);
		scope.pendingAgentMessageTasks.add(scopedTask);
		void scopedTask.finally(() => {
			scope.pendingAgentMessageTasks.delete(scopedTask);
		});
	}

	async #waitForAgentMessageTasks(scope: RpcExtensionUserMessageScope): Promise<void> {
		while (scope.pendingAgentMessageTasks.size > 0) {
			await Promise.allSettled(Array.from(scope.pendingAgentMessageTasks));
		}
	}

	watchPrompt<T>(startPrompt: () => Promise<T>): {
		prompt: Promise<T>;
		hasAgentMessageTask: () => boolean;
		waitForAgentMessageTasks: () => Promise<void>;
	} {
		const scope: RpcExtensionUserMessageScope = {
			hasAgentMessageTask: false,
			pendingAgentMessageTasks: new Set(),
		};
		this.#activePromptScopes.add(scope);
		let prompt: Promise<T>;
		try {
			prompt = startPrompt();
		} catch (error) {
			this.#activePromptScopes.delete(scope);
			throw error;
		}
		return {
			prompt: prompt.finally(() => {
				this.#activePromptScopes.delete(scope);
			}),
			hasAgentMessageTask: () => scope.hasAgentMessageTask,
			waitForAgentMessageTasks: () => this.#waitForAgentMessageTasks(scope),
		};
	}
}

export function watchAndReportLocalOnlyPromptResult(input: {
	id: string | undefined;
	startPrompt: () => Promise<boolean>;
	output: (obj: object) => void;
	onError: (error: Error) => void;
	extensionUserMessageTracker: RpcExtensionUserMessageTracker;
}): void {
	const trackedPrompt = input.extensionUserMessageTracker.watchPrompt(input.startPrompt);
	reportLocalOnlyPromptResult({
		id: input.id,
		prompt: trackedPrompt.prompt,
		output: input.output,
		onError: input.onError,
		hasExtensionAgentMessageTask: trackedPrompt.hasAgentMessageTask,
		waitForExtensionAgentMessageTasks: trackedPrompt.waitForAgentMessageTasks,
	});
}

/**
 * Dependencies for {@link dispatchRpcInputFrame}. Provided by the RPC mode
 * entrypoint; broken out so tests can drive the input loop with stubs.
 */
export interface RpcInputFrameDeps {
	handleCommand: (command: RpcCommand) => Promise<RpcResponse>;
	output: RpcOutput;
	errorResponse: (id: string | undefined, command: string, message: string) => RpcResponse;
	trackBackgroundTask?: (task: Promise<void>) => void;
	pendingExtensionRequests: Map<string, PendingExtensionRequest>;
	onHostToolResult: (frame: RpcHostToolResult) => void;
	onHostToolUpdate: (frame: RpcHostToolUpdate) => void;
	onHostUriResult: (frame: RpcHostUriResult) => void;
}

/**
 * Structural guard for a well-formed extension UI response frame. Mirrors the
 * shape declared in {@link RpcExtensionUIResponse} — a truthy record with
 * `type === "extension_ui_response"` and a string `id`. Payload variants (value,
 * confirmed, cancelled) are validated at the read site.
 */
function isRpcExtensionUIResponse(value: unknown): value is RpcExtensionUIResponse {
	if (!isRecord(value)) return false;
	return value.type === "extension_ui_response" && typeof value.id === "string";
}

/** Dispatch side-channel frames that must overtake the serialized command queue. */
export function dispatchRpcControlFrame(parsed: unknown, deps: RpcInputFrameDeps): boolean {
	if (isRpcExtensionUIResponse(parsed)) {
		const pending = deps.pendingExtensionRequests.get(parsed.id);
		if (pending) pending.resolve(parsed);
		return true;
	}

	if (isRpcHostToolResult(parsed)) {
		deps.onHostToolResult(parsed);
		return true;
	}

	if (isRpcHostToolUpdate(parsed)) {
		deps.onHostToolUpdate(parsed);
		return true;
	}

	if (isRpcHostUriResult(parsed)) {
		deps.onHostUriResult(parsed);
		return true;
	}

	return false;
}

/**
 * Dispatch a single parsed frame from the RPC input stream.
 *
 * Bash commands are dispatched in the background so the caller can keep reading
 * subsequent frames while a shell command is still running. This lets a client
 * send `abort_bash` while a long-running `bash` is in flight. Response
 * correlation is preserved via each command's `id`; ordering across concurrent
 * commands is not guaranteed and clients MUST match on `id`.
 *
 * @returns `undefined` when the frame was routed to a side-channel handler
 *   (extension UI response, host tool/URI frames) or dispatched in the
 *   background (`bash`). Otherwise a promise that resolves once the response
 *   for the command has been emitted via `output`. Errors from `handleCommand`
 *   on non-`bash` commands propagate; the caller is expected to wrap them.
 */
export function dispatchRpcInputFrame(parsed: unknown, deps: RpcInputFrameDeps): Promise<void> | undefined {
	if (dispatchRpcControlFrame(parsed, deps)) return undefined;
	// Regular RPC command. The transport contract states each remaining frame
	// is an {@link RpcCommand}; `handleCommand`'s `default` arm surfaces
	// unknown discriminants as an error response, so we do not shape-check
	// the union here.
	const command = parsed as RpcCommand;

	// `bash` can run for a long time. Dispatch it in the background so a
	// subsequent `abort_bash` frame can be read and handled without waiting
	// for the shell command to finish on its own. The response is emitted
	// when `handleCommand` resolves; clients correlate via `command.id`.
	if (command.type === "bash") {
		const task = (async () => {
			try {
				deps.output(await deps.handleCommand(command));
			} catch (err: unknown) {
				const message = err instanceof Error ? err.message : String(err);
				deps.output(deps.errorResponse(command.id, "bash", message));
			}
		})();
		deps.trackBackgroundTask?.(task);
		return undefined;
	}

	return (async () => {
		deps.output(await deps.handleCommand(command));
	})();
}

/** Serializes ordinary RPC commands while allowing control frames to dispatch immediately. */
export class RpcInputDispatcher {
	#tail: Promise<void> = Promise.resolve();
	#tasks = new Set<Promise<void>>();
	readonly #deps: RpcInputFrameDeps;
	readonly #afterSerialCommand: (() => Promise<void>) | undefined;

	constructor(options: { deps: RpcInputFrameDeps; afterSerialCommand?: () => Promise<void> }) {
		this.#deps = options.deps;
		this.#afterSerialCommand = options.afterSerialCommand;
	}

	/** Accept a parsed input frame without blocking the stdin reader. */
	dispatch(parsed: unknown): void {
		try {
			if (dispatchRpcControlFrame(parsed, this.#deps)) return;

			const command = parsed as RpcCommand;
			if (command.type === "bash") {
				dispatchRpcInputFrame(command, this.#deps);
				return;
			}

			const task = this.#tail.then(
				() => this.#dispatchSerialCommand(command),
				() => this.#dispatchSerialCommand(command),
			);
			this.#tail = task.catch(() => {});
			this.#tasks.add(task);
			void task.finally(() => {
				this.#tasks.delete(task);
			});
		} catch (err: unknown) {
			const message = err instanceof Error ? err.message : String(err);
			this.#deps.output(this.#deps.errorResponse(undefined, "parse", `Failed to parse command: ${message}`));
		}
	}

	/** Await every accepted serial command, including commands queued before EOF. */
	async drain(): Promise<void> {
		while (this.#tasks.size > 0) {
			await Promise.allSettled(Array.from(this.#tasks));
		}
	}

	async #dispatchSerialCommand(command: RpcCommand): Promise<void> {
		try {
			const awaited = dispatchRpcInputFrame(command, this.#deps);
			if (awaited) await awaited;
		} catch (err: unknown) {
			const message = err instanceof Error ? err.message : String(err);
			this.#deps.output(this.#deps.errorResponse(command.id, command.type, message));
		} finally {
			await this.#afterSerialCommand?.();
		}
	}
}

/**
 * Coordinates deferred shutdown with in-flight background input tasks.
 *
 * `pi.shutdown()` from an extension only *requests* shutdown; the process must
 * not exit while a background-dispatched command (`bash`, see
 * {@link dispatchRpcInputFrame}) still owes the client a response frame. The
 * coordinator tracks those tasks, re-checks the shutdown request whenever one
 * settles (covering a shutdown requested mid-bash with no follow-up client
 * frame), and drains every tracked task before invoking `performShutdown`.
 * The shutdown sequence is latched so concurrent triggers (input loop and
 * settling tasks) run it exactly once.
 */
export class RpcShutdownCoordinator {
	#tasks = new Set<Promise<void>>();
	#shutdown: Promise<void> | undefined;
	readonly #isShutdownRequested: () => boolean;
	readonly #performShutdown: () => Promise<void>;

	constructor(options: { isShutdownRequested: () => boolean; performShutdown: () => Promise<void> }) {
		this.#isShutdownRequested = options.isShutdownRequested;
		this.#performShutdown = options.performShutdown;
	}

	/**
	 * Track a background input task. When it settles it is untracked and the
	 * shutdown request is re-checked, so a deferred shutdown fires even when
	 * no further client frames arrive.
	 */
	track(task: Promise<void>): void {
		this.#tasks.add(task);
		void task.finally(() => {
			this.#tasks.delete(task);
			// Fire-and-forget: performShutdown ends the process. Rejections are
			// not expected — hook errors are caught inside extensionRunner.emit,
			// and background tasks catch their own dispatch errors.
			void this.checkShutdownRequested();
		});
	}

	/** Await every tracked task, including tasks tracked while draining. */
	async drain(): Promise<void> {
		while (this.#tasks.size > 0) {
			await Promise.allSettled(Array.from(this.#tasks));
		}
	}

	/**
	 * If shutdown was requested, drain background tasks (so every owed
	 * response frame is written) before running the shutdown sequence.
	 */
	checkShutdownRequested(): Promise<void> {
		if (!this.#shutdown) {
			if (!this.#isShutdownRequested()) return Promise.resolve();
			this.#shutdown = this.drain().then(() => this.#performShutdown());
		}
		return this.#shutdown;
	}
}

export type RpcSubagentResetRegistry = Pick<RpcSubagentRegistry, "clear">;

export async function handleRpcSessionChange(
	session: RpcSessionChangeSession,
	command: RpcSessionChangeCommand,
	subagentRegistry?: RpcSubagentResetRegistry,
): Promise<RpcSessionChangeResult> {
	switch (command.type) {
		case "new_session": {
			const options = command.parentSession ? { parentSession: command.parentSession } : undefined;
			const cancelled = !(await session.newSession(options));
			if (!cancelled) subagentRegistry?.clear();
			return { type: "new_session", data: { cancelled } };
		}

		case "switch_session": {
			const cancelled = !(await session.switchSession(command.sessionPath));
			if (!cancelled) subagentRegistry?.clear();
			return { type: "switch_session", data: { cancelled } };
		}

		case "branch": {
			const result = await session.branch(command.entryId);
			if (!result.cancelled) subagentRegistry?.clear();
			return { type: "branch", data: { text: result.selectedText, cancelled: result.cancelled } };
		}
	}
	throw new Error("Unsupported RPC session change command");
}

function normalizeHostToolDefinitions(tools: RpcHostToolDefinition[]): RpcHostToolDefinition[] {
	return tools.map((tool, index) => {
		const name = typeof tool.name === "string" ? tool.name.trim() : "";
		if (!name) {
			throw new Error(`Host tool at index ${index} must provide a non-empty name`);
		}
		const description = typeof tool.description === "string" ? tool.description.trim() : "";
		if (!description) {
			throw new Error(`Host tool "${name}" must provide a non-empty description`);
		}
		if (!tool.parameters || typeof tool.parameters !== "object" || Array.isArray(tool.parameters)) {
			throw new Error(`Host tool "${name}" must provide a JSON Schema object`);
		}
		const label = typeof tool.label === "string" && tool.label.trim() ? tool.label.trim() : name;
		return {
			name,
			label,
			description,
			parameters: tool.parameters,
			hidden: tool.hidden === true,
			loadMode: defaultLoadModeForToolName(name, tool.loadMode),
		};
	});
}

function parseValueDialogResponse(
	response: RpcExtensionUIResponse,
	dialogOptions: ExtensionUIDialogOptions | undefined,
): string | undefined {
	if ("cancelled" in response && response.cancelled) {
		if (response.timedOut) dialogOptions?.onTimeout?.();
		return undefined;
	}
	if ("value" in response) return response.value;
	return undefined;
}

function shouldEmitRpcTitles(): boolean {
	const raw = $env.PI_RPC_EMIT_TITLE;
	if (!raw) return false;
	const normalized = raw.trim().toLowerCase();
	return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on";
}

function isSubagentSubscriptionLevel(value: unknown): value is RpcSubagentSubscriptionLevel {
	return value === "off" || value === "progress" || value === "events";
}

/** Every schema path that declares `ui` metadata (the GUI-relevant settings surface). Computed once. */
const ALL_UI_SETTING_PATHS = new Set<SettingPath>(SETTING_TABS.flatMap(tab => getPathsForTab(tab)));

export function requestRpcEditor(
	pendingRequests: Map<string, PendingExtensionRequest>,
	output: RpcOutput,
	title: string,
	prefill?: string,
	dialogOptions?: ExtensionUIDialogOptions,
	editorOptions?: { promptStyle?: boolean },
): Promise<string | undefined> {
	if (dialogOptions?.signal?.aborted) return Promise.resolve(undefined);

	const id = Snowflake.next() as string;
	const { promise, resolve, reject } = Promise.withResolvers<string | undefined>();
	let settled = false;

	const cleanup = () => {
		dialogOptions?.signal?.removeEventListener("abort", onAbort);
		pendingRequests.delete(id);
	};
	const finish = (value: string | undefined) => {
		if (settled) return;
		settled = true;
		cleanup();
		resolve(value);
	};
	const fail = (error: Error) => {
		if (settled) return;
		settled = true;
		cleanup();
		reject(error);
	};
	const onAbort = () => {
		output({
			type: "extension_ui_request",
			id: Snowflake.next() as string,
			method: "cancel",
			targetId: id,
		} as RpcExtensionUIRequest);
		finish(undefined);
	};

	dialogOptions?.signal?.addEventListener("abort", onAbort, { once: true });
	pendingRequests.set(id, {
		resolve: response => {
			if ("cancelled" in response && response.cancelled) {
				finish(undefined);
			} else if ("value" in response) {
				finish(response.value);
			} else {
				finish(undefined);
			}
		},
		reject: fail,
	});
	output({
		type: "extension_ui_request",
		id,
		method: "editor",
		title,
		prefill,
		promptStyle: editorOptions?.promptStyle,
	} as RpcExtensionUIRequest);
	return promise;
}

/** Sends an RPC extension dialog and cancels the remote presentation when its signal aborts. */
export function requestRpcDialog<T>(
	pendingRequests: Map<string, PendingExtensionRequest>,
	output: RpcOutput,
	opts: ExtensionUIDialogOptions | undefined,
	defaultValue: T,
	request: Record<string, unknown>,
	parseResponse: (response: RpcExtensionUIResponse) => T,
): Promise<T> {
	if (opts?.signal?.aborted) return Promise.resolve(defaultValue);

	const id = Snowflake.next() as string;
	const { promise, resolve, reject } = Promise.withResolvers<T>();
	let timeoutId: NodeJS.Timeout | undefined;

	const cleanup = () => {
		clearTimeout(timeoutId);
		opts?.signal?.removeEventListener("abort", onAbort);
		pendingRequests.delete(id);
	};
	const onAbort = () => {
		output({
			type: "extension_ui_request",
			id: Snowflake.next() as string,
			method: "cancel",
			targetId: id,
		} as RpcExtensionUIRequest);
		cleanup();
		resolve(defaultValue);
	};
	opts?.signal?.addEventListener("abort", onAbort, { once: true });

	if (opts?.timeout !== undefined) {
		timeoutId = setTimeout(() => {
			opts.onTimeout?.();
			cleanup();
			resolve(defaultValue);
		}, opts.timeout);
	}

	pendingRequests.set(id, {
		resolve: response => {
			cleanup();
			resolve(parseResponse(response));
		},
		reject,
	});
	output({ type: "extension_ui_request", id, ...request } as RpcExtensionUIRequest);
	return promise;
}
/**
 * Run in RPC mode.
 * Listens for JSON commands on stdin, outputs events and responses on stdout.
 */
export async function runRpcMode(
	session: AgentSession,
	setToolUIContext?: (uiContext: ExtensionUIContext, hasUI: boolean) => void,
	eventBus?: EventBus,
	input: ReadableStream<Uint8Array> = claimRpcInput(),
): Promise<never> {
	// Signal to RPC clients that the server is ready to accept commands
	// Suppress terminal notifications: they write \x07 (BEL) or OSC sequences directly to
	// process.stdout with no newline, which the reader merges with the next JSON line and
	// breaks JSON.parse. In RPC mode stdout is the JSON protocol channel — nothing else
	// may write there.
	process.env.PI_NOTIFICATIONS = "off";

	const frameEncoder = new RpcFrameEncoder();
	// Ordered stdout writer honoring backpressure: chunked v2 frames are produced
	// lazily by the encoder and written one physical line at a time, so a near-limit
	// logical frame never materializes its full base64 transport in memory.
	let stdoutQueue: Promise<void> = Promise.resolve();
	const writeFrames = (frames: Iterable<string>) => {
		stdoutQueue = stdoutQueue
			.then(async () => {
				for (const line of frames) {
					if (!process.stdout.write(line)) await once(process.stdout, "drain");
				}
			})
			// stdout gone (host exited) — nothing left to deliver; keep the queue alive.
			.catch(() => {});
	};
	writeFrames(
		frameEncoder.encodeFrames({
			type: "ready",
			protocolVersion: 1,
			supportedProtocolVersions: [1, 2],
			maxFrameBytes: MAX_RPC_FRAME_BYTES,
			maxReassembledFrameBytes: MAX_RPC_REASSEMBLED_BYTES,
		}),
	);
	const output = (obj: RpcResponse | RpcExtensionUIRequest | object) => {
		writeFrames(frameEncoder.encodeFrames(obj));
		if (isRecord(obj) && obj.type === "response" && obj.command === "negotiate_protocol" && obj.success === true)
			frameEncoder.setProtocolVersion(2);
	};
	const emitRpcTitles = shouldEmitRpcTitles();

	const success = <T extends RpcCommand["type"]>(
		id: string | undefined,
		command: T,
		data?: object | null,
	): RpcResponse => {
		if (data === undefined) {
			return { id, type: "response", command, success: true } as RpcResponse;
		}
		return { id, type: "response", command, success: true, data } as RpcResponse;
	};

	const error = (id: string | undefined, command: string, message: string, code?: string): RpcResponse => {
		return { id, type: "response", command, success: false, error: message, ...(code ? { code } : {}) };
	};

	const extensionUserMessageTracker = new RpcExtensionUserMessageTracker();

	const pendingExtensionRequests = new RpcPendingExtensionRequests();
	const hostToolBridge = new RpcHostToolBridge(output);
	const hostUriBridge = new RpcHostUriBridge(output);
	const subagentRegistry = eventBus ? new RpcSubagentRegistry(eventBus, output) : undefined;

	// OMP workflows (plan/goal mode): tool-set snapshots taken on entry so exit/
	// pause/drop/completion can restore exactly what was active before, mirroring
	// the TUI's #planModePreviousTools/#goalModePreviousTools bookkeeping.
	let planModePreviousTools: string[] | undefined;
	let goalModePreviousTools: string[] | undefined;

	const buildWorkflowState = (): RpcWorkflowState => ({
		planSettingEnabled: session.settings.get("plan.enabled"),
		goalSettingEnabled: session.settings.get("goal.enabled"),
		plan: session.getPlanModeState(),
		goal: session.getGoalModeState(),
		advisor: session.getAdvisorStatusOverview(),
	});

	// Collaboration (host side). `collabHostContext` is the CollabHostContext
	// CollabHost drives directly — its `collabHost` field is the single source
	// of truth for "are we hosting" (CollabHost itself clears it on teardown,
	// mirroring InteractiveModeContext.collabHost in the TUI).
	const buildCollabState = (): RpcCollabState => {
		const host = collabHostContext.collabHost;
		return {
			hosting: host !== undefined,
			link: host?.link,
			webLink: host?.webLink,
			viewLink: host?.viewLink,
			webViewLink: host?.webViewLink,
			participants: host?.participants ?? [],
		};
	};
	const collabHostContext: CollabHostContext = {
		sessionManager: session.sessionManager,
		session,
		settings: session.settings,
		eventBus,
		collabHost: undefined,
		showStatus: () => {},
		updatePendingMessagesDisplay: () => {},
		statusLine: {
			setCollabStatus: () => output({ type: "collab_state_changed", data: buildCollabState() }),
			invalidate: () => {},
			getCachedContextBreakdown: () => {
				const usage = session.getContextUsage();
				return { usedTokens: usage?.tokens ?? 0, contextWindow: usage?.contextWindow ?? 0 };
			},
		},
		ui: { requestRender: () => {} },
	};
	// Collaboration (guest side). Constructed on `collab_join`; cleared on
	// `collab_leave` or when the host ends the session (its own `bye`/close
	// handling calls back through `notifyApplicationChanged` but does not
	// clear this reference itself, so `left` is checked before reuse).
	let collabGuest: RpcCollabGuest | undefined;

	const application = new ApplicationController(
		new AgentSessionApplicationRuntime(session, { onSessionChanged: () => subagentRegistry?.clear() }),
		output,
	);

	// Shutdown request flag (wrapped in object to allow mutation with const)
	const shutdownState = { requested: false };

	/**
	 * Extension UI context that uses the RPC protocol.
	 */
	class RpcExtensionUIContext implements ExtensionUIContext {
		constructor(
			private pendingRequests: Map<string, PendingExtensionRequest>,
			private output: (obj: RpcResponse | RpcExtensionUIRequest | object) => void,
		) {}

		select(
			title: string,
			options: ExtensionUISelectItem[],
			dialogOptions?: ExtensionUIDialogOptions,
		): Promise<string | undefined> {
			return requestRpcDialog(
				this.pendingRequests,
				this.output,
				dialogOptions,
				undefined,
				{
					method: "select",
					title,
					options: options.map(getExtensionUISelectOptionLabel),
					timeout: dialogOptions?.timeout,
				},
				response => parseValueDialogResponse(response, dialogOptions),
			);
		}

		requestToolApproval(request: ToolApprovalUIRequest): Promise<ToolApprovalChoice | undefined> {
			return requestRpcDialog(
				this.pendingRequests,
				this.output,
				undefined,
				undefined,
				{ method: "toolApproval", ...request },
				response => {
					if (!("approvalChoice" in response)) return undefined;
					return request.choices.includes(response.approvalChoice) ? response.approvalChoice : undefined;
				},
			);
		}

		confirm(title: string, message: string, dialogOptions?: ExtensionUIDialogOptions): Promise<boolean> {
			return requestRpcDialog(
				this.pendingRequests,
				this.output,
				dialogOptions,
				false,
				{ method: "confirm", title, message, timeout: dialogOptions?.timeout },
				response => {
					if ("cancelled" in response && response.cancelled) {
						if (response.timedOut) dialogOptions?.onTimeout?.();
						return false;
					}
					if ("confirmed" in response) return response.confirmed;
					return false;
				},
			);
		}

		input(
			title: string,
			placeholder?: string,
			dialogOptions?: ExtensionUIDialogOptions,
		): Promise<string | undefined> {
			return requestRpcDialog(
				this.pendingRequests,
				this.output,
				dialogOptions,
				undefined,
				{ method: "input", title, placeholder, timeout: dialogOptions?.timeout },
				response => parseValueDialogResponse(response, dialogOptions),
			);
		}

		onTerminalInput(): () => void {
			// Raw terminal input not supported in RPC mode
			return () => {};
		}

		notify(message: string, type?: "info" | "warning" | "error"): void {
			// Fire and forget - no response needed
			this.output({
				type: "extension_ui_request",
				id: Snowflake.next() as string,
				method: "notify",
				message,
				notifyType: type,
			} as RpcExtensionUIRequest);
		}

		setStatus(key: string, text: string | undefined): void {
			// Fire and forget - no response needed
			this.output({
				type: "extension_ui_request",
				id: Snowflake.next() as string,
				method: "setStatus",
				statusKey: key,
				statusText: text,
			} as RpcExtensionUIRequest);
		}

		setWorkingMessage(_message?: string): void {
			// Not supported in RPC mode
		}

		setWidget(key: string, content: unknown, options?: ExtensionWidgetOptions): void {
			// Only support string arrays in RPC mode - factory functions are ignored
			if (content === undefined || Array.isArray(content)) {
				this.output({
					type: "extension_ui_request",
					id: Snowflake.next() as string,
					method: "setWidget",
					widgetKey: key,
					widgetLines: content as string[] | undefined,
					widgetPlacement: options?.placement,
				} as RpcExtensionUIRequest);
			}
			// Component factories are not supported in RPC mode - would need TUI access
		}

		setFooter(_factory: unknown): void {
			// Custom footer not supported in RPC mode - requires TUI access
		}

		setHeader(_factory: unknown): void {
			// Custom header not supported in RPC mode - requires TUI access
		}

		setTitle(title: string): void {
			// Title updates are low-value noise for most RPC hosts; opt in via PI_RPC_EMIT_TITLE=1.
			if (!emitRpcTitles) return;
			this.output({
				type: "extension_ui_request",
				id: Snowflake.next() as string,
				method: "setTitle",
				title,
			} as RpcExtensionUIRequest);
		}

		async custom(): Promise<never> {
			// Custom UI not supported in RPC mode
			return undefined as never;
		}

		pasteToEditor(text: string): void {
			// Paste handling not supported in RPC mode - falls back to setEditorText
			this.setEditorText(text);
		}

		setEditorText(text: string): void {
			// Fire and forget - host can implement editor control
			this.output({
				type: "extension_ui_request",
				id: Snowflake.next() as string,
				method: "set_editor_text",
				text,
			} as RpcExtensionUIRequest);
		}

		getEditorText(): string {
			// Synchronous method can't wait for RPC response
			// Host should track editor state locally if needed
			return "";
		}

		async editor(
			title: string,
			prefill?: string,
			dialogOptions?: ExtensionUIDialogOptions,
			editorOptions?: { promptStyle?: boolean },
		): Promise<string | undefined> {
			return requestRpcEditor(this.pendingRequests, this.output, title, prefill, dialogOptions, editorOptions);
		}

		addAutocompleteProvider(): void {
			// Autocomplete provider composition is not supported in RPC mode
		}

		get theme(): Theme {
			return theme;
		}

		getAllThemes(): Promise<{ name: string; path: string | undefined }[]> {
			return Promise.resolve([]);
		}

		getTheme(_name: string): Promise<Theme | undefined> {
			return Promise.resolve(undefined);
		}

		setTheme(_theme: string | Theme): Promise<{ success: boolean; error?: string }> {
			// Theme switching not supported in RPC mode
			return Promise.resolve({ success: false, error: "Theme switching not supported in RPC mode" });
		}

		getToolsExpanded() {
			// Tool expansion not supported in RPC mode - no TUI
			return false;
		}

		setToolsExpanded(_expanded: boolean) {
			// Tool expansion not supported in RPC mode - no TUI
		}

		setEditorComponent(): void {
			// Custom editor components not supported in RPC mode
		}
	}

	// Wire up UI context for tool execution (ask tool, etc.) and extensions.
	// A single shared instance routes all responses received on stdin to the
	// correct waiting promise regardless of which code path created the request.
	const rpcUiContext = new RpcExtensionUIContext(pendingExtensionRequests, output);
	setToolUIContext?.(rpcUiContext, true);

	// Set up extensions with RPC-based UI context
	await initializeExtensions(session, {
		reportSendError: (action, err) => {
			output(error(undefined, action, err.message));
		},
		reportRuntimeError: err => {
			output({ type: "extension_error", extensionPath: err.extensionPath, event: err.event, error: err.error });
		},
		onShutdown: () => {
			shutdownState.requested = true;
		},
		trackAgentInvokingMessage: task => {
			extensionUserMessageTracker.trackAgentMessageTask(task);
		},
		uiContext: rpcUiContext,
	});

	// Output all agent events as JSON
	session.subscribe(event => {
		output(event);
		// The `goal` tool can complete the objective from inside the agent loop
		// (no RPC command involved) — `mode: "exiting"` signals that transition.
		// Mirror the TUI's #exitGoalMode(reason: "completed") cleanup so the
		// restricted "goal" tool set never gets stuck active.
		if (event.type === "goal_updated" && event.state?.mode === "exiting") {
			const completedGoal = event.state.goal;
			void (async () => {
				try {
					if (goalModePreviousTools) {
						await session.setActiveToolsByName(goalModePreviousTools);
						goalModePreviousTools = undefined;
					}
					session.setGoalModeState(undefined);
					session.sessionManager.appendModeChange("none");
					session.sessionManager.appendCustomEntry("goal-completed", {
						objective: completedGoal.objective,
						tokensUsed: completedGoal.tokensUsed,
						tokenBudget: completedGoal.tokenBudget,
						timeUsedSeconds: completedGoal.timeUsedSeconds,
					});
				} catch (err) {
					logger.warn("failed to finalize completed goal", { err: String(err) });
				}
			})();
		}
	});

	const getAvailableCommands = async () => buildAvailableSlashCommands(session);
	const reloadPluginState = async () => {
		const cwd = session.sessionManager.getCwd();
		const projectPath = await resolveActiveProjectRegistryPath(cwd);
		clearPluginRootsAndCaches(projectPath ? [projectPath] : undefined);
		resetCapabilities();
		await session.refreshSkills();
		session.setSlashCommands(await loadSlashCommands({ cwd }));
		await emitAvailableCommandsUpdate();
	};
	const emitAvailableCommandsUpdate = async () => {
		output({ type: "available_commands_update", commands: await getAvailableCommands() });
	};
	session.subscribeCommandMetadataChanged(() => {
		void emitAvailableCommandsUpdate();
	});
	await emitAvailableCommandsUpdate();

	// Handle a single command
	const handleCommand = async (command: RpcCommand): Promise<RpcResponse> => {
		const id = command.id;

		switch (command.type) {
			case "negotiate_protocol": {
				if (command.protocolVersion !== 2)
					return error(id, "negotiate_protocol", `Unsupported RPC protocol version: ${command.protocolVersion}`);
				return success(id, "negotiate_protocol", { protocolVersion: 2 });
			}

			// =================================================================
			// Prompting
			// =================================================================

			case "prompt": {
				const skillResult = await tryRunRpcSkillCommand(session, command.message, command.streamingBehavior);
				if (skillResult) {
					return success(id, "prompt", skillResult);
				}
				const builtinResult = await executeAcpBuiltinSlashCommand(command.message, {
					session,
					sessionManager: session.sessionManager,
					settings: session.settings,
					cwd: session.sessionManager.getCwd(),
					output: text => output({ type: "command_output", text }),
					refreshCommands: emitAvailableCommandsUpdate,
					reloadPlugins: reloadPluginState,
					notifyTitleChanged: async () => {
						output({ type: "session_info_update", title: session.sessionName, sessionId: session.sessionId });
					},
					notifyConfigChanged: async () => {
						output({ type: "config_update", model: session.model, thinkingLevel: session.thinkingLevel });
					},
				});
				if (builtinResult !== false) {
					if ("prompt" in builtinResult) {
						// A guest's local commands (/dump, /settings, ...) run against the
						// replica as usual, but a residual prompt is real conversational
						// content — it goes over the collab wire, not to a local agent turn.
						if (collabGuest && !collabGuest.left) {
							const sent = collabGuest.sendPrompt(builtinResult.prompt, command.images);
							return sent
								? success(id, "prompt", { agentInvoked: true })
								: error(id, "prompt", "This collab link is read-only.");
						}
						watchAndReportLocalOnlyPromptResult({
							id,
							startPrompt: () => session.prompt(builtinResult.prompt, { images: command.images }),
							output,
							onError: promptError => output(error(id, "prompt", promptError.message)),
							extensionUserMessageTracker,
						});
						return success(id, "prompt");
					}
					return success(id, "prompt", { agentInvoked: false });
				}

				if (collabGuest && !collabGuest.left) {
					const sent = collabGuest.sendPrompt(command.message, command.images);
					return sent
						? success(id, "prompt", { agentInvoked: true })
						: error(id, "prompt", "This collab link is read-only.");
				}

				// Don't await - events will stream
				// Extension commands are executed immediately, file prompt templates are expanded
				// If streaming and streamingBehavior specified, queues via steer/followUp
				watchAndReportLocalOnlyPromptResult({
					id,
					startPrompt: () =>
						session.prompt(command.message, {
							images: command.images,
							streamingBehavior: command.streamingBehavior,
						}),
					output,
					onError: promptError => output(error(id, "prompt", promptError.message)),
					extensionUserMessageTracker,
				});
				return success(id, "prompt");
			}

			case "steer": {
				if (collabGuest && !collabGuest.left) {
					const sent = collabGuest.sendPrompt(command.message, command.images);
					return sent ? success(id, "steer") : error(id, "steer", "This collab link is read-only.");
				}
				await session.steer(command.message, command.images);
				return success(id, "steer");
			}

			case "follow_up": {
				if (collabGuest && !collabGuest.left) {
					const sent = collabGuest.sendPrompt(command.message, command.images);
					return sent ? success(id, "follow_up") : error(id, "follow_up", "This collab link is read-only.");
				}
				await session.followUp(command.message, command.images);
				return success(id, "follow_up");
			}

			case "abort": {
				if (collabGuest && !collabGuest.left) {
					const sent = collabGuest.sendAbort();
					return sent ? success(id, "abort") : error(id, "abort", "This collab link is read-only.");
				}
				await session.abort({ reason: USER_INTERRUPT_LABEL });
				return success(id, "abort");
			}

			case "abort_and_prompt": {
				await session.abort({ reason: USER_INTERRUPT_LABEL });
				session
					.prompt(command.message, { images: command.images })
					.catch(e => output(error(id, "abort_and_prompt", e.message)));
				return success(id, "abort_and_prompt");
			}

			case "new_session":
			case "switch_session":
			case "branch": {
				if (collabGuest && !collabGuest.left) {
					return error(id, command.type, "Leave the collab session first (collab_leave).");
				}
				const result = await handleRpcSessionChange(session, command, subagentRegistry);
				if (!result.data.cancelled) await emitAvailableCommandsUpdate();
				return success(id, result.type, result.data);
			}

			// =================================================================
			// State
			// =================================================================

			case "get_state": {
				const state: RpcSessionState = {
					model: session.model,
					thinkingLevel: session.thinkingLevel,
					isStreaming: session.isStreaming,
					isCompacting: session.isCompacting,
					steeringMode: session.steeringMode,
					followUpMode: session.followUpMode,
					interruptMode: session.interruptMode,
					sessionFile: session.sessionFile,
					sessionId: session.sessionId,
					sessionName: session.sessionName,
					autoCompactionEnabled: session.autoCompactionEnabled,
					autoRetryEnabled: session.autoRetryEnabled,
					queuedMessageCount: session.queuedMessageCount,
					todoPhases: session.getTodoPhases(),
					fastModeEnabled: session.isFastModeEnabled(),
					tokensPerSecond: calculateTokensPerSecond(session.messages, session.isStreaming),
					fastModeActive: session.isFastModeActive(),
					messageCount: session.messages.length,
					systemPrompt: session.systemPrompt,
					dumpTools: session.agent.state.tools.map(tool => ({
						name: tool.name,
						description: tool.description,
						parameters: toolWireSchema(tool),
						examples: tool.examples,
					})),
					contextUsage: session.getContextUsage(),
				};
				return success(id, "get_state", state);
			}

			case "get_application_snapshot": {
				return success(id, "get_application_snapshot", await application.snapshot());
			}

			case "execute_application_intent": {
				try {
					return success(id, "execute_application_intent", await application.execute(command));
				} catch (intentError) {
					return error(
						id,
						"execute_application_intent",
						intentError instanceof Error ? intentError.message : String(intentError),
						intentError instanceof ApplicationStaleRevisionError ? "stale_revision" : undefined,
					);
				}
			}

			case "set_fast_mode": {
				const supported = session.setFastMode(command.enabled);
				if (command.enabled && !supported) {
					return error(id, "set_fast_mode", "Fast mode is unavailable for the current model.");
				}
				return success(id, "set_fast_mode", {
					enabled: session.isFastModeEnabled(),
					active: session.isFastModeActive(),
				});
			}

			case "get_available_commands": {
				return success(id, "get_available_commands", { commands: await getAvailableCommands() });
			}

			case "set_todos": {
				session.setTodoPhases(command.phases);
				return success(id, "set_todos", { todoPhases: session.getTodoPhases() });
			}

			case "set_host_tools": {
				const tools = normalizeHostToolDefinitions(command.tools);
				const rpcTools = hostToolBridge.setTools(tools);
				await session.refreshRpcHostTools(rpcTools);
				return success(id, "set_host_tools", { toolNames: tools.map(tool => tool.name) });
			}

			case "set_host_uri_schemes": {
				try {
					const schemes = hostUriBridge.setSchemes(command.schemes);
					return success(id, "set_host_uri_schemes", { schemes });
				} catch (err) {
					return error(id, "set_host_uri_schemes", err instanceof Error ? err.message : String(err));
				}
			}

			case "set_subagent_subscription": {
				if (!subagentRegistry) {
					return error(id, "set_subagent_subscription", "Subagent event bus is unavailable");
				}
				if (!isSubagentSubscriptionLevel(command.level)) {
					return error(
						id,
						"set_subagent_subscription",
						`Invalid subagent subscription level: ${String(command.level)}`,
					);
				}
				subagentRegistry.setSubscriptionLevel(command.level);
				return success(id, "set_subagent_subscription", { level: subagentRegistry.getSubscriptionLevel() });
			}

			case "get_subagents": {
				if (!subagentRegistry) {
					return error(id, "get_subagents", "Subagent event bus is unavailable");
				}
				return success(id, "get_subagents", { subagents: subagentRegistry.getSubagents() });
			}

			case "get_subagent_messages": {
				if (!subagentRegistry) {
					return error(id, "get_subagent_messages", "Subagent event bus is unavailable");
				}
				try {
					if (command.fromByte !== undefined && !Number.isFinite(command.fromByte)) {
						return error(id, "get_subagent_messages", "fromByte must be a finite number");
					}
					const sessionFile = subagentRegistry.resolveSessionFile(command);
					const transcript = await readRpcSubagentTranscript(sessionFile, command.fromByte);
					return success(id, "get_subagent_messages", transcript);
				} catch (err) {
					return error(id, "get_subagent_messages", err instanceof Error ? err.message : String(err));
				}
			}

			// =================================================================
			// OMP workflows (plan/goal mode, advisor status)
			// =================================================================

			case "get_workflow_state": {
				return success(id, "get_workflow_state", buildWorkflowState());
			}

			case "enter_plan_mode": {
				if (!session.settings.get("plan.enabled")) {
					return error(id, "enter_plan_mode", "Plan mode is disabled in settings.");
				}
				if (session.getGoalModeState()?.enabled) {
					return error(id, "enter_plan_mode", "Exit goal mode first.");
				}
				if (session.getPlanModeState()?.enabled) {
					return success(id, "enter_plan_mode", buildWorkflowState());
				}
				try {
					const planFilePath = session.getPlanReferencePath() || "local://PLAN.md";
					const previousTools = session.getEnabledToolNames();
					const augmentations = session.hasBuiltInTool("write") ? ["write"] : [];
					planModePreviousTools = previousTools;
					await session.setActiveToolsByName([...new Set([...previousTools, ...augmentations])]);
					session.setPlanModeState({
						enabled: true,
						planFilePath,
						workflow: command.workflow ?? "parallel",
					});
					session.setPlanProposalHandler?.(title => session.preparePlanForReview(title));
					if (session.isStreaming) await session.sendPlanModeContext({ deliverAs: "steer" });
					session.sessionManager.appendModeChange("plan", { planFilePath });
					return success(id, "enter_plan_mode", buildWorkflowState());
				} catch (err) {
					planModePreviousTools = undefined;
					return error(id, "enter_plan_mode", err instanceof Error ? err.message : String(err));
				}
			}

			case "exit_plan_mode": {
				if (!session.getPlanModeState()?.enabled) {
					return success(id, "exit_plan_mode", buildWorkflowState());
				}
				try {
					session.setPlanModeState(undefined);
					session.setPlanProposalHandler?.(null);
					if (planModePreviousTools) {
						await session.setActiveToolsByName(planModePreviousTools);
						planModePreviousTools = undefined;
					}
					session.sessionManager.appendModeChange("none");
					return success(id, "exit_plan_mode", buildWorkflowState());
				} catch (err) {
					return error(id, "exit_plan_mode", err instanceof Error ? err.message : String(err));
				}
			}

			case "goal_set": {
				if (!session.settings.get("goal.enabled")) {
					return error(id, "goal_set", "Goal mode is disabled in settings.");
				}
				if (session.getPlanModeState()?.enabled) {
					return error(id, "goal_set", "Exit plan mode first.");
				}
				const objective = command.objective.trim();
				if (!objective) return error(id, "goal_set", "objective is required.");
				try {
					const existing = session.getGoalModeState();
					const replacing =
						existing?.goal !== undefined &&
						existing.goal.status !== "dropped" &&
						existing.goal.status !== "complete";
					// GoalRuntime's setState host callback already syncs the returned
					// state onto the session — no need to call setGoalModeState again.
					if (replacing) {
						await session.goalRuntime.replaceGoal({ objective, tokenBudget: command.tokenBudget });
					} else {
						await session.goalRuntime.createGoal({ objective, tokenBudget: command.tokenBudget });
					}
					const previousTools = session.getEnabledToolNames().filter(name => name !== "goal");
					goalModePreviousTools = previousTools;
					await session.setActiveToolsByName([...new Set([...previousTools, "goal"])]);
					if (session.isStreaming) await session.sendGoalModeContext({ deliverAs: "steer" });
					return success(id, "goal_set", buildWorkflowState());
				} catch (err) {
					return error(id, "goal_set", err instanceof Error ? err.message : String(err));
				}
			}

			case "goal_resume": {
				if (!session.settings.get("goal.enabled")) {
					return error(id, "goal_resume", "Goal mode is disabled in settings.");
				}
				if (session.getPlanModeState()?.enabled) {
					return error(id, "goal_resume", "Exit plan mode first.");
				}
				try {
					await session.goalRuntime.resumeGoal();
					const previousTools = session.getEnabledToolNames().filter(name => name !== "goal");
					goalModePreviousTools = previousTools;
					await session.setActiveToolsByName([...new Set([...previousTools, "goal"])]);
					if (session.isStreaming) await session.sendGoalModeContext({ deliverAs: "steer" });
					return success(id, "goal_resume", buildWorkflowState());
				} catch (err) {
					return error(id, "goal_resume", err instanceof Error ? err.message : String(err));
				}
			}

			case "goal_pause": {
				try {
					// pauseGoal()'s setState host callback already syncs the session.
					await session.goalRuntime.pauseGoal();
					if (goalModePreviousTools) {
						await session.setActiveToolsByName(goalModePreviousTools);
						goalModePreviousTools = undefined;
					}
					return success(id, "goal_pause", buildWorkflowState());
				} catch (err) {
					return error(id, "goal_pause", err instanceof Error ? err.message : String(err));
				}
			}

			case "goal_drop": {
				try {
					// dropGoal() already clears the session's goal state and persists
					// "none" via its host callbacks — do not repeat either here.
					await session.goalRuntime.dropGoal();
					if (goalModePreviousTools) {
						await session.setActiveToolsByName(goalModePreviousTools);
						goalModePreviousTools = undefined;
					}
					return success(id, "goal_drop", buildWorkflowState());
				} catch (err) {
					return error(id, "goal_drop", err instanceof Error ? err.message : String(err));
				}
			}

			case "goal_set_budget": {
				try {
					// onBudgetMutated()'s setState host callback already syncs the session.
					await session.goalRuntime.onBudgetMutated(command.tokenBudget);
					return success(id, "goal_set_budget", buildWorkflowState());
				} catch (err) {
					return error(id, "goal_set_budget", err instanceof Error ? err.message : String(err));
				}
			}

			// =================================================================
			// Model
			// =================================================================

			case "set_model": {
				let models = session.getAvailableModels();
				let model = models.find(m => m.provider === command.provider && m.id === command.modelId);
				if (!model) {
					// Model not in the current catalog. Wait for in-flight
					// background discovery before declaring it missing: on cold
					// start, discovery-backed providers (proxy / ollama / etc.)
					// populate seconds after session ready. Models already in
					// the bundled catalog skip this await entirely so the RPC
					// queue is not stalled behind unrelated discovery.
					await session.modelRegistry.awaitBackgroundRefresh();
					models = session.getAvailableModels();
					model = models.find(m => m.provider === command.provider && m.id === command.modelId);
				}
				if (!model) {
					return error(id, "set_model", `Model not found: ${command.provider}/${command.modelId}`);
				}
				await session.setModel(model);
				return success(id, "set_model", model);
			}

			case "cycle_model": {
				const result = await session.cycleModel();
				if (!result) {
					return success(id, "cycle_model", null);
				}
				return success(id, "cycle_model", result);
			}

			case "get_available_models": {
				await session.modelRegistry.awaitBackgroundRefresh();
				const models = session.getAvailableModels();
				return success(id, "get_available_models", { models });
			}

			// =================================================================
			// Thinking
			// =================================================================

			case "set_thinking_level": {
				session.setThinkingLevel(command.level);
				return success(id, "set_thinking_level");
			}

			case "cycle_thinking_level": {
				const level = session.cycleThinkingLevel();
				if (!level) {
					return success(id, "cycle_thinking_level", null);
				}
				return success(id, "cycle_thinking_level", { level });
			}

			// =================================================================
			// Queue Modes
			// =================================================================

			case "set_steering_mode": {
				session.setSteeringMode(command.mode);
				return success(id, "set_steering_mode");
			}

			case "set_follow_up_mode": {
				session.setFollowUpMode(command.mode);
				return success(id, "set_follow_up_mode");
			}

			case "set_interrupt_mode": {
				session.setInterruptMode(command.mode);
				return success(id, "set_interrupt_mode");
			}

			// =================================================================
			// Compaction
			// =================================================================

			case "compact": {
				const result = await session.compact(command.customInstructions);
				return success(id, "compact", result);
			}

			case "set_auto_compaction": {
				session.setAutoCompactionEnabled(command.enabled);
				return success(id, "set_auto_compaction");
			}

			// =================================================================
			// Retry
			// =================================================================

			case "set_auto_retry": {
				session.setAutoRetryEnabled(command.enabled);
				return success(id, "set_auto_retry");
			}

			case "abort_retry": {
				session.abortRetry();
				return success(id, "abort_retry");
			}

			// =================================================================
			// Bash
			// =================================================================

			case "bash": {
				const result = await session.executeBash(
					command.command,
					id ? chunk => output({ type: "bash_output", id, chunk }) : undefined,
					{ excludeFromContext: command.excludeFromContext, useUserShell: true },
				);
				return success(id, "bash", result);
			}

			case "abort_bash": {
				session.abortBash();
				return success(id, "abort_bash");
			}

			// =================================================================
			// Approval policy management
			// =================================================================

			case "get_approval_policies": {
				return success(id, "get_approval_policies", {
					project: session.settings.getProjectApprovalPolicies(),
					global: session.settings.getGlobalApprovalPolicies(),
				});
			}

			case "set_approval_policy": {
				if (command.scope === "global") session.settings.setGlobalApprovalPolicy(command.policyKey, command.policy);
				else session.settings.setProjectApprovalPolicy(command.policyKey, command.policy);
				await session.settings.flush();
				return success(id, "set_approval_policy");
			}

			case "clear_approval_policy": {
				if (command.scope === "global") session.settings.clearGlobalApprovalPolicy(command.policyKey);
				else session.settings.clearProjectApprovalPolicy(command.policyKey);
				await session.settings.flush();
				return success(id, "clear_approval_policy");
			}

			// =================================================================
			// Session
			// =================================================================

			case "get_session_stats": {
				const stats = session.getSessionStats();
				return success(id, "get_session_stats", stats);
			}

			case "export_html": {
				const path = await session.exportToHtml(command.outputPath);
				return success(id, "export_html", { path });
			}

			case "get_branch_messages": {
				const messages = session.getUserMessagesForBranching();
				return success(id, "get_branch_messages", { messages });
			}

			case "get_last_assistant_text": {
				const text = session.getLastAssistantText();
				return success(id, "get_last_assistant_text", { text });
			}

			case "set_session_name": {
				const name = command.name.trim();
				if (!name) {
					return error(id, "set_session_name", "Session name cannot be empty");
				}
				const applied = await session.setSessionName(name, "user");
				if (!applied) {
					return error(id, "set_session_name", "Session name cannot be empty");
				}
				return success(id, "set_session_name");
			}

			case "handoff": {
				// Resetting the agent mid-stream lets the live turn keep emitting into a
				// session that handoff has already torn down. Refuse while a prompt is in
				// flight (mirrors the TUI /handoff guard).
				if (session.isStreaming) {
					return error(id, "handoff", "Cannot hand off while a response is in progress");
				}
				const result = await session.handoff(command.customInstructions);
				return success(id, "handoff", result ? { savedPath: result.savedPath } : null);
			}

			// =================================================================
			// Messages
			// =================================================================

			case "get_messages": {
				return success(id, "get_messages", { messages: session.messages });
			}

			case "get_workspace_review": {
				return success(id, "get_workspace_review", await buildWorkspaceReview(session.sessionManager.getCwd()));
			}

			case "get_messages_page": {
				if (session.isStreaming || session.isCompacting)
					return error(id, "get_messages_page", RPC_MESSAGES_PAGE_BUSY_ERROR, "session_busy");
				const messages = session.messages;
				try {
					return success(
						id,
						"get_messages_page",
						pageRpcMessages(
							messages,
							{
								sessionId: session.sessionId,
								leafId: session.sessionManager.getLeafId(),
								messageCount: messages.length,
							},
							{ cursor: command.cursor, limit: command.limit },
						),
					);
				} catch (pageError) {
					return error(
						id,
						"get_messages_page",
						pageError instanceof Error ? pageError.message : String(pageError),
						pageError instanceof RpcMessagesPageError ? pageError.code : undefined,
					);
				}
			}

			// =================================================================
			// Async jobs
			// =================================================================

			case "get_async_jobs": {
				const jobs = (session.asyncJobManager?.getAllJobs() ?? []).map(job => ({
					id: job.id,
					type: job.type,
					status: job.status,
					label: job.label,
					startTime: job.startTime,
					queued: job.queued,
					resultText: job.resultText,
					errorText: job.errorText,
				}));
				return success(id, "get_async_jobs", { jobs });
			}

			case "abort_async_job": {
				const cancelled = session.asyncJobManager?.cancel(command.jobId) ?? false;
				return success(id, "abort_async_job", { cancelled });
			}

			// =================================================================
			// Settings
			// =================================================================

			case "get_settings_schema": {
				const settings: RpcSettingDef[] = [];
				for (const settingPath of ALL_UI_SETTING_PATHS) {
					const ui = getUi(settingPath);
					if (!ui) continue;
					settings.push({
						path: settingPath,
						tab: ui.tab,
						group: ui.group,
						label: ui.label,
						description: ui.description,
						type: getType(settingPath),
						enumValues: getEnumValues(settingPath),
						options: ui.options,
						secret: isCredential(settingPath) || undefined,
					});
				}
				return success(id, "get_settings_schema", {
					tabs: SETTING_TABS.map(tab => ({ id: tab, label: TAB_METADATA[tab].label })),
					groups: TAB_GROUPS,
					settings,
				});
			}

			case "get_settings_values": {
				const values: RpcSettingValueEntry[] = [];
				for (const settingPath of ALL_UI_SETTING_PATHS) {
					const scope: "project" | "global" | "default" =
						session.settings.getProjectValue(settingPath) !== undefined
							? "project"
							: session.settings.getGlobalValue(settingPath) !== undefined
								? "global"
								: "default";
					values.push(
						isCredential(settingPath)
							? { path: settingPath, configured: session.settings.isConfigured(settingPath), scope }
							: { path: settingPath, value: session.settings.get(settingPath), scope },
					);
				}
				return success(id, "get_settings_values", { values });
			}

			case "set_setting_value": {
				if (!ALL_UI_SETTING_PATHS.has(command.path as SettingPath)) {
					return error(id, "set_setting_value", `Unknown setting: ${command.path}`);
				}
				const settingPath = command.path as SettingPath;
				if (command.scope === "project") session.settings.setProject(settingPath, command.value as never);
				else session.settings.set(settingPath, command.value as never);
				await session.settings.flush();
				return success(id, "set_setting_value");
			}

			case "clear_setting_value": {
				if (!ALL_UI_SETTING_PATHS.has(command.path as SettingPath)) {
					return error(id, "clear_setting_value", `Unknown setting: ${command.path}`);
				}
				const settingPath = command.path as SettingPath;
				if (command.scope === "project") session.settings.clearProjectSetting(settingPath);
				else session.settings.set(settingPath, getDefault(settingPath));
				await session.settings.flush();
				return success(id, "clear_setting_value");
			}

			// =================================================================
			// Resources
			// =================================================================

			case "get_resources": {
				const cwd = session.sessionManager.getCwd();
				const [promptsResult, plugins, agentsResult] = await Promise.all([
					loadCapability<Prompt>("prompts", { cwd }).catch(() => ({ items: [], warnings: [] })),
					new PluginManager(cwd).list().catch(() => []),
					discoverAgents(cwd).catch(() => ({ agents: [], projectAgentsDir: null })),
				]);
				const mcpManager = MCPManager.instance();
				const mcpServers: RpcResourcesSnapshot["mcpServers"] = (mcpManager?.getAllServerNames() ?? []).map(
					mcpName => ({
						name: mcpName,
						status: mcpManager?.getConnectionStatus(mcpName) ?? "disconnected",
						toolCount: mcpManager?.getConnection(mcpName)?.tools?.length,
						sourceLevel: mcpManager?.getSource(mcpName)?.level,
					}),
				);
				const snapshot: RpcResourcesSnapshot = {
					skills: session.skills.map(skill => ({
						name: skill.name,
						description: skill.description,
						source: skill.source,
						hide: skill.hide,
					})),
					skillWarnings: session.skillWarnings.map(warning => warning.message),
					prompts: promptsResult.items.map(prompt => ({
						name: prompt.name,
						path: prompt.path,
						sourceLevel: prompt._source.level,
						providerName: prompt._source.providerName,
					})),
					promptWarnings: promptsResult.warnings,
					plugins: plugins.map(plugin => ({
						name: plugin.name,
						version: plugin.version,
						enabled: plugin.enabled,
						enabledFeatures: plugin.enabledFeatures,
					})),
					mcpServers,
					agents: agentsResult.agents.map(agent => ({
						name: agent.name,
						description: agent.description,
						source: agent.source,
					})),
					tools: session.agent.state.tools.map(tool => ({ name: tool.name, description: tool.description })),
				};
				return success(id, "get_resources", snapshot);
			}

			case "reload_resources": {
				await reloadPluginState();
				return success(id, "reload_resources");
			}

			// =================================================================
			// Login
			// =================================================================

			case "get_login_providers": {
				const providers = getOAuthProviders().map(provider => ({
					id: provider.id,
					name: provider.name,
					available: provider.available,
					authenticated: session.modelRegistry.authStorage.hasAuth(provider.id),
				}));
				return success(id, "get_login_providers", { providers });
			}

			case "login": {
				const knownProvider = getOAuthProviders().find(p => p.id === command.providerId);
				if (!knownProvider) {
					return error(id, "login", `Unknown OAuth provider: ${command.providerId}`);
				}
				const uiCtx = new RpcExtensionUIContext(pendingExtensionRequests, output);
				// Track whether onAuth has fired. Providers that require interactive
				// input before a browser URL cannot be satisfied headlessly; after
				// onAuth, prompt input is the pasted OAuth code/redirect URL path.
				let authEmitted = false;
				try {
					await session.modelRegistry.authStorage.login(command.providerId, {
						onAuth: info => {
							authEmitted = true;
							output({
								type: "extension_ui_request",
								id: Snowflake.next() as string,
								method: "open_url",
								url: info.url,
								launchUrl: info.launchUrl,
								instructions: info.instructions,
							} as RpcExtensionUIRequest);
						},
						onProgress: message => {
							uiCtx.notify(message, "info");
						},
						onPrompt: async prompt => {
							if (!authEmitted) {
								// onPrompt called before any auth URL — provider requires
								// interactive input that cannot be satisfied headlessly.
								return Promise.reject(
									new Error(
										`Provider '${command.providerId}' requires interactive prompts ` +
											"which are not supported in RPC mode. Use the terminal UI to log in.",
									),
								);
							}
							return (await uiCtx.input(prompt.message, prompt.placeholder, { timeout: 600_000 })) ?? "";
						},
					});
					// Provider-scoped online refresh so the just-persisted credential
					// re-runs discovery instead of reusing a fresh authoritative cache
					// row (#5780).
					await session.modelRegistry.refreshProvider(command.providerId, "online");
					return success(id, "login", { providerId: command.providerId });
				} catch (err: unknown) {
					return error(id, "login", err instanceof Error ? err.message : String(err));
				}
			}

			// =================================================================
			// Provider API keys (BYO-key credential entry, distinct from OAuth login above)
			// =================================================================

			case "get_provider_credentials": {
				const catalogProviders: readonly ProviderCatalogEntry[] = CATALOG_PROVIDERS;
				const providers = catalogProviders
					.filter(provider => provider.createModelManagerOptions && !provider.specialModelManager)
					.map(provider => ({
						id: provider.id,
						label: provider.catalogDiscovery?.label ?? provider.id,
						configured: session.modelRegistry.authStorage.hasAuth(provider.id),
					}));
				return success(id, "get_provider_credentials", { providers });
			}

			case "set_provider_api_key": {
				session.modelRegistry.authStorage.upsertCredential(command.providerId, {
					type: "api_key",
					key: command.apiKey,
				});
				await session.modelRegistry.refreshProvider(command.providerId, "online");
				return success(id, "set_provider_api_key");
			}

			case "clear_provider_api_key": {
				await session.modelRegistry.authStorage.logout(command.providerId);
				return success(id, "clear_provider_api_key");
			}

			// =================================================================
			// Release updates
			// =================================================================

			case "get_update_status": {
				const base = { currentVersion: VERSION, downloadUrl: OFFICIAL_DOWNLOAD_URL, checkedAt: Date.now() };
				try {
					const release = await getLatestRelease({ timeoutMs: 10_000 });
					return success(id, "get_update_status", {
						...base,
						latestVersion: release.version,
						updateAvailable: compareVersions(release.version, VERSION) > 0,
					});
				} catch (err) {
					return success(id, "get_update_status", {
						...base,
						updateAvailable: false,
						error: err instanceof Error ? err.message : String(err),
					});
				}
			}

			// =================================================================
			// Collaboration (host side)
			// =================================================================

			case "collab_start": {
				if (collabHostContext.collabHost) return success(id, "collab_start", buildCollabState());
				if (collabGuest && !collabGuest.left) return error(id, "collab_start", "Leave the collab session first.");
				const relayInput = command.relayUrl || session.settings.get("collab.relayUrl") || "";
				if (!relayInput) {
					return error(
						id,
						"collab_start",
						"No relay configured. Set collab.relayUrl in settings or pass relayUrl.",
					);
				}
				// Scheme-less relay input defaults to wss (ws:// must be spelled out for localhost).
				const relayUrl = relayInput.includes("://") ? relayInput : `wss://${relayInput}`;
				const webUrl = command.webUrl || session.settings.get("collab.webUrl") || "";
				const host = new CollabHost(collabHostContext);
				try {
					await host.start(relayUrl, webUrl);
				} catch (err) {
					return error(id, "collab_start", err instanceof Error ? err.message : String(err));
				}
				collabHostContext.collabHost = host;
				return success(id, "collab_start", buildCollabState());
			}

			case "collab_stop": {
				const host = collabHostContext.collabHost;
				if (!host) return success(id, "collab_stop", buildCollabState());
				await host.stop("host stopped");
				return success(id, "collab_stop", buildCollabState());
			}

			case "get_collab_state": {
				return success(id, "get_collab_state", buildCollabState());
			}

			case "collab_join": {
				if (collabGuest && !collabGuest.left) {
					return error(id, "collab_join", "Already in a collab session (leave first).");
				}
				if (collabHostContext.collabHost) {
					return error(id, "collab_join", "Stop hosting first.");
				}
				const guest = new RpcCollabGuest({
					session,
					settings: session.settings,
					eventBus,
					output,
					uiContext: rpcUiContext,
					notifyApplicationChanged: () => application.notifyExternalChange(),
				});
				try {
					await guest.join(command.link);
				} catch (err) {
					return error(id, "collab_join", err instanceof Error ? err.message : String(err));
				}
				collabGuest = guest;
				await emitAvailableCommandsUpdate();
				return success(id, "collab_join", { joined: true, readOnly: guest.readOnly, state: guest.state });
			}

			case "collab_leave": {
				if (!collabGuest || collabGuest.left) return success(id, "collab_leave");
				await collabGuest.leave();
				collabGuest = undefined;
				await emitAvailableCommandsUpdate();
				return success(id, "collab_leave");
			}

			default: {
				const unknownCommand = command as { type: string };
				return error(undefined, unknownCommand.type, `Unknown command: ${unknownCommand.type}`);
			}
		}
	};

	// Deferred shutdown (pi.shutdown() from an extension) must not kill the
	// process while a background-dispatched bash still owes the client its
	// response frame. The coordinator drains tracked tasks before exiting and
	// re-checks the request as each task settles.
	const shutdownCoordinator = new RpcShutdownCoordinator({
		isShutdownRequested: () => shutdownState.requested,
		performShutdown: async () => {
			// Say goodbye to any collab guests before the socket goes away with the
			// process, so they see a clean "host stopped" instead of an abrupt drop.
			await collabHostContext.collabHost?.stop("host process exiting");
			if (collabGuest && !collabGuest.left) await collabGuest.leave();
			// Route through the idempotent session.dispose() so the browser
			// reaper (releaseTabsForOwner) and other bounded teardown run before
			// the process exits. dispose() also emits `session_shutdown`, so we
			// must NOT emit it separately here or the event fires twice. Skipping
			// dispose left OMP-owned Chromium alive after RPC shutdown (#5643).
			await session.dispose();
			process.exit(0);
		},
	});

	const dispatchFrameDeps: RpcInputFrameDeps = {
		handleCommand,
		output,
		errorResponse: error,
		trackBackgroundTask: task => shutdownCoordinator.track(task),
		pendingExtensionRequests,
		onHostToolResult: frame => hostToolBridge.handleResult(frame),
		onHostToolUpdate: frame => hostToolBridge.handleUpdate(frame),
		onHostUriResult: frame => hostUriBridge.handleResult(frame),
	};

	const inputDispatcher = new RpcInputDispatcher({
		deps: dispatchFrameDeps,
		afterSerialCommand: () => shutdownCoordinator.checkShutdownRequested(),
	});

	// Keep the stdin reader moving: side-channel frames dispatch immediately,
	// ordinary commands serialize through inputDispatcher, and bash remains
	// background-dispatched so abort_bash can overtake it. Frames are read
	// line-by-line and parsed here (not via readJsonl) so a single malformed
	// line is reported as an error frame and the loop keeps running instead of
	// throwing out of the generator and killing the whole process (issue #5194).
	const decoder = new TextDecoder();
	for await (const line of readLines(input ?? Bun.stdin.stream())) {
		const text = decoder.decode(line).trim();
		if (!text) continue;
		let parsed: unknown;
		try {
			parsed = JSON.parse(text);
		} catch (e: unknown) {
			const message = e instanceof Error ? e.message : String(e);
			output(error(undefined, "parse", `Failed to parse command: ${message}`));
			continue;
		}
		inputDispatcher.dispatch(parsed);
	}

	// stdin closed — RPC client is gone. Fail pending side-channel requests
	// first so active/queued commands can settle, then drain accepted work.
	pendingExtensionRequests.rejectAll("RPC client disconnected before extension UI response completed");
	hostToolBridge.close("RPC client disconnected before host tool execution completed");
	hostUriBridge.clear("RPC client disconnected before host URI request completed");
	await inputDispatcher.drain();
	await shutdownCoordinator.drain();
	application.dispose();
	subagentRegistry?.dispose();
	// Dispose the main session before exiting so the browser reaper and other
	// bounded teardown run on the stdin-EOF path too (#5643). Idempotent: a
	// prior pi.shutdown() through the coordinator makes this await settle
	// immediately.
	await session.dispose();
	process.exit(0);
}
