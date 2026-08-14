import { ArrowUpCircle, LoaderCircle, ShieldCheck, ShieldX, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { DesktopApprovalPolicies } from "@/lib/desktop-protocol";
import { useT } from "@/lib/i18n/context";
import { cn } from "@/lib/utils";

export interface ApprovalsSettingsProps {
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

/**
 * Standing approval decisions live in project/global config, not in the active
 * session, so they are managed here rather than in a session inspector.
 */
export function ApprovalsSettings({ policies, loading, onPromote, onClear }: ApprovalsSettingsProps) {
	const t = useT();

	if (loading && !policies) {
		return (
			<div className="flex items-center gap-2 text-xs text-muted-foreground">
				<LoaderCircle className="size-3 animate-spin" />
				{t("approvals.loading")}
			</div>
		);
	}

	const projectEntries = Object.entries(policies?.project ?? {});
	const globalEntries = Object.entries(policies?.global ?? {});

	return (
		<>
			<section>
				<h3 className="text-xs font-medium">{t("approvals.project.title")}</h3>
				<p className="mt-0.5 text-[11px] text-muted-foreground">{t("approvals.project.description")}</p>
				{projectEntries.length === 0 ? (
					<p className="mt-2 text-xs text-muted-foreground">{t("approvals.project.empty")}</p>
				) : (
					<div className="mt-2 space-y-1.5">
						{projectEntries.map(([policyKey, policy]) => (
							<div key={policyKey} className="flex items-center gap-2 rounded-lg border bg-card px-2.5 py-2">
								<code className="min-w-0 flex-1 truncate text-xs">{policyKey}</code>
								<PolicyBadge policy={policy} />
								{policy !== "prompt" ? (
									<Button
										variant="ghost"
										size="icon"
										className="size-6"
										title={t("approvals.promote")}
										aria-label={t("approvals.promote")}
										onClick={() => onPromote(policyKey)}
									>
										<ArrowUpCircle className="size-3.5" />
									</Button>
								) : null}
								<Button
									variant="ghost"
									size="icon"
									className="size-6"
									title={t("approvals.revoke")}
									aria-label={t("approvals.revoke")}
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
				<h3 className="text-xs font-medium">{t("approvals.global.title")}</h3>
				<p className="mt-0.5 text-[11px] text-muted-foreground">{t("approvals.global.description")}</p>
				{globalEntries.length === 0 ? (
					<p className="mt-2 text-xs text-muted-foreground">{t("approvals.global.empty")}</p>
				) : (
					<div className="mt-2 space-y-1.5">
						{globalEntries.map(([policyKey, policy]) => (
							<div key={policyKey} className="flex items-center gap-2 rounded-lg border bg-card px-2.5 py-2">
								<code className="min-w-0 flex-1 truncate text-xs">{policyKey}</code>
								<PolicyBadge policy={policy} />
								<Button
									variant="ghost"
									size="icon"
									className="size-6"
									title={t("approvals.revoke")}
									aria-label={t("approvals.revoke")}
									onClick={() => onClear("global", policyKey)}
								>
									<Trash2 className="size-3.5" />
								</Button>
							</div>
						))}
					</div>
				)}
			</section>
		</>
	);
}
