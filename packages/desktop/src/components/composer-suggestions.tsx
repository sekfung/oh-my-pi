import { cn } from "@/lib/utils";

export interface ComposerSuggestionItem {
	key: string;
	label: string;
	hint?: string;
}

export interface ComposerSuggestionsProps {
	items: ComposerSuggestionItem[];
	activeIndex: number;
	onSelect(index: number): void;
	onHover(index: number): void;
}

export function ComposerSuggestions({ items, activeIndex, onSelect, onHover }: ComposerSuggestionsProps) {
	if (items.length === 0) return null;
	return (
		<div className="absolute bottom-full left-0 mb-1.5 w-full max-w-sm overflow-hidden rounded-lg border bg-card p-1 shadow-lg">
			{items.map((item, index) => (
				<button
					type="button"
					key={item.key}
					className={cn(
						"flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs hover:bg-accent",
						index === activeIndex && "bg-accent",
					)}
					onMouseEnter={() => onHover(index)}
					onClick={() => onSelect(index)}
				>
					<span className="min-w-0 flex-1 truncate font-mono">{item.label}</span>
					{item.hint ? (
						<span className="shrink-0 truncate text-[10px] text-muted-foreground">{item.hint}</span>
					) : null}
				</button>
			))}
		</div>
	);
}
