import { cn } from "@/lib/utils";

/**
 * Git's preamble (`diff --git`, blob hashes, `--- a/…` / `+++ b/…`) carries no
 * information a UI that already names the file needs, and it pushes the first
 * hunk out of view in a narrow panel.
 */
const PREAMBLE =
	/^(diff --git |index [0-9a-f]{4,}|old mode |new mode |new file mode |deleted file mode |similarity index |dissimilarity index |rename from |rename to |copy from |copy to |--- |\+\+\+ )/;

export function diffBody(text: string): string {
	const lines = text.split("\n");
	const start = lines.findIndex(line => line.startsWith("@@"));
	return (start < 0 ? lines.filter(line => !PREAMBLE.test(line)) : lines.slice(start)).join("\n").trim();
}

export function DiffBlock({ text, className }: { text: string; className?: string }) {
	const lines = text.split("\n");
	return (
		<pre
			className={cn(
				"max-h-96 overflow-auto rounded-lg border bg-muted/30 py-1.5 font-mono text-xs leading-5",
				className,
			)}
		>
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
