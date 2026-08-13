import { ChevronDown, ChevronRight, File as FileIcon, Folder, FolderOpen } from "lucide-react";
import { useMemo, useState } from "react";
import type { DesktopWorkspaceReview } from "@/lib/desktop-protocol";

interface WorkspaceReviewProps {
	review: DesktopWorkspaceReview;
	projectPath: string;
	onOpen: (absolutePath: string) => void;
}

interface FileNode {
	name: string;
	path: string;
	kind: "file" | "directory";
	children: FileNode[];
}

function buildFileTree(files: DesktopWorkspaceReview["files"]): FileNode[] {
	const root: FileNode[] = [];
	for (const entry of files) {
		const segments = entry.path.split("/");
		let siblings = root;
		let prefix = "";
		for (let index = 0; index < segments.length; index += 1) {
			const segment = segments[index];
			const isLast = index === segments.length - 1;
			const nodePath = prefix ? `${prefix}/${segment}` : segment;
			prefix = nodePath;
			if (!segment) continue;
			const existing = siblings.find(node => node.name === segment);
			if (existing) {
				siblings = existing.children;
				continue;
			}
			const node: FileNode = {
				name: segment,
				path: nodePath,
				kind: isLast ? entry.kind : "directory",
				children: [],
			};
			siblings.push(node);
			siblings = node.children;
		}
	}
	const sort = (nodes: FileNode[]) => {
		nodes.sort((left, right) => {
			if (left.kind !== right.kind) return left.kind === "directory" ? -1 : 1;
			return left.name.localeCompare(right.name);
		});
		for (const node of nodes) sort(node.children);
	};
	sort(root);
	return root;
}

function pathMatches(node: FileNode, query: string): boolean {
	return query
		.toLowerCase()
		.split(/\s+/)
		.filter(Boolean)
		.every(part => node.name.toLowerCase().includes(part));
}

function visibleSet(roots: FileNode[], query: string): Set<FileNode> | null {
	if (!query.trim()) return null;
	const wanted = new Set<FileNode>();
	const visit = (node: FileNode, ancestorMatched: boolean): boolean => {
		const matched = ancestorMatched || pathMatches(node, query);
		let descendantMatched = false;
		for (const child of node.children) if (visit(child, matched)) descendantMatched = true;
		if (matched || descendantMatched) {
			wanted.add(node);
			return true;
		}
		return false;
	};
	for (const root of roots) visit(root, false);
	return wanted;
}

export function FilesInspector({ review, projectPath, onOpen }: WorkspaceReviewProps) {
	const [filter, setFilter] = useState("");
	const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
	const roots = useMemo(() => buildFileTree(review.files), [review.files]);
	const visible = useMemo(() => visibleSet(roots, filter), [roots, filter]);
	const filtering = Boolean(filter.trim());

	const toggle = (path: string) =>
		setCollapsed(current => {
			const next = new Set(current);
			if (next.has(path)) next.delete(path);
			else next.add(path);
			return next;
		});

	const renderNode = (node: FileNode, depth: number) => {
		const isOpen = filtering || !collapsed.has(node.path);
		const children = visible ? node.children.filter(child => visible.has(child)) : node.children;
		return (
			<div key={node.path}>
				<button
					type="button"
					className="group flex w-full items-center gap-1 rounded-md py-1 pr-1 text-left text-xs hover:bg-muted"
					style={{ paddingLeft: `${depth * 12 + 4}px` }}
					onClick={() =>
						node.kind === "directory" ? toggle(node.path) : onOpen(joinPath(projectPath, node.path))
					}
				>
					{node.kind === "directory" ? (
						<>
							{isOpen ? (
								<ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
							) : (
								<ChevronRight className="size-3.5 shrink-0 text-muted-foreground" />
							)}
							{isOpen ? (
								<FolderOpen className="size-3.5 shrink-0 text-muted-foreground" />
							) : (
								<Folder className="size-3.5 shrink-0 text-muted-foreground" />
							)}
						</>
					) : (
						<>
							<span className="size-3.5 shrink-0" />
							<FileIcon className="size-3.5 shrink-0 text-muted-foreground" />
						</>
					)}
					<span className="truncate">{node.name}</span>
				</button>
				{node.kind === "directory" && isOpen ? children.map(child => renderNode(child, depth + 1)) : null}
			</div>
		);
	};

	return (
		<div className="flex h-full flex-col gap-2 p-3">
			<input
				className="w-full rounded-md border bg-background px-2.5 py-1.5 text-xs outline-none placeholder:text-muted-foreground focus:ring-1 focus:ring-ring"
				placeholder="Filter files…"
				value={filter}
				onChange={event => setFilter(event.target.value)}
			/>
			<div className="min-h-0 flex-1 overflow-y-auto">
				{(visible ? roots.filter(node => visible.has(node)) : roots).map(node => renderNode(node, 0))}
			</div>
			{review.filesTruncated ? (
				<p className="border-t pt-2 text-[11px] text-muted-foreground">
					Listing truncated — filter to narrow the view.
				</p>
			) : null}
		</div>
	);
}

