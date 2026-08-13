import { Check, Copy } from "lucide-react";
import { useState } from "react";
import { DiffBlock } from "@/components/diff-block";
import { MermaidBlock } from "@/components/mermaid-block";
import { looksLikeDiff } from "@/lib/markdown";

export function CodeBlock({ lang, text }: { lang?: string; text: string }) {
	const [copied, setCopied] = useState(false);

	if (lang === "mermaid") return <MermaidBlock code={text} />;
	if (lang === "diff" || lang === "patch" || (!lang && looksLikeDiff(text))) return <DiffBlock text={text} />;

	return (
		<div className="overflow-hidden rounded-lg border bg-muted/30">
			<div className="flex items-center gap-2 border-b bg-muted/40 px-3 py-1">
				<span className="text-[10px] text-muted-foreground">{lang || "text"}</span>
				<button
					type="button"
					className="ml-auto flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground"
					onClick={() => {
						void navigator.clipboard.writeText(text).then(() => {
							setCopied(true);
							setTimeout(() => setCopied(false), 1200);
						});
					}}
				>
					{copied ? <Check className="size-3" /> : <Copy className="size-3" />}
					{copied ? "Copied" : "Copy"}
				</button>
			</div>
			<pre className="max-h-96 overflow-auto px-3 py-2 font-mono text-xs leading-5">{text}</pre>
		</div>
	);
}
