import { ArrowLeft, Check, LoaderCircle, RotateCcw } from "lucide-react";
import { useMemo, useState } from "react";
import { ApprovalsSettings } from "@/components/approvals-settings";
import { ModelProviderSettings } from "@/components/model-provider-settings";
import { ResourcesSettings } from "@/components/resources-settings";
import { Button } from "@/components/ui/button";
import { APP_THEMES } from "@/lib/app-themes";
import type {
	DesktopApprovalPolicies,
	DesktopProviderCredential,
	DesktopResourcesSnapshot,
	DesktopSettingDef,
	DesktopSettingScope,
	DesktopSettingsSchema,
	DesktopSettingValueEntry,
} from "@/lib/desktop-protocol";
import { type Translate, useLocale, useT } from "@/lib/i18n/context";
import { LOCALES } from "@/lib/i18n/locale";
import type { MessageKey } from "@/lib/i18n/messages";
import { settingDescription, settingGroup, settingLabel } from "@/lib/i18n/settings";
import { cn } from "@/lib/utils";

export type AppearanceMode = "system" | "light" | "dark";

export interface SettingsPageProps {
	schema?: DesktopSettingsSchema;
	values?: DesktopSettingValueEntry[];
	loading: boolean;
	onSet(path: string, scope: "project" | "global", value: unknown): void;
	onReset(path: string, scope: "project" | "global"): void;
	onRefresh(): void;
	onBack(): void;
	/** Undefined selects the first tab; App owns it so the palette can deep-link. */
	tab?: string;
	onTabChange(tabId: string): void;
	appearance: {
		mode: AppearanceMode;
		onModeChange(mode: AppearanceMode): void;
		dark: boolean;
		theme?: string;
		onThemeChange(themeId?: string): void;
		zoom: number;
		onZoomChange(zoom: number): void;
	};
	providers: {
		credentials?: DesktopProviderCredential[];
		loading: boolean;
		onSetApiKey(providerId: string, apiKey: string): void;
		onClearApiKey(providerId: string): void;
	};
	approvals: {
		policies?: DesktopApprovalPolicies;
		loading: boolean;
		onRefresh(): void;
		onPromote(policyKey: string): void;
		onClear(scope: "project" | "global", policyKey: string): void;
	};
	resources: {
		snapshot?: DesktopResourcesSnapshot;
		loading: boolean;
		onRefresh(): void;
		onReload(): void;
	};
}

const SCOPE_LABEL_KEY = {
	project: "settings.scope.project",
	global: "settings.scope.global",
	default: "settings.scope.default",
} as const satisfies Record<DesktopSettingScope, MessageKey>;

/**
 * Three sections — the reference's fourth (数据与统计) has no backing feature in
 * oh-my-pi yet. "Workspace" holds the configuration surfaces that outlive the
 * active session (approval policies, installed resources).
 */
const SETTINGS_SECTIONS = [
	{ id: "basic", labelKey: "settings.section.basic", tabIds: ["appearance", "model", "providers"] },
	{
		id: "agent",
		labelKey: "settings.section.agent",
		tabIds: ["interaction", "context", "memory", "files", "shell", "tools", "tasks"],
	},
	{ id: "workspace", labelKey: "settings.section.workspace", tabIds: ["approvals", "resources"] },
] as const satisfies ReadonlyArray<{ id: string; labelKey: MessageKey; tabIds: readonly string[] }>;

/** Tabs the desktop renders itself; they carry no settings from the sidecar schema. */
const LOCAL_TABS = new Set(["approvals", "resources"]);

/** Tabs the desktop names itself; anything else keeps the schema's own label. */
const TAB_LABEL_KEY: Record<string, MessageKey> = {
	appearance: "settings.tab.appearance",
	model: "settings.tab.model",
	providers: "settings.tab.providers",
	interaction: "settings.tab.interaction",
	context: "settings.tab.context",
	memory: "settings.tab.memory",
	files: "settings.tab.files",
	shell: "settings.tab.shell",
	tools: "settings.tab.tools",
	tasks: "settings.tab.tasks",
	approvals: "settings.tab.approvals",
	resources: "settings.tab.resources",
};

