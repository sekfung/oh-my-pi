import { describe, expect, test } from "bun:test";
import {
	isHostInteraction,
	readApplicationSnapshot,
	readMessages,
	readSessionState,
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
				sessionId: "session-1",
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
				messageCount: 3,
				queue: { items: [{ id: "queue-2", delivery: "followUp", text: "Then package it" }] },
			},
			capabilities: ["sessions.list"],
			sessions: [{ id: "session-1", status: "complete" }],
		});
	});
});
