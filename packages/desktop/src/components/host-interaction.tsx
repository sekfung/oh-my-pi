import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import type { DesktopHostInteraction, DesktopToolApprovalChoice } from "@/lib/desktop-protocol";

interface HostInteractionProps {
	request: DesktopHostInteraction;
	onValue(value: string): void;
	onConfirm(confirmed: boolean): void;
	onApproval(choice: DesktopToolApprovalChoice): void;
	onCancel(): void;
}

const APPROVAL_LABELS: Record<DesktopToolApprovalChoice, string> = {
	allow_once: "Allow once",
	allow_project: "Always allow in this project",
	deny_once: "Deny once",
	deny_project: "Always deny in this project",
};

export function HostInteraction({ request, onValue, onConfirm, onApproval, onCancel }: HostInteractionProps) {
	const [value, setValue] = useState("");
	useEffect(() => {
		setValue(request.method === "editor" ? (request.prefill ?? "") : "");
	}, [request]);

	if (request.method === "cancel") return null;
	if (
		request.method === "notify" ||
		request.method === "setStatus" ||
		request.method === "setWidget" ||
		request.method === "setTitle" ||
		request.method === "set_editor_text" ||
		request.method === "open_url"
	)
		return null;

	return (
		<div
			className="fixed inset-0 z-50 grid place-items-center bg-black/35 p-5 backdrop-blur-[2px]"
			role="presentation"
		>
			<section
				className="w-full max-w-md rounded-2xl border bg-card p-5 shadow-2xl"
				role="dialog"
				aria-modal="true"
				aria-labelledby="interaction-title"
			>
				<h2 id="interaction-title" className="text-base font-semibold">
					{request.method === "toolApproval" ? `Allow ${request.toolName}?` : request.title}
				</h2>
				{request.method === "toolApproval" ? (
					<div className="mt-3 space-y-3">
						<div className="flex items-center gap-2 text-xs text-muted-foreground">
							<span className="rounded bg-muted px-2 py-1 font-medium uppercase">{request.tier}</span>
							<span className="truncate">Policy: {request.policyKey}</span>
						</div>
						{request.reason ? <p className="text-sm text-muted-foreground">{request.reason}</p> : null}
						<pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded-lg border bg-muted/50 p-3 text-xs leading-5">
							{request.preview}
						</pre>
						<div className="grid gap-2">
							{request.choices.map(choice => (
								<Button
									key={choice}
									variant={choice.startsWith("deny") ? "outline" : "default"}
									className="justify-start"
									onClick={() => onApproval(choice)}
								>
									{APPROVAL_LABELS[choice]}
								</Button>
							))}
						</div>
					</div>
				) : null}
				{request.method === "confirm" ? (
					<p className="mt-2 text-sm leading-6 text-muted-foreground">{request.message}</p>
				) : null}
				{request.method === "select" ? (
					<div className="mt-4 grid gap-2">
						{request.options.map(option => (
							<Button key={option} variant="outline" className="justify-start" onClick={() => onValue(option)}>
								{option}
							</Button>
						))}
					</div>
				) : null}
				{request.method === "input" ? (
					<input
						autoFocus
						className="mt-4 h-10 w-full rounded-lg border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring"
						placeholder={request.placeholder}
						value={value}
						onChange={event => setValue(event.target.value)}
					/>
				) : null}
				{request.method === "editor" ? (
					<textarea
						autoFocus
						className="mt-4 min-h-44 w-full resize-y rounded-lg border bg-background p-3 font-mono text-sm outline-none focus:ring-2 focus:ring-ring"
						value={value}
						onChange={event => setValue(event.target.value)}
					/>
				) : null}
				<div className="mt-5 flex justify-end gap-2">
					<Button variant="ghost" onClick={onCancel}>
						Cancel
					</Button>
					{request.method === "confirm" ? <Button onClick={() => onConfirm(true)}>Confirm</Button> : null}
					{request.method === "input" || request.method === "editor" ? (
						<Button onClick={() => onValue(value)} disabled={!value.trim()}>
							Continue
						</Button>
					) : null}
				</div>
			</section>
		</div>
	);
}