function tabLabel(t: Translate, id: string, fallback: string): string {
	const key = TAB_LABEL_KEY[id];
	return key ? t(key) : fallback;
}

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
	const { locale, t } = useLocale();
	const [scope, setScope] = useState<"project" | "global">("global");
	const scopeOfCurrentValue = entry?.scope ?? "default";

	return (
		<div className="rounded-lg border bg-card p-2.5">
			<div className="flex items-start justify-between gap-2">
				<div className="min-w-0">
					<p className="text-xs font-medium">{settingLabel(locale, def.path, def.label)}</p>
					<p className="mt-0.5 text-[11px] text-muted-foreground">
						{settingDescription(locale, def.path, def.description)}
					</p>
				</div>
				<span
					className={cn(
						"shrink-0 rounded px-1.5 py-0.5 text-[10px]",
						scopeOfCurrentValue === "default" ? "bg-muted text-muted-foreground" : "bg-primary/15 text-primary",
					)}
				>
					{t(SCOPE_LABEL_KEY[scopeOfCurrentValue])}
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
						{entry?.value === true ? t("common.on") : t("common.off")}
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
					title={t("settings.scope.hint")}
				>
					<option value="global">{t("settings.scope.applyGlobal")}</option>
					<option value="project">{t("settings.scope.applyProject")}</option>
				</select>
				{scopeOfCurrentValue !== "default" ? (
					<Button
						variant="ghost"
						size="icon"
						className="size-6 shrink-0"
						title={t("settings.reset")}
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
	const t = useT();
	const [value, setValue] = useState("");
	return (
		<input
			type="password"
			className="h-6 min-w-0 flex-1 rounded border bg-background px-1.5 text-[11px]"
			placeholder={configured ? t("settings.secret.configured") : t("settings.secret.unset")}
			value={value}
			onChange={event => setValue(event.target.value)}
			onBlur={() => {
				if (value) onSubmit(value);
			}}
		/>
	);
}

function ThemeSwatch({
	id,
	label,
	active,
	dark,
	onSelect,
}: {
	id?: string;
	label: string;
	active: boolean;
	dark: boolean;
	onSelect(): void;
}) {
	return (
		<button
			type="button"
			data-app-theme={id}
			className={cn("rounded-lg text-left", dark && "dark")}
			onClick={onSelect}
		>
			<span
				className={cn("flex flex-col gap-2 rounded-lg border p-2.5", active && "ring-2 ring-ring")}
				style={{ background: "var(--background)", borderColor: "var(--border)", color: "var(--foreground)" }}
			>
				<span className="flex items-center justify-between">
					<span className="flex gap-1">
						<span className="size-3 rounded-full" style={{ background: "var(--primary)" }} />
						<span className="size-3 rounded-full" style={{ background: "var(--secondary)" }} />
						<span className="size-3 rounded-full" style={{ background: "var(--muted)" }} />
					</span>
					{active ? <Check className="size-3.5" style={{ color: "var(--primary)" }} /> : null}
				</span>
				<span className="text-[11px] font-medium">{label}</span>
			</span>
		</button>
	);
}

function ThemeSwatchPicker({
	appTheme,
	dark,
	onSelectAppTheme,
}: {
	appTheme?: string;
	dark: boolean;
	onSelectAppTheme(themeId?: string): void;
}) {
	const t = useT();
	return (
		<section>
			<h3 className="text-xs font-medium">{t("appearance.theme.label")}</h3>
			<p className="mt-0.5 mb-2 text-[11px] text-muted-foreground">{t("appearance.theme.description")}</p>
			<div className="grid grid-cols-4 gap-2">
				<ThemeSwatch
					label={t("appearance.theme.default")}
					active={!appTheme}
					dark={dark}
					onSelect={() => onSelectAppTheme(undefined)}
				/>
				{APP_THEMES.map(theme => (
					<ThemeSwatch
						key={theme.id}
						id={theme.id}
						label={theme.label}
						active={appTheme === theme.id}
						dark={dark}
						onSelect={() => onSelectAppTheme(theme.id)}
					/>
				))}
			</div>
		</section>
	);
}

const APPEARANCE_MODE_KEY = {
	system: "appearance.mode.system",
	light: "appearance.mode.light",
	dark: "appearance.mode.dark",
} as const satisfies Record<AppearanceMode, MessageKey>;

/** Row shell shared by the desktop-owned preferences, matching `SettingRow`'s card. */
function PreferenceRow({
	label,
	description,
	children,
}: {
	label: string;
	description: string;
	children: React.ReactNode;
}) {
	return (
		<div className="rounded-lg border bg-card p-2.5">
			<p className="text-xs font-medium">{label}</p>
			<p className="mt-0.5 text-[11px] text-muted-foreground">{description}</p>
			<div className="mt-2 flex items-center gap-1.5">{children}</div>
		</div>
	);
}

function AppearanceModePicker({
	mode,
	onModeChange,
}: {
	mode: AppearanceMode;
	onModeChange(mode: AppearanceMode): void;
}) {
	const t = useT();
	return (
		<PreferenceRow label={t("appearance.mode.label")} description={t("appearance.mode.description")}>
			{(["system", "light", "dark"] as const).map(option => (
				<Button
					key={option}
					size="sm"
					variant={mode === option ? "secondary" : "outline"}
					className="h-6 text-[11px]"
					onClick={() => onModeChange(option)}
				>
					{t(APPEARANCE_MODE_KEY[option])}
				</Button>
			))}
		</PreferenceRow>
	);
}

export const ZOOM_MIN = 0.8;
export const ZOOM_MAX = 1.6;
export const ZOOM_STEP = 0.1;

function ZoomPicker({ zoom, onZoomChange }: { zoom: number; onZoomChange(zoom: number): void }) {
	const t = useT();
	return (
		<PreferenceRow label={t("appearance.zoom.label")} description={t("appearance.zoom.description")}>
			<input
				type="range"
				min={ZOOM_MIN}
				max={ZOOM_MAX}
				step={ZOOM_STEP}
				value={zoom}
				aria-label={t("appearance.zoom.label")}
				className="w-48 accent-primary"
				onChange={event => onZoomChange(event.target.valueAsNumber)}
			/>
			<span className="w-10 text-[11px] text-muted-foreground tabular-nums">{Math.round(zoom * 100)}%</span>
			{zoom === 1 ? null : (
				<Button
					variant="ghost"
					size="icon"
					className="size-6"
					title={t("appearance.zoom.reset")}
					aria-label={t("appearance.zoom.reset")}
					onClick={() => onZoomChange(1)}
				>
					<RotateCcw className="size-3" />
				</Button>
			)}
		</PreferenceRow>
	);
}

function LanguagePicker() {
	const { locale, setLocale, t } = useLocale();
	return (
		<PreferenceRow label={t("appearance.language.label")} description={t("appearance.language.description")}>
			<select
				className="h-6 rounded border bg-background px-1.5 text-[11px]"
				value={locale}
				onChange={event => setLocale(event.target.value as (typeof LOCALES)[number]["id"])}
			>
				{LOCALES.map(option => (
					<option key={option.id} value={option.id}>
						{option.label}
					</option>
				))}
			</select>
		</PreferenceRow>
	);
}

export function SettingsPage({
	schema,
	values,
	loading,
	onSet,
	onReset,
	onRefresh,
	onBack,
	tab: activeTab,
	onTabChange,
	appearance,
	providers,
	approvals,
	resources,
}: SettingsPageProps) {
	const { locale, t } = useLocale();
	const sections = useMemo(() => {
		if (!schema) return [];
		const byId = new Map(schema.tabs.map(entry => [entry.id, entry]));
		return SETTINGS_SECTIONS.map(section => ({
			id: section.id,
			label: t(section.labelKey),
			tabs: section.tabIds
				.map(id => byId.get(id) ?? (LOCAL_TABS.has(id) ? { id, label: id } : undefined))
				.filter((entry): entry is { id: string; label: string } => entry !== undefined),
		})).filter(section => section.tabs.length > 0);
	}, [schema, t]);

	const tab = activeTab ?? sections[0]?.tabs[0]?.id;
	const activeTabMeta = sections.flatMap(section => section.tabs).find(entry => entry.id === tab);
	const refreshActiveTab =
		tab === "approvals" ? approvals.onRefresh : tab === "resources" ? resources.onRefresh : onRefresh;

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

	return (
		// Explicit row + `min-h-0`: an implicit `auto` row would grow past the window
		// on a long tab and leave the panes with nothing to scroll.
		<div className="grid h-full grid-cols-[240px_minmax(0,1fr)] grid-rows-[minmax(0,1fr)] overflow-hidden bg-background text-foreground">
			<aside className="flex min-h-0 flex-col gap-4 overflow-y-auto border-r bg-sidebar p-3">
				<button
					type="button"
					className="flex items-center gap-2 rounded-lg px-1 py-1 text-left text-sm text-muted-foreground hover:text-foreground"
					onClick={onBack}
				>
					<ArrowLeft className="size-4" />
					{t("settings.back")}
				</button>
				<h1 className="px-1 text-lg font-semibold">{t("settings.title")}</h1>
				{sections.map(section => (
					<div key={section.id}>
						<h2 className="mb-1 px-2 text-[10px] font-medium tracking-wide text-muted-foreground uppercase">
							{section.label}
						</h2>
						<div className="flex flex-col gap-0.5">
							{section.tabs.map(entry => (
								<button
									type="button"
									key={entry.id}
									className={cn(
										"rounded-md px-2 py-1.5 text-left text-sm",
										entry.id === tab
											? "bg-accent font-medium"
											: "text-muted-foreground hover:bg-sidebar-accent",
									)}
									onClick={() => onTabChange(entry.id)}
								>
									{tabLabel(t, entry.id, entry.label)}
								</button>
							))}
						</div>
					</div>
				))}
			</aside>
			<section className="flex min-h-0 flex-col">
				<header className="flex h-[52px] shrink-0 items-center border-b px-5">
					<h2 className="text-sm font-medium">
						{activeTabMeta ? tabLabel(t, activeTabMeta.id, activeTabMeta.label) : t("settings.title")}
					</h2>
					<Button className="ml-auto" variant="ghost" size="sm" onClick={refreshActiveTab}>
						{t("common.refresh")}
					</Button>
				</header>
				<div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-5">
					{loading && !schema ? (
						<div className="grid h-full place-items-center">
							<div className="flex items-center gap-2 text-xs">
								<LoaderCircle className="animate-spin" />
								{t("settings.loading")}
							</div>
						</div>
					) : !schema ? null : (
						<>
							{tab === "appearance" ? (
								<>
									<AppearanceModePicker mode={appearance.mode} onModeChange={appearance.onModeChange} />
									<ThemeSwatchPicker
										appTheme={appearance.theme}
										dark={appearance.dark}
										onSelectAppTheme={appearance.onThemeChange}
									/>
									<ZoomPicker zoom={appearance.zoom} onZoomChange={appearance.onZoomChange} />
									<LanguagePicker />
								</>
							) : null}
							{tab === "model" ? (
								<ModelProviderSettings
									providers={providers.credentials}
									loading={providers.loading}
									onSetApiKey={providers.onSetApiKey}
									onClearApiKey={providers.onClearApiKey}
								/>
							) : null}
							{tab === "approvals" ? (
								<ApprovalsSettings
									policies={approvals.policies}
									loading={approvals.loading}
									onPromote={approvals.onPromote}
									onClear={approvals.onClear}
								/>
							) : null}
							{tab === "resources" ? (
								<ResourcesSettings
									resources={resources.snapshot}
									loading={resources.loading}
									onReload={resources.onReload}
								/>
							) : null}
							{grouped.map(([group, defs]) => (
								<section key={group || "_"}>
									{group ? (
										<h3 className="mb-1.5 text-[10px] font-medium tracking-wide text-muted-foreground uppercase">
											{settingGroup(locale, group)}
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
						</>
					)}
				</div>
			</section>
		</div>
	);
}
