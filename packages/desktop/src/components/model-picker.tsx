import { Brain, Check, LoaderCircle, Search, X } from "lucide-react";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import type { DesktopAvailableModel } from "@/lib/desktop-protocol";
import { cn } from "@/lib/utils";

export interface ModelPickerProps {
	models: DesktopAvailableModel[];
	loading: boolean;
	current?: { provider: string; id: string };
	onSelect(model: DesktopAvailableModel): void;
	onClose(): void;
}

function formatContextWindow(tokens: number | null): string | undefined {
	if (!tokens) return undefined;
	return tokens >= 1000 ? `${Math.round(tokens / 1000)}K ctx` : `${tokens} ctx`;
}

export function ModelPicker({ models, loading, current, onSelect, onClose }: ModelPickerProps) {
	const [query, setQuery] = useState("");

	const grouped = useMemo(() => {
		const needle = query.trim().toLowerCase();
		const filtered = needle
			? models.filter(model => `${model.provider} ${model.name} ${model.id}`.toLowerCase().includes(needle))
			: models;
		const byProvider = new Map<string, DesktopAvailableModel[]>();
		for (const model of filtered) {
			const list = byProvider.get(model.provider) ?? [];
			list.push(model);
			byProvider.set(model.provider, list);
		}
		return [...byProvider.entries()].sort(([a], [b]) => a.localeCompare(b));
	}, [models, query]);

	return (
		<div
			className="fixed inset-0 z-50 grid place-items-center bg-black/35 p-5 backdrop-blur-[2px]"
			role="presentation"
			onClick={onClose}
		>
			<section
				className="flex max-h-[70vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl border bg-card shadow-2xl"
				role="dialog"
				aria-modal="true"
				aria-labelledby="model-picker-title"
				onClick={event => event.stopPropagation()}
			>
				<div className="flex items-center gap-2 border-b px-4 py-3">
					<h2 id="model-picker-title" className="text-sm font-semibold">
						Select a model
					</h2>
					<Button variant="ghost" size="icon" className="ml-auto size-7" onClick={onClose}>
						<X className="size-4" />
					</Button>
				</div>
				<div className="flex items-center gap-2 border-b px-3 py-2">
					<Search className="size-3.5 shrink-0 text-muted-foreground" />
					<input
						autoFocus
						value={query}
						onChange={event => setQuery(event.target.value)}
						placeholder="Search models…"
						className="w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
					/>
				</div>
				<div className="min-h-0 flex-1 overflow-y-auto p-1.5">
					{loading ? (
						<div className="flex items-center justify-center gap-2 py-8 text-xs text-muted-foreground">
							<LoaderCircle className="size-4 animate-spin" />
							Loading model catalog…
						</div>
					) : grouped.length === 0 ? (
						<p className="px-3 py-8 text-center text-xs text-muted-foreground">No models match "{query}".</p>
					) : (
						grouped.map(([provider, items]) => (
							<div key={provider} className="mb-1.5">
								<p className="px-2 py-1 text-[10px] font-medium tracking-wide text-muted-foreground uppercase">
									{provider}
								</p>
								{items.map(model => {
									const active = current?.provider === model.provider && current?.id === model.id;
									return (
										<button
											type="button"
											key={`${model.provider}/${model.id}`}
											className={cn(
												"flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-accent",
												active && "bg-accent",
											)}
											onClick={() => onSelect(model)}
										>
											<span className="min-w-0 flex-1 truncate text-sm">{model.name}</span>
											{model.reasoning ? (
												<span title="Supports thinking">
													<Brain className="size-3 shrink-0 text-muted-foreground" />
												</span>
											) : null}
											{formatContextWindow(model.contextWindow) ? (
												<span className="shrink-0 text-[10px] text-muted-foreground">
													{formatContextWindow(model.contextWindow)}
												</span>
											) : null}
											{active ? <Check className="size-3.5 shrink-0" /> : null}
										</button>
									);
								})}
							</div>
						))
					)}
				</div>
			</section>
		</div>
	);
}
