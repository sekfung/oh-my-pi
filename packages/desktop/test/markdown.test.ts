import { describe, expect, test } from "bun:test";
import { looksLikeDiff, parseInline, parseMarkdown, safeLinkHref } from "../src/lib/markdown";

describe("markdown parsing", () => {
	test("parses headings, paragraphs, fenced code, lists, blockquotes and rules", () => {
		const blocks = parseMarkdown(
			[
				"# Title",
				"",
				"A paragraph with **bold** and *em* text.",
				"",
				"```ts",
				"const x = 1;",
				"```",
				"",
				"- one",
				"- two",
				"",
				"1. first",
				"2. second",
				"",
				"> quoted line",
				"",
				"---",
			].join("\n"),
		);

		expect(blocks).toEqual([
			{ kind: "heading", level: 1, children: [{ kind: "text", text: "Title" }] },
			{
				kind: "paragraph",
				children: [
					{ kind: "text", text: "A paragraph with " },
					{ kind: "strong", children: [{ kind: "text", text: "bold" }] },
					{ kind: "text", text: " and " },
					{ kind: "em", children: [{ kind: "text", text: "em" }] },
					{ kind: "text", text: " text." },
				],
			},
			{ kind: "code", lang: "ts", text: "const x = 1;" },
			{
				kind: "list",
				ordered: false,
				items: [[{ kind: "text", text: "one" }], [{ kind: "text", text: "two" }]],
			},
			{
				kind: "list",
				ordered: true,
				items: [[{ kind: "text", text: "first" }], [{ kind: "text", text: "second" }]],
			},
			{
				kind: "blockquote",
				children: [{ kind: "paragraph", children: [{ kind: "text", text: "quoted line" }] }],
			},
			{ kind: "hr" },
		]);
	});

	test("parses inline code, links and images without touching innerHTML-unsafe content", () => {
		expect(parseInline("Use `npm install` then see [docs](https://example.com/x) done")).toEqual([
			{ kind: "text", text: "Use " },
			{ kind: "code", text: "npm install" },
			{ kind: "text", text: " then see " },
			{ kind: "link", href: "https://example.com/x", children: [{ kind: "text", text: "docs" }] },
			{ kind: "text", text: " done" },
		]);
		expect(parseInline("![a screenshot](https://example.com/shot.png)")).toEqual([
			{ kind: "image", alt: "a screenshot", href: "https://example.com/shot.png" },
		]);
	});

	test("only treats absolute https URLs as safe to open", () => {
		expect(safeLinkHref("https://example.com")).toBe("https://example.com");
		expect(safeLinkHref("http://example.com")).toBeUndefined();
		expect(safeLinkHref("javascript:alert(1)")).toBeUndefined();
		expect(safeLinkHref("mailto:a@b.com")).toBeUndefined();
		expect(safeLinkHref("/relative/path")).toBeUndefined();
	});

	test("recognizes unified diff shape without an explicit fence language", () => {
		const diff = ["diff --git a/x.ts b/x.ts", "--- a/x.ts", "+++ b/x.ts", "@@ -1 +1 @@", "-old", "+new"].join("\n");
		expect(looksLikeDiff(diff)).toBe(true);
		expect(looksLikeDiff("just some\nplain text\nwith a - dash")).toBe(false);
	});
});
