import { useVirtualizer } from "@tanstack/react-virtual";
import { Bot, LoaderCircle } from "lucide-react";
import { useEffect, useRef } from "react";
import { ShellCommandCard } from "@/components/shell-command-card";
import { TranscriptMessage } from "@/components/transcript-message";

export interface TranscriptShellRun {
	command: string;
	excludeFromContext: boolean;
	output: string;
}

export interface TranscriptProps {
	messages: unknown[];
	shellRun?: TranscriptShellRun;
	recovering: boolean;
	onAbortBash(): void;
	onOpenLink(url: string): void;
}

/**
 * Virtualized transcript: only mounted rows near the viewport are ever in the
 * DOM, so long sessions stay smooth. Row heights are measured (not fixed) via
 * `measureElement`'s ResizeObserver, since Markdown/Mermaid/diff content and
 * in-flight streaming rows vary wildly in height.
 */
export function Transcript({ messages, shellRun, recovering, onAbortBash, onOpenLink }: TranscriptProps) {
	const scrollRef = useRef<HTMLDivElement>(null);
	const stickToBottomRef = useRef(true);
	const shellRowIndex = shellRun ? messages.length : -1;
	const recoveringRowIndex = recovering ? messages.length + (shellRun ? 1 : 0) : -1;
	const itemCount = messages.length + (shellRun ? 1 : 0) + (recovering ? 1 : 0);

	const virtualizer = useVirtualizer({
		count: itemCount,
		getScrollElement: () => scrollRef.current,
		estimateSize: () => 96,
		overscan: 8,
	});

	useEffect(() => {
		if (stickToBottomRef.current && itemCount > 0) {
			virtualizer.scrollToIndex(itemCount - 1, { align: "end" });
		}
	}, [itemCount, messages.at(-1), shellRun?.output]);

	if (itemCount === 0) {
		return (
			<div className="grid h-full place-items-center">
				<div className="text-center">
					<Bot className="mx-auto size-8 text-muted-foreground" />
					<h2 className="mt-3 text-lg font-medium">What should we work on?</h2>
					<p className="mt-1 text-sm text-muted-foreground">
						Ask Oh My Pi to understand, change, test, or review this project.
					</p>
				</div>
			</div>
		);
	}

	return (
		<div
			ref={scrollRef}
			className="h-full overflow-y-auto"
			aria-live="polite"
			onScroll={() => {
				const node = scrollRef.current;
				if (!node) return;
				stickToBottomRef.current = node.scrollHeight - node.scrollTop - node.clientHeight < 80;
			}}
		>
			<div className="mx-auto w-full max-w-3xl px-6 pt-10">
				<div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
					{virtualizer.getVirtualItems().map(item => (
						<div
							key={item.key}
							data-index={item.index}
							ref={virtualizer.measureElement}
							style={{
								position: "absolute",
								top: 0,
								left: 0,
								width: "100%",
								transform: `translateY(${item.start}px)`,
								paddingBottom: "1.75rem",
							}}
						>
							{item.index === shellRowIndex && shellRun ? (
								<div className="flex justify-start">
									<ShellCommandCard
										command={shellRun.command}
										excludeFromContext={shellRun.excludeFromContext}
										output={shellRun.output}
										running
										onAbort={onAbortBash}
									/>
								</div>
							) : item.index === recoveringRowIndex ? (
								<div className="flex items-center gap-2 text-sm text-muted-foreground">
									<LoaderCircle className="animate-spin" />
									Restoring persisted session…
								</div>
							) : (
								<TranscriptMessage message={messages[item.index]} onOpenLink={onOpenLink} />
							)}
						</div>
					))}
				</div>
				<div className="h-10" />
			</div>
		</div>
	);
}
