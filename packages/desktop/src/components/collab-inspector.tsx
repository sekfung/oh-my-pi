import { Check, Copy, LoaderCircle, LogOut, Radio, Users } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import type { DesktopCollabGuestState, DesktopCollabState } from "@/lib/desktop-protocol";
import { cn } from "@/lib/utils";

function LinkRow({ label, link, onOpen }: { label: string; link: string; onOpen(url: string): void }) {
	const [copied, setCopied] = useState(false);
	return (
		<div className="rounded-lg border bg-card p-2">
			<p className="text-[10px] font-medium text-muted-foreground uppercase">{label}</p>
			<div className="mt-1 flex items-center gap-1.5">
				<button
					type="button"
					className="min-w-0 flex-1 truncate text-left text-xs text-primary underline-offset-2 hover:underline"
					onClick={() => onOpen(link)}
					title={link}
				>
					{link}
				</button>
				<Button
					size="icon"
					variant="ghost"
					className="size-6 shrink-0"
					title="Copy link"
					onClick={() => {
						void navigator.clipboard.writeText(link);
						setCopied(true);
						setTimeout(() => setCopied(false), 1500);
					}}
				>
					{copied ? <Check className="size-3" /> : <Copy className="size-3" />}
				</Button>
			</div>
		</div>
	);
}

export interface CollabInspectorProps {
	collab?: DesktopCollabState;
	guest?: DesktopCollabGuestState;
	loading: boolean;
	relayUrl: string;
	onRelayUrlChange(value: string): void;
	onStart(): void;
	onStop(): void;
	onOpenLink(url: string): void;
	joinLink: string;
	onJoinLinkChange(value: string): void;
	onJoin(): void;
	onLeave(): void;
}

export function CollabInspector({
	collab,
	guest,
	loading,
	relayUrl,
	onRelayUrlChange,
	onStart,
	onStop,
	onOpenLink,
	joinLink,
	onJoinLinkChange,
	onJoin,
	onLeave,
}: CollabInspectorProps) {
	if (loading && !collab) {
		return (
			<div className="grid h-full place-items-center">
				<div className="flex items-center gap-2 text-xs">
					<LoaderCircle className="animate-spin" />
					Reading collab state…
				</div>
			</div>
		);
	}

	return (
		<div className="space-y-5 p-4">
			<section>
				<h3 className="flex items-center gap-1.5 text-xs font-medium text-foreground">
					<Radio className="size-3.5" />
					Host this session
				</h3>
				{collab?.hosting ? (
					<div className="mt-2 space-y-2">
						{collab.webLink ? (
							<LinkRow label="Join (full control)" link={collab.webLink} onOpen={onOpenLink} />
						) : null}
						{collab.webViewLink ? (
							<LinkRow label="Watch (read-only)" link={collab.webViewLink} onOpen={onOpenLink} />
						) : null}
						<p className="text-[11px] text-muted-foreground">
							Anyone with the full-control link can read and prompt this session; the read-only link can only
							watch.
						</p>
						<Button size="sm" variant="outline" className="h-7 text-[11px]" onClick={onStop}>
							Stop hosting
						</Button>
					</div>
				) : (
					<div className="mt-2 space-y-2">
						<input
							value={relayUrl}
							onChange={event => onRelayUrlChange(event.target.value)}
							placeholder="relay.example.com (optional — uses collab.relayUrl)"
							className="h-7 w-full rounded-md border bg-background px-2 text-[11px] outline-none placeholder:text-muted-foreground focus:ring-1 focus:ring-ring"
						/>
						<Button
							size="sm"
							variant="outline"
							className="h-7 text-[11px]"
							disabled={guest?.joined}
							title={guest?.joined ? "Leave the collab session first" : undefined}
							onClick={onStart}
						>
							Start hosting
						</Button>
					</div>
				)}
			</section>

			<section>
				<h3 className="flex items-center gap-1.5 text-xs font-medium text-foreground">
					<Users className="size-3.5" />
					Participants
				</h3>
				{(() => {
					const participants = collab?.hosting
						? collab.participants
						: ((guest?.joined ? guest.state?.participants : undefined) ?? []);
					if (participants.length === 0) {
						return (
							<p className="mt-2 text-xs text-muted-foreground">
								{collab?.hosting
									? "Just you, for now."
									: guest?.joined
										? "Loading…"
										: "Not in a collab session."}
							</p>
						);
					}
					return (
						<div className="mt-2 space-y-1">
							{participants.map((participant, index) => (
								<div
									key={`${participant.name}-${index}`}
									className="flex items-center gap-2 rounded-lg border bg-card px-2 py-1.5"
								>
									<span
										className={cn(
											"size-1.5 shrink-0 rounded-full",
											participant.role === "host" ? "bg-primary" : "bg-emerald-500",
										)}
									/>
									<span className="min-w-0 flex-1 truncate text-xs">{participant.name}</span>
									<span className="shrink-0 text-[10px] text-muted-foreground">
										{participant.role === "host" ? "host" : participant.readOnly ? "view-only" : "guest"}
									</span>
								</div>
							))}
						</div>
					);
				})()}
			</section>

			<section>
				<h3 className="flex items-center gap-1.5 text-xs font-medium text-foreground">
					<LogOut className="size-3.5" />
					Join another session
				</h3>
				{guest?.joined ? (
					<div className="mt-2 space-y-2">
						<div className="rounded-lg border bg-card p-2">
							<p className="text-xs">
								{guest.state?.sessionName || "Connected"}
								{guest.readOnly ? " (read-only)" : ""}
							</p>
							{guest.state ? (
								<p className="mt-1 text-[11px] text-muted-foreground">
									{guest.state.participants.length} participant
									{guest.state.participants.length === 1 ? "" : "s"} ·{" "}
									{guest.state.isStreaming ? "streaming" : "idle"}
								</p>
							) : null}
						</div>
						<Button size="sm" variant="outline" className="h-7 text-[11px]" onClick={onLeave}>
							Leave
						</Button>
					</div>
				) : (
					<div className="mt-2 flex items-center gap-1.5">
						<input
							value={joinLink}
							onChange={event => onJoinLinkChange(event.target.value)}
							placeholder="Paste a collab link…"
							className="h-7 min-w-0 flex-1 rounded-md border bg-background px-2 text-[11px] outline-none placeholder:text-muted-foreground focus:ring-1 focus:ring-ring"
						/>
						<Button
							size="sm"
							variant="outline"
							className="h-7 shrink-0 text-[11px]"
							disabled={!joinLink.trim() || collab?.hosting}
							onClick={onJoin}
						>
							Join
						</Button>
					</div>
				)}
			</section>
		</div>
	);
}
