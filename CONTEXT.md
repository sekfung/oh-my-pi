# Oh My Pi Application

This context defines the product language shared by Oh My Pi's terminal and desktop presentations.

## Language

**Application Behavior**:
The user-visible workflows and data semantics shared by every Oh My Pi presentation, independent of terminal or desktop rendering.
_Avoid_: Existing logic, core logic

**Desktop Application**:
The native graphical presentation of Oh My Pi that exposes all Application Behavior through desktop-appropriate interactions.
_Avoid_: GUI port, web UI, Pi GUI clone

**UI Port**:
The adaptation of Pi GUI's visual components, layout, assets, and desktop interactions into the Desktop Application while Oh My Pi remains the sole source of Application Behavior.
_Avoid_: Runtime port, application port, backend port

**Presentation**:
A user interface that adapts Application Behavior to an interaction environment, such as the existing terminal presentation or the Desktop Application.
_Avoid_: Frontend, client

**Native Desktop Workflow**:
A desktop interaction that preserves the behavior and data semantics of an Oh My Pi workflow without reproducing its terminal mechanics.
_Avoid_: GUI equivalent, emulation

**Terminal-only Capability**:
A terminal rendering or input mechanism with no independent Application Behavior, explicitly identified as unavailable in the Desktop Application.
_Avoid_: Unsupported feature, missing feature

**Additive Integration**:
The minimal registration, export, manifest, and build wiring needed to attach the Desktop Application without changing existing Application Behavior.
_Avoid_: Refactor, rewrite

**Shared Application Data**:
The existing Oh My Pi sessions, settings, credentials, trust records, plugins, skills, MCP configuration, model configuration, and project resources used in place by every Presentation.
_Avoid_: Imported data, migrated data, desktop data

**Desktop Window**:
The single Desktop Application workspace, containing one Active Project and one Active Session.
_Avoid_: Tab, client, frontend instance

**Desktop Sidecar**:
The single, version-matched local Oh My Pi process supervised by the Desktop Application. It owns Application Behavior and communicates through a typed, transport-neutral protocol.
_Avoid_: Backend copy, embedded runtime

**Active Project**:
The local project directory selected in a Desktop Window, including its configured workspace roots and project resources.
_Avoid_: Workspace, repository, current directory

**Active Session**:
The Oh My Pi session selected in a Desktop Window and operated on through Shared Application Data.
_Avoid_: Conversation, chat, thread

**Desktop Parity**:
The state in which every user-reachable Application Behavior has a verified Native Desktop Workflow or Fallback Workflow, and only terminal mechanics remain Terminal-only Capabilities.
_Avoid_: Feature complete, GUI parity

**Fallback Workflow**:
A visible, structured, and safe generic desktop interaction used when a specialized Native Desktop Workflow is unavailable.
_Avoid_: Unsupported behavior, silent fallback
