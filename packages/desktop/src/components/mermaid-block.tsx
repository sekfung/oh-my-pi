import { useEffect, useId, useRef, useState } from "react";

/**
 * Renders a Mermaid diagram from untrusted model/tool text. `securityLevel:
 * "strict"` makes Mermaid encode label HTML and drop click bindings, so the
 * resulting SVG is safe to inject directly — the one place in the transcript
 * renderer that touches the DOM outside of React's own escaping.
 */
export function MermaidBlock({ code }: { code: string }) {
	const rawId = useId().replace(/[^a-zA-Z0-9]/g, "");
	const containerRef = useRef<HTMLDivElement>(null);
	const [error, setError] = useState<string>();

	useEffect(() => {
		let cancelled = false;
		setError(undefined);
		(async () => {
			try {
				const { default: mermaid } = await import("mermaid");
				mermaid.initialize({
					startOnLoad: false,
					securityLevel: "strict",
					theme: document.documentElement.classList.contains("dark") ? "dark" : "default",
				});
				const { svg, bindFunctions } = await mermaid.render(`mermaid-${rawId}`, code);
				if (cancelled || !containerRef.current) return;
				containerRef.current.innerHTML = svg;
				bindFunctions?.(containerRef.current);
			} catch (cause) {
				if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause));
			}
		})();
		return () => {
			cancelled = true;
		};
	}, [code, rawId]);

	if (error) {
		return (
			<div className="rounded-lg border border-destructive/25 bg-destructive/5 p-3 text-xs">
				<p className="mb-2 font-medium text-destructive">Mermaid diagram failed to render</p>
				<pre className="overflow-auto whitespace-pre-wrap font-mono text-muted-foreground">{code}</pre>
			</div>
		);
	}

	return <div ref={containerRef} className="overflow-auto rounded-lg border bg-card p-3 [&_svg]:mx-auto" />;
}
