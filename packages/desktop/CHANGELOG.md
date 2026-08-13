# Changelog

## [Unreleased]

### Added

- Added the experimental Tauri 2 desktop Presentation with a Codex-inspired shadcn/ui workbench and a supervised Oh My Pi RPC sidecar.
- Added authoritative project/session snapshots, session rename/delete, editable message queues, protocol-v2 chunked transport, native four-state tool approvals, single-instance project forwarding, and crash recovery without intent replay.
- Added session clone/fork/import/export actions, a filterable session-tree inspector with navigation, labels, and fork-from-entry, and real read-only Files and Changes inspectors with project-scoped external-editor handoff.
- Added structured shell command cards: typing `!command` (contextual) or `!!command` (excluded from model context) in the composer runs it through the sidecar's `bash` RPC with live streaming output, exit status, truncation notice, and an abort button, matching the terminal's `!`/`!!` shell escapes.
- Replaced the header's cycle-only Model/Thinking buttons with a searchable model catalog dialog (grouped by provider, showing context window and thinking support) and a thinking-level dropdown scoped to the selected model's supported efforts.
- Added an Approvals inspector listing project- and global-scoped tool-approval policies, with one-click promotion of a project decision to every project and revocation at either scope.
- Upgraded the composer: image paste and drag-and-drop, up/down prompt history recall, and `/`-slash-command and `@`-file-mention autocomplete backed by the sidecar's live command list and workspace file tree.
- Replaced the flat, always-mounted transcript with a virtualized one (`@tanstack/react-virtual`, measured row heights, stick-to-bottom autoscroll) so long sessions stay smooth, and gave message text a real (dependency-free) Markdown renderer — headings, lists, emphasis, links opened only through the sanctioned `https://` external-link command, inline/fenced code with copy, diff-colored fenced/heuristically-detected diffs, and lazy-loaded Mermaid diagrams (`securityLevel: "strict"`) — with a per-block raw-source toggle.
- Added a ⌘K/Ctrl+K command palette listing every built-in and extension slash command alongside common operations (choose project, new session, select model, open an inspector, toggle appearance, abort).
- Replaced the placeholder "Settings" sidebar stub with a real Context inspector: live context-window usage, the todo list with per-task status, manual compaction plus auto-compaction/auto-retry toggles, and a background-jobs panel (bash/task async jobs) with abort.
- Added a Settings inspector covering every GUI-relevant setting from the schema (tabs, groups, booleans/enums/strings/numbers), with per-setting project/global scope selection, reset-to-inherited, and credential fields that only ever show a "configured" flag, never the value.
- Added a Resources inspector: read-only skills, plugins, MCP servers, configured subagents, tools, and prompts, with load warnings surfaced up top and a one-click reload.

### Fixed

- Fixed AppImage bundling failing outright ("couldn't find a square icon") by declaring `bundle.icon` in `tauri.conf.json`, which was previously unset despite the icon assets already existing on disk.

### Infrastructure

- Added a `Desktop` CI workflow that builds the Linux sidecar and deb/rpm bundles (required) plus an AppImage bundle (best-effort — its bundler, `linuxdeploy`, is a known-fragile prebuilt binary that also needs `libfuse2`/`APPIMAGE_EXTRACT_AND_RUN` workarounds since Ubuntu 24.04+ dropped libfuse2 by default), then runs a new structural smoke test (`scripts/smoke-test-linux-bundle.ts`) verifying the sidecar and main binary are present and executable in each produced package.

### Fixed

- Fixed every application snapshot being rejected with "Sidecar returned invalid session state": the sidecar's authoritative `activeSession` projection uses `id`/`path`/`title`, but the desktop's protocol reader expected `sessionId`/`sessionFile`/`sessionName` and never mapped between them.
