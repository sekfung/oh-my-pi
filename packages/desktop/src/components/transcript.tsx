import { useVirtualizer } from "@tanstack/react-virtual";
import { Bot, LoaderCircle } from "lucide-react";
import { useLayoutEffect, useRef } from "react";
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

/** Breathing room above the first row and below the last, owned by the virtualizer. */
const PADDING_START = 40;
const PADDING_END = 40;
/** Distance from the bottom that still counts as "following the newest message". */
const FOLLOW_THRESHOLD = 80;

/**
 * Virtualized transcript: only mounted rows near the viewport are ever in the
 * DOM, so long sessions stay smooth. Row heights are measured (not fixed) via
 * `measureElement`'s ResizeObserver, since Markdown/Mermaid/diff content and
 * in-flight streaming rows vary wildly in height.
 *
 * Following the newest message is a plain `scrollTop` write rather than
 * `scrollToIndex`: the latter starts a reconcile loop that re-targets on every
 * measurement for up to five seconds, which in a long session (where scrolling
 * up measures dozens of estimated rows and moves the target every frame) drags
 * the viewport back down and makes the transcript feel unscrollable.
 */
export function Transcript({ messages, shellRun, recovering, onAbortBash, onOpenLink }: TranscriptProps) {
	const scrollRef = useRef<HTMLDivElement>(null);
	const followRef = useRef(true);
	const lastScrollTopRef = useRef(0);
	const shellRowIndex = shellRun ? messages.length : -1;
	const recoveringRowIndex = recovering ? messages.length + (shellRun ? 1 : 0) : -1;
	const itemCount = messages.length + (shellRun ? 1 : 0) + (recovering ? 1 : 0);

	const virtualizer = useVirtualizer({
		count: itemCount,
		getScrollElement: () => scrollRef.current,
		estimateSize: () => 96,
		overscan: 8,
		paddingStart: PADDING_START,
		paddingEnd: PADDING_END,
		// Keeps the viewport put when a measured row above the fold resolves from
		// its estimate, and holds the bottom while the streaming row grows.
		anchorTo: "end",
		scrollEndThreshold: FOLLOW_THRESHOLD,
	});

	// Re-pins on mount (opening a session at its newest message), on append, and
	// as measurements resolve — but only while the reader is still at the bottom.
	const totalSize = virtualizer.getTotalSize();
	useLayoutEffect(() => {
		const node = scrollRef.current;
		if (!node || !followRef.current || itemCount === 0) return;
		node.scrollTop = node.scrollHeight;
		lastScrollTopRef.current = node.scrollTop;
	}, [totalSize, itemCount]);

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
				// Any upward movement is the reader taking over: our own writes and the
				// virtualizer's end-anchoring only ever move the offset down.
				if (node.scrollTop < lastScrollTopRef.current - 1) followRef.current = false;
				if (node.scrollHeight - node.scrollTop - node.clientHeight <= FOLLOW_THRESHOLD) followRef.current = true;
				lastScrollTopRef.current = node.scrollTop;
			}}
		>
			<div className="mx-auto w-full max-w-3xl px-6">
				<div style={{ height: totalSize, position: "relative" }}>
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
			</div>
		</div>
	);
}
