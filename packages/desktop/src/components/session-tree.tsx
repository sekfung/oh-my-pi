import { Check, ChevronDown, ChevronRight, Copy, GitFork, Tag, X } from "lucide-react";
import { useMemo, useState } from "react";
import type { DesktopSessionTree, DesktopSessionTreeNode } from "@/lib/desktop-protocol";
import { cn } from "@/lib/utils";

interface SessionTreeProps {
	tree: DesktopSessionTree;
	disabled?: boolean;
	onNavigate: (entryId: string) => void;
	onFork: (entryId: string) => void;
	onLabel: (entryId: string, label: string | undefined) => void;
}

function nodeMatches(node: DesktopSessionTreeNode, query: string): boolean {
	const haystack = `${node.type} ${node.label ?? ""} ${node.preview}`.toLowerCase();
	return query
		.toLowerCase()
		.split(/\s+/)
		.filter(Boolean)
		.every(part => haystack.includes(part));
}

export function SessionTree({ tree, disabled = false, onNavigate, onFork, onLabel }: SessionTreeProps) {
	const [filter, setFilter] = useState("");
	const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
	const [labeling, setLabeling] = useState<{ id: string; value: string }>();
	const [copiedId, setCopiedId] = useState<string>();

	const { parentMap, childrenMap, roots } = useMemo(() => {
		const parents = new Map<string, string | null>();
		const children = new Map<string, DesktopSessionTreeNode[]>();
		const rootNodes: DesktopSessionTreeNode[] = [];
		for (const node of tree.nodes) {
			parents.set(node.id, node.parentId);
			if (node.parentId === null) {
				rootNodes.push(node);
			} else {
				const siblings = children.get(node.parentId) ?? [];
				siblings.push(node);
				children.set(node.parentId, siblings);
			}
		}
		return { parentMap: parents, childrenMap: children, roots: rootNodes };
	}, [tree.nodes]);

	const visible = useMemo(() => {
		if (!filter.trim()) return null;
		const wanted = new Set<string>();
		for (const node of tree.nodes) {
			if (!nodeMatches(node, filter)) continue;
			let cursor: string | null = node.id;
			while (cursor !== null) {
				wanted.add(cursor);
				cursor = parentMap.get(cursor) ?? null;
			}
		}
		return wanted;
	}, [filter, tree.nodes, parentMap]);

	const copyId = async (id: string) => {
		await navigator.clipboard.writeText(id);
		setCopiedId(id);
		window.setTimeout(() => setCopiedId(current => (current === id ? undefined : current)), 1200);
	};

	const commitLabel = (id: string) => {
		if (!labeling || labeling.id !== id) return;
		onLabel(id, labeling.value.trim() ? labeling.value.trim() : undefined);
		setLabeling(undefined);
	};

	const renderNode = (node: DesktopSessionTreeNode, depth: number) => {
		const children = childrenMap.get(node.id) ?? [];
		const isCollapsed = filter.trim() ? false : collapsed.has(node.id);
		const isLeaf = tree.leafId === node.id;
		const visibleChildren = visible ? children.filter(child => visible.has(child.id)) : children;

		return (
			<div key={node.id}>
				<div
					className={cn(
						"group flex items-center gap-1 rounded-md py-1 pr-1 hover:bg-muted",
						isLeaf && "bg-muted/60",
					)}
					style={{ paddingLeft: `${depth * 14 + 4}px` }}
				>
					{visibleChildren.length > 0 ? (
						<button
							type="button"
							className="grid size-5 shrink-0 place-items-center rounded text-muted-foreground hover:bg-muted-foreground/15"
							onClick={() =>
								setCollapsed(current => {
									const next = new Set(current);
									if (next.has(node.id)) next.delete(node.id);
									else next.add(node.id);
									return next;
								})
							}
							aria-expanded={!isCollapsed}
						>
							{isCollapsed ? <ChevronRight className="size-3.5" /> : <ChevronDown className="size-3.5" />}
						</button>
					) : (
						<span className="size-5 shrink-0" />
					)}
					<button
						type="button"
						disabled={disabled}
						className="min-w-0 flex-1 truncate text-left text-xs text-foreground disabled:cursor-default"
						title={node.preview}
						onClick={() => onNavigate(node.id)}
					>
						<span className="text-muted-foreground">{isLeaf ? "▸ " : ""}</span>
						{node.preview}
					</button>
					{labeling?.id === node.id ? (
						<span className="flex items-center gap-1">
							<input
								autoFocus
								className="w-28 rounded border bg-background px-1.5 py-0.5 text-[11px] outline-none focus:ring-1 focus:ring-ring"
								value={labeling.value}
								onChange={event => setLabeling({ id: node.id, value: event.target.value })}
								onKeyDown={event => {
									if (event.key === "Enter") commitLabel(node.id);
									if (event.key === "Escape") setLabeling(undefined);
								}}
							/>
							<button type="button" className="icon-button" onClick={() => commitLabel(node.id)}>
								<Check />
							</button>
							<button type="button" className="icon-button" onClick={() => setLabeling(undefined)}>
								<X />
							</button>
						</span>
					) : (
						<span className="hidden items-center gap-0.5 group-hover:flex">
							<button
								type="button"
								disabled={disabled}
								className="icon-button"
								title={node.label ? `Edit label "${node.label}"` : "Add label"}
								onClick={() => setLabeling({ id: node.id, value: node.label ?? "" })}
							>
								<Tag />
							</button>
							<button
								type="button"
								disabled={disabled}
								className="icon-button"
								title="Fork from this entry"
								onClick={() => onFork(node.id)}
							>
								<GitFork />
							</button>
							<button
								type="button"
								className="icon-button"
								title="Copy entry id"
								onClick={() => void copyId(node.id)}
							>
								{copiedId === node.id ? <Check /> : <Copy />}
							</button>
						</span>
					)}
					{node.label && labeling?.id !== node.id ? (
						<span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
							{node.label}
						</span>
					) : null}
				</div>
				{!isCollapsed ? visibleChildren.map(child => renderNode(child, depth + 1)) : null}
			</div>
		);
	};

	return (
		<div className="flex h-full flex-col gap-2 p-3">
			<input
				className="w-full rounded-md border bg-background px-2.5 py-1.5 text-xs outline-none placeholder:text-muted-foreground focus:ring-1 focus:ring-ring"
				placeholder="Filter branches…"
				value={filter}
				onChange={event => setFilter(event.target.value)}
			/>
			<div className="min-h-0 flex-1 overflow-y-auto">
				{tree.nodes.length === 0 ? (
					<p className="px-1 py-2 text-xs text-muted-foreground">The session has no journal entries yet.</p>
				) : null}
				{(visible ? roots.filter(node => visible.has(node.id)) : roots).map(node => renderNode(node, 0))}
			</div>
			<p className="border-t pt-2 text-[11px] leading-4 text-muted-foreground">
				Click an entry to move the active leaf. Fork creates a new session from that point. Labels are stored on the
				journal entry.
			</p>
		</div>
	);
}
