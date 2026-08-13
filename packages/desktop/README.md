# Oh My Pi Desktop

Experimental native desktop Presentation for Oh My Pi, built with Tauri 2, React 19, Tailwind CSS 4, and shadcn/ui.

The application supervises one bundled, version-matched `omp --mode rpc-ui` sidecar. It uses the same sessions, settings, credentials, trust records, plugins, skills, MCP configuration, models, and project resources as the terminal Presentation.

## Development

Install the repository dependencies and build the native OMP addon, then run:

```sh
bun --cwd=packages/desktop run tauri dev
```

The Tauri hook builds the OMP sidecar before starting Vite. To reuse an already compiled matching OMP binary during development:

```sh
OMP_DESKTOP_SIDECAR=/absolute/path/to/omp bun --cwd=packages/desktop run tauri dev
```

Focused checks:

```sh
bun --cwd=packages/desktop run check
bun --cwd=packages/desktop run build
cargo check -p omp-desktop
```

See [`../../docs/desktop-design.md`](../../docs/desktop-design.md) for the accepted architecture and Desktop Parity matrix.
