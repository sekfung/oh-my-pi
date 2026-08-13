const MAX_FRAME_BYTES = 1024 * 1024;
const MAX_REASSEMBLED_BYTES = 64 * 1024 * 1024;
const MAX_CHUNK_PAYLOAD_BYTES = 256 * 1024;

interface PendingChunks {
	chunkId: string;
	count: number;
	byteLength: number;
	nextIndex: number;
	receivedBytes: number;
	chunks: Uint8Array[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function decodeBase64(value: unknown): Uint8Array {
	if (
		typeof value !== "string" ||
		value.length === 0 ||
		!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)
	) {
		throw new Error("Invalid RPC chunk data");
	}
	const binary = atob(value);
	const bytes = Uint8Array.from(binary, character => character.charCodeAt(0));
	if (btoa(binary) !== value) throw new Error("Invalid RPC chunk data");
	return bytes;
}

export class DesktopFrameDecoder {
	#pending?: PendingChunks;

	reset(): void {
		this.#pending = undefined;
	}

	push(value: unknown): object | undefined {
		if (!isRecord(value) || value.type !== "rpc_chunk") {
			if (this.#pending) throw new Error("RPC chunk sequence interrupted");
			if (!isRecord(value)) throw new Error("RPC frame must be an object");
			return value;
		}

		const { chunkId, index, count, byteLength } = value;
		if (
			typeof chunkId !== "string" ||
			chunkId.length === 0 ||
			chunkId.length > 128 ||
			!Number.isSafeInteger(index) ||
			!Number.isSafeInteger(count) ||
			!Number.isSafeInteger(byteLength) ||
			(index as number) < 0 ||
			(count as number) < 2 ||
			(count as number) > Math.ceil(MAX_REASSEMBLED_BYTES / MAX_CHUNK_PAYLOAD_BYTES) ||
			(index as number) >= (count as number) ||
			(byteLength as number) < MAX_FRAME_BYTES ||
			(byteLength as number) > MAX_REASSEMBLED_BYTES
		) {
			throw new Error("Invalid RPC chunk metadata");
		}

		const bytes = decodeBase64(value.data);
		if (bytes.byteLength > MAX_CHUNK_PAYLOAD_BYTES) throw new Error("RPC chunk payload exceeds the transport limit");
		if (!this.#pending) {
			if (index !== 0) throw new Error("RPC chunk sequence must start at index 0");
			this.#pending = {
				chunkId,
				count: count as number,
				byteLength: byteLength as number,
				nextIndex: 0,
				receivedBytes: 0,
				chunks: [],
			};
		}

		const pending = this.#pending;
		if (
			pending.chunkId !== chunkId ||
			pending.count !== count ||
			pending.byteLength !== byteLength ||
			pending.nextIndex !== index
		) {
			throw new Error("RPC chunk sequence mismatch");
		}
		pending.chunks.push(bytes);
		pending.receivedBytes += bytes.byteLength;
		pending.nextIndex += 1;
		if (pending.receivedBytes > pending.byteLength) throw new Error("RPC chunk sequence exceeds declared length");
		if (pending.nextIndex < pending.count) return undefined;
		if (pending.receivedBytes !== pending.byteLength) throw new Error("RPC chunk sequence length mismatch");

		this.#pending = undefined;
		const assembled = new Uint8Array(pending.byteLength);
		let offset = 0;
		for (const chunk of pending.chunks) {
			assembled.set(chunk, offset);
			offset += chunk.byteLength;
		}
		const decoded = new TextDecoder("utf-8", { fatal: true }).decode(assembled);
		const frame: unknown = JSON.parse(decoded);
		if (!isRecord(frame)) throw new Error("RPC frame must be an object");
		return frame;
	}
}
