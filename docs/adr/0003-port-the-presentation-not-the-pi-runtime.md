# Port the Pi GUI presentation, not its runtime

The migration source is the visual and interaction layer in `~/Projects/pi/packages/gui`, including its React components, styling, assets, and Tauri desktop shell where applicable. Pi's application adapter, application protocol, client, server, SQLite session backend, AgentSession behavior, and session formats will not be ported; the Desktop Application will project and invoke existing Oh My Pi behavior through a thin integration boundary, keeping Oh My Pi as the sole runtime and data authority.
