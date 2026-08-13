import { useMemo } from "react";
import { CodeBlock } from "@/components/code-block";
import { type MarkdownBlock, type MarkdownInline, parseMarkdown, safeLinkHref } from "@/lib/markdown";

function renderInline(nodes: MarkdownInline[], onOpenLink?: (url: string) => void): React.ReactNode {
	return nodes.map((node, index) => {
		switch (node.kind) {
			case "text":
				return node.text;
			case "code":
				return (
					<code key={index} className="rounded bg-muted px-1 py-0.5 font-mono text-[0.85em]">
						{node.text}
					</code>
				);
			case "strong":
				return <strong key={index}>{renderInline(node.children, onOpenLink)}</strong>;
			case "em":
				return <em key={index}>{renderInline(node.children, onOpenLink)}</em>;
			case "image":
				// Untrusted content: never auto-fetch a remote image src (tracking-pixel risk). Show alt text only.
				return (
					<span key={index} className="text-muted-foreground italic">
						[image: {node.alt || "untitled"}]
					</span>
				);
			case "link": {
				const href = safeLinkHref(node.href);
				if (!href) return <span key={index}>{renderInline(node.children, onOpenLink)}</span>;
				return (
					<a
						key={index}
						href={href}
						className="text-primary underline underline-offset-2 hover:no-underline"
						onClick={event => {
							event.preventDefault();
							onOpenLink?.(href);
						}}
					>
						{renderInline(node.children, onOpenLink)}
					</a>
				);
			}
			default:
				return null;
		}
	});
}

function renderBlock(block: MarkdownBlock, index: number, onOpenLink?: (url: string) => void): React.ReactNode {
	switch (block.kind) {
		case "heading": {
			const Tag = `h${block.level}` as const;
			const sizes: Record<number, string> = {
				1: "text-lg font-semibold",
				2: "text-base font-semibold",
				3: "text-sm font-semibold",
				4: "text-sm font-semibold",
				5: "text-sm font-medium",
				6: "text-sm font-medium",
			};
			return (
				<Tag key={index} className={`${sizes[block.level]} mt-3 mb-1 first:mt-0`}>
					{renderInline(block.children, onOpenLink)}
				</Tag>
			);
		}
		case "paragraph":
			return (
				<p key={index} className="my-1.5 leading-7 first:mt-0 last:mb-0">
					{renderInline(block.children, onOpenLink)}
				</p>
			);
		case "code":
			return (
				<div key={index} className="my-2">
					<CodeBlock lang={block.lang} text={block.text} />
				</div>
			);
		case "list":
			return block.ordered ? (
				<ol key={index} className="my-1.5 list-decimal space-y-0.5 pl-5">
					{block.items.map((item, itemIndex) => (
						<li key={itemIndex}>{renderInline(item, onOpenLink)}</li>
					))}
				</ol>
			) : (
				<ul key={index} className="my-1.5 list-disc space-y-0.5 pl-5">
					{block.items.map((item, itemIndex) => (
						<li key={itemIndex}>{renderInline(item, onOpenLink)}</li>
					))}
				</ul>
			);
		case "blockquote":
			return (
				<blockquote key={index} className="my-1.5 border-l-2 pl-3 text-muted-foreground">
					{block.children.map((child, childIndex) => renderBlock(child, childIndex, onOpenLink))}
				</blockquote>
			);
		case "hr":
			return <hr key={index} className="my-3 border-border" />;
		default:
			return null;
	}
}

export function Markdown({ text, onOpenLink }: { text: string; onOpenLink?: (url: string) => void }) {
	const blocks = useMemo(() => parseMarkdown(text), [text]);
	return <div className="min-w-0">{blocks.map((block, index) => renderBlock(block, index, onOpenLink))}</div>;
}
