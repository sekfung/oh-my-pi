import { AlertTriangle, Blocks, Bot, LoaderCircle, Plug, RefreshCw, Sparkles, Wrench } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import type { DesktopResourcesSnapshot } from "@/lib/desktop-protocol";
import { cn } from "@/lib/utils";

export interface ResourcesInspectorProps {
	resources?: DesktopResourcesSnapshot;
	loading: boolean;
	onReload(): void;
}

function Section({
	icon: Icon,
	title,
	count,
	children,
}: {
	icon: React.ComponentType<{ className?: string }>;
	title: string;
	count: number;
	children: React.ReactNode;
}) {
	const [open, setOpen] = useState(true);
	return (
		<section>
			<button
				type="button"
				className="flex w-full items-center gap-1.5 text-left text-xs font-medium text-foreground"
				onClick={() => setOpen(value => !value)}
			>
				<Icon className="size-3.5 text-muted-foreground" />
				{title}
				<span className="text-muted-foreground">({count})</span>
			</button>
			{open ? <div className="mt-1.5 space-y-1">{children}</div> : null}
		</section>
	);
}

function Row({ title, subtitle, badge }: { title: string; subtitle?: string; badge?: string }) {
	return (
		<div className="flex items-center gap-2 rounded-lg border bg-card px-2 py-1.5">
			<div className="min-w-0 flex-1">
				<p className="truncate text-xs font-medium">{title}</p>
				{subtitle ? <p className="truncate text-[10px] text-muted-foreground">{subtitle}</p> : null}
			</div>
			{badge ? (
				<span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">{badge}</span>
			) : null}
		</div>
	);
}

export function ResourcesInspector({ resources, loading, onReload }: ResourcesInspectorProps) {
	if (loading && !resources) {
		return (
			<div className="grid h-full place-items-center">
				<div className="flex items-center gap-2 text-xs">
					<LoaderCircle className="animate-spin" />
					Reading resources…
				</div>
			</div>
		);
	}

	if (!resources) return null;

	const warnings = [...resources.skillWarnings, ...resources.promptWarnings];

	return (
		<div className="space-y-4 p-3">
			<Button size="sm" variant="outline" className="h-7 w-full gap-1.5 text-[11px]" onClick={onReload}>
				<RefreshCw className={cn("size-3", loading && "animate-spin")} />
				Reload skills, plugins, and commands
			</Button>

			{warnings.length > 0 ? (
				<div className="space-y-1 rounded-lg border border-amber-500/30 bg-amber-500/10 p-2">
					{warnings.map((warning, index) => (
						<div key={index} className="flex items-start gap-1.5 text-[11px] text-amber-700 dark:text-amber-400">
							<AlertTriangle className="mt-0.5 size-3 shrink-0" />
							<span>{warning}</span>
						</div>
					))}
				</div>
			) : null}

			<Section icon={Sparkles} title="Skills" count={resources.skills.length}>
				{resources.skills.map(skill => (
					<Row key={skill.name} title={skill.name} subtitle={skill.description} badge={skill.source} />
				))}
			</Section>

			<Section icon={Blocks} title="Plugins" count={resources.plugins.length}>
				{resources.plugins.map(plugin => (
					<Row
						key={plugin.name}
						title={plugin.name}
						subtitle={`v${plugin.version}`}
						badge={plugin.enabled ? "enabled" : "disabled"}
					/>
				))}
			</Section>

			<Section icon={Plug} title="MCP servers" count={resources.mcpServers.length}>
				{resources.mcpServers.map(server => (
					<Row
						key={server.name}
						title={server.name}
						subtitle={server.toolCount !== undefined ? `${server.toolCount} tools` : undefined}
						badge={server.status}
					/>
				))}
			</Section>

			<Section icon={Bot} title="Agents" count={resources.agents.length}>
				{resources.agents.map(agent => (
					<Row key={agent.name} title={agent.name} subtitle={agent.description} badge={agent.source} />
				))}
			</Section>

			<Section icon={Wrench} title="Tools" count={resources.tools.length}>
				{resources.tools.map(tool => (
					<Row key={tool.name} title={tool.name} subtitle={tool.description} />
				))}
			</Section>

			<Section icon={Sparkles} title="Prompts" count={resources.prompts.length}>
				{resources.prompts.map(prompt => (
					<Row key={prompt.path} title={prompt.name} subtitle={prompt.providerName} badge={prompt.sourceLevel} />
				))}
			</Section>
		</div>
	);
}
