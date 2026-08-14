import { Check, LoaderCircle } from "lucide-react";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import type { DesktopProviderCredential } from "@/lib/desktop-protocol";
import { useT } from "@/lib/i18n/context";
import { cn } from "@/lib/utils";

/** Excluded from this screen only — the providers stay fully functional under the hood. */
const EXCLUDED_PROVIDER_IDS = new Set(["zai", "zhipu-coding-plan"]);
const FEATURED_PROVIDER_ID = "deepseek";

export interface ModelProviderSettingsProps {
	providers?: DesktopProviderCredential[];
	loading: boolean;
	onSetApiKey(providerId: string, apiKey: string): void;
	onClearApiKey(providerId: string): void;
}

export function ModelProviderSettings({ providers, loading, onSetApiKey, onClearApiKey }: ModelProviderSettingsProps) {
	const t = useT();
	const visible = useMemo(() => {
		const list = (providers ?? []).filter(provider => !EXCLUDED_PROVIDER_IDS.has(provider.id));
		return [...list].sort((a, b) => {
			if (a.id === FEATURED_PROVIDER_ID) return -1;
			if (b.id === FEATURED_PROVIDER_ID) return 1;
			return a.label.localeCompare(b.label);
		});
	}, [providers]);

	const [selectedId, setSelectedId] = useState<string>();
	const selected = visible.find(provider => provider.id === selectedId) ?? visible[0];
	const [keyDraft, setKeyDraft] = useState("");

	if (loading && !providers) {
		return (
			<div className="flex items-center gap-2 rounded-lg border bg-card p-4 text-xs text-muted-foreground">
				<LoaderCircle className="size-3.5 animate-spin" />
				{t("provider.loading")}
			</div>
		);
	}

	if (!providers) return null;

	return (
		<div className="grid grid-cols-[180px_minmax(0,1fr)] overflow-hidden rounded-lg border bg-card">
			<div className="space-y-0.5 border-r p-2">
				{visible.map(provider => (
					<button
						type="button"
						key={provider.id}
						className={cn(
							"flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-xs",
							provider.id === selected?.id ? "bg-accent font-medium" : "text-muted-foreground hover:bg-accent",
						)}
						onClick={() => {
							setSelectedId(provider.id);
							setKeyDraft("");
						}}
					>
						<span className="truncate">{provider.label}</span>
						{provider.configured ? <Check className="size-3 shrink-0 text-primary" /> : null}
					</button>
				))}
			</div>
			<div className="p-3">
				{selected ? (
					<div className="space-y-2">
						<div className="flex items-center gap-2">
							<span className="text-sm font-medium">{selected.label}</span>
							<span
								className={cn(
									"rounded px-1.5 py-0.5 text-[10px]",
									selected.configured ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground",
								)}
							>
								{selected.configured ? t("provider.connected") : t("provider.disconnected")}
							</span>
						</div>
						<div className="flex items-center gap-1.5">
							<input
								type="password"
								className="h-7 min-w-0 flex-1 rounded border bg-background px-2 text-xs"
								placeholder={
									selected.configured ? t("provider.apiKey.configured") : t("provider.apiKey.placeholder")
								}
								value={keyDraft}
								onChange={event => setKeyDraft(event.target.value)}
							/>
							<Button
								size="sm"
								className="h-7 text-[11px]"
								disabled={!keyDraft}
								onClick={() => {
									onSetApiKey(selected.id, keyDraft);
									setKeyDraft("");
								}}
							>
								{t("common.save")}
							</Button>
							{selected.configured ? (
								<Button
									size="sm"
									variant="outline"
									className="h-7 text-[11px]"
									onClick={() => onClearApiKey(selected.id)}
								>
									{t("common.remove")}
								</Button>
							) : null}
						</div>
					</div>
				) : (
					<p className="text-xs text-muted-foreground">{t("provider.empty")}</p>
				)}
			</div>
		</div>
	);
}
