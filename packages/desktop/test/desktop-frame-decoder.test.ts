import { describe, expect, test } from "bun:test";
import { DesktopFrameDecoder } from "../src/lib/desktop-frame-decoder";

const CHUNK_BYTES = 256 * 1024;

function chunkFrames(value: object): object[] {
	const bytes = Buffer.from(JSON.stringify(value), "utf8");
	const count = Math.ceil(bytes.byteLength / CHUNK_BYTES);
	return Array.from({ length: count }, (_, index) => ({
		type: "rpc_chunk",
		chunkId: "test-chunk",
		index,
		count,
		byteLength: bytes.byteLength,
		data: bytes.subarray(index * CHUNK_BYTES, (index + 1) * CHUNK_BYTES).toString("base64"),
	}));
}

describe("DesktopFrameDecoder", () => {
	test("reassembles a protocol v2 response larger than the JSONL frame limit", () => {
		const decoder = new DesktopFrameDecoder();
		const expected = {
			type: "response",
			command: "get_application_snapshot",
			success: true,
			data: { transcript: "x".repeat(1024 * 1024) },
		};
		const frames = chunkFrames(expected);

		for (const frame of frames.slice(0, -1)) expect(decoder.push(frame)).toBeUndefined();
		expect(decoder.push(frames.at(-1))).toEqual(expected);
	});

	test("fails closed when an ordinary frame interrupts a chunk sequence", () => {
		const decoder = new DesktopFrameDecoder();
		const [first] = chunkFrames({ type: "event", content: "x".repeat(1024 * 1024) });
		expect(decoder.push(first)).toBeUndefined();
		expect(() => decoder.push({ type: "notice" })).toThrow("sequence interrupted");
	});
});
