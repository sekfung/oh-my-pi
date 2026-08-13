import { CircleDashed, Eye, LoaderCircle, NotebookPen, Pause, Play, Target, Trash2, Users } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import type {
	DesktopAdvisorRuntimeStatus,
	DesktopSubagentSnapshot,
	DesktopSubagentStatus,
	DesktopWorkflowState,
} from "@/lib/desktop-protocol";
import { cn } from "@/lib/utils";

function formatTokens(tokens: number): string {
	return tokens >= 1000 ? `${(tokens / 1000).toFixed(1)}K` : String(tokens);
}

function formatDuration(ms: number): string {
	const seconds = Math.max(0, Math.round(ms / 1000));
	if (seconds < 60) return `${seconds}s`;
	return `${Math.round(seconds / 60)}m`;
}

const ADVISOR_STATUS_LABEL: Record<DesktopAdvisorRuntimeStatus, string> = {
	running: "text-emerald-600 dark:text-emerald-400",
	paused: "text-muted-foreground",
	quota_exhausted: "text-amber-600 dark:text-amber-400",
	error: "text-destructive",
	no_model: "text-muted-foreground",
};

const SUBAGENT_STATUS_DOT: Record<DesktopSubagentStatus, string> = {
	pending: "bg-muted-foreground",
	running: "bg-primary",
	completed: "bg-emerald-500",
	failed: "bg-destructive",
	aborted: "bg-muted-foreground",
};

export interface WorkflowsInspectorProps {
	workflow?: DesktopWorkflowState;
	subagents?: DesktopSubagentSnapshot[];
	loading: boolean;
	onEnterPlan(workflow?: "parallel" | "iterative"): void;
	onExitPlan(): void;
	onGoalSet(objective: string, tokenBudget?: number): void;
	onGoalPause(): void;
	onGoalResume(): void;
	onGoalDrop(): void;
	onGoalSetBudget(tokenBudget?: number): void;
}

