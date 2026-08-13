# Project-scope persistent desktop approval decisions

Desktop tool approval is a typed interaction that exposes the tool, capability tier, policy key, reason, and sanitized preview. It supports allow once, allow for this project, reject once, and reject for this project. Persisted decisions use the existing Oh My Pi settings and trust machinery, can be inspected and revoked, and may be explicitly promoted to global scope. The webview does not infer approval semantics from prompt strings and never receives credentials or executable extension code.
