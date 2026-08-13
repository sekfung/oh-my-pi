import { ArrowUpCircle, LoaderCircle, ShieldCheck, ShieldX, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { DesktopApprovalPolicies } from "@/lib/desktop-protocol";
import { cn } from "@/lib/utils";

export interface ApprovalsInspectorProps {
	policies?: DesktopApprovalPolicies;
	loading: boolean;
	onPromote(policyKey: string): void;
	onClear(scope: "project" | "global", policyKey: string): void;
}

function PolicyBadge({ policy }: { policy: "allow" | "deny" | "prompt" }) {
	return (
		<span
			className={cn(
				"flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium",
				policy === "allow" && "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
				policy === "deny" && "bg-destructive/15 text-destructive",
				policy === "prompt" && "bg-muted text-muted-foreground",
			)}
		>
			{policy === "allow" ? (
				<ShieldCheck className="size-3" />
			) : policy === "deny" ? (
				<ShieldX className="size-3" />
			) : null}
			{policy}
		</span>
	);
}

export function ApprovalsInspector({ policies, loading, onPromote, onClear }: ApprovalsInspectorProps) {
	if (loading && !policies) {
		return (
			<div className="grid h-full place-items-center">
				<div className="flex items-center gap-2 text-xs">
					<LoaderCircle className="animate-spin" />
					Reading approval policies…
				</div>
			</div>
		);
	}

	const projectEntries = Object.entries(policies?.project ?? {});
	const globalEntries = Object.entries(policies?.global ?? {});

	return (
		<div className="space-y-5 p-4">
			<section>
				<h3 className="text-xs font-medium text-foreground">This project</h3>
				<p className="mt-0.5 text-[11px] text-muted-foreground">
					Standing decisions from "Always allow/deny in this project".
				</p>
				{projectEntries.length === 0 ? (
					<p className="mt-2 text-xs text-muted-foreground">No project-scoped policies yet.</p>
				) : (
					<div className="mt-2 space-y-1">
						{projectEntries.map(([policyKey, policy]) => (
							<div key={policyKey} className="flex items-center gap-2 rounded-lg border bg-card px-2 py-1.5">
								<code className="min-w-0 flex-1 truncate text-xs">{policyKey}</code>
								<PolicyBadge policy={policy} />
								{policy !== "prompt" ? (
									<Button
										variant="ghost"
										size="icon"
										className="size-6"
										title="Promote to global (applies to every project)"
										onClick={() => onPromote(policyKey)}
									>
										<ArrowUpCircle className="size-3.5" />
									</Button>
								) : null}
								<Button
									variant="ghost"
									size="icon"
									className="size-6"
									title="Revoke"
									onClick={() => onClear("project", policyKey)}
								>
									<Trash2 className="size-3.5" />
								</Button>
							</div>
						))}
					</div>
				)}
			</section>
			<section>
				<h3 className="text-xs font-medium text-foreground">Every project</h3>
				<p className="mt-0.5 text-[11px] text-muted-foreground">
					Global decisions promoted from a project, or set directly.
				</p>
				{globalEntries.length === 0 ? (
					<p className="mt-2 text-xs text-muted-foreground">No global policies yet.</p>
				) : (
					<div className="mt-2 space-y-1">
						{globalEntries.map(([policyKey, policy]) => (
							<div key={policyKey} className="flex items-center gap-2 rounded-lg border bg-card px-2 py-1.5">
								<code className="min-w-0 flex-1 truncate text-xs">{policyKey}</code>
								<PolicyBadge policy={policy} />
								<Button
									variant="ghost"
									size="icon"
									className="size-6"
									title="Revoke"
									onClick={() => onClear("global", policyKey)}
								>
									<Trash2 className="size-3.5" />
								</Button>
							</div>
						))}
					</div>
				)}
			</section>
		</div>
	);
}