export function ChangesInspector({ review, projectPath, onOpen }: WorkspaceReviewProps) {
	const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
	const root = review.repository?.root ?? projectPath;

	const toggle = (path: string) =>
		setExpanded(current => {
			const next = new Set(current);
			if (next.has(path)) next.delete(path);
			else next.add(path);
			return next;
		});

	return (
		<div className="flex h-full flex-col gap-2 p-3">
			{review.repository ? (
				<p className="text-[11px] text-muted-foreground">
					{review.repository.branch ?? "detached HEAD"} · {review.changes.summary.staged} staged ·{" "}
					{review.changes.summary.unstaged} unstaged · {review.changes.summary.untracked} untracked
				</p>
			) : (
				<p className="text-[11px] text-muted-foreground">Not inside a git repository.</p>
			)}
			<div className="min-h-0 flex-1 overflow-y-auto">
				{review.changes.entries.length === 0 ? (
					<p className="px-1 py-2 text-xs text-muted-foreground">Working tree clean.</p>
				) : null}
				{review.changes.entries.map(entry => {
					const isOpen = expanded.has(entry.path);
					return (
						<div key={entry.path} className="mb-1 overflow-hidden rounded-lg border">
							<div className="flex w-full items-center">
								<button
									type="button"
									className="flex min-w-0 flex-1 items-center gap-2 px-2.5 py-1.5 text-left text-xs hover:bg-muted"
									onClick={() => toggle(entry.path)}
								>
									<span className="flex shrink-0 gap-0.5">
										{entry.staged ? <span className="status-chip">S</span> : null}
										{entry.unstaged ? <span className="status-chip">U</span> : null}
										{entry.untracked ? <span className="status-chip">?</span> : null}
									</span>
									<span className="truncate" title={entry.path}>
										{entry.path}
									</span>
								</button>
								<button
									type="button"
									className="shrink-0 px-2 py-1.5 text-[10px] text-muted-foreground hover:bg-muted hover:underline"
									onClick={() => onOpen(joinPath(root, entry.path))}
								>
									open
								</button>
							</div>
							{isOpen ? (
								<pre className="max-h-72 overflow-auto border-t bg-muted/30 p-2.5 text-[11px] leading-4 whitespace-pre-wrap">
									{entry.diff ||
										(entry.untracked ? "(untracked file — no diff preview)" : "(no diff preview)")}
								</pre>
							) : null}
						</div>
					);
				})}
			</div>
			{review.changes.truncated ? (
				<p className="border-t pt-2 text-[11px] text-muted-foreground">
					Change list truncated; the summary counts remain complete.
				</p>
			) : null}
		</div>
	);
}

function joinPath(root: string, relative: string): string {
	return `${root.replace(/\/+$/, "")}/${relative}`;
}
