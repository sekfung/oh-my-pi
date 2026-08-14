# Desktop Application Performance Optimization

This document summarizes the measured-by-construction costs in the desktop
request path, compares them with the terminal presentation, and lists the
agreed optimization points. It supersedes the transport/topology parts of
`docs/adr/0002-single-window-local-sidecar-topology.md` and the framed-stdio
section of `docs/desktop-design.md`; the process-isolation and revision-check
decisions remain.

## Current request path

```text
React component
  -> transport.request(): JSON command + id, registered in the pending map
  -> invoke("write_sidecar", { bytes: number[] })     Tauri IPC, JSON serialized
  -> Rust CommandChild.write()                        sidecar stdin
  -> omp --mode rpc-ui: read line, dispatch, handle
  -> RpcFrameEncoder: line to stdout (>1 MiB frames split into base64 chunks)
  -> Rust events.recv(): one emit("omp-sidecar-data", Vec<u8>) per stdout chunk
  -> webview listen -> per-line JSON.parse -> DesktopFrameDecoder -> dispatch
  -> pending.resolve(response) or onFrame(event) -> React state
```

Push events (`message_start/update/end`, `application_changed`, ...) bypass
the request/pending path and go straight from the sidecar subscription to
React state.

## Identified costs

Roughly ranked by impact on long, active sessions.

1. **Refresh storm plus full-transcript refetch.**
   `application_changed` fires for `agent_start/end`, `message_start/end`,
   `queue_changed`, and model/thinking changes. `App.tsx` answers every one of
   them with `get_application_snapshot` + `get_messages`. A tool-heavy turn
   therefore issues N full refreshes, and `get_messages` serializes the entire
   `session.messages` array each time. The sidecar already has
   `get_messages_page` (`src/modes/rpc/rpc-mode.ts`); the main view never uses
   it.

2. **Snapshot rebuild on every event.**
   Each snapshot re-runs `SessionManager.list()` (per-file stat/parse behind a
   stat cache), `getTree()`, flatten, and per-entry preview generation, then
   serializes all of it. The tree only changes on navigation/fork/label, not on
   message events. See `AgentSessionApplicationRuntime.readSnapshot()` in
   `src/application/application-controller.ts`.

3. **Cumulative `message_update` plus O(n) React copies.**
   Every delta carries the entire accumulated assistant message, and the
   desktop applies it with
   `setMessages(current => [...current.slice(0, -1), frame.message])` — an
   O(n) array copy per delta and O(content) re-serialization per frame.
   The delta (`assistantMessageEvent`) is already emitted alongside the
   cumulative message (`src/session/agent-session.ts`, the
   `setAssistantMessageEventInterceptor` event), so the change is a projection
   choice, not new event plumbing.
   The TUI coalesces this at the subscription boundary
   (`EventController.#MESSAGE_UPDATE_COALESCE_MS = 33`); the RPC layer does not.

4. **IPC byte encoding overhead.**
   Rust emits each stdout chunk as a Tauri event carrying `Vec<u8>`, which
   serde_json expands into a `number[]` (several bytes per byte) in a separate
   IPC message; `write_sidecar` mirrors this with `Array.from(bytes)`.
   `DesktopFrameDecoder` also slices a growing string buffer per line and
   performs `atob`/`btoa` verification for every chunk of frames over
   1 MiB (`MAX_RPC_FRAME_BYTES`; 256 KiB chunk payloads, 64 MiB reassembly
   cap). See `src-tauri/src/lib.rs` (stdout emit loop),
   `src/lib/desktop-transport.ts`, and `src/lib/desktop-frame-decoder.ts`.

5. **Workspace review parses before bounding (low priority).**
   `buildWorkspaceReview` runs two full `git diff` calls and
   `parseFileDiffs` on the complete text before per-entry truncation
   (`src/application/workspace-review.ts`). It is on-demand (inspector open /
   manual refresh), so it is the least urgent item.

## Why the TUI is cheaper

The TUI consumes the same `AgentSession` event source, but downstream of that
source the chains differ fundamentally:

- events are in-process callbacks, not serialized frames;
- `message_update` is coalesced (33 ms window) before UI work;
- rendering is coalesced and differential (`requestRender` /
  `requestComponentRender`), not per-event full-state React updates;
- session listing and the tree selector are built lazily on demand;
- the terminal emulator is a stateless pixel host, so the TUI never holds a
  second authoritative copy of the data model.

The desktop cannot delegate its window to an existing host, and a rich UI
needs local view state. What it can recover is the TUI's state architecture:
one authoritative runtime state, derived view state, event-driven sync.

## Optimization principles

1. Authoritative state lives in exactly one process; the presentation keeps
   only derived view state and applies events.
2. Serialize once, transmit once; prefer deltas over cumulative payloads.
3. Coalesce at the producer, not at the consumer.
4. Sequence every event; resync (full fetch) only on a detected gap.
5. Bulk data over binary local IPC; JSON reserved for small control frames.

## Optimization points

### A. Protocol and event layer (no transport change)

