import { LoaderCircle, RotateCcw } from "lucide-react";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import type {
	DesktopSettingDef,
	DesktopSettingScope,
	DesktopSettingsSchema,
	DesktopSettingValueEntry,
} from "@/lib/desktop-protocol";
import { cn } from "@/lib/utils";

export interface SettingsInspectorProps {
	schema?: DesktopSettingsSchema;
	values?: DesktopSettingValueEntry[];
	loading: boolean;
	onSet(path: string, scope: "project" | "global", value: unknown): void;
	onReset(path: string, scope: "project" | "global"): void;
}

const SCOPE_LABEL: Record<DesktopSettingScope, string> = { project: "project", global: "global", default: "default" };

function SettingRow({
	def,
	entry,
	onSet,
	onReset,
}: {
	def: DesktopSettingDef;
	entry?: DesktopSettingValueEntry;
	onSet(path: string, scope: "project" | "global", value: unknown): void;
	onReset(path: string, scope: "project" | "global"): void;
}) {
	const [scope, setScope] = useState<"project" | "global">("global");
	const scopeOfCurrentValue = entry?.scope ?? "default";

	return (
		<div className="rounded-lg border bg-card p-2.5">
			<div className="flex items-start justify-between gap-2">
				<div className="min-w-0">
					<p className="text-xs font-medium">{def.label}</p>
					<p className="mt-0.5 text-[11px] text-muted-foreground">{def.description}</p>
				</div>
				<span
					className={cn(
						"shrink-0 rounded px-1.5 py-0.5 text-[10px]",
						scopeOfCurrentValue === "default" ? "bg-muted text-muted-foreground" : "bg-primary/15 text-primary",
					)}
				>
					{SCOPE_LABEL[scopeOfCurrentValue]}
				</span>
			</div>
			<div className="mt-2 flex items-center gap-1.5">
				{def.secret ? (
					<SecretInput configured={entry?.configured === true} onSubmit={value => onSet(def.path, scope, value)} />
				) : def.type === "boolean" ? (
					<Button
						size="sm"
						variant={entry?.value === true ? "secondary" : "outline"}
						className="h-6 text-[11px]"
						onClick={() => onSet(def.path, scope, !(entry?.value === true))}
					>
						{entry?.value === true ? "On" : "Off"}
					</Button>
				) : def.type === "enum" ? (
					<select
						className="h-6 rounded border bg-background px-1.5 text-[11px]"
						value={typeof entry?.value === "string" ? entry.value : ""}
						onChange={event => onSet(def.path, scope, event.target.value)}
					>
						{(def.options !== "runtime" ? def.options : undefined)?.map(option => (
							<option key={option.value} value={option.value}>
								{option.label}
							</option>
						)) ??
							def.enumValues?.map(value => (
								<option key={value} value={value}>
									{value}
								</option>
							))}
					</select>
				) : def.type === "string" ? (
					<input
						className="h-6 min-w-0 flex-1 rounded border bg-background px-1.5 text-[11px]"
						defaultValue={typeof entry?.value === "string" ? entry.value : ""}
						onBlur={event => onSet(def.path, scope, event.target.value)}
					/>
				) : def.type === "number" ? (
					<input
						type="number"
						className="h-6 w-24 rounded border bg-background px-1.5 text-[11px]"
						defaultValue={typeof entry?.value === "number" ? entry.value : ""}
						onBlur={event => onSet(def.path, scope, event.target.valueAsNumber)}
					/>
				) : (
					<code className="max-w-full truncate text-[10px] text-muted-foreground">
						{JSON.stringify(entry?.value)}
					</code>
				)}
				<select
					className="h-6 shrink-0 rounded border bg-background px-1 text-[10px] text-muted-foreground"
					value={scope}
					onChange={event => setScope(event.target.value as "project" | "global")}
					title="Scope for the next change"
				>
					<option value="global">Apply to: global</option>
					<option value="project">Apply to: this project</option>
				</select>
				{scopeOfCurrentValue !== "default" ? (
					<Button
						variant="ghost"
						size="icon"
						className="size-6 shrink-0"
						title="Reset to inherited/default"
						onClick={() => onReset(def.path, scopeOfCurrentValue === "project" ? "project" : "global")}
					>
						<RotateCcw className="size-3" />
					</Button>
				) : null}
			</div>
		</div>
	);
}

function SecretInput({ configured, onSubmit }: { configured: boolean; onSubmit(value: string): void }) {
	const [value, setValue] = useState("");
	return (
		<input
			type="password"
			className="h-6 min-w-0 flex-1 rounded border bg-background px-1.5 text-[11px]"
			placeholder={configured ? "•••••••• (configured)" : "Not set"}
			value={value}
			onChange={event => setValue(event.target.value)}
			onBlur={() => {
				if (value) onSubmit(value);
			}}
		/>
	);
}

export function SettingsInspector({ schema, values, loading, onSet, onReset }: SettingsInspectorProps) {
	const [activeTab, setActiveTab] = useState<string>();
	const tab = activeTab ?? schema?.tabs[0]?.id;

	const valuesByPath = useMemo(() => {
		const map = new Map<string, DesktopSettingValueEntry>();
		for (const entry of values ?? []) map.set(entry.path, entry);
		return map;
	}, [values]);

	const settingsForTab = useMemo(() => (schema?.settings ?? []).filter(def => def.tab === tab), [schema, tab]);
	const groupOrder = (tab && schema?.groups[tab]) || [];
	const grouped = useMemo(() => {
		const map = new Map<string, DesktopSettingDef[]>();
		for (const def of settingsForTab) {
			const key = def.group ?? "";
			const list = map.get(key) ?? [];
			list.push(def);
			map.set(key, list);
		}
		return [...map.entries()].sort(([a], [b]) => {
			if (a === "") return -1;
			if (b === "") return 1;
			return groupOrder.indexOf(a) - groupOrder.indexOf(b);
		});
	}, [settingsForTab, groupOrder]);

	if (loading && !schema) {
		return (
			<div className="grid h-full place-items-center">
				<div className="flex items-center gap-2 text-xs">
					<LoaderCircle className="animate-spin" />
					Reading settings…
				</div>
			</div>
		);
	}

	if (!schema) return null;

	return (
		<div className="flex h-full min-h-0 flex-col">
			<div className="flex gap-1 overflow-x-auto border-b px-2 py-1.5">
				{schema.tabs.map(t => (
					<button
						type="button"
						key={t.id}
						className={cn(
							"shrink-0 rounded-md px-2 py-1 text-[11px] whitespace-nowrap",
							t.id === tab ? "bg-accent font-medium" : "text-muted-foreground hover:bg-accent",
						)}
						onClick={() => setActiveTab(t.id)}
					>
						{t.label}
					</button>
				))}
			</div>
			<div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-3">
				{grouped.map(([group, defs]) => (
					<section key={group || "_"}>
						{group ? (
							<h3 className="mb-1.5 text-[10px] font-medium tracking-wide text-muted-foreground uppercase">
								{group}
							</h3>
						) : null}
						<div className="space-y-1.5">
							{defs.map(def => (
								<SettingRow
									key={def.path}
									def={def}
									entry={valuesByPath.get(def.path)}
									onSet={onSet}
									onReset={onReset}
								/>
							))}
						</div>
					</section>
				))}
			</div>
		</div>
	);
}
