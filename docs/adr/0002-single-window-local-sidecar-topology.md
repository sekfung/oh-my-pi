# Use one local sidecar in a single-window application

The Desktop Application is a single application instance with one Desktop Window, one Active Project, one Active Session, and one bundled, version-matched Desktop Sidecar. Tauri and its webview may use platform helper processes, so this is a product topology rather than a guarantee of one operating-system process. Multiple windows, a shared daemon, and remote session authority are outside the design.

Rust supervises the Desktop Sidecar and relays framed protocol messages without interpreting Application Behavior. The presentation state machine depends on a typed transport interface; the first implementation uses sidecar stdio and does not implement a local-socket daemon. The protocol remains transport-neutral so a future adapter can be added without coupling React state to Tauri process APIs.

The application does not introduce the upstream remote server or SQLite session repository because they would create a second authority incompatible with Shared Application Data. Linux is validated first, while Linux, macOS, and Windows installers are all required before Desktop Parity is claimed.

> The stdio transport and single-window/no-daemon topology decided here are being revisited; see `docs/desktop-performance-optimization.md` for the measured costs and the phased plan toward a binary local-socket transport and an `omp daemon` process. Process isolation (a separate sidecar process) and revision-checked mutations remain unchanged.
