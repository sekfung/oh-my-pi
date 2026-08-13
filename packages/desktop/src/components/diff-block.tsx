import { cn } from "@/lib/utils";

export function DiffBlock({ text }: { text: string }) {
	const lines = text.split("\n");
	return (
		<pre className="max-h-96 overflow-auto rounded-lg border bg-muted/30 py-1.5 font-mono text-xs leading-5">
			{lines.map((line, index) => {
				const isHunk = line.startsWith("@@");
				const isAdd = !isHunk && line.startsWith("+") && !line.startsWith("+++");
				const isDel = !isHunk && line.startsWith("-") && !line.startsWith("---");
				return (
					<div
						key={index}
						className={cn(
							"px-3 whitespace-pre",
							isAdd && "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
							isDel && "bg-destructive/10 text-destructive",
							isHunk && "text-muted-foreground",
						)}
					>
						{line || " "}
					</div>
				);
			})}
		</pre>
	);
}
