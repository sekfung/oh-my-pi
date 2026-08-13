import { Search, X } from "lucide-react";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export interface PaletteAction {
	id: string;
	label: string;
	hint?: string;
	icon: React.ComponentType<{ className?: string }>;
	group: "Commands" | "Operations";
	run: () => void;
}

export interface CommandPaletteProps {
	actions: PaletteAction[];
	onClose(): void;
}

export function CommandPalette({ actions, onClose }: CommandPaletteProps) {
	const [query, setQuery] = useState("");
	const [highlightIndex, setHighlightIndex] = useState(0);

	const filtered = useMemo(() => {
		const needle = query.trim().toLowerCase();
		const matches = needle
			? actions.filter(action => `${action.label} ${action.hint ?? ""}`.toLowerCase().includes(needle))
			: actions;
		return matches.slice(0, 40);
	}, [actions, query]);

	const run = (action: PaletteAction) => {
		action.run();
		onClose();
	};

	let lastGroup: string | undefined;

	return (
		<div
			className="fixed inset-0 z-50 grid place-items-start justify-center bg-black/35 p-5 pt-24 backdrop-blur-[2px]"
			role="presentation"
			onClick={onClose}
		>
			<section
				className="flex max-h-[60vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl border bg-card shadow-2xl"
				role="dialog"
				aria-modal="true"
				aria-labelledby="command-palette-title"
				onClick={event => event.stopPropagation()}
			>
				<h2 id="command-palette-title" className="sr-only">
					Command palette
				</h2>
				<div className="flex items-center gap-2 border-b px-3 py-2">
					<Search className="size-3.5 shrink-0 text-muted-foreground" />
					<input
						autoFocus
						value={query}
						onChange={event => {
							setQuery(event.target.value);
							setHighlightIndex(0);
						}}
						onKeyDown={event => {
							if (event.key === "ArrowDown") {
								event.preventDefault();
								setHighlightIndex(index => Math.min(index + 1, filtered.length - 1));
							} else if (event.key === "ArrowUp") {
								event.preventDefault();
								setHighlightIndex(index => Math.max(index - 1, 0));
							} else if (event.key === "Enter" && filtered[highlightIndex]) {
								event.preventDefault();
								run(filtered[highlightIndex]);
							} else if (event.key === "Escape") {
								event.preventDefault();
								onClose();
							}
						}}
						placeholder="Search commands and operations…"
						className="w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
					/>
					<Button variant="ghost" size="icon" className="size-7 shrink-0" onClick={onClose}>
						<X className="size-4" />
					</Button>
				</div>
				<div className="min-h-0 flex-1 overflow-y-auto p-1.5">
					{filtered.length === 0 ? (
						<p className="px-3 py-8 text-center text-xs text-muted-foreground">No matches for "{query}".</p>
					) : (
						filtered.map((action, index) => {
							const showGroupLabel = action.group !== lastGroup;
							lastGroup = action.group;
							const Icon = action.icon;
							return (
								<div key={action.id}>
									{showGroupLabel ? (
										<p className="mt-1.5 px-2 py-1 text-[10px] font-medium tracking-wide text-muted-foreground uppercase first:mt-0">
											{action.group}
										</p>
									) : null}
									<button
										type="button"
										className={cn(
											"flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-accent",
											index === highlightIndex && "bg-accent",
										)}
										onMouseEnter={() => setHighlightIndex(index)}
										onClick={() => run(action)}
									>
										<Icon className="size-3.5 shrink-0 text-muted-foreground" />
										<span className="min-w-0 flex-1 truncate text-sm">{action.label}</span>
										{action.hint ? (
											<span className="shrink-0 truncate text-[10px] text-muted-foreground">
												{action.hint}
											</span>
										) : null}
									</button>
								</div>
							);
						})
					)}
				</div>
			</section>
		</div>
	);
}
