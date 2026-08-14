# Oh My Pi Desktop Application

## Status

Accepted design. Delivery is incremental and remains experimental until every non-excluded Desktop Parity row is implemented and verified.

## Product contract

Oh My Pi Desktop is a Tauri 2, React 19, Tailwind CSS 4, and shadcn/ui Presentation of the existing Oh My Pi Application Behavior. It is a single-instance, single-window application with one Active Project, one Active Session, and one bundled Desktop Sidecar. It shares sessions, settings, credentials, trust records, plugins, skills, MCP configuration, model configuration, and project resources in place and performs no data migration.

The visual language is Codex-inspired but independently branded. The Desktop Application selectively ports MIT-licensed presentation components and interaction patterns from Pi GUI while excluding Pi's runtime, application protocol, client, server, SQLite repository, AgentSession behavior, and session formats.

## Architecture

```text
React/shadcn presentation
        |
 typed DesktopTransport
        |
 Tauri IPC and Rust sidecar supervisor
        |
 bundled omp --mode rpc-ui
        |
 AgentSession, SessionManager, settings, auth, tools, extensions
```

Rust owns only native window integration, constrained dialogs and links, and Desktop Sidecar lifecycle. Application Behavior stays in the sidecar. The initial transport uses framed stdio; presentation state is not coupled to Tauri process APIs. A future local-socket adapter is possible, but neither a shared daemon nor multiple windows are part of this design.

> The framed-stdio transport and single-window/no-daemon topology described here are being revisited; see `docs/desktop-performance-optimization.md` for the identified costs, phased protocol/transport/daemon plan, and which parts of this section and `docs/adr/0002-single-window-local-sidecar-topology.md` it supersedes.

The application protocol must grow beyond today's command-response RPC into an authoritative application projection:

- connection snapshots contain the active project, session, transcript, queues, operations, model and thinking state, settings, capabilities, pending interactions, and diagnostics;
- events have gap-free connection sequence numbers and authoritative state revisions;
- intent identifiers are idempotent for a connection and mutations are serialized;
- selection-dependent mutations reject stale revisions;
- reconnect starts from a fresh snapshot and never replays an unconfirmed prompt, command, tool action, or approval response.

## Information architecture

- The left sidebar contains the Active Project, recent projects, and current-project sessions.
- The center contains a virtualized transcript and persistent composer.
- The right inspector opens on demand for Changes, Files, Tasks, and Diagnostics.
- The inspector is reserved for surfaces bound to the active session; configuration that outlives the session — approval policies, installed resources, appearance, and every schema setting — lives on the settings page.
- The command palette contains built-in commands, extension commands, and available operations.
- Files and Changes are review surfaces. Editing is performed by agent tools or an external editor.
- Shell actions render as structured command cards with streaming output, approval, exit status, and abort; there is no general PTY terminal.

## Security and privacy

- Project Trust is resolved in the sidecar before project configuration or executable resources load.
- Credentials remain in existing Oh My Pi storage and never enter the webview.
- Repository content, model output, Markdown, Mermaid, images, diffs, paths, URLs, tool output, and extension fallbacks are untrusted and sanitized.
- Persistent approval is project-scoped by default and is managed through existing settings and trust records.
- Desktop-only preferences are limited to recent projects, last selection, window geometry, appearance, and shortcuts in platform application data.
- New desktop telemetry is disabled by default. Diagnostic exports omit prompts, file contents, credentials, and full local paths unless the user explicitly adds detail.

## Sidecar recovery

The package bundles a target-specific, version-matched OMP sidecar. Development builds may use an explicit executable override. On unexpected exit the presentation becomes disconnected, blocks new input, and automatically restarts once from persisted session state. A second failure exposes local diagnostics and manual retry. Recovery does not replay unconfirmed operations.

## Delivery and release

The first usable slice must open a real project; create, resume, and select real sessions; stream a real turn; steer, follow up, and abort; select model and thinking level; render structured tool activity; handle four-state approval; inspect diffs; attach images; and recover from one sidecar crash. Mock conversations do not satisfy the slice.

`omp gui [--project <path>]` launches the installed application. If it is unavailable, the command presents installation guidance; development may use an explicit executable override.

Linux is validated first. Desktop Parity requires Linux, macOS, and Windows installers and automated evidence. The experimental release checks for updates and opens the official download page; a signed automatic updater waits for stable signing and notarization on all platforms.

## Desktop Parity matrix

Every row must be classified as Native, Fallback, or Terminal-only and carry automated evidence before the experimental label is removed.

| Area | Required desktop contract | Classification |
| --- | --- | --- |
| Lifecycle | Single instance/window, project selection, handshake, guarded close, one-shot crash recovery without replay | Native |
| Conversation | Text, thinking, tools, errors, retry, compaction, cancellation, images and branch summaries | Native |
| Transcript | Paged and virtualized history; Markdown, code, diff, Mermaid, images and inspectable raw fallback | Native |
| Composer | Multiline, undo, history, paste/drop images, file/path/slash completion | Native |
| Queue | Now, steer, follow-up, inspect, remove, restore, clear and abort-and-prompt | Native |
| Approval | Typed preview plus allow/reject once/project; global promotion and revocation | Native |
| Shell | Contextual `!`, non-contextual `!!`, streaming, abort, exit status and approval | Native |
| Models and auth | Catalog, search, selection, scopes, thinking, roles, OAuth, API keys, logout and account pinning | Native |
| Sessions | List/search, new/resume/rename/delete/stats/clone/fork/import/export/share/handoff | Native |
| Session tree | Navigate, filter, fold, label, copy and fork | Native |
| Context | Manual/automatic compaction, retry, context usage, todos, jobs and async operations | Native |
| Settings | Every GUI-relevant setting with global/project scope and advanced-config access | Native |
| Resources | Trust, skills, prompts, plugins, MCP, agents, tools, reload and diagnostics | Native |
| Extensions | Tools, commands, providers, events and standard Host Interactions | Native |
| Extension renderers | Sanitized structured/text fallback with a visible terminal-only explanation | Fallback |
| OMP workflows | Plan, goal, loop, live, pause, subagents, advisors, browser/computer/vision, memory and security | Native or explicit Fallback |
| Collaboration | Join/leave, participants, advisors, subagent progress and transcripts | Native |
| Review | Read-only Changes and Files inspection, search and external-editor handoff | Native |
| Accessibility | Keyboard reachability, focus restoration, labels, scaling and reduced motion | Native |
| Packaging | Matching offline sidecar and installer smoke coverage on Linux, macOS and Windows | Native |
| Terminal mechanics | ANSI, raw keys, alternate screen and terminal image protocols | Terminal-only |
| TUI customization | Terminal headers, footers, widgets, editors, autocomplete implementations and ANSI themes | Terminal-only |
| Hidden commands | Debug and easter-egg dispatch paths | Terminal-only |

## Attribution

Presentation code substantially derived from Pi GUI retains the upstream MIT copyright and license notice. Newly written Oh My Pi code uses the repository license and branding.
