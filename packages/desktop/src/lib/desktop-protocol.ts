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
	| { type: "cycle_thinking_level" };

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
