import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { DesktopFrameDecoder } from "@/lib/desktop-frame-decoder";
import type {
	DesktopHostInteractionResponse,
	DesktopRpcCommand,
	DesktopRpcFrame,
	DesktopRpcResponse,
} from "@/lib/desktop-protocol";

export type { DesktopRpcCommand, DesktopRpcFrame } from "@/lib/desktop-protocol";

export interface DesktopSidecarExit {
	generation: number;
	code: number | null;
}

export interface DesktopTransport {
	open(projectPath: string): Promise<void>;
	request(command: DesktopRpcCommand, options?: { id?: string }): Promise<DesktopRpcResponse>;
	respond(response: DesktopHostInteractionResponse): Promise<void>;
	onFrame(listener: (frame: DesktopRpcFrame) => void): () => void;
	onExit(listener: (exit: DesktopSidecarExit) => void): () => void;
	close(): Promise<void>;
}

interface PendingRequest {
	resolve: (response: DesktopRpcResponse) => void;
	reject: (reason?: unknown) => void;
}

interface ReadyResolver {
	promise: Promise<void>;
	resolve: (value: void | PromiseLike<void>) => void;
	reject: (reason?: unknown) => void;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isRpcResponse(value: unknown): value is DesktopRpcResponse {
	return (
		isRecord(value) &&
		value.type === "response" &&
		typeof value.command === "string" &&
		typeof value.success === "boolean"
	);
}

function isDesktopFrame(value: unknown): value is DesktopRpcFrame {
	return isRecord(value) && typeof value.type === "string";
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
	const timeout = Promise.withResolvers<T>();
	const timeoutId = window.setTimeout(() => timeout.reject(new Error(message)), timeoutMs);
	return Promise.race([promise, timeout.promise]).finally(() => window.clearTimeout(timeoutId));
}

export class TauriSidecarTransport implements DesktopTransport {
	#decoder = new TextDecoder();
	#frameDecoder = new DesktopFrameDecoder();
	#buffer = "";
	#requestId = 0;
	#generation = 0;
	#pending = new Map<string, PendingRequest>();
	#frameListeners = new Set<(frame: DesktopRpcFrame) => void>();
	#exitListeners = new Set<(exit: DesktopSidecarExit) => void>();
	#unlisteners: UnlistenFn[] = [];
	#listenersReady?: Promise<void>;
	#ready?: ReadyResolver;
	#closing = false;

	onFrame(listener: (frame: DesktopRpcFrame) => void): () => void {
		this.#frameListeners.add(listener);
		return () => this.#frameListeners.delete(listener);
	}

	onExit(listener: (exit: DesktopSidecarExit) => void): () => void {
		this.#exitListeners.add(listener);
		return () => this.#exitListeners.delete(listener);
	}

	async open(projectPath: string): Promise<void> {
		await this.#ensureListeners();
		this.#closing = false;
		this.#buffer = "";
		this.#decoder = new TextDecoder();
		this.#frameDecoder.reset();
		this.#ready = Promise.withResolvers<void>();
		this.#generation = await invoke<number>("open_project", { path: projectPath });
		await withTimeout(this.#ready.promise, 30_000, "Oh My Pi sidecar did not become ready");
	}

	async request(command: DesktopRpcCommand, options?: { id?: string }): Promise<DesktopRpcResponse> {
		const id = options?.id ?? `desktop-${++this.#requestId}`;
		const pending = Promise.withResolvers<DesktopRpcResponse>();
		this.#pending.set(id, pending);
		try {
			await this.#write({ ...command, id });
			return await pending.promise;
		} catch (error) {
			this.#pending.delete(id);
			throw error;
		}
	}

	respond(response: DesktopHostInteractionResponse): Promise<void> {
		return this.#write(response);
	}

	async close(): Promise<void> {
		this.#closing = true;
		await invoke("close_sidecar");
		this.#rejectPending(new Error("Oh My Pi sidecar closed"));
	}

	async dispose(): Promise<void> {
		await this.close();
		for (const unlisten of this.#unlisteners.splice(0)) unlisten();
		this.#listenersReady = undefined;
	}

	async #ensureListeners(): Promise<void> {
		if (this.#listenersReady) return this.#listenersReady;
		this.#listenersReady = (async () => {
			this.#unlisteners.push(
				await listen<number[]>("omp-sidecar-data", ({ payload }) => this.#consume(payload)),
				await listen<string>("omp-sidecar-log", ({ payload }) => {
					this.#frameListeners.forEach(listener => {
						listener({ type: "notice", level: "warning", message: payload, source: "sidecar" });
					});
				}),
				await listen<DesktopSidecarExit>("omp-sidecar-exit", ({ payload }) => {
					if (payload.generation !== this.#generation || this.#closing) return;
					this.#rejectPending(
						new Error(`Oh My Pi sidecar exited${payload.code === null ? "" : ` (${payload.code})`}`),
					);
					this.#exitListeners.forEach(listener => {
						listener(payload);
					});
				}),
			);
		})();
		return this.#listenersReady;
	}

	#consume(bytes: number[]): void {
		this.#buffer += this.#decoder.decode(Uint8Array.from(bytes), { stream: true });
		for (;;) {
			const newline = this.#buffer.indexOf("\n");
			if (newline < 0) break;
			const line = this.#buffer.slice(0, newline).trim();
			this.#buffer = this.#buffer.slice(newline + 1);
			if (!line) continue;
			try {
				const decoded = this.#frameDecoder.push(JSON.parse(line) as unknown);
				if (decoded) this.#dispatch(decoded);
			} catch (error) {
				this.#frameListeners.forEach(listener => {
					listener({
						type: "notice",
						level: "error",
						message: error instanceof Error ? error.message : String(error),
						source: "desktop-transport",
					});
				});
			}
		}
	}

	#dispatch(value: unknown): void {
		if (isRecord(value) && value.type === "ready") void this.#negotiate(value);
		if (isRpcResponse(value) && typeof value.id === "string") {
			const pending = this.#pending.get(value.id);
			if (pending) {
				this.#pending.delete(value.id);
				pending.resolve(value);
			}
		}
		if (isDesktopFrame(value)) {
			this.#frameListeners.forEach(listener => {
				listener(value);
			});
		}
	}

	async #negotiate(ready: Record<string, unknown>): Promise<void> {
		try {
			if (Array.isArray(ready.supportedProtocolVersions) && ready.supportedProtocolVersions.includes(2)) {
				const response = await this.request({ type: "negotiate_protocol", protocolVersion: 2 });
				if (!response.success) throw new Error(response.error);
				if (response.command !== "negotiate_protocol") throw new Error("Unexpected protocol negotiation response");
			}
			this.#ready?.resolve();
		} catch (error) {
			this.#ready?.reject(error);
		}
	}

	async #write(frame: object): Promise<void> {
		const bytes = new TextEncoder().encode(`${JSON.stringify(frame)}\n`);
		await invoke("write_sidecar", { bytes: Array.from(bytes) });
	}

	#rejectPending(reason: Error): void {
		for (const pending of this.#pending.values()) pending.reject(reason);
		this.#pending.clear();
	}
}
