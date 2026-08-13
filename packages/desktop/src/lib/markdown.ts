/**
 * Minimal Markdown parser producing a small block/inline AST. Not a CommonMark
 * implementation — just enough structure (headings, lists, blockquotes, fenced
 * code, links, emphasis) to render typical model output as React elements
 * without ever touching innerHTML.
 */

export type MarkdownInline =
	| { kind: "text"; text: string }
	| { kind: "code"; text: string }
	| { kind: "strong"; children: MarkdownInline[] }
	| { kind: "em"; children: MarkdownInline[] }
	| { kind: "link"; href: string; children: MarkdownInline[] }
	| { kind: "image"; alt: string; href: string };

export type MarkdownBlock =
	| { kind: "heading"; level: 1 | 2 | 3 | 4 | 5 | 6; children: MarkdownInline[] }
	| { kind: "paragraph"; children: MarkdownInline[] }
	| { kind: "code"; lang?: string; text: string }
	| { kind: "list"; ordered: boolean; items: MarkdownInline[][] }
	| { kind: "blockquote"; children: MarkdownBlock[] }
	| { kind: "hr" };

const HEADING_RE = /^(#{1,6})\s+(.*)$/;
const UL_ITEM_RE = /^\s*[-*+]\s+(.*)$/;
const OL_ITEM_RE = /^\s*\d+[.)]\s+(.*)$/;
const HR_RE = /^\s*([-*_])\s*(\1\s*){2,}$/;
const BLOCKQUOTE_RE = /^\s*>\s?(.*)$/;
const FENCE_RE = /^```\s*(\S*)\s*$/;

export function parseMarkdown(source: string): MarkdownBlock[] {
	const lines = source.replace(/\r\n/g, "\n").split("\n");
	return parseBlocks(lines);
}

function parseBlocks(lines: string[]): MarkdownBlock[] {
	const blocks: MarkdownBlock[] = [];
	let index = 0;
	while (index < lines.length) {
		const line = lines[index];

		if (line.trim() === "") {
			index++;
			continue;
		}

		const fence = FENCE_RE.exec(line);
		if (fence) {
			const lang = fence[1] || undefined;
			const codeLines: string[] = [];
			index++;
			while (index < lines.length && !/^```\s*$/.test(lines[index])) {
				codeLines.push(lines[index]);
				index++;
			}
			index++; // skip closing fence
			blocks.push({ kind: "code", lang, text: codeLines.join("\n") });
			continue;
		}

		if (HR_RE.test(line)) {
			blocks.push({ kind: "hr" });
			index++;
			continue;
		}

		const heading = HEADING_RE.exec(line);
		if (heading) {
			blocks.push({
				kind: "heading",
				level: heading[1].length as 1 | 2 | 3 | 4 | 5 | 6,
				children: parseInline(heading[2]),
			});
			index++;
			continue;
		}

		if (BLOCKQUOTE_RE.test(line)) {
			const quoted: string[] = [];
			while (index < lines.length && (BLOCKQUOTE_RE.test(lines[index]) || lines[index].trim() === "")) {
				const match = BLOCKQUOTE_RE.exec(lines[index]);
				quoted.push(match ? match[1] : "");
				index++;
			}
			blocks.push({ kind: "blockquote", children: parseBlocks(quoted) });
			continue;
		}

		if (UL_ITEM_RE.test(line) || OL_ITEM_RE.test(line)) {
			const ordered = OL_ITEM_RE.test(line);
			const itemRe = ordered ? OL_ITEM_RE : UL_ITEM_RE;
			const items: MarkdownInline[][] = [];
			while (index < lines.length && itemRe.test(lines[index])) {
				const match = itemRe.exec(lines[index]);
				items.push(parseInline(match ? match[1] : ""));
				index++;
			}
			blocks.push({ kind: "list", ordered, items });
			continue;
		}

		// Paragraph: consume until a blank line or a line starting a new block kind.
		const paragraphLines: string[] = [];
		while (
			index < lines.length &&
			lines[index].trim() !== "" &&
			!FENCE_RE.test(lines[index]) &&
			!HEADING_RE.test(lines[index]) &&
			!BLOCKQUOTE_RE.test(lines[index]) &&
			!UL_ITEM_RE.test(lines[index]) &&
			!OL_ITEM_RE.test(lines[index]) &&
			!HR_RE.test(lines[index])
		) {
			paragraphLines.push(lines[index]);
			index++;
		}
		blocks.push({ kind: "paragraph", children: parseInline(paragraphLines.join("\n")) });
	}
	return blocks;
}

const INLINE_TOKEN_RE =
	/(`[^`]+`|!\[[^\]]*\]\([^)\s]+\)|\[[^\]]*\]\([^)\s]+\)|\*\*[^*]+\*\*|\*[^*]+\*|__[^_]+__|_[^_]+_)/;

export function parseInline(text: string): MarkdownInline[] {
	if (!text) return [];
	const parts = text.split(INLINE_TOKEN_RE);
	const nodes: MarkdownInline[] = [];
	for (const part of parts) {
		if (!part) continue;
		if (part.startsWith("`") && part.endsWith("`") && part.length > 1) {
			nodes.push({ kind: "code", text: part.slice(1, -1) });
			continue;
		}
		const image = /^!\[([^\]]*)\]\(([^)\s]+)\)$/.exec(part);
		if (image) {
			nodes.push({ kind: "image", alt: image[1], href: image[2] });
			continue;
		}
		const link = /^\[([^\]]*)\]\(([^)\s]+)\)$/.exec(part);
		if (link) {
			nodes.push({ kind: "link", href: link[2], children: parseInline(link[1]) });
			continue;
		}
		if ((part.startsWith("**") && part.endsWith("**")) || (part.startsWith("__") && part.endsWith("__"))) {
			nodes.push({ kind: "strong", children: parseInline(part.slice(2, -2)) });
			continue;
		}
		if ((part.startsWith("*") && part.endsWith("*")) || (part.startsWith("_") && part.endsWith("_"))) {
			nodes.push({ kind: "em", children: parseInline(part.slice(1, -1)) });
			continue;
		}
		nodes.push({ kind: "text", text: part });
	}
	return nodes;
}

/**
 * Returns `href` when it is an absolute `https://` URL, otherwise `undefined`
 * (untrusted model/tool output). Matches the Tauri `open_external_url`
 * command's own scheme restriction exactly, so every link this renders as
 * clickable is guaranteed to actually open rather than error at click time.
 */
export function safeLinkHref(href: string): string | undefined {
	try {
		const url = new URL(href);
		return url.protocol === "https:" ? href : undefined;
	} catch {
		return undefined;
	}
}

const DIFF_LINE_RE = /^(diff --git|index |--- |\+\+\+ |@@ )/;

/** Heuristic: does this text look like a unified diff, even without an explicit ```diff fence? */
export function looksLikeDiff(text: string): boolean {
	const lines = text.split("\n").slice(0, 12);
	return lines.some(line => DIFF_LINE_RE.test(line)) && lines.some(line => /^[+-]/.test(line));
}
