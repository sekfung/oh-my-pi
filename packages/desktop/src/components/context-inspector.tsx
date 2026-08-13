import {
	Ban,
	Check,
	CircleDashed,
	CircleSlash,
	Gauge,
	ListChecks,
	LoaderCircle,
	Loader as LoaderIcon,
	Square,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import type { DesktopAsyncJob, DesktopContextState, DesktopTodoStatus } from "@/lib/desktop-protocol";
import { cn } from "@/lib/utils";

const TODO_STATUS_ICON: Record<DesktopTodoStatus, React.ComponentType<{ className?: string }>> = {
	pending: CircleDashed,
	in_progress: LoaderIcon,
	completed: Check,
	abandoned: CircleSlash,
	blocked: Ban,
};

const TODO_STATUS_LABEL: Record<DesktopTodoStatus, string> = {
	pending: "text-muted-foreground",
	in_progress: "text-primary",
	completed: "text-emerald-600 dark:text-emerald-400 line-through",
	abandoned: "text-muted-foreground line-through",
	blocked: "text-destructive",
};

function formatTokens(tokens: number): string {
	return tokens >= 1000 ? `${(tokens / 1000).toFixed(1)}K` : String(tokens);
}

function formatDuration(startTime: number): string {
	const seconds = Math.max(0, Math.round((Date.now() - startTime) / 1000));
	if (seconds < 60) return `${seconds}s`;
	return `${Math.round(seconds / 60)}m`;
}

export interface ContextInspectorProps {
	context?: DesktopContextState;
	jobs?: DesktopAsyncJob[];
	loading: boolean;
	onCompact(): void;
	onToggleAutoCompaction(enabled: boolean): void;
	onToggleAutoRetry(enabled: boolean): void;
	onAbortRetry(): void;
	onAbortJob(jobId: string): void;
}

export function ContextInspector({
	context,
	jobs,
	loading,
	onCompact,
	onToggleAutoCompaction,
	onToggleAutoRetry,
	onAbortRetry,
	onAbortJob,
}: ContextInspectorProps) {
	if (loading && !context) {
		return (
			<div className="grid h-full place-items-center">
				<div className="flex items-center gap-2 text-xs">
					<LoaderCircle className="animate-spin" />
					Reading context state…
				</div>
			</div>
		);
	}

	const runningJobs = (jobs ?? []).filter(job => job.status === "running");
	const settledJobs = (jobs ?? [])
		.filter(job => job.status !== "running")
		.sort((a, b) => b.startTime - a.startTime)
		.slice(0, 10);

	return (
		<div className="space-y-5 p-4">
			<section>
				<h3 className="flex items-center gap-1.5 text-xs font-medium text-foreground">
					<Gauge className="size-3.5" />
					Context usage
				</h3>
				{context?.contextUsage ? (
					<div className="mt-2">
						<div className="h-1.5 overflow-hidden rounded-full bg-muted">
							<div
								className={cn(
									"h-full rounded-full",
									context.contextUsage.percent >= 90
										? "bg-destructive"
										: context.contextUsage.percent >= 70
											? "bg-amber-500"
											: "bg-primary",
								)}
								style={{ width: `${Math.min(100, context.contextUsage.percent)}%` }}
							/>
						</div>
						<p className="mt-1 text-[11px] text-muted-foreground">
							{formatTokens(context.contextUsage.tokens)} / {formatTokens(context.contextUsage.contextWindow)}{" "}
							tokens · {context.contextUsage.percent.toFixed(1)}%
						</p>
					</div>
				) : (
					<p className="mt-1 text-xs text-muted-foreground">No usage reported yet.</p>
				)}
				<div className="mt-3 flex flex-wrap items-center gap-2">
					<Button
						size="sm"
						variant="outline"
						className="h-7 text-[11px]"
						onClick={onCompact}
						disabled={context?.isCompacting}
					>
						{context?.isCompacting ? <LoaderCircle className="size-3 animate-spin" /> : null}
						Compact now
					</Button>
					<Button
						size="sm"
						variant={context?.autoCompactionEnabled ? "secondary" : "ghost"}
						className="h-7 text-[11px]"
						onClick={() => onToggleAutoCompaction(!context?.autoCompactionEnabled)}
					>
						Auto-compaction: {context?.autoCompactionEnabled ? "on" : "off"}
					</Button>
					<Button
						size="sm"
						variant={context?.autoRetryEnabled ? "secondary" : "ghost"}
						className="h-7 text-[11px]"
						onClick={() => onToggleAutoRetry(!context?.autoRetryEnabled)}
					>
						Auto-retry: {context?.autoRetryEnabled ? "on" : "off"}
					</Button>
					<Button size="sm" variant="ghost" className="h-7 text-[11px]" onClick={onAbortRetry}>
						Abort pending retry
					</Button>
				</div>
			</section>

			<section>
				<h3 className="flex items-center gap-1.5 text-xs font-medium text-foreground">
					<ListChecks className="size-3.5" />
					Todos
				</h3>
				{!context || context.todoPhases.length === 0 ? (
					<p className="mt-2 text-xs text-muted-foreground">No todo list for this session.</p>
				) : (
					<div className="mt-2 space-y-3">
						{context.todoPhases.map((phase, phaseIndex) => (
							<div key={`${phase.name}-${phaseIndex}`}>
								<p className="text-[11px] font-medium text-muted-foreground">{phase.name}</p>
								<div className="mt-1 space-y-1">
									{phase.tasks.map((task, taskIndex) => {
										const Icon = TODO_STATUS_ICON[task.status];
										return (
											<div key={taskIndex} className="flex items-start gap-2 text-xs">
												<Icon
													className={cn(
														"mt-0.5 size-3 shrink-0",
														task.status === "in_progress" && "animate-spin",
														TODO_STATUS_LABEL[task.status],
													)}
												/>
												<span className={cn("min-w-0 flex-1", TODO_STATUS_LABEL[task.status])}>
													{task.content}
												</span>
												{task.blocker ? (
													<span className="shrink-0 text-[10px] text-destructive">{task.blocker}</span>
												) : null}
											</div>
										);
									})}
								</div>
							</div>
						))}
					</div>
				)}
			</section>

			<section>
				<h3 className="text-xs font-medium text-foreground">Background jobs</h3>
				{runningJobs.length === 0 && settledJobs.length === 0 ? (
					<p className="mt-2 text-xs text-muted-foreground">No background bash or task jobs.</p>
				) : (
					<div className="mt-2 space-y-1">
						{[...runningJobs, ...settledJobs].map(job => (
							<div key={job.id} className="flex items-center gap-2 rounded-lg border bg-card px-2 py-1.5">
								{job.status === "running" ? (
									<LoaderCircle className="size-3 shrink-0 animate-spin text-primary" />
								) : (
									<span
										className={cn(
											"size-1.5 shrink-0 rounded-full",
											job.status === "completed" && "bg-emerald-500",
											job.status === "failed" && "bg-destructive",
											job.status === "cancelled" && "bg-muted-foreground",
										)}
									/>
								)}
								<span className="min-w-0 flex-1 truncate text-xs">{job.label}</span>
								<span className="shrink-0 text-[10px] text-muted-foreground">
									{job.type} · {formatDuration(job.startTime)}
								</span>
								{job.status === "running" ? (
									<Button
										variant="ghost"
										size="icon"
										className="size-6 shrink-0"
										title="Abort job"
										onClick={() => onAbortJob(job.id)}
									>
										<Square className="size-3 fill-current" />
									</Button>
								) : null}
							</div>
						))}
					</div>
				)}
			</section>
		</div>
	);
}
