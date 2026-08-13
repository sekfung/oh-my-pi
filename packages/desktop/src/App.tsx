import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import {
	Bot,
	Check,
	ChevronDown,
	FolderGit2,
	FolderOpen,
	GitCompareArrows,
	ImagePlus,
	ListOrdered,
	LoaderCircle,
	MessageSquareText,
	Moon,
	PanelRight,
	Pencil,
	Plus,
	RotateCcw,
	Send,
	Settings2,
	Square,
	Sun,
	TerminalSquare,
	Trash2,
	Undo2,
	X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import appIcon from "@/assets/app-icon-ui.png";
import { HostInteraction } from "@/components/host-interaction";
import { TranscriptMessage } from "@/components/transcript-message";
import { Button } from "@/components/ui/button";
import {
	type DesktopApplicationIntent,
	type DesktopApplicationSnapshot,
	type DesktopHostInteraction,
	type DesktopImageContent,
	type DesktopQueuedMessage,
	type DesktopSessionState,
	isHostInteraction,
	readApplicationIntentResult,
	readApplicationSnapshot,
	readMessages,
} from "@/lib/desktop-protocol";
import type { DesktopRpcCommand } from "@/lib/desktop-transport";
import { TauriSidecarTransport } from "@/lib/desktop-transport";
import { cn } from "@/lib/utils";

const RECENT_PROJECTS_KEY = "omp.desktop.recent-projects";
const APPEARANCE_KEY = "omp.desktop.appearance";

type ConnectionStatus = "empty" | "connecting" | "connected" | "recovering" | "disconnected";
type Inspector = "changes" | "files" | "tasks" | "diagnostics";

function loadRecentProjects(): string[] {
	try {
		const value = JSON.parse(localStorage.getItem(RECENT_PROJECTS_KEY) ?? "[]") as unknown;
		return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
	} catch {
		return [];
	}
}

function projectName(projectPath: string): string {
	const parts = projectPath.replaceAll("\\", "/").split("/").filter(Boolean);
	return parts.at(-1) ?? projectPath;
}

async function imageContent(file: File): Promise<DesktopImageContent> {
	if (!file.type.startsWith("image/")) throw new Error(`${file.name} is not an image`);
	const result = Promise.withResolvers<string>();
	const reader = new FileReader();
	reader.onload = () =>
		typeof reader.result === "string"
			? result.resolve(reader.result)
			: result.reject(new Error("Unable to read image"));
	reader.onerror = () => result.reject(reader.error ?? new Error("Unable to read image"));
	reader.readAsDataURL(file);
	const dataUrl = await result.promise;
	const separator = dataUrl.indexOf(",");
	if (separator < 0) throw new Error("Invalid image data");
	return { type: "image", mimeType: file.type, data: dataUrl.slice(separator + 1) };
}

export default function App() {
	const transport = useMemo(() => new TauriSidecarTransport(), []);
	const fileInput = useRef<HTMLInputElement>(null);
	const projectRef = useRef<string | undefined>(undefined);
	const restartedRef = useRef(false);
	const revisionRef = useRef(0);
	const sequenceRef = useRef(0);
	const [status, setStatus] = useState<ConnectionStatus>("empty");
	const [project, setProject] = useState<string>();
	const [recentProjects, setRecentProjects] = useState(loadRecentProjects);
	const [session, setSession] = useState<DesktopSessionState>();
	const [application, setApplication] = useState<DesktopApplicationSnapshot>();
	const [messages, setMessages] = useState<unknown[]>([]);
	const [draft, setDraft] = useState("");
	const [images, setImages] = useState<Array<DesktopImageContent & { name: string }>>([]);
	const [delivery, setDelivery] = useState<"steer" | "followUp">("followUp");
	const [interaction, setInteraction] = useState<DesktopHostInteraction>();
	const [error, setError] = useState<string>();
	const [notice, setNotice] = useState<string>();
	const [inspector, setInspector] = useState<Inspector>();
	const [renamingSession, setRenamingSession] = useState<{ path: string; title: string }>();
	const [deletingSessionPath, setDeletingSessionPath] = useState<string>();
	const [appearance, setAppearance] = useState<"system" | "light" | "dark">(() => {
		const saved = localStorage.getItem(APPEARANCE_KEY);
		return saved === "light" || saved === "dark" ? saved : "system";
	});
	const [systemDark, setSystemDark] = useState(() => window.matchMedia("(prefers-color-scheme: dark)").matches);
	const dark = appearance === "dark" || (appearance === "system" && systemDark);

	const refresh = useCallback(async () => {
		const [applicationResponse, messagesResponse] = await Promise.all([
			transport.request({ type: "get_application_snapshot" }),
			transport.request({ type: "get_messages" }),
		]);
		if (!applicationResponse.success) throw new Error(applicationResponse.error);
		if (applicationResponse.command !== "get_application_snapshot") throw new Error("Unexpected snapshot response");
		if (!messagesResponse.success) throw new Error(messagesResponse.error);
		if (messagesResponse.command !== "get_messages") throw new Error("Unexpected messages response");
		const snapshot = readApplicationSnapshot(applicationResponse.data);
		revisionRef.current = snapshot.revision;
		sequenceRef.current = snapshot.sequence;
		setApplication(snapshot);
		setSession(snapshot.activeSession);
		setMessages(readMessages(messagesResponse.data));
	}, [transport]);

	const connect = useCallback(
		async (path: string, recovering = false) => {
			setStatus(recovering ? "recovering" : "connecting");
			setError(undefined);
			try {
				await transport.open(path);
				await refresh();
				projectRef.current = path;
				setProject(path);
				setStatus("connected");
				if (!recovering) restartedRef.current = false;
				setRecentProjects(current => {
					const next = [path, ...current.filter(candidate => candidate !== path)].slice(0, 12);
					localStorage.setItem(RECENT_PROJECTS_KEY, JSON.stringify(next));
					return next;
				});
			} catch (cause) {
				setStatus("disconnected");
				setError(cause instanceof Error ? cause.message : String(cause));
			}
		},
		[refresh, transport],
	);

	useEffect(() => {
		document.documentElement.classList.toggle("dark", dark);
	}, [dark]);

	useEffect(() => {
		const query = window.matchMedia("(prefers-color-scheme: dark)");
		const changed = () => setSystemDark(query.matches);
		query.addEventListener("change", changed);
		return () => query.removeEventListener("change", changed);
	}, []);

	useEffect(() => {
		let stopOpenProject: (() => void) | undefined;
		let disposed = false;
		void listen<string>("omp-open-project", ({ payload }) => void connect(payload)).then(unlisten => {
			if (disposed) unlisten();
			else stopOpenProject = unlisten;
		});
		const stopFrames = transport.onFrame(frame => {
			if (isHostInteraction(frame)) {
				if (frame.method === "cancel") {
					setInteraction(current => (current?.id === frame.targetId ? undefined : current));
				} else if (frame.method === "notify") {
					setNotice(frame.message);
				} else if (frame.method === "open_url") {
					void invoke("open_external_url", { url: frame.launchUrl ?? frame.url }).catch(cause =>
						setError(cause instanceof Error ? cause.message : String(cause)),
					);
				} else if (
					frame.method === "select" ||
					frame.method === "toolApproval" ||
					frame.method === "confirm" ||
					frame.method === "input" ||
					frame.method === "editor"
				) {
					setInteraction(frame);
				}
				return;
			}
			if (
				frame.type === "application_changed" &&
				typeof frame.sequence === "number" &&
				typeof frame.revision === "number"
			) {
				const hasGap = frame.sequence !== sequenceRef.current + 1;
				sequenceRef.current = frame.sequence;
				revisionRef.current = frame.revision;
				void refresh().catch(cause =>
					setError(
						cause instanceof Error
							? hasGap
								? `Application event gap: ${cause.message}`
								: cause.message
							: String(cause),
					),
				);
				return;
			}
			if (frame.type === "message_start" && "message" in frame) {
				setMessages(current => [...current, frame.message]);
			} else if ((frame.type === "message_update" || frame.type === "message_end") && "message" in frame) {
				setMessages(current => (current.length === 0 ? [frame.message] : [...current.slice(0, -1), frame.message]));
			} else if (frame.type === "notice" && "message" in frame && typeof frame.message === "string") {
				setNotice(frame.message);
			} else if (
				frame.type === "agent_end" ||
				frame.type === "model_changed" ||
				frame.type === "thinking_level_changed"
			) {
				void refresh().catch(cause => setError(cause instanceof Error ? cause.message : String(cause)));
			}
		});
		const stopExit = transport.onExit(() => {
			const activeProject = projectRef.current;
			if (activeProject && !restartedRef.current) {
				restartedRef.current = true;
				setNotice("The Oh My Pi sidecar stopped unexpectedly. Restoring the persisted session once…");
				void connect(activeProject, true);
				return;
			}
			setStatus("disconnected");
			setError("The Oh My Pi sidecar stopped again. Review diagnostics, then retry manually.");
		});
		void invoke<string | null>("startup_project").then(path => {
			const startup = path ?? loadRecentProjects()[0];
			if (startup) void connect(startup);
		});
		return () => {
			disposed = true;
			stopOpenProject?.();
			stopFrames();
			stopExit();
			void transport.dispose();
		};
	}, [connect, refresh, transport]);

	const chooseProject = async () => {
		const selected = await open({ directory: true, multiple: false, title: "Open Oh My Pi project" });
		if (selected) await connect(selected);
	};

	const send = async () => {
		const text = draft.trim();
		if (!text && images.length === 0) return;
		setDraft("");
		const attachments = images.map(({ name: _name, ...image }) => image);
		setImages([]);
		try {
			const response = session?.isStreaming
				? await transport.request({
						type: delivery === "steer" ? "steer" : "follow_up",
						message: text,
						images: attachments,
					})
				: await transport.request({ type: "prompt", message: text, images: attachments });
			if (!response.success) throw new Error(response.error);
			await refresh();
		} catch (cause) {
			setDraft(text);
			setError(cause instanceof Error ? cause.message : String(cause));
		}
	};

	const run = async (command: DesktopRpcCommand) => {
		try {
			const response = await transport.request(command);
			if (!response.success) throw new Error(response.error);
			await refresh();
		} catch (cause) {
			setError(cause instanceof Error ? cause.message : String(cause));
		}
	};

	const runIntent = async (intent: DesktopApplicationIntent): Promise<boolean> => {
		try {
			const response = await transport.request({
				type: "execute_application_intent",
				intentId: crypto.randomUUID(),
				expectedRevision: revisionRef.current,
				intent,
			});
			if (!response.success) {
				if (response.code === "stale_revision") await refresh();
				throw new Error(response.error);
			}
			const result = readApplicationIntentResult(response.data);
			revisionRef.current = result.snapshot.revision;
			sequenceRef.current = result.snapshot.sequence;
			setApplication(result.snapshot);
			setSession(result.snapshot.activeSession);
			const messagesResponse = await transport.request({ type: "get_messages" });
			if (!messagesResponse.success) throw new Error(messagesResponse.error);
			setMessages(readMessages(messagesResponse.data));
			return result.applied;
		} catch (cause) {
			setError(cause instanceof Error ? cause.message : String(cause));
			return false;
		}
	};

	const restoreQueueItem = async (item: DesktopQueuedMessage) => {
		if (!(await runIntent({ type: "remove_queue_item", queueItemId: item.id }))) return;
		setDraft(current => [item.text, current].filter(Boolean).join("\n"));
		const queuedImages = item.images;
		if (queuedImages) {
			setImages(current => [
				...queuedImages.map((image, index) => ({ ...image, name: `Queued image ${index + 1}` })),
				...current,
			]);
		}
	};

	const renameSession = async () => {
		if (!renamingSession?.title.trim()) return;
		if (
			await runIntent({
				type: "rename_session",
				sessionPath: renamingSession.path,
				title: renamingSession.title,
			})
		) {
			setRenamingSession(undefined);
		}
	};

	const addImages = async (files: FileList | null) => {
		if (!files) return;
		try {
			const next = await Promise.all(
				[...files].map(async file => ({ ...(await imageContent(file)), name: file.name })),
			);
			setImages(current => [...current, ...next]);
		} catch (cause) {
			setError(cause instanceof Error ? cause.message : String(cause));
		}
	};

	const cycleAppearance = () => {
		const next = appearance === "system" ? "light" : appearance === "light" ? "dark" : "system";
		setAppearance(next);
		localStorage.setItem(APPEARANCE_KEY, next);
	};

	if (!project && status !== "connecting") {
		return (
			<main className="grid h-full place-items-center bg-background p-8">
				<section className="w-full max-w-lg">
					<img src={appIcon} alt="" className="mb-8 size-12 rounded-2xl shadow-sm" />
					<h1 className="text-3xl font-semibold tracking-tight">Open a project</h1>
					<p className="mt-2 text-sm leading-6 text-muted-foreground">
						Oh My Pi works in your local project and uses the same sessions, settings, credentials, skills, and
						tools as the terminal.
					</p>
					<Button className="mt-6" onClick={chooseProject}>
						<FolderOpen />
						Choose folder
					</Button>
					{recentProjects.length > 0 ? (
						<div className="mt-8 space-y-1">
							<p className="mb-2 text-xs font-medium text-muted-foreground">Recent projects</p>
							{recentProjects.map(path => (
								<button
									type="button"
									key={path}
									className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm hover:bg-accent"
									onClick={() => connect(path)}
								>
									<FolderGit2 className="size-4 text-muted-foreground" />
									<span className="font-medium">{projectName(path)}</span>
									<span className="ml-auto max-w-64 truncate text-xs text-muted-foreground">{path}</span>
								</button>
							))}
						</div>
					) : null}
					{error ? (
						<p className="mt-5 rounded-lg border border-destructive/25 bg-destructive/10 px-3 py-2 text-sm text-destructive">
							{error}
						</p>
					) : null}
				</section>
			</main>
		);
	}

	return (
		<div className="grid h-full grid-cols-[248px_minmax(0,1fr)] bg-background text-foreground">
			<aside className="flex min-h-0 flex-col border-r bg-sidebar p-2">
				<div className="flex items-center gap-2 px-2 py-2">
					<img src={appIcon} alt="" className="size-7 rounded-lg" />
					<span className="text-sm font-semibold">Oh My Pi</span>
				</div>
				<button
					type="button"
					className="mt-2 flex items-center gap-2 rounded-lg px-2 py-2 text-left hover:bg-sidebar-accent"
					onClick={chooseProject}
				>
					<FolderGit2 className="size-4" />
					<span className="min-w-0 flex-1 truncate text-sm font-medium">
						{project ? projectName(project) : "Opening…"}
					</span>
					<ChevronDown className="size-3.5 text-muted-foreground" />
				</button>
				<div className="mt-5 flex items-center justify-between px-2">
					<span className="text-xs font-medium text-muted-foreground">Sessions</span>
					<Button
						size="icon"
						variant="ghost"
						className="size-6"
						title="New session"
						onClick={() => runIntent({ type: "new_session" })}
					>
						<Plus />
					</Button>
				</div>
				<div className="mt-1 min-h-0 flex-1 space-y-1 overflow-y-auto">
					{application?.sessions.map(item => {
						const active = item.id === session?.sessionId || item.path === session?.sessionFile;
						return (
							<div
								key={item.path}
								className={cn(
									"group rounded-lg px-1 py-1 hover:bg-sidebar-accent",
									active && "bg-sidebar-accent",
								)}
							>
								{renamingSession?.path === item.path ? (
									<div className="flex items-center gap-1 p-1">
										<input
											autoFocus
											className="min-w-0 flex-1 rounded border bg-background px-2 py-1 text-xs outline-none focus:ring-1 focus:ring-ring"
											value={renamingSession.title}
											onChange={event => setRenamingSession({ path: item.path, title: event.target.value })}
											onKeyDown={event => {
												if (event.key === "Enter") void renameSession();
												if (event.key === "Escape") setRenamingSession(undefined);
											}}
										/>
										<Button size="icon" variant="ghost" className="size-6" onClick={renameSession}>
											<Check />
										</Button>
										<Button
											size="icon"
											variant="ghost"
											className="size-6"
											onClick={() => setRenamingSession(undefined)}
										>
											<X />
										</Button>
									</div>
								) : deletingSessionPath === item.path ? (
									<div className="flex items-center gap-1 p-1 text-xs text-destructive">
										<span className="flex-1 px-1">Delete this session?</span>
										<Button
											size="sm"
											variant="destructive"
											className="h-6 px-2 text-[11px]"
											onClick={async () => {
												if (await runIntent({ type: "delete_session", sessionPath: item.path })) {
													setDeletingSessionPath(undefined);
												}
											}}
										>
											Delete
										</Button>
										<Button
											size="sm"
											variant="ghost"
											className="h-6 px-2 text-[11px]"
											onClick={() => setDeletingSessionPath(undefined)}
										>
											Cancel
										</Button>
									</div>
								) : (
									<div className="flex items-start gap-1">
										<button
											type="button"
											className="min-w-0 flex-1 px-2 py-1 text-left"
											onClick={() =>
												active ? undefined : runIntent({ type: "switch_session", sessionPath: item.path })
											}
										>
											<div className="flex items-center gap-2">
												<MessageSquareText className="size-3.5 shrink-0 text-muted-foreground" />
												<span className="truncate text-sm font-medium">
													{item.title || item.firstMessage || "Untitled session"}
												</span>
											</div>
											<p className="mt-1 truncate pl-5 text-[11px] text-muted-foreground">
												{item.messageCount} messages · {item.status}
											</p>
										</button>
										<div className="flex pt-1 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100">
											<Button
												size="icon"
												variant="ghost"
												className="size-6"
												title="Rename session"
												onClick={() =>
													setRenamingSession({
														path: item.path,
														title: item.title || item.firstMessage || "",
													})
												}
											>
												<Pencil />
											</Button>
											<Button
												size="icon"
												variant="ghost"
												className="size-6"
												title={active ? "The active session cannot be deleted" : "Delete session"}
												disabled={active}
												onClick={() => setDeletingSessionPath(item.path)}
											>
												<Trash2 />
											</Button>
										</div>
									</div>
								)}
							</div>
						);
					})}
					{application && application.sessions.length === 0 ? (
						<div className="rounded-lg bg-sidebar-accent px-3 py-2">
							<p className="truncate text-sm font-medium">{session?.sessionName || "Current session"}</p>
							<p className="mt-1 truncate text-[11px] text-muted-foreground">New session</p>
						</div>
					) : null}
				</div>
				<div className="mt-auto space-y-1">
					<button type="button" className="sidebar-action" onClick={() => setInspector("changes")}>
						<GitCompareArrows />
						Changes
					</button>
					<button type="button" className="sidebar-action" onClick={() => setInspector("diagnostics")}>
						<TerminalSquare />
						Diagnostics
					</button>
					<button type="button" className="sidebar-action" onClick={() => setInspector("tasks")}>
						<Settings2 />
						Settings
					</button>
				</div>
			</aside>

			<section
				className={cn(
					"grid min-w-0 grid-rows-[52px_minmax(0,1fr)_auto]",
					inspector && "grid-cols-[minmax(0,1fr)_360px]",
				)}
			>
				<header className="col-start-1 flex items-center border-b px-4">
					<div className="min-w-0">
						<h1 className="truncate text-sm font-medium">
							{session?.sessionName || projectName(project ?? "Oh My Pi")}
						</h1>
						<p className="truncate text-[11px] text-muted-foreground">
							{session?.model ? `${session.model.provider} · ${session.model.name ?? session.model.id}` : status}
						</p>
					</div>
					<div className="ml-auto flex items-center gap-1">
						<Button variant="ghost" size="sm" onClick={() => run({ type: "cycle_model" })}>
							Model
						</Button>
						<Button variant="ghost" size="sm" onClick={() => run({ type: "cycle_thinking_level" })}>
							{session?.thinkingLevel ?? "Thinking"}
						</Button>
						<Button variant="ghost" size="icon" onClick={cycleAppearance} title="Change appearance">
							{dark ? <Moon /> : <Sun />}
						</Button>
						<Button
							variant="ghost"
							size="icon"
							onClick={() => setInspector(value => (value ? undefined : "changes"))}
							title="Toggle inspector"
						>
							<PanelRight />
						</Button>
					</div>
				</header>

				<div className="col-start-1 min-h-0 overflow-y-auto" aria-live="polite">
					<div className="mx-auto flex min-h-full w-full max-w-3xl flex-col gap-7 px-6 py-10">
						{messages.length === 0 ? (
							<div className="my-auto text-center">
								<Bot className="mx-auto size-8 text-muted-foreground" />
								<h2 className="mt-3 text-lg font-medium">What should we work on?</h2>
								<p className="mt-1 text-sm text-muted-foreground">
									Ask Oh My Pi to understand, change, test, or review this project.
								</p>
							</div>
						) : (
							messages.map((message, index) => <TranscriptMessage key={index} message={message} />)
						)}
						{status === "recovering" ? (
							<div className="flex items-center gap-2 text-sm text-muted-foreground">
								<LoaderCircle className="animate-spin" />
								Restoring persisted session…
							</div>
						) : null}
					</div>
				</div>

				<div className="col-start-1 px-5 pb-5">
					{application &&
					(application.activeSession.queue.items.length > 0 || application.activeSession.queue.hiddenCount > 0) ? (
						<div className="mx-auto mb-2 max-w-3xl rounded-xl border bg-card p-2 shadow-sm">
							<div className="flex items-center gap-2 px-1 pb-1 text-xs text-muted-foreground">
								<ListOrdered className="size-3.5" />
								<span>{application.activeSession.queue.items.length} queued</span>
								{application.activeSession.queue.hiddenCount > 0 ? (
									<span>· {application.activeSession.queue.hiddenCount} internal</span>
								) : null}
								{application.activeSession.queue.items.length > 0 ? (
									<Button
										className="ml-auto h-6 px-2 text-[11px]"
										variant="ghost"
										onClick={() => runIntent({ type: "clear_queue" })}
									>
										Clear
									</Button>
								) : null}
							</div>
							{application.activeSession.queue.items.map(item => (
								<div key={item.id} className="flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-muted">
									<span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
										{item.delivery === "steer" ? "Steer" : "Follow up"}
									</span>
									<span className="min-w-0 flex-1 truncate text-xs">
										{item.text || `[${item.images?.length ?? 0} image attachments]`}
									</span>
									<Button
										variant="ghost"
										size="icon"
										className="size-6"
										title="Restore to composer"
										onClick={() => restoreQueueItem(item)}
									>
										<Undo2 />
									</Button>
									<Button
										variant="ghost"
										size="icon"
										className="size-6"
										title="Remove queued message"
										onClick={() => runIntent({ type: "remove_queue_item", queueItemId: item.id })}
									>
										<X />
									</Button>
								</div>
							))}
						</div>
					) : null}
					{notice ? (
						<button
							type="button"
							className="mx-auto mb-2 block max-w-3xl rounded-lg border bg-card px-3 py-2 text-left text-xs text-muted-foreground"
							onClick={() => setNotice(undefined)}
						>
							{notice}
						</button>
					) : null}
					{error ? (
						<div className="mx-auto mb-2 flex max-w-3xl items-center gap-3 rounded-lg border border-destructive/25 bg-destructive/10 px-3 py-2 text-xs text-destructive">
							<span className="flex-1">{error}</span>
							{project ? (
								<Button size="sm" variant="outline" onClick={() => connect(project, true)}>
									<RotateCcw />
									Retry
								</Button>
							) : null}
						</div>
					) : null}
					<div className="composer mx-auto max-w-3xl">
						{images.length > 0 ? (
							<div className="flex flex-wrap gap-2 px-3 pt-3">
								{images.map((image, index) => (
									<button
										type="button"
										key={`${image.name}-${index}`}
										className="rounded-md border bg-muted px-2 py-1 text-xs"
										onClick={() =>
											setImages(current => current.filter((_, itemIndex) => itemIndex !== index))
										}
									>
										{image.name} ×
									</button>
								))}
							</div>
						) : null}
						<textarea
							value={draft}
							onChange={event => setDraft(event.target.value)}
							onKeyDown={event => {
								if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
									event.preventDefault();
									void send();
								}
							}}
							placeholder={
								session?.isStreaming
									? delivery === "steer"
										? "Steer the current turn…"
										: "Queue a follow-up…"
									: "Ask Oh My Pi…"
							}
							className="min-h-20 max-h-56 w-full resize-none bg-transparent px-4 pt-3 text-sm leading-6 outline-none placeholder:text-muted-foreground"
							disabled={status !== "connected"}
						/>
						<div className="flex items-center gap-1 px-2 pb-2">
							<input
								ref={fileInput}
								type="file"
								accept="image/*"
								multiple
								className="hidden"
								onChange={event => {
									void addImages(event.target.files);
									event.target.value = "";
								}}
							/>
							<Button
								variant="ghost"
								size="icon"
								className="size-8"
								title="Attach images"
								onClick={() => fileInput.current?.click()}
							>
								<ImagePlus />
							</Button>
							{session?.isStreaming ? (
								<button
									type="button"
									className="ml-1 rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-accent"
									onClick={() => setDelivery(value => (value === "steer" ? "followUp" : "steer"))}
								>
									{delivery === "steer" ? "Steer now" : "Follow up"}
								</button>
							) : null}
							<span className="ml-auto text-[10px] text-muted-foreground">Ctrl ↵</span>
							{session?.isStreaming ? (
								<Button
									variant="outline"
									size="icon"
									className="size-8"
									title="Abort"
									onClick={() => run({ type: "abort" })}
								>
									<Square className="size-3 fill-current" />
								</Button>
							) : (
								<Button
									size="icon"
									className="size-8 rounded-full"
									title="Send"
									disabled={(!draft.trim() && images.length === 0) || status !== "connected"}
									onClick={send}
								>
									<Send />
								</Button>
							)}
						</div>
					</div>
				</div>

				{inspector ? (
					<aside className="col-start-2 row-span-3 row-start-1 min-h-0 border-l bg-card">
						<div className="flex h-[52px] items-center border-b px-4">
							<h2 className="text-sm font-medium capitalize">{inspector}</h2>
							<Button className="ml-auto" variant="ghost" size="sm" onClick={() => setInspector(undefined)}>
								Close
							</Button>
						</div>
						<div className="p-4 text-sm leading-6 text-muted-foreground">
							{inspector === "changes" ? (
								"Read-only repository changes will appear here as the typed desktop application protocol is expanded."
							) : inspector === "diagnostics" ? (
								<dl className="space-y-3">
									<div>
										<dt className="text-xs">Connection</dt>
										<dd className="text-foreground">{status}</dd>
									</div>
									<div>
										<dt className="text-xs">Project</dt>
										<dd className="break-all text-foreground">{project}</dd>
									</div>
									<div>
										<dt className="text-xs">Session</dt>
										<dd className="break-all text-foreground">{session?.sessionId}</dd>
									</div>
								</dl>
							) : (
								"This native workflow is part of the accepted Desktop Parity matrix."
							)}
						</div>
					</aside>
				) : null}
			</section>

			{interaction ? (
				<HostInteraction
					request={interaction}
					onValue={value => {
						void transport.respond({ type: "extension_ui_response", id: interaction.id, value });
						setInteraction(undefined);
					}}
					onConfirm={confirmed => {
						void transport.respond({ type: "extension_ui_response", id: interaction.id, confirmed });
						setInteraction(undefined);
					}}
					onApproval={approvalChoice => {
						void transport.respond({ type: "extension_ui_response", id: interaction.id, approvalChoice });
						setInteraction(undefined);
					}}
					onCancel={() => {
						void transport.respond({ type: "extension_ui_response", id: interaction.id, cancelled: true });
						setInteraction(undefined);
					}}
				/>
			) : null}
		</div>
	);
}
