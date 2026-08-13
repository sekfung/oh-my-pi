export const APPLICATION_PROTOCOL_VERSION = 1;

export type ApplicationCapability =
	| "conversation.read"
	| "conversation.send"
	| "sessions.list"
	| "sessions.create"
	| "sessions.switch"
	| "sessions.rename"
	| "sessions.delete"
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
	createdAt: string;
	modifiedAt: string;
	messageCount: number;
	firstMessage: string;
	status: "complete" | "interrupted" | "aborted" | "error" | "pending" | "unknown";
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
	reason: "runtime" | "intent";
}
