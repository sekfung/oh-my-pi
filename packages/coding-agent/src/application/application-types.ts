export const APPLICATION_PROTOCOL_VERSION = 1;

export type ApplicationCapability =
	| "conversation.read"
	| "conversation.send"
	| "sessions.list"
	| "sessions.create"
	| "sessions.switch"
	| "sessions.rename"
	| "sessions.delete"
	| "sessions.clone"
	| "sessions.fork"
	| "sessions.import"
	| "sessions.export"
	| "sessionTree.read"
	| "sessionTree.navigate"
	| "sessionTree.label"
	| "sessionTree.fork"
	| "review.read"
	| "queue.read"
	| "queue.remove"
	| "queue.clear";

export interface ApplicationQueuedMessage {
	id: string;
	delivery: "steer" | "followUp";
	text: string;
	images?: Array<{ type: "image"; data: string; mimeType: string }>;
}

export interface ApplicationProject {
	path: string;
	name: string;
}

export interface ApplicationSessionSummary {
	path: string;
	id: string;
	title?: string;
	/** Path of the session this one was forked from, when lineage is recorded. */
	parentSessionPath?: string;
	createdAt: string;
	modifiedAt: string;
	messageCount: number;
	firstMessage: string;
	status: "complete" | "interrupted" | "aborted" | "error" | "pending" | "unknown";
}

/** One entry/branch node from the active session's journal tree. */
export interface ApplicationSessionTreeNode {
	id: string;
	parentId: string | null;
	/** Session-entry type discriminator (message, compaction, label, …). */
	type: string;
	/** User-assigned label in effect for this entry, if any. */
	label?: string;
	/** When the entry was persisted (ISO timestamp). */
	timestamp: string;
	/** Bounded plain-text preview for list rendering. */
	preview: string;
}

export interface ApplicationSessionTree {
	nodes: ApplicationSessionTreeNode[];
	leafId: string | null;
}

export interface ApplicationActiveSession {
	id: string;
	path?: string;
	title?: string;
	model?: {
		provider: string;
		id: string;
		name?: string;
	};
	thinkingLevel?: string;
	isStreaming: boolean;
	isCompacting: boolean;
	queuedMessageCount: number;
	queue: {
		items: ApplicationQueuedMessage[];
		hiddenCount: number;
	};
	transcript: {
		messageCount: number;
	};
	/** Branch tree of the active session's journal entries. */
	tree: ApplicationSessionTree;
}

export interface ApplicationSnapshot {
	protocolVersion: typeof APPLICATION_PROTOCOL_VERSION;
	sequence: number;
	revision: number;
	project: ApplicationProject;
	activeSession: ApplicationActiveSession;
	sessions: ApplicationSessionSummary[];
	capabilities: ApplicationCapability[];
}

export type ApplicationIntent =
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

export interface ApplicationIntentRequest {
	intentId: string;
	expectedRevision: number;
	intent: ApplicationIntent;
}

export interface ApplicationIntentResult {
	intentId: string;
	applied: boolean;
	snapshot: ApplicationSnapshot;
}

export interface ApplicationChangedEvent {
	type: "application_changed";
	sequence: number;
	revision: number;
	/** "external" covers changes the runtime made outside the intent path (e.g. a collab guest join/leave swapping the active session). */
	reason: "runtime" | "intent" | "external";
}

/** One changed path in the working tree, with bounded diff text. */
export interface WorkspaceReviewChange {
	path: string;
	staged: boolean;
	unstaged: boolean;
	untracked: boolean;
	diff: string;
}

/** Read-only Files/Changes projection for the desktop inspector. */
export interface WorkspaceReview {
	repository?: {
		root: string;
		branch?: string;
	};
	changes: {
		summary: { staged: number; unstaged: number; untracked: number };
		entries: WorkspaceReviewChange[];
		/** True when entries were capped; the summary counts remain complete. */
		truncated: boolean;
	};
	files: Array<{ path: string; kind: "file" | "directory" }>;
	/** True when the file listing was capped. */
	filesTruncated: boolean;
}