export function WorkflowsInspector({
	workflow,
	subagents,
	loading,
	onEnterPlan,
	onExitPlan,
	onGoalSet,
	onGoalPause,
	onGoalResume,
	onGoalDrop,
	onGoalSetBudget,
}: WorkflowsInspectorProps) {
	const [objectiveDraft, setObjectiveDraft] = useState("");
	const [budgetDraft, setBudgetDraft] = useState("");

	if (loading && !workflow) {
		return (
			<div className="grid h-full place-items-center">
				<div className="flex items-center gap-2 text-xs">
					<LoaderCircle className="animate-spin" />
					Reading workflow state…
				</div>
			</div>
		);
	}

	const plan = workflow?.plan;
	const goalState = workflow?.goal;
	const goal = goalState?.goal;
	const goalActive = goalState?.enabled === true;
	const goalLive = goal !== undefined && goal.status !== "complete" && goal.status !== "dropped";
	const runningSubagents = (subagents ?? []).filter(item => item.status === "pending" || item.status === "running");
	const settledSubagents = (subagents ?? [])
		.filter(item => item.status !== "pending" && item.status !== "running")
		.sort((a, b) => b.lastUpdate - a.lastUpdate)
		.slice(0, 10);

	return (
		<div className="space-y-5 p-4">
			<section>
				<h3 className="flex items-center gap-1.5 text-xs font-medium text-foreground">
					<NotebookPen className="size-3.5" />
					Plan mode
				</h3>
				{!workflow?.planSettingEnabled ? (
					<p className="mt-2 text-xs text-muted-foreground">Disabled in settings.</p>
				) : plan?.enabled ? (
					<div className="mt-2 space-y-2">
						<p className="text-xs text-muted-foreground">
							Plan file: <span className="text-foreground">{plan.planFilePath}</span>
							{plan.workflow ? ` · ${plan.workflow}` : ""}
						</p>
						<Button
							size="sm"
							variant="outline"
							className="h-7 text-[11px]"
							onClick={onExitPlan}
							disabled={goalLive}
						>
							Exit plan mode
						</Button>
					</div>
				) : (
					<div className="mt-2 flex gap-2">
						<Button
							size="sm"
							variant="outline"
							className="h-7 text-[11px]"
							onClick={() => onEnterPlan("parallel")}
							disabled={goalLive}
							title={goalLive ? "Exit goal mode first" : undefined}
						>
							Enter plan mode
						</Button>
					</div>
				)}
			</section>

			<section>
				<h3 className="flex items-center gap-1.5 text-xs font-medium text-foreground">
					<Target className="size-3.5" />
					Goal mode
				</h3>
				{!workflow?.goalSettingEnabled ? (
					<p className="mt-2 text-xs text-muted-foreground">Disabled in settings.</p>
				) : goalLive && goal ? (
					<div className="mt-2 space-y-2">
						<div className="rounded-lg border bg-card p-2">
							<div className="flex items-center gap-2">
								<span
									className={cn(
										"rounded px-1.5 py-0.5 text-[10px] font-medium capitalize",
										goal.status === "active" && "bg-primary/10 text-primary",
										goal.status === "paused" && "bg-muted text-muted-foreground",
										goal.status === "budget-limited" && "bg-amber-500/10 text-amber-600 dark:text-amber-400",
									)}
								>
									{goal.status}
								</span>
								<span className="text-[10px] text-muted-foreground">
									{formatTokens(goal.tokensUsed)}
									{goal.tokenBudget !== undefined ? ` / ${formatTokens(goal.tokenBudget)}` : ""} tokens ·{" "}
									{formatDuration(goal.timeUsedSeconds * 1000)}
								</span>
							</div>
							<p className="mt-1.5 text-xs">{goal.objective}</p>
						</div>
						<div className="flex flex-wrap items-center gap-2">
							{goalActive ? (
								<Button size="sm" variant="outline" className="h-7 text-[11px]" onClick={onGoalPause}>
									<Pause className="size-3" />
									Pause
								</Button>
							) : (
								<Button size="sm" variant="outline" className="h-7 text-[11px]" onClick={onGoalResume}>
									<Play className="size-3" />
									Resume
								</Button>
							)}
							<Button
								size="sm"
								variant="ghost"
								className="h-7 text-[11px] text-destructive"
								onClick={onGoalDrop}
							>
								<Trash2 className="size-3" />
								Drop
							</Button>
						</div>
						<div className="flex items-center gap-1.5">
							<input
								value={budgetDraft}
								onChange={event => setBudgetDraft(event.target.value)}
								placeholder="Token budget"
								inputMode="numeric"
								className="h-7 w-28 rounded-md border bg-background px-2 text-[11px] outline-none focus:ring-1 focus:ring-ring"
							/>
							<Button
								size="sm"
								variant="ghost"
								className="h-7 text-[11px]"
								onClick={() => {
									const parsed = Number.parseInt(budgetDraft, 10);
									onGoalSetBudget(Number.isFinite(parsed) && parsed > 0 ? parsed : undefined);
									setBudgetDraft("");
								}}
							>
								Set budget
							</Button>
						</div>
					</div>
				) : (
					<div className="mt-2 space-y-2">
						<textarea
							value={objectiveDraft}
							onChange={event => setObjectiveDraft(event.target.value)}
							placeholder="Objective for this session…"
							className="min-h-14 w-full resize-none rounded-md border bg-background px-2 py-1.5 text-xs outline-none focus:ring-1 focus:ring-ring"
							disabled={plan?.enabled === true}
						/>
						<div className="flex items-center gap-1.5">
							<input
								value={budgetDraft}
								onChange={event => setBudgetDraft(event.target.value)}
								placeholder="Token budget (optional)"
								inputMode="numeric"
								className="h-7 w-36 rounded-md border bg-background px-2 text-[11px] outline-none focus:ring-1 focus:ring-ring"
								disabled={plan?.enabled === true}
							/>
							<Button
								size="sm"
								variant="outline"
								className="h-7 text-[11px]"
								disabled={!objectiveDraft.trim() || plan?.enabled === true}
								title={plan?.enabled ? "Exit plan mode first" : undefined}
								onClick={() => {
									const parsed = Number.parseInt(budgetDraft, 10);
									onGoalSet(objectiveDraft.trim(), Number.isFinite(parsed) && parsed > 0 ? parsed : undefined);
									setObjectiveDraft("");
									setBudgetDraft("");
								}}
							>
								Set goal
							</Button>
						</div>
					</div>
				)}
			</section>

			<section>
				<h3 className="flex items-center gap-1.5 text-xs font-medium text-foreground">
					<Eye className="size-3.5" />
					Advisors
				</h3>
				{!workflow?.advisor.configured ? (
					<p className="mt-2 text-xs text-muted-foreground">No advisors configured for this project.</p>
				) : (
					<div className="mt-2 space-y-1">
						{workflow.advisor.advisors.map(advisor => (
							<div key={advisor.name} className="flex items-center gap-2 rounded-lg border bg-card px-2 py-1.5">
								<span className={cn("size-1.5 shrink-0 rounded-full", ADVISOR_STATUS_LABEL[advisor.status])} />
								<span className="min-w-0 flex-1 truncate text-xs">{advisor.name}</span>
								<span className={cn("shrink-0 text-[10px]", ADVISOR_STATUS_LABEL[advisor.status])}>
									{advisor.status.replace("_", " ")}
								</span>
							</div>
						))}
					</div>
				)}
			</section>

			<section>
				<h3 className="flex items-center gap-1.5 text-xs font-medium text-foreground">
					<Users className="size-3.5" />
					Subagents
				</h3>
				{runningSubagents.length === 0 && settledSubagents.length === 0 ? (
					<p className="mt-2 text-xs text-muted-foreground">No subagents running.</p>
				) : (
					<div className="mt-2 space-y-1">
						{[...runningSubagents, ...settledSubagents].map(item => (
							<div key={item.id} className="rounded-lg border bg-card px-2 py-1.5">
								<div className="flex items-center gap-2">
									{item.status === "running" || item.status === "pending" ? (
										<LoaderCircle className="size-3 shrink-0 animate-spin text-primary" />
									) : (
										<span
											className={cn("size-1.5 shrink-0 rounded-full", SUBAGENT_STATUS_DOT[item.status])}
										/>
									)}
									<span className="min-w-0 flex-1 truncate text-xs font-medium">{item.agent}</span>
									<span className="shrink-0 text-[10px] text-muted-foreground">
										{item.progress ? formatDuration(item.progress.durationMs) : null}
									</span>
								</div>
								{item.task ? (
									<p className="mt-1 truncate pl-5 text-[11px] text-muted-foreground">{item.task}</p>
								) : null}
								{item.progress?.currentTool ? (
									<p className="mt-0.5 flex items-center gap-1 pl-5 text-[10px] text-muted-foreground">
										<CircleDashed className="size-2.5 shrink-0" />
										{item.progress.currentTool}
										{item.progress.retrying ? " · retrying" : ""}
									</p>
								) : null}
								{item.progress ? (
									<p className="mt-0.5 pl-5 text-[10px] text-muted-foreground">
										{formatTokens(item.progress.tokens)} tokens
										{item.progress.cost > 0 ? ` · $${item.progress.cost.toFixed(3)}` : ""}
									</p>
								) : null}
							</div>
						))}
					</div>
				)}
			</section>
		</div>
	);
}
