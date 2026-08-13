import { CircleX, LoaderCircle, Square, TerminalSquare } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export interface ShellCommandStatus {
	exitCode?: number;
	cancelled?: boolean;
	timedOut?: boolean;
	truncated?: boolean;
	totalLines?: number;
	totalBytes?: number;
}

export interface ShellCommandCardProps {
	command: string;
	excludeFromContext?: boolean;
	output: string;
	running: boolean;
	status?: ShellCommandStatus;
	onAbort?: () => void;
}

function statusLabel(running: boolean, status?: ShellCommandStatus): { text: string; tone: "muted" | "ok" | "error" } {
	if (running) return { text: "Running…", tone: "muted" };
	if (!status) return { text: "Aborted", tone: "error" };
	if (status.cancelled) return { text: "Aborted", tone: "error" };
	if (status.timedOut) return { text: "Timed out", tone: "error" };
	if (status.exitCode === 0 || status.exitCode === undefined) return { text: "Exit 0", tone: "ok" };
	return { text: `Exit ${status.exitCode}`, tone: "error" };
}

export function ShellCommandCard({
	command,
	excludeFromContext,
	output,
	running,
	status,
	onAbort,
}: ShellCommandCardProps) {
	const outputRef = useRef<HTMLPreElement>(null);
	const [stickToBottom, setStickToBottom] = useState(true);

	useEffect(() => {
		if (!stickToBottom) return;
		const node = outputRef.current;
		if (node) node.scrollTop = node.scrollHeight;
	}, [output, stickToBottom]);

	const label = statusLabel(running, status);

	return (
		<div className="w-full overflow-hidden rounded-xl border bg-card">
			<div className="flex items-center gap-2 border-b bg-muted/40 px-3 py-2">
				<TerminalSquare className="size-3.5 shrink-0 text-muted-foreground" />
				<code className="min-w-0 flex-1 truncate font-mono text-xs">{command}</code>
				{excludeFromContext ? (
					<span
						className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground"
						title="Not sent to the model (!! command)"
					>
						hidden
					</span>
				) : null}
				<span
					className={cn(
						"flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium",
						label.tone === "ok" && "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
						label.tone === "error" && "bg-destructive/15 text-destructive",
						label.tone === "muted" && "bg-muted text-muted-foreground",
					)}
				>
					{running ? <LoaderCircle className="size-3 animate-spin" /> : null}
					{label.text}
				</span>
				{running && onAbort ? (
					<Button variant="ghost" size="icon" className="size-6 shrink-0" title="Abort command" onClick={onAbort}>
						<Square className="size-3 fill-current" />
					</Button>
				) : null}
			</div>
			<pre
				ref={outputRef}
				onScroll={event => {
					const node = event.currentTarget;
					setStickToBottom(node.scrollHeight - node.scrollTop - node.clientHeight < 24);
				}}
				className="max-h-72 overflow-auto whitespace-pre-wrap px-3 py-2 font-mono text-xs leading-5 text-foreground/90"
			>
				{output || (running ? "" : "(no output)")}
			</pre>
			{status?.truncated ? (
				<div className="flex items-center gap-1.5 border-t px-3 py-1.5 text-[10px] text-muted-foreground">
					<CircleX className="size-3" />
					Output truncated
					{status.totalLines ? ` (${status.totalLines} lines, ${status.totalBytes ?? 0} bytes total)` : ""}
				</div>
			) : null}
		</div>
	);
}
