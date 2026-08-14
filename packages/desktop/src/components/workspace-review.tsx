import { ChevronDown, ChevronRight, ExternalLink, File as FileIcon, Folder, FolderOpen, GitBranch } from "lucide-react";
import { useMemo, useState } from "react";
import { DiffBlock, diffBody } from "@/components/diff-block";
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

/** Added/removed line counts, read off the diff the sidecar already sent. */
function diffStat(diff: string): { added: number; removed: number } {
	let added = 0;
	let removed = 0;
	for (const line of diff.split("\n")) {
		if (line.startsWith("+") && !line.startsWith("+++")) added += 1;
		else if (line.startsWith("-") && !line.startsWith("---")) removed += 1;
	}
	return { added, removed };
}

function StatusChips({ entry }: { entry: DesktopWorkspaceReview["changes"]["entries"][number] }) {
	return (
		<span className="flex shrink-0 gap-0.5">
			{entry.staged ? (
				<span className="status-chip bg-emerald-500/15 text-emerald-600 dark:text-emerald-400" title="Staged">
					S
				</span>
			) : null}
			{entry.unstaged ? (
				<span className="status-chip bg-amber-500/15 text-amber-600 dark:text-amber-400" title="Unstaged">
					M
				</span>
			) : null}
			{entry.untracked ? (
				<span className="status-chip bg-sky-500/15 text-sky-600 dark:text-sky-400" title="Untracked">
					?
				</span>
			) : null}
		</span>
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
		<div className="flex h-full flex-col">
			<div className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b px-3 py-2 text-[11px] text-muted-foreground">
				{review.repository ? (
					<>
						<span className="flex items-center gap-1 text-foreground">
							<GitBranch className="size-3" />
							{review.repository.branch ?? "detached HEAD"}
						</span>
						<span>{review.changes.summary.staged} staged</span>
						<span>· {review.changes.summary.unstaged} unstaged</span>
						<span>· {review.changes.summary.untracked} untracked</span>
					</>
				) : (
					<span>Not inside a git repository.</span>
				)}
			</div>
			<div className="min-h-0 flex-1 space-y-1 overflow-y-auto p-2">
				{review.changes.entries.length === 0 ? (
					<p className="px-1 py-2 text-xs text-muted-foreground">Working tree clean.</p>
				) : null}
				{review.changes.entries.map(entry => {
					const isOpen = expanded.has(entry.path);
					const slash = entry.path.lastIndexOf("/");
					const directory = slash < 0 ? "" : entry.path.slice(0, slash + 1);
					const name = slash < 0 ? entry.path : entry.path.slice(slash + 1);
					const { added, removed } = diffStat(entry.diff);
					const body = diffBody(entry.diff);
					return (
						<div key={entry.path} className="group overflow-hidden rounded-lg border bg-card">
							<div className="flex w-full items-center">
								<button
									type="button"
									className="flex min-w-0 flex-1 items-center gap-1.5 px-2 py-1.5 text-left hover:bg-muted"
									onClick={() => toggle(entry.path)}
									aria-expanded={isOpen}
								>
									{isOpen ? (
										<ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
									) : (
										<ChevronRight className="size-3.5 shrink-0 text-muted-foreground" />
									)}
									<StatusChips entry={entry} />
									{/* Name first: a 360px panel ellipsises the tail, and the tail is what names the file. */}
									<span className="flex min-w-0 flex-1 items-baseline gap-1.5" title={entry.path}>
										<span className="max-w-[70%] shrink-0 truncate text-xs font-medium">{name}</span>
										{directory ? (
											<span className="min-w-0 flex-1 truncate text-[10px] text-muted-foreground">
												{directory.replace(/\/$/, "")}
											</span>
										) : null}
									</span>
									{added > 0 ? (
										<span className="shrink-0 text-[10px] text-emerald-600 tabular-nums dark:text-emerald-400">
											+{added}
										</span>
									) : null}
									{removed > 0 ? (
										<span className="shrink-0 text-[10px] text-destructive tabular-nums">−{removed}</span>
									) : null}
								</button>
								<button
									type="button"
									className="shrink-0 rounded-md p-1.5 text-muted-foreground opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 hover:bg-muted hover:text-foreground"
									title="Open in the default editor"
									aria-label={`Open ${entry.path}`}
									onClick={() => onOpen(joinPath(root, entry.path))}
								>
									<ExternalLink className="size-3.5" />
								</button>
							</div>
							{isOpen ? (
								body ? (
									<DiffBlock
										text={body}
										className="max-h-80 rounded-none border-0 border-t text-[11px] leading-[1.45]"
									/>
								) : (
									<p className="border-t bg-muted/30 px-2.5 py-2 text-[11px] text-muted-foreground">
										{entry.untracked ? "Untracked file — no diff preview." : "No textual diff."}
									</p>
								)
							) : null}
						</div>
					);
				})}
			</div>
			{review.changes.truncated ? (
				<p className="border-t px-3 py-2 text-[11px] text-muted-foreground">
					Change list truncated; the summary counts remain complete.
				</p>
			) : null}
		</div>
	);
}

function joinPath(root: string, relative: string): string {
	return `${root.replace(/\/+$/, "")}/${relative}`;
}