**A1. `application_changed` needs coalescing, not a new sequence scheme.**
The frame already carries `sequence`/`revision`, and `App.tsx` already
performs gap detection and resync on them. Producer-side coalescing of
consecutive `#changed()` calls is therefore safe — a merged notification just
makes the sequence jump by more than one, which the existing gap logic
handles. The remaining work is debouncing/coalescing and turning
`application_changed` into a targeted invalidation signal (refresh only the
fields it implies) instead of a full snapshot + transcript refetch.

**A2. The message stream is the only genuinely new sequencing work.**
`message_start/update/end` frames have no per-connection sequence today. Add
one, apply deltas in order, and fall back to `get_messages_page` only when a
gap is detected. `get_messages` then moves from per-event to connect/resync
only.

**A3. Delta projection, not a new delta mechanism.**
The `assistantMessageEvent` delta is already on the wire alongside the
cumulative message. The change is: stop serializing the redundant cumulative
`message` field on `message_update`, and have the desktop assemble the last
in-flight message from the deltas it already receives (the same shape of work
the TUI's streaming-reveal controller does). Scope is bounded to the trailing
message; risk is localized to the desktop's last-message assembly logic.

### B. Data plane (transport)

**Decision: the data plane should be a direct webview -> runtime WebSocket,
not a Rust-relayed stream.** This settles the push/pull question by removing
the relay: WebSocket is bidirectional push in both directions, and the runtime
already speaks it (see C below). Rust keeps only window, dialog, and lifecycle
responsibilities.

- Reuse the existing collab frame protocol end to end; it already provides
  ordered frames, byte-bounded snapshot chunks, backpressure, and reconnect.
- The webview connects to a loopback endpoint (`ws://127.0.0.1:<port>`,
  room-key-authenticated) instead of the relay. This requires relaxing the
  Tauri CSP `connect-src` for that endpoint — a small spike must validate it
  first; if the webview cannot hold a loopback WebSocket, the fallback is a
  Rust-relayed, pull-initiated streamed response (`fetch`/`ReadableStream`)
  with bulk data flowing as binary, and control commands staying on Tauri IPC.
- This removes the per-chunk JSON `number[]` events, the base64 chunk
  reassembly, and the string-buffer slicing in the desktop decoder for all
  bulk traffic.

### C. Process topology: reuse the existing multi-client mechanism

The repo already has the "multiple clients attached to one live session"
design in `src/collab/host.ts` (host broadcasts events/entries/state over
`CollabSocket`) and `src/modes/rpc/rpc-collab-guest.ts` (guest join ->
`welcome` -> byte-bounded `snapshot-chunk` -> strict in-arrival-order
`#applyChain`, with RPC event semantics). The daemon should adopt this
protocol rather than define a local variant:

- `omp daemon` = the existing collab **host** plus a loopback listener (a
  `ws://127.0.0.1` endpoint; the existing `CollabSocket` client needs no
  protocol change, only a different `wsUrl`).
- Each desktop window = the existing `RpcCollabGuest`; attach is a plain
  join, snapshot replay lands on the guest's replica session, and live frames
  forward through the same `session.subscribe(event => output(event))`
  vocabulary the desktop already consumes.
- The room key doubles as local authentication for the loopback endpoint, so
  no new auth layer is needed for the first iteration.
- The only new code is the local listener and daemon lifecycle; the ordered
  apply chain, snapshot chunking, resync, and multi-client semantics come
  for free.
- If loopback WebSocket is rejected in the spike, the same protocol can be
  carried over a Unix domain socket / named pipe (`\\.\pipe\omp-<hash>`,
  following `src/launch/paths.ts`) by adding a socket backend under
  `CollabSocket`; this is more work and is the fallback, not the plan.

Keep what is correct in the current design: the runtime stays a separate
process (crash isolation; Bun cannot live inside the webview or be embedded
in Rust), and mutations stay serialized with revision checks. The
per-window sidecar goes away; one daemon serves windows and can serve the
terminal presentation too.

## Phased plan

1. **Event semantics first.** A1/A2/A3 with no transport changes; measure
   frames/sec, bytes/turn, and `get_messages` call count.
2. **Daemon + direct attach spike.** `omp daemon` as a collab host on a
   loopback WebSocket; one window attaches through `RpcCollabGuest`; validate
   CSP, reconnect, and guest->host control (write-token path) coverage.
3. **Retire stdio.** Delete the per-window sidecar spawn, the chunk
   decoder, and the JSON `number[]` path once parity is proven.

## Success metrics

- streaming frames/sec and bytes/turn versus the current stdio path, with the
  webview attached directly (no per-chunk Tauri events);
- `get_messages` calls per turn (target: once per connect/resync) and
  `get_application_snapshot` calls per turn;
- snapshot latency for sessions with 5k/20k journal entries;
- window-open latency and steady-state memory with a warm daemon;
- no JSON `number[]` payloads in the bulk data path;
- a second window and the terminal attaching to the same live session.

## Open questions

- loopback WebSocket from the Tauri webview (CSP `connect-src`, mixed
  content, and per-OS behavior) — gates Phase 2;
- keep the collab AES-GCM sealing for local rooms (recommended: zero protocol
  change) versus a plaintext local variant;
- guest -> host control coverage: which intents/commands flow over the
  write-token channel versus remaining on Tauri IPC;
- daemon lifecycle policy (idle shutdown, project-scoped versus user-scoped,
  broker reuse of `src/launch/` machinery).
