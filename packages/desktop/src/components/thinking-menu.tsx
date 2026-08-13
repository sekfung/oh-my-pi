import { Check } from "lucide-react";
import { DESKTOP_THINKING_LEVELS } from "@/lib/desktop-protocol";
import { cn } from "@/lib/utils";

export interface ThinkingMenuProps {
	levels?: string[];
	current?: string;
	onSelect(level: string): void;
	onClose(): void;
}

export function ThinkingMenu({ levels, current, onSelect, onClose }: ThinkingMenuProps) {
	const options = levels && levels.length > 0 ? levels : DESKTOP_THINKING_LEVELS;
	return (
		<>
			<button
				type="button"
				aria-label="Close thinking level menu"
				className="fixed inset-0 z-40 cursor-default"
				onClick={onClose}
			/>
			<div className="absolute top-full right-0 z-50 mt-1 min-w-32 rounded-lg border bg-card p-1 shadow-lg">
				{options.map(level => (
					<button
						type="button"
						key={level}
						className={cn(
							"flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs capitalize hover:bg-accent",
							level === current && "bg-accent",
						)}
						onClick={() => onSelect(level)}
					>
						<span className="min-w-0 flex-1 truncate">{level}</span>
						{level === current ? <Check className="size-3 shrink-0" /> : null}
					</button>
				))}
			</div>
		</>
	);
}
