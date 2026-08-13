import { Bot, Brain, CircleUserRound, Code2, Wrench } from "lucide-react";
import { useState } from "react";
import { Markdown } from "@/components/markdown";
import { ShellCommandCard } from "@/components/shell-command-card";
import { cn } from "@/lib/utils";

interface ContentBlock {
	kind: "text" | "thinking" | "tool" | "image" | "unknown";
	text: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringify(value: unknown): string {
	if (typeof value === "string") return value;
	try {
		return JSON.stringify(value, null, 2);
	} catch {
		return String(value);
	}
}

function contentBlocks(message: unknown): ContentBlock[] {
	if (!isRecord(message)) return [{ kind: "unknown", text: stringify(message) }];
	const content = message.content;
	if (typeof content === "string") return [{ kind: "text", text: content }];
	if (!Array.isArray(content)) return [{ kind: "unknown", text: stringify(message) }];
	return content.map(value => {
		if (!isRecord(value)) return { kind: "unknown", text: stringify(value) };
		if (value.type === "text" && typeof value.text === "string") return { kind: "text", text: value.text };
		if ((value.type === "thinking" || value.type === "reasoning") && typeof value.thinking === "string") {
			return { kind: "thinking", text: value.thinking };
		}
		if (value.type === "toolCall") {
			const name = typeof value.name === "string" ? value.name : "Tool";
			return { kind: "tool", text: `${name}\n${stringify(value.arguments)}` };
		}
		if (value.type === "image") return { kind: "image", text: "Image attachment" };
		return { kind: "unknown", text: stringify(value) };
	});
}

function roleOf(message: unknown): string {
	return isRecord(message) && typeof message.role === "string" ? message.role : "event";
}

function CollapsibleBlock({ block, onOpenLink }: { block: ContentBlock; onOpenLink?: (url: string) => void }) {
	const [open, setOpen] = useState(false);
	const [raw, setRaw] = useState(false);

	if (block.kind === "thinking" || block.kind === "tool" || block.kind === "unknown") {
		const label = block.kind === "thinking" ? "Thinking" : block.kind === "tool" ? "Tool call" : "Details";
		return (
			<div className="my-2 overflow-hidden rounded-lg border bg-muted/35">
				<button
					type="button"
					className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs font-medium text-muted-foreground hover:bg-muted"
					onClick={() => setOpen(value => !value)}
					aria-expanded={open}
				>
					{block.kind === "thinking" ? <Brain /> : <Wrench />}
					{label}
				</button>
				{open ? (
					<pre className="max-h-96 overflow-auto border-t px-3 py-2 text-xs whitespace-pre-wrap">{block.text}</pre>
				) : null}
			</div>
		);
	}

	if (block.kind === "text") {
		return (
			<div className="group/text relative text-sm">
				<button
					type="button"
					title={raw ? "Show rendered" : "Show raw source"}
					aria-label={raw ? "Show rendered" : "Show raw source"}
					className="absolute top-0.5 right-0.5 rounded p-1 text-muted-foreground opacity-0 hover:bg-muted group-hover/text:opacity-100"
					onClick={() => setRaw(value => !value)}
				>
					<Code2 className="size-3" />
				</button>
				{raw ? (
					<pre className="overflow-auto rounded-lg bg-muted/30 p-2 font-mono text-xs whitespace-pre-wrap">
						{block.text}
					</pre>
				) : (
					<Markdown text={block.text} onOpenLink={onOpenLink} />
				)}
			</div>
		);
	}

	return <div className="whitespace-pre-wrap break-words leading-7">{block.text}</div>;
}

function isBashExecutionMessage(message: unknown): message is {
	role: "bashExecution";
	command: string;
	output: string;
	exitCode?: number;
	cancelled: boolean;
	truncated: boolean;
	excludeFromContext?: boolean;
} {
	return (
		isRecord(message) &&
		message.role === "bashExecution" &&
		typeof message.command === "string" &&
		typeof message.output === "string"
	);
}

export function TranscriptMessage({ message, onOpenLink }: { message: unknown; onOpenLink?: (url: string) => void }) {
	if (isBashExecutionMessage(message)) {
		return (
			<div className="flex justify-start">
				<ShellCommandCard
					command={message.command}
					excludeFromContext={message.excludeFromContext}
					output={message.output}
					running={false}
					status={{ exitCode: message.exitCode, cancelled: message.cancelled, truncated: message.truncated }}
				/>
			</div>
		);
	}
	const role = roleOf(message);
	const user = role === "user";
	const toolResult = role === "toolResult" || role === "tool";
	return (
		<article className={cn("group flex gap-3", user && "justify-end")}>
			{!user ? (
				<div className="mt-1 flex size-7 shrink-0 items-center justify-center rounded-full border bg-card text-muted-foreground">
					{toolResult ? <Wrench className="size-3.5" /> : <Bot className="size-3.5" />}
				</div>
			) : null}
			<div
				className={cn(
					"min-w-0 max-w-[88%] text-sm",
					user && "rounded-2xl rounded-br-md bg-secondary px-4 py-2.5",
					toolResult && "w-full rounded-xl border bg-card px-3 py-2",
				)}
			>
				{contentBlocks(message).map((block, index) => (
					<CollapsibleBlock key={`${block.kind}-${index}`} block={block} onOpenLink={onOpenLink} />
				))}
			</div>
			{user ? (
				<div className="mt-1 flex size-7 shrink-0 items-center justify-center rounded-full bg-foreground text-background">
					<CircleUserRound className="size-3.5" />
				</div>
			) : null}
		</article>
	);
}
