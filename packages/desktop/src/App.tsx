import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open, save } from "@tauri-apps/plugin-dialog";
import {
	Blocks,
	Check,
	ChevronDown,
	Compass,
	CopyPlus,
	Cpu,
	Download,
	Files,
	FolderGit2,
	FolderOpen,
	GitBranch,
	GitCompareArrows,
	GitFork,
	ImagePlus,
	ListChecks,
	ListOrdered,
	LoaderCircle,
	MessageSquareText,
	Moon,
	PanelRight,
	Pencil,
	Plus,
	Radio,
	RotateCcw,
	Send,
	Settings2,
	ShieldCheck,
	Square,
	SquareSlash,
	Sun,
	TerminalSquare,
	Trash2,
	Undo2,
	Upload,
	X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import appIcon from "@/assets/app-icon-ui.png";
import { ApprovalsInspector } from "@/components/approvals-inspector";
import { CollabInspector } from "@/components/collab-inspector";
import { CommandPalette, type PaletteAction } from "@/components/command-palette";
import { ComposerSuggestions } from "@/components/composer-suggestions";
import { ContextInspector } from "@/components/context-inspector";
import { HostInteraction } from "@/components/host-interaction";
import { ModelPicker } from "@/components/model-picker";
import { ResourcesInspector } from "@/components/resources-inspector";
import { SessionTree } from "@/components/session-tree";
import { SettingsInspector } from "@/components/settings-inspector";
import { ThinkingMenu } from "@/components/thinking-menu";
import { Transcript } from "@/components/transcript";
import { Button } from "@/components/ui/button";
import { WorkflowsInspector } from "@/components/workflows-inspector";
import { ChangesInspector, FilesInspector } from "@/components/workspace-review";
import {
	type DesktopApplicationIntent,
	type DesktopApplicationSnapshot,
	type DesktopApprovalPolicies,
	type DesktopAsyncJob,
	type DesktopAvailableModel,
	type DesktopCollabGuestState,
	type DesktopCollabState,
	type DesktopContextState,
	type DesktopHostInteraction,
	type DesktopImageContent,
	type DesktopQueuedMessage,
	type DesktopResourcesSnapshot,
	type DesktopSessionState,
	type DesktopSessionStats,
	type DesktopSettingsSchema,
	type DesktopSettingValueEntry,
	type DesktopSlashCommand,
	type DesktopSubagentSnapshot,
	type DesktopUpdateStatus,
	type DesktopWorkflowState,
	type DesktopWorkspaceReview,
	isBashOutput,
	isHostInteraction,
	isSubagentFrame,
	readApplicationIntentResult,
	readApplicationSnapshot,
	readApprovalPolicies,
	readAsyncJobs,
	readAvailableModels,
	readCollabGuestState,
	readCollabState,
	readContextState,
	readGoalUpdatedFrame,
	readMessages,
	readResourcesSnapshot,
	readSessionStats,
	readSettingsSchema,
	readSettingValues,
	readSlashCommands,
	readSubagents,
	readUpdateStatus,
	readWorkflowState,
	readWorkspaceReview,
} from "@/lib/desktop-protocol";
import type { DesktopRpcCommand } from "@/lib/desktop-transport";
import { TauriSidecarTransport } from "@/lib/desktop-transport";
import { cn } from "@/lib/utils";

const RECENT_PROJECTS_KEY = "omp.desktop.recent-projects";
const APPEARANCE_KEY = "omp.desktop.appearance";
const ZOOM_KEY = "omp.desktop.zoom";
const ZOOM_MIN = 0.8;
const ZOOM_MAX = 1.6;
const ZOOM_STEP = 0.1;

type ConnectionStatus = "empty" | "connecting" | "connected" | "recovering" | "disconnected";
type Inspector =
	| "tree"
	| "files"
	| "changes"
	| "approvals"
	| "context"
	| "workflows"
	| "collab"
	| "settings"
	| "resources"
	| "diagnostics";

interface ShellRunState {
	id: string;
	command: string;
	excludeFromContext: boolean;
	output: string;
}

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

/** The `@token` immediately before `cursor`, if any — drives file/path mention completion. */
function currentAtToken(text: string, cursor: number): { start: number; query: string } | undefined {
	const before = text.slice(0, cursor);
	const match = /(?:^|\s)@(\S*)$/.exec(before);
	if (!match) return undefined;
	const query = match[1] ?? "";
	return { start: cursor - query.length - 1, query };
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
	const [review, setReview] = useState<DesktopWorkspaceReview>();
	const [reviewLoading, setReviewLoading] = useState(false);
	const [approvalPolicies, setApprovalPolicies] = useState<DesktopApprovalPolicies>();
	const [contextState, setContextState] = useState<DesktopContextState>();
	const [asyncJobs, setAsyncJobs] = useState<DesktopAsyncJob[]>();
	const [contextLoading, setContextLoading] = useState(false);
	const [workflowState, setWorkflowState] = useState<DesktopWorkflowState>();
	const [subagents, setSubagents] = useState<DesktopSubagentSnapshot[]>();
	const [workflowsLoading, setWorkflowsLoading] = useState(false);
	const [updateStatus, setUpdateStatus] = useState<DesktopUpdateStatus>();
	const [updateBannerDismissed, setUpdateBannerDismissed] = useState(false);
	const [sessionStats, setSessionStats] = useState<DesktopSessionStats>();
	const [sessionStatsLoading, setSessionStatsLoading] = useState(false);
	const [sessionSearch, setSessionSearch] = useState("");
	const [collabState, setCollabState] = useState<DesktopCollabState>();
	const [collabGuestState, setCollabGuestState] = useState<DesktopCollabGuestState>();
	const [collabLoading, setCollabLoading] = useState(false);
	const [collabRelayUrl, setCollabRelayUrl] = useState("");
	const [collabJoinLink, setCollabJoinLink] = useState("");
	const [settingsSchema, setSettingsSchema] = useState<DesktopSettingsSchema>();
	const [settingValues, setSettingValues] = useState<DesktopSettingValueEntry[]>();
	const [settingsLoading, setSettingsLoading] = useState(false);
	const [resources, setResources] = useState<DesktopResourcesSnapshot>();
	const [resourcesLoading, setResourcesLoading] = useState(false);
	const [approvalsLoading, setApprovalsLoading] = useState(false);
	const [draft, setDraft] = useState("");
	const [images, setImages] = useState<Array<DesktopImageContent & { name: string }>>([]);
	const [delivery, setDelivery] = useState<"steer" | "followUp">("followUp");
	const [shellRun, setShellRun] = useState<ShellRunState>();
	const [slashCommands, setSlashCommands] = useState<DesktopSlashCommand[]>([]);
	const [promptHistory, setPromptHistory] = useState<string[]>([]);
	const [historyIndex, setHistoryIndex] = useState<number | null>(null);
	const [historyDraft, setHistoryDraft] = useState("");
	const [cursorPos, setCursorPos] = useState(0);
	const [autocompleteDismissed, setAutocompleteDismissed] = useState(false);
	const textareaRef = useRef<HTMLTextAreaElement>(null);
	const [availableModels, setAvailableModels] = useState<DesktopAvailableModel[]>();
	const [modelsLoading, setModelsLoading] = useState(false);
	const [modelPickerOpen, setModelPickerOpen] = useState(false);
	const [paletteOpen, setPaletteOpen] = useState(false);
	const [thinkingMenuOpen, setThinkingMenuOpen] = useState(false);
	const [interaction, setInteraction] = useState<DesktopHostInteraction>();
	const [extensionStatuses, setExtensionStatuses] = useState<Record<string, string>>({});
	const [extensionWidgets, setExtensionWidgets] = useState<
		Record<string, { lines: string[]; placement: "aboveEditor" | "belowEditor" }>
	>({});
	const [extensionTitle, setExtensionTitle] = useState<string>();
	const [error, setError] = useState<string>();
	const [notice, setNotice] = useState<string>();
	const [inspector, setInspector] = useState<Inspector>();
	const [renamingSession, setRenamingSession] = useState<{ path: string; title: string }>();
	const [deletingSessionPath, setDeletingSessionPath] = useState<string>();
	const [importingSource, setImportingSource] = useState<"claude" | "codex">();
	const [appearance, setAppearance] = useState<"system" | "light" | "dark">(() => {
		const saved = localStorage.getItem(APPEARANCE_KEY);
		return saved === "light" || saved === "dark" ? saved : "system";
	});
	const [systemDark, setSystemDark] = useState(() => window.matchMedia("(prefers-color-scheme: dark)").matches);
	const dark = appearance === "dark" || (appearance === "system" && systemDark);
	const [zoom, setZoom] = useState(() => {
		const saved = Number.parseFloat(localStorage.getItem(ZOOM_KEY) ?? "");
		return Number.isFinite(saved) && saved >= ZOOM_MIN && saved <= ZOOM_MAX ? saved : 1;
	});
	const currentModelEntry = availableModels?.find(
		model => model.provider === session?.model?.provider && model.id === session?.model?.id,
	);

	const filteredSessions = useMemo(() => {
		const sessions = application?.sessions ?? [];
		const query = sessionSearch.trim().toLowerCase();
		if (!query) return sessions;
		return sessions.filter(item => `${item.title ?? ""} ${item.firstMessage}`.toLowerCase().includes(query));
	}, [application, sessionSearch]);

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

	const refreshReview = useCallback(async () => {
		setReviewLoading(true);
		try {
			const response = await transport.request({ type: "get_workspace_review" });
			if (!response.success) throw new Error(response.error);
			if (response.command !== "get_workspace_review") throw new Error("Unexpected review response");
			setReview(readWorkspaceReview(response.data));
		} catch (cause) {
			setError(cause instanceof Error ? cause.message : String(cause));
		} finally {
			setReviewLoading(false);
		}
	}, [transport]);

	const refreshApprovals = useCallback(async () => {
		setApprovalsLoading(true);
		try {
			const response = await transport.request({ type: "get_approval_policies" });
			if (!response.success) throw new Error(response.error);
			if (response.command !== "get_approval_policies") throw new Error("Unexpected approvals response");
			setApprovalPolicies(readApprovalPolicies(response.data));
		} catch (cause) {
			setError(cause instanceof Error ? cause.message : String(cause));
		} finally {
			setApprovalsLoading(false);
		}
	}, [transport]);

	const refreshContext = useCallback(async () => {
		setContextLoading(true);
		try {
			const [stateResponse, jobsResponse] = await Promise.all([
				transport.request({ type: "get_state" }),
				transport.request({ type: "get_async_jobs" }),
			]);
			if (!stateResponse.success) throw new Error(stateResponse.error);
			if (stateResponse.command !== "get_state") throw new Error("Unexpected state response");
			setContextState(readContextState(stateResponse.data));
			if (!jobsResponse.success) throw new Error(jobsResponse.error);
			if (jobsResponse.command !== "get_async_jobs") throw new Error("Unexpected async jobs response");
			setAsyncJobs(readAsyncJobs(jobsResponse.data));
		} catch (cause) {
			setError(cause instanceof Error ? cause.message : String(cause));
		} finally {
			setContextLoading(false);
		}
	}, [transport]);

	const refreshSubagents = useCallback(async () => {
		try {
			const response = await transport.request({ type: "get_subagents" });
			if (!response.success) throw new Error(response.error);
			if (response.command !== "get_subagents") throw new Error("Unexpected subagents response");
			setSubagents(readSubagents(response.data));
		} catch (cause) {
			setError(cause instanceof Error ? cause.message : String(cause));
		}
	}, [transport]);

	const refreshWorkflows = useCallback(async () => {
		setWorkflowsLoading(true);
		try {
			const [stateResponse] = await Promise.all([
				transport.request({ type: "get_workflow_state" }),
				refreshSubagents(),
			]);
			if (!stateResponse.success) throw new Error(stateResponse.error);
			if (stateResponse.command !== "get_workflow_state") throw new Error("Unexpected workflow state response");
			setWorkflowState(readWorkflowState(stateResponse.data));
		} catch (cause) {
			setError(cause instanceof Error ? cause.message : String(cause));
		} finally {
			setWorkflowsLoading(false);
		}
	}, [transport, refreshSubagents]);

	const runWorkflowCommand = async (command: DesktopRpcCommand) => {
		try {
			const response = await transport.request(command);
			if (!response.success) throw new Error(response.error);
			if ("data" in response && response.data) setWorkflowState(readWorkflowState(response.data));
		} catch (cause) {
			setError(cause instanceof Error ? cause.message : String(cause));
		}
	};

	const refreshSessionStats = useCallback(async () => {
		setSessionStatsLoading(true);
		try {
			const response = await transport.request({ type: "get_session_stats" });
			if (!response.success) throw new Error(response.error);
			if (response.command !== "get_session_stats") throw new Error("Unexpected session stats response");
			setSessionStats(readSessionStats(response.data));
		} catch (cause) {
			setError(cause instanceof Error ? cause.message : String(cause));
		} finally {
			setSessionStatsLoading(false);
		}
	}, [transport]);

	const refreshCollabState = useCallback(async () => {
		setCollabLoading(true);
		try {
			const response = await transport.request({ type: "get_collab_state" });
			if (!response.success) throw new Error(response.error);
			if (response.command !== "get_collab_state") throw new Error("Unexpected collab state response");
			setCollabState(readCollabState(response.data));
		} catch (cause) {
			setError(cause instanceof Error ? cause.message : String(cause));
		} finally {
			setCollabLoading(false);
		}
	}, [transport]);

	const startCollab = async () => {
		try {
			const response = await transport.request({
				type: "collab_start",
				relayUrl: collabRelayUrl.trim() || undefined,
			});
			if (!response.success) throw new Error(response.error);
			if (response.command === "collab_start") setCollabState(readCollabState(response.data));
		} catch (cause) {
			setError(cause instanceof Error ? cause.message : String(cause));
		}
	};

	const stopCollab = async () => {
		try {
			const response = await transport.request({ type: "collab_stop" });
			if (!response.success) throw new Error(response.error);
			if (response.command === "collab_stop") setCollabState(readCollabState(response.data));
		} catch (cause) {
			setError(cause instanceof Error ? cause.message : String(cause));
		}
	};

	const joinCollab = async () => {
		const link = collabJoinLink.trim();
		if (!link) return;
		try {
			const response = await transport.request({ type: "collab_join", link });
			if (!response.success) throw new Error(response.error);
			if (response.command === "collab_join") setCollabGuestState(readCollabGuestState(response.data));
			setCollabJoinLink("");
			await refresh();
		} catch (cause) {
			setError(cause instanceof Error ? cause.message : String(cause));
		}
	};

	const leaveCollab = async () => {
		try {
			const response = await transport.request({ type: "collab_leave" });
			if (!response.success) throw new Error(response.error);
			setCollabGuestState(undefined);
			await refresh();
		} catch (cause) {
			setError(cause instanceof Error ? cause.message : String(cause));
		}
	};

	const handoffSession = async () => {
		try {
			const response = await transport.request({ type: "handoff" });
			if (!response.success) throw new Error(response.error);
			const data = response.command === "handoff" ? (response.data as { savedPath?: string } | null) : undefined;
			setNotice(data?.savedPath ? `Session handed off. Saved to ${data.savedPath}` : "Session handed off.");
			await refresh();
		} catch (cause) {
			setError(cause instanceof Error ? cause.message : String(cause));
		}
	};

	const refreshSettings = useCallback(async () => {
		setSettingsLoading(true);
		try {
			const requests = [transport.request({ type: "get_settings_values" })];
			if (!settingsSchema) requests.unshift(transport.request({ type: "get_settings_schema" }));
			const responses = await Promise.all(requests);
			for (const response of responses) {
				if (!response.success) throw new Error(response.error);
				if (response.command === "get_settings_schema") setSettingsSchema(readSettingsSchema(response.data));
				else if (response.command === "get_settings_values") setSettingValues(readSettingValues(response.data));
			}
		} catch (cause) {
			setError(cause instanceof Error ? cause.message : String(cause));
		} finally {
			setSettingsLoading(false);
		}
	}, [transport, settingsSchema]);

	const refreshResources = useCallback(async () => {
		setResourcesLoading(true);
		try {
			const response = await transport.request({ type: "get_resources" });
			if (!response.success) throw new Error(response.error);
			if (response.command !== "get_resources") throw new Error("Unexpected resources response");
			setResources(readResourcesSnapshot(response.data));
		} catch (cause) {
			setError(cause instanceof Error ? cause.message : String(cause));
		} finally {
			setResourcesLoading(false);
		}
	}, [transport]);

	const reloadResources = async () => {
		try {
			const response = await transport.request({ type: "reload_resources" });
			if (!response.success) throw new Error(response.error);
			await refreshResources();
		} catch (cause) {
			setError(cause instanceof Error ? cause.message : String(cause));
		}
	};

	const slashMatches = useMemo(() => {
		if (autocompleteDismissed || !/^\/[a-zA-Z0-9_-]*$/.test(draft)) return [];
		const query = draft.slice(1).toLowerCase();
		return slashCommands.filter(command => command.name.toLowerCase().startsWith(query)).slice(0, 8);
	}, [autocompleteDismissed, draft, slashCommands]);

	const atToken = useMemo(() => currentAtToken(draft, cursorPos), [draft, cursorPos]);

	const fileMatches = useMemo(() => {
		if (autocompleteDismissed || !atToken || !review) return [];
		const query = atToken.query.toLowerCase();
		return (query ? review.files.filter(file => file.path.toLowerCase().includes(query)) : review.files).slice(0, 8);
	}, [atToken, autocompleteDismissed, review]);

	const activeMenu: "slash" | "file" | undefined =
		slashMatches.length > 0 ? "slash" : fileMatches.length > 0 ? "file" : undefined;

	const [highlightIndex, setHighlightIndex] = useState(0);

	useEffect(() => {
		setHighlightIndex(0);
		setAutocompleteDismissed(false);
	}, [draft]);

	useEffect(() => {
		if (atToken && !review && status === "connected") void refreshReview();
	}, [atToken, review, status, refreshReview]);

	const applySlashCommand = (command: DesktopSlashCommand) => {
		const next = `/${command.name} `;
		setDraft(next);
		requestAnimationFrame(() => {
			textareaRef.current?.focus();
			textareaRef.current?.setSelectionRange(next.length, next.length);
		});
	};

	const applyFileMention = (filePath: string) => {
		if (!atToken) return;
		const before = draft.slice(0, atToken.start);
		const after = draft.slice(cursorPos);
		const next = `${before}@${filePath} ${after}`;
		setDraft(next);
		const nextCursor = before.length + filePath.length + 2;
		requestAnimationFrame(() => {
			textareaRef.current?.focus();
			textareaRef.current?.setSelectionRange(nextCursor, nextCursor);
		});
	};

	const checkForUpdates = useCallback(async () => {
		try {
			const response = await transport.request({ type: "get_update_status" });
			if (!response.success) return;
			if (response.command !== "get_update_status") return;
			setUpdateStatus(readUpdateStatus(response.data));
		} catch {
			// Best-effort: an unreachable registry is not worth surfacing as an error.
		}
	}, [transport]);

	const connect = useCallback(
		async (path: string, recovering = false) => {
			setStatus(recovering ? "recovering" : "connecting");
			setError(undefined);
			setExtensionStatuses({});
			setExtensionWidgets({});
			setExtensionTitle(undefined);
			try {
				await transport.open(path);
				await refresh();
				projectRef.current = path;
				setProject(path);
				setStatus("connected");
				if (!recovering) {
					restartedRef.current = false;
					void checkForUpdates();
				}
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
		[refresh, transport, checkForUpdates],
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
		document.documentElement.style.fontSize = zoom === 1 ? "" : `${zoom * 100}%`;
	}, [zoom]);

	useEffect(() => {
		const onKeyDown = (event: KeyboardEvent) => {
			if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
				event.preventDefault();
				setPaletteOpen(value => !value);
				return;
			}
			if (!(event.metaKey || event.ctrlKey)) return;
			if (event.key === "=" || event.key === "+") {
				event.preventDefault();
				setZoom(current => {
					const next = Math.min(ZOOM_MAX, Math.round((current + ZOOM_STEP) * 100) / 100);
					localStorage.setItem(ZOOM_KEY, String(next));
					return next;
				});
			} else if (event.key === "-") {
				event.preventDefault();
				setZoom(current => {
					const next = Math.max(ZOOM_MIN, Math.round((current - ZOOM_STEP) * 100) / 100);
					localStorage.setItem(ZOOM_KEY, String(next));
					return next;
				});
			} else if (event.key === "0") {
				event.preventDefault();
				setZoom(1);
				localStorage.removeItem(ZOOM_KEY);
			}
		};
		window.addEventListener("keydown", onKeyDown);
		return () => window.removeEventListener("keydown", onKeyDown);
	}, []);

	useEffect(() => {
		if ((inspector === "files" || inspector === "changes") && status === "connected") void refreshReview();
	}, [inspector, status, refreshReview]);

	useEffect(() => {
		if (inspector === "approvals" && status === "connected") void refreshApprovals();
	}, [inspector, status, refreshApprovals]);

	useEffect(() => {
		if (inspector === "context" && status === "connected") void refreshContext();
	}, [inspector, status, refreshContext]);

	useEffect(() => {
		if (inspector === "diagnostics" && status === "connected") void refreshSessionStats();
	}, [inspector, status, session?.sessionId, refreshSessionStats]);

	useEffect(() => {
		if (inspector === "collab" && status === "connected") void refreshCollabState();
	}, [inspector, status, refreshCollabState]);

	useEffect(() => {
		if (inspector !== "workflows" || status !== "connected") return;
		void refreshWorkflows();
		void transport.request({ type: "set_subagent_subscription", level: "progress" });
		return () => {
			void transport.request({ type: "set_subagent_subscription", level: "off" });
		};
	}, [inspector, status, refreshWorkflows, transport]);

	useEffect(() => {
		if (inspector === "settings" && status === "connected") void refreshSettings();
	}, [inspector, status, refreshSettings]);

	useEffect(() => {
		if (inspector === "resources" && status === "connected") void refreshResources();
	}, [inspector, status, refreshResources]);

	useEffect(() => {
		let stopOpenProject: (() => void) | undefined;
		let disposed = false;
		void listen<string>("omp-open-project", ({ payload }) => void connect(payload)).then(unlisten => {
			if (disposed) unlisten();
			else stopOpenProject = unlisten;
		});
		const stopFrames = transport.onFrame(frame => {
			if (isBashOutput(frame)) {
				setShellRun(current =>
					current?.id === frame.id ? { ...current, output: current.output + frame.chunk } : current,
				);
				return;
			}
			if (isHostInteraction(frame)) {
				if (frame.method === "cancel") {
					setInteraction(current => (current?.id === frame.targetId ? undefined : current));
				} else if (frame.method === "notify") {
					setNotice(frame.message);
				} else if (frame.method === "open_url") {
					openExternalUrl(frame.launchUrl ?? frame.url);
				} else if (frame.method === "setStatus") {
					setExtensionStatuses(current => {
						if (frame.statusText === undefined) {
							if (!(frame.statusKey in current)) return current;
							const { [frame.statusKey]: _removed, ...rest } = current;
							return rest;
						}
						return { ...current, [frame.statusKey]: frame.statusText };
					});
				} else if (frame.method === "setWidget") {
					setExtensionWidgets(current => {
						if (frame.widgetLines === undefined) {
							if (!(frame.widgetKey in current)) return current;
							const { [frame.widgetKey]: _removed, ...rest } = current;
							return rest;
						}
						return {
							...current,
							[frame.widgetKey]: { lines: frame.widgetLines, placement: frame.widgetPlacement ?? "aboveEditor" },
						};
					});
				} else if (frame.method === "setTitle") {
					setExtensionTitle(frame.title);
				} else if (frame.method === "set_editor_text") {
					setDraft(frame.text);
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
			if (isSubagentFrame(frame)) {
				void refreshSubagents();
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
			} else if (frame.type === "command_output" && "text" in frame && typeof frame.text === "string") {
				// Surfaces text-mode slash commands with no dedicated RPC/UI (e.g. /share, /dump).
				setNotice(frame.text);
			} else if (frame.type === "available_commands_update" && "commands" in frame) {
				setSlashCommands(readSlashCommands(frame.commands));
			} else if (frame.type === "goal_updated") {
				const { state } = readGoalUpdatedFrame(frame);
				setWorkflowState(current => (current ? { ...current, goal: state } : current));
			} else if (frame.type === "collab_state_changed" && "data" in frame) {
				setCollabState(readCollabState(frame.data));
			} else if (frame.type === "collab_guest_state" && "data" in frame) {
				const guestState = readCollabGuestState(frame.data);
				setCollabGuestState(guestState);
				if (!guestState.joined) void refresh();
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
	}, [connect, refresh, refreshSubagents, transport]);

	const chooseProject = async () => {
		const selected = await open({ directory: true, multiple: false, title: "Open Oh My Pi project" });
		if (selected) await connect(selected);
	};

	const pushPromptHistory = (text: string) => {
		if (!text.trim()) return;
		setPromptHistory(current => (current.at(-1) === text ? current : [...current, text].slice(-100)));
		setHistoryIndex(null);
		setHistoryDraft("");
	};

	const send = async () => {
		const text = draft.trim();
		if (!text && images.length === 0) return;
		if (images.length === 0 && text.startsWith("!")) {
			const excludeFromContext = text.startsWith("!!");
			const command = text.slice(excludeFromContext ? 2 : 1).trim();
			if (command) {
				setDraft("");
				pushPromptHistory(text);
				await runShellCommand(command, excludeFromContext);
				return;
			}
		}
		setDraft("");
		pushPromptHistory(text);
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

	const runShellCommand = async (command: string, excludeFromContext: boolean) => {
		const id = crypto.randomUUID();
		setShellRun({ id, command, excludeFromContext, output: "" });
		try {
			const response = await transport.request({ type: "bash", command, excludeFromContext }, { id });
			if (!response.success) throw new Error(response.error);
		} catch (cause) {
			setError(cause instanceof Error ? cause.message : String(cause));
		} finally {
			setShellRun(current => (current?.id === id ? undefined : current));
		}
	};

	const ensureModelsLoaded = async () => {
		if (availableModels || modelsLoading) return;
		setModelsLoading(true);
		try {
			const response = await transport.request({ type: "get_available_models" });
			if (!response.success) throw new Error(response.error);
			setAvailableModels(readAvailableModels(response.data));
		} catch (cause) {
			setError(cause instanceof Error ? cause.message : String(cause));
		} finally {
			setModelsLoading(false);
		}
	};

	const openModelPicker = () => {
		setModelPickerOpen(true);
		void ensureModelsLoaded();
	};

	const selectModel = async (model: DesktopAvailableModel) => {
		setModelPickerOpen(false);
		try {
			const response = await transport.request({ type: "set_model", provider: model.provider, modelId: model.id });
			if (!response.success) throw new Error(response.error);
			await refresh();
		} catch (cause) {
			setError(cause instanceof Error ? cause.message : String(cause));
		}
	};

	const toggleThinkingMenu = () => {
		setThinkingMenuOpen(value => !value);
		void ensureModelsLoaded();
	};

	const selectThinkingLevel = async (level: string) => {
		setThinkingMenuOpen(false);
		try {
			const response = await transport.request({ type: "set_thinking_level", level });
			if (!response.success) throw new Error(response.error);
			await refresh();
		} catch (cause) {
			setError(cause instanceof Error ? cause.message : String(cause));
		}
	};

	const promoteApprovalPolicy = async (policyKey: string) => {
		const policy = approvalPolicies?.project[policyKey];
		if (policy !== "allow" && policy !== "deny") return;
		try {
			const response = await transport.request({ type: "set_approval_policy", scope: "global", policyKey, policy });
			if (!response.success) throw new Error(response.error);
			await refreshApprovals();
		} catch (cause) {
			setError(cause instanceof Error ? cause.message : String(cause));
		}
	};

	const clearApprovalPolicy = async (scope: "project" | "global", policyKey: string) => {
		try {
			const response = await transport.request({ type: "clear_approval_policy", scope, policyKey });
			if (!response.success) throw new Error(response.error);
			await refreshApprovals();
		} catch (cause) {
			setError(cause instanceof Error ? cause.message : String(cause));
		}
	};

	const runContextCommand = async (command: DesktopRpcCommand) => {
		try {
			const response = await transport.request(command);
			if (!response.success) throw new Error(response.error);
			await refreshContext();
		} catch (cause) {
			setError(cause instanceof Error ? cause.message : String(cause));
		}
	};

	const setSettingValue = async (path: string, scope: "project" | "global", value: unknown) => {
		try {
			const response = await transport.request({ type: "set_setting_value", path, scope, value });
			if (!response.success) throw new Error(response.error);
			await refreshSettings();
		} catch (cause) {
			setError(cause instanceof Error ? cause.message : String(cause));
		}
	};

	const resetSettingValue = async (path: string, scope: "project" | "global") => {
		try {
			const response = await transport.request({ type: "clear_setting_value", path, scope });
			if (!response.success) throw new Error(response.error);
			await refreshSettings();
		} catch (cause) {
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

	const exportSession = async (item: { path: string; id: string; title?: string }) => {
		const defaultPath = `${(item.title ?? "omp-session").replace(/[^\w.-]+/g, "-")}-${item.id.slice(0, 8)}.html`;
		const outputPath = await save({
			defaultPath,
			filters: [{ name: "HTML transcript", extensions: ["html"] }],
		});
		if (!outputPath) return;
		if (await runIntent({ type: "export_session", sessionPath: item.path, format: "html", outputPath })) {
			setNotice(`Session exported to ${outputPath}`);
		}
	};

	const importSession = async (source: "claude" | "codex") => {
		setImportingSource(undefined);
		const selected = await open({
			directory: false,
			multiple: false,
			filters: [{ name: "Session transcript", extensions: ["jsonl"] }],
		});
		if (typeof selected !== "string") return;
		if (await runIntent({ type: "import_session", path: selected, source })) {
			setNotice(`Imported ${source === "claude" ? "Claude" : "Codex"} session`);
		}
	};

	const openPath = (absolutePath: string) => {
		void invoke("open_path", { path: absolutePath }).catch(cause =>
			setError(cause instanceof Error ? cause.message : String(cause)),
		);
	};

	const openExternalUrl = (url: string) => {
		void invoke("open_external_url", { url }).catch(cause =>
			setError(cause instanceof Error ? cause.message : String(cause)),
		);
	};

	const addImages = async (files: Iterable<File> | FileList | null) => {
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

	const paletteActions = useMemo((): PaletteAction[] => {
		const commandActions: PaletteAction[] = slashCommands.map(command => ({
			id: `command:${command.name}`,
			label: `/${command.name}`,
			hint: command.description ?? command.hint,
			icon: SquareSlash,
			group: "Commands",
			run: () => applySlashCommand(command),
		}));
		const operations: PaletteAction[] = [
			{
				id: "op:choose-project",
				label: "Choose project folder…",
				icon: FolderOpen,
				group: "Operations",
				run: () => void chooseProject(),
			},
			{
				id: "op:new-session",
				label: "New session",
				icon: Plus,
				group: "Operations",
				run: () => void runIntent({ type: "new_session" }),
			},
			{
				id: "op:select-model",
				label: "Select model…",
				icon: Cpu,
				group: "Operations",
				run: openModelPicker,
			},
			{
				id: "op:session-tree",
				label: "Open session tree",
				icon: GitBranch,
				group: "Operations",
				run: () => setInspector("tree"),
			},
			{
				id: "op:files",
				label: "Open Files",
				icon: Files,
				group: "Operations",
				run: () => setInspector("files"),
			},
			{
				id: "op:changes",
				label: "Open Changes",
				icon: GitCompareArrows,
				group: "Operations",
				run: () => setInspector("changes"),
			},
			{
				id: "op:approvals",
				label: "Open Approvals",
				icon: ShieldCheck,
				group: "Operations",
				run: () => setInspector("approvals"),
			},
			{
				id: "op:workflows",
				label: "Open Workflows",
				icon: Compass,
				group: "Operations",
				run: () => setInspector("workflows"),
			},
			{
				id: "op:collab",
				label: collabState?.hosting ? "Open Collab (hosting)" : "Open Collab",
				icon: Radio,
				group: "Operations",
				run: () => setInspector("collab"),
			},
			{
				id: "op:diagnostics",
				label: "Open Diagnostics",
				icon: TerminalSquare,
				group: "Operations",
				run: () => setInspector("diagnostics"),
			},
			{
				id: "op:appearance",
				label: "Toggle appearance",
				hint: appearance,
				icon: dark ? Sun : Moon,
				group: "Operations",
				run: cycleAppearance,
			},
			{
				id: "op:check-updates",
				label: "Check for updates",
				hint: updateStatus ? `current ${updateStatus.currentVersion}` : undefined,
				icon: Download,
				group: "Operations",
				run: () => void checkForUpdates(),
			},
		];
		if (session?.isStreaming) {
			operations.push({
				id: "op:abort",
				label: "Abort the current turn",
				icon: Square,
				group: "Operations",
				run: () => void run({ type: "abort" }),
			});
		}
		return [...commandActions, ...operations];
	}, [slashCommands, appearance, dark, session?.isStreaming, updateStatus, checkForUpdates, collabState]);

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
					<span className="flex items-center gap-0.5">
						<Button
							size="icon"
							variant="ghost"
							className="size-6"
							title="Import a Claude or Codex transcript"
							aria-label="Import a Claude or Codex transcript"
							onClick={() => setImportingSource(value => (value ? undefined : "claude"))}
						>
							<Upload />
						</Button>
						<Button
							size="icon"
							variant="ghost"
							className="size-6"
							title="New session"
							aria-label="New session"
							onClick={() => runIntent({ type: "new_session" })}
						>
							<Plus />
						</Button>
					</span>
				</div>
				{importingSource ? (
					<div className="mt-1 rounded-lg bg-sidebar-accent p-1.5">
						<p className="px-1 text-[11px] text-muted-foreground">Import a transcript file:</p>
						<div className="mt-1 flex gap-1">
							<Button
								size="sm"
								variant="outline"
								className="h-6 flex-1 text-[11px]"
								onClick={() => void importSession("claude")}
							>
								Claude
							</Button>
							<Button
								size="sm"
								variant="outline"
								className="h-6 flex-1 text-[11px]"
								onClick={() => void importSession("codex")}
							>
								Codex
							</Button>
						</div>
					</div>
				) : null}
				{(application?.sessions.length ?? 0) > 5 ? (
					<input
						value={sessionSearch}
						onChange={event => setSessionSearch(event.target.value)}
						placeholder="Search sessions…"
						className="mt-1 h-7 w-full rounded-md border bg-background px-2 text-xs outline-none placeholder:text-muted-foreground focus:ring-1 focus:ring-ring"
					/>
				) : null}
				<div className="mt-1 min-h-0 flex-1 space-y-1 overflow-y-auto">
					{filteredSessions.map(item => {
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
										<Button
											size="icon"
											variant="ghost"
											className="size-6"
											aria-label="Save session name"
											onClick={renameSession}
										>
											<Check />
										</Button>
										<Button
											size="icon"
											variant="ghost"
											className="size-6"
											aria-label="Cancel rename"
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
												title="Clone session"
												aria-label="Clone session"
												onClick={() => runIntent({ type: "clone_session", sessionPath: item.path })}
											>
												<CopyPlus />
											</Button>
											<Button
												size="icon"
												variant="ghost"
												className="size-6"
												title="Fork session"
												aria-label="Fork session"
												onClick={() => runIntent({ type: "fork_session", sessionPath: item.path })}
											>
												<GitFork />
											</Button>
											<Button
												size="icon"
												variant="ghost"
												className="size-6"
												title="Export session"
												aria-label="Export session"
												onClick={() => void exportSession(item)}
											>
												<Download />
											</Button>
											<Button
												size="icon"
												variant="ghost"
												className="size-6"
												title="Rename session"
												aria-label="Rename session"
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
												aria-label={active ? "The active session cannot be deleted" : "Delete session"}
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
					{application && application.sessions.length > 0 && filteredSessions.length === 0 ? (
						<p className="px-2 py-2 text-xs text-muted-foreground">No sessions match "{sessionSearch}".</p>
					) : null}
					{application && application.sessions.length === 0 ? (
						<div className="rounded-lg bg-sidebar-accent px-3 py-2">
							<p className="truncate text-sm font-medium">{session?.sessionName || "Current session"}</p>
							<p className="mt-1 truncate text-[11px] text-muted-foreground">New session</p>
						</div>
					) : null}
				</div>
				<div className="mt-auto space-y-1">
					<button type="button" className="sidebar-action" onClick={() => setInspector("tree")}>
						<GitBranch />
						Session tree
					</button>
					<button type="button" className="sidebar-action" onClick={() => setInspector("files")}>
						<Files />
						Files
					</button>
					<button type="button" className="sidebar-action" onClick={() => setInspector("changes")}>
						<GitCompareArrows />
						Changes
					</button>
					<button type="button" className="sidebar-action" onClick={() => setInspector("approvals")}>
						<ShieldCheck />
						Approvals
					</button>
					<button type="button" className="sidebar-action" onClick={() => setInspector("context")}>
						<ListChecks />
						Context
					</button>
					<button type="button" className="sidebar-action" onClick={() => setInspector("workflows")}>
						<Compass />
						Workflows
					</button>
					<button type="button" className="sidebar-action" onClick={() => setInspector("collab")}>
						<Radio />
						Collab{collabState?.hosting ? ` (${collabState.participants.length})` : ""}
					</button>
					<button type="button" className="sidebar-action" onClick={() => setInspector("settings")}>
						<Settings2 />
						Settings
					</button>
					<button type="button" className="sidebar-action" onClick={() => setInspector("resources")}>
						<Blocks />
						Resources
					</button>
					<button type="button" className="sidebar-action" onClick={() => setInspector("diagnostics")}>
						<TerminalSquare />
						Diagnostics
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
							{extensionTitle || session?.sessionName || projectName(project ?? "Oh My Pi")}
						</h1>
						<p className="truncate text-[11px] text-muted-foreground">
							{session?.model ? `${session.model.provider} · ${session.model.name ?? session.model.id}` : status}
						</p>
					</div>
					{Object.entries(extensionStatuses).length > 0 ? (
						<div className="ml-3 flex items-center gap-1">
							{Object.entries(extensionStatuses).map(([key, text]) => (
								<span
									key={key}
									className="rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground"
									title={key}
								>
									{text}
								</span>
							))}
						</div>
					) : null}
					<div className="ml-auto flex items-center gap-1">
						<Button
							variant="ghost"
							size="sm"
							className="gap-1.5 text-muted-foreground"
							onClick={() => setPaletteOpen(true)}
							title="Command palette"
						>
							<SquareSlash className="size-3.5" />
							<span className="text-[10px]">⌘K</span>
						</Button>
						<Button variant="ghost" size="sm" onClick={openModelPicker}>
							{session?.model ? (session.model.name ?? session.model.id) : "Model"}
						</Button>
						<div className="relative">
							<Button variant="ghost" size="sm" className="capitalize" onClick={toggleThinkingMenu}>
								{session?.thinkingLevel ?? "Thinking"}
							</Button>
							{thinkingMenuOpen ? (
								<ThinkingMenu
									levels={currentModelEntry?.thinkingEfforts}
									current={session?.thinkingLevel}
									onSelect={level => void selectThinkingLevel(level)}
									onClose={() => setThinkingMenuOpen(false)}
								/>
							) : null}
						</div>
						<Button
							variant="ghost"
							size="icon"
							onClick={cycleAppearance}
							title="Change appearance"
							aria-label="Change appearance"
						>
							{dark ? <Moon /> : <Sun />}
						</Button>
						<Button
							variant="ghost"
							size="icon"
							onClick={() => setInspector(value => (value ? undefined : "changes"))}
							title="Toggle inspector"
							aria-label="Toggle inspector"
						>
							<PanelRight />
						</Button>
					</div>
				</header>

				<div className="col-start-1 min-h-0">
					<Transcript
						messages={messages}
						shellRun={shellRun}
						recovering={status === "recovering"}
						onAbortBash={() => void run({ type: "abort_bash" })}
						onOpenLink={openExternalUrl}
					/>
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
										aria-label="Restore to composer"
										onClick={() => restoreQueueItem(item)}
									>
										<Undo2 />
									</Button>
									<Button
										variant="ghost"
										size="icon"
										className="size-6"
										title="Remove queued message"
										aria-label="Remove queued message"
										onClick={() => runIntent({ type: "remove_queue_item", queueItemId: item.id })}
									>
										<X />
									</Button>
								</div>
							))}
						</div>
					) : null}
					{updateStatus?.updateAvailable && !updateBannerDismissed ? (
						<div className="mx-auto mb-2 flex max-w-3xl items-center gap-3 rounded-lg border bg-card px-3 py-2 text-xs">
							<Download className="size-3.5 shrink-0 text-muted-foreground" />
							<span className="flex-1">
								Oh My Pi {updateStatus.latestVersion} is available (you have {updateStatus.currentVersion}).
							</span>
							<Button
								size="sm"
								variant="outline"
								className="h-6 px-2 text-[11px]"
								onClick={() => openExternalUrl(updateStatus.downloadUrl)}
							>
								View download page
							</Button>
							<Button
								variant="ghost"
								size="icon"
								className="size-6"
								title="Dismiss"
								aria-label="Dismiss update notice"
								onClick={() => setUpdateBannerDismissed(true)}
							>
								<X />
							</Button>
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
					{Object.entries(extensionWidgets)
						.filter(([, widget]) => widget.placement === "aboveEditor")
						.map(([key, widget]) => (
							<div
								key={key}
								className="mx-auto mb-2 max-w-3xl rounded-lg border bg-card px-3 py-2 text-xs text-muted-foreground"
							>
								{widget.lines.map((line, index) => (
									<p key={index}>{line}</p>
								))}
							</div>
						))}
					<div
						className="composer relative mx-auto max-w-3xl"
						onDragOver={event => {
							if (event.dataTransfer.types.includes("Files")) event.preventDefault();
						}}
						onDrop={event => {
							const dropped = [...(event.dataTransfer?.files ?? [])].filter(file =>
								file.type.startsWith("image/"),
							);
							if (dropped.length > 0) {
								event.preventDefault();
								void addImages(dropped);
							}
						}}
					>
						{activeMenu ? (
							<ComposerSuggestions
								items={
									activeMenu === "slash"
										? slashMatches.map(command => ({
												key: command.name,
												label: `/${command.name}`,
												hint: command.description ?? command.hint,
											}))
										: fileMatches.map(file => ({ key: file.path, label: file.path }))
								}
								activeIndex={highlightIndex}
								onHover={setHighlightIndex}
								onSelect={index => {
									if (activeMenu === "slash") applySlashCommand(slashMatches[index]);
									else applyFileMention(fileMatches[index].path);
								}}
							/>
						) : null}
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
							ref={textareaRef}
							value={draft}
							onChange={event => {
								setDraft(event.target.value);
								setCursorPos(event.target.selectionStart ?? event.target.value.length);
								setHistoryIndex(null);
							}}
							onKeyUp={event => setCursorPos(event.currentTarget.selectionStart ?? 0)}
							onClick={event => setCursorPos(event.currentTarget.selectionStart ?? 0)}
							onPaste={event => {
								const items = event.clipboardData?.items;
								if (!items) return;
								const pastedImages = [...items]
									.filter(item => item.kind === "file" && item.type.startsWith("image/"))
									.map(item => item.getAsFile())
									.filter((file): file is File => file !== null);
								if (pastedImages.length > 0) {
									event.preventDefault();
									void addImages(pastedImages);
								}
							}}
							onKeyDown={event => {
								if (activeMenu) {
									const items = activeMenu === "slash" ? slashMatches : fileMatches;
									if (event.key === "ArrowDown") {
										event.preventDefault();
										setHighlightIndex(index => (index + 1) % items.length);
										return;
									}
									if (event.key === "ArrowUp") {
										event.preventDefault();
										setHighlightIndex(index => (index - 1 + items.length) % items.length);
										return;
									}
									if (event.key === "Tab" || event.key === "Enter") {
										event.preventDefault();
										if (activeMenu === "slash") applySlashCommand(slashMatches[highlightIndex]);
										else applyFileMention(fileMatches[highlightIndex].path);
										return;
									}
									if (event.key === "Escape") {
										event.preventDefault();
										setAutocompleteDismissed(true);
										return;
									}
								}
								if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
									event.preventDefault();
									void send();
									return;
								}
								if (!activeMenu && event.key === "ArrowUp" && (draft === "" || historyIndex !== null)) {
									if (promptHistory.length === 0) return;
									event.preventDefault();
									if (historyIndex === null) {
										setHistoryDraft(draft);
										const nextIndex = promptHistory.length - 1;
										setHistoryIndex(nextIndex);
										setDraft(promptHistory[nextIndex]);
									} else if (historyIndex > 0) {
										const nextIndex = historyIndex - 1;
										setHistoryIndex(nextIndex);
										setDraft(promptHistory[nextIndex]);
									}
									return;
								}
								if (!activeMenu && event.key === "ArrowDown" && historyIndex !== null) {
									event.preventDefault();
									if (historyIndex < promptHistory.length - 1) {
										const nextIndex = historyIndex + 1;
										setHistoryIndex(nextIndex);
										setDraft(promptHistory[nextIndex]);
									} else {
										setHistoryIndex(null);
										setDraft(historyDraft);
									}
								}
							}}
							placeholder={
								session?.isStreaming
									? delivery === "steer"
										? "Steer the current turn…"
										: "Queue a follow-up…"
									: "Ask Oh My Pi… (/ commands, @ files, ! shell)"
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
								aria-label="Attach images"
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
									aria-label="Abort"
									onClick={() => run({ type: "abort" })}
								>
									<Square className="size-3 fill-current" />
								</Button>
							) : (
								<Button
									size="icon"
									className="size-8 rounded-full"
									title="Send"
									aria-label="Send"
									disabled={(!draft.trim() && images.length === 0) || status !== "connected"}
									onClick={send}
								>
									<Send />
								</Button>
							)}
						</div>
					</div>
					{Object.entries(extensionWidgets)
						.filter(([, widget]) => widget.placement === "belowEditor")
						.map(([key, widget]) => (
							<div
								key={key}
								className="mx-auto mt-2 max-w-3xl rounded-lg border bg-card px-3 py-2 text-xs text-muted-foreground"
							>
								{widget.lines.map((line, index) => (
									<p key={index}>{line}</p>
								))}
							</div>
						))}
				</div>

				{inspector ? (
					<aside className="col-start-2 row-span-3 row-start-1 min-h-0 border-l bg-card">
						<div className="flex h-[52px] items-center border-b px-4">
							<h2 className="text-sm font-medium capitalize">{inspector}</h2>
							{(inspector === "files" || inspector === "changes") && status === "connected" ? (
								<Button className="ml-auto mr-2" variant="ghost" size="sm" onClick={() => void refreshReview()}>
									Refresh
								</Button>
							) : null}
							{inspector === "approvals" && status === "connected" ? (
								<Button
									className="ml-auto mr-2"
									variant="ghost"
									size="sm"
									onClick={() => void refreshApprovals()}
								>
									Refresh
								</Button>
							) : null}
							{inspector === "context" && status === "connected" ? (
								<Button
									className="ml-auto mr-2"
									variant="ghost"
									size="sm"
									onClick={() => void refreshContext()}
								>
									Refresh
								</Button>
							) : null}
							{inspector === "workflows" && status === "connected" ? (
								<Button
									className="ml-auto mr-2"
									variant="ghost"
									size="sm"
									onClick={() => void refreshWorkflows()}
								>
									Refresh
								</Button>
							) : null}
							{inspector === "diagnostics" && status === "connected" ? (
								<Button
									className="ml-auto mr-2"
									variant="ghost"
									size="sm"
									onClick={() => void refreshSessionStats()}
								>
									Refresh
								</Button>
							) : null}
							{inspector === "collab" && status === "connected" ? (
								<Button
									className="ml-auto mr-2"
									variant="ghost"
									size="sm"
									onClick={() => void refreshCollabState()}
								>
									Refresh
								</Button>
							) : null}
							{inspector === "settings" && status === "connected" ? (
								<Button
									className="ml-auto mr-2"
									variant="ghost"
									size="sm"
									onClick={() => void refreshSettings()}
								>
									Refresh
								</Button>
							) : null}
							{inspector === "resources" && status === "connected" ? (
								<Button
									className="ml-auto mr-2"
									variant="ghost"
									size="sm"
									onClick={() => void refreshResources()}
								>
									Refresh
								</Button>
							) : null}
							<Button className="ml-auto" variant="ghost" size="sm" onClick={() => setInspector(undefined)}>
								Close
							</Button>
						</div>
						<div className="h-[calc(100%-52px)] text-sm leading-6 text-muted-foreground">
							{inspector === "tree" ? (
								<SessionTree
									tree={session?.tree ?? { nodes: [], leafId: null }}
									disabled={status !== "connected"}
									onNavigate={entryId => void runIntent({ type: "tree_navigate", entryId })}
									onFork={entryId => void runIntent({ type: "tree_fork", entryId })}
									onLabel={(entryId, label) =>
										void runIntent({ type: "tree_label", entryId, ...(label ? { label } : {}) })
									}
								/>
							) : inspector === "files" || inspector === "changes" ? (
								review ? (
									inspector === "files" ? (
										<FilesInspector review={review} projectPath={project ?? ""} onOpen={openPath} />
									) : (
										<ChangesInspector review={review} projectPath={project ?? ""} onOpen={openPath} />
									)
								) : (
									<div className="grid h-full place-items-center">
										<div className="flex items-center gap-2 text-xs">
											{reviewLoading ? <LoaderCircle className="animate-spin" /> : null}
											{reviewLoading ? "Reading workspace…" : "Workspace review unavailable"}
										</div>
									</div>
								)
							) : inspector === "approvals" ? (
								<ApprovalsInspector
									policies={approvalPolicies}
									loading={approvalsLoading}
									onPromote={policyKey => void promoteApprovalPolicy(policyKey)}
									onClear={(scope, policyKey) => void clearApprovalPolicy(scope, policyKey)}
								/>
							) : inspector === "context" ? (
								<ContextInspector
									context={contextState}
									jobs={asyncJobs}
									loading={contextLoading}
									onCompact={() => void runContextCommand({ type: "compact" })}
									onToggleAutoCompaction={enabled =>
										void runContextCommand({ type: "set_auto_compaction", enabled })
									}
									onToggleAutoRetry={enabled => void runContextCommand({ type: "set_auto_retry", enabled })}
									onAbortRetry={() => void runContextCommand({ type: "abort_retry" })}
									onAbortJob={jobId => void runContextCommand({ type: "abort_async_job", jobId })}
								/>
							) : inspector === "workflows" ? (
								<WorkflowsInspector
									workflow={workflowState}
									subagents={subagents}
									loading={workflowsLoading}
									onEnterPlan={workflowMode =>
										void runWorkflowCommand({ type: "enter_plan_mode", workflow: workflowMode })
									}
									onExitPlan={() => void runWorkflowCommand({ type: "exit_plan_mode" })}
									onGoalSet={(objective, tokenBudget) =>
										void runWorkflowCommand({ type: "goal_set", objective, tokenBudget })
									}
									onGoalPause={() => void runWorkflowCommand({ type: "goal_pause" })}
									onGoalResume={() => void runWorkflowCommand({ type: "goal_resume" })}
									onGoalDrop={() => void runWorkflowCommand({ type: "goal_drop" })}
									onGoalSetBudget={tokenBudget =>
										void runWorkflowCommand({ type: "goal_set_budget", tokenBudget })
									}
								/>
							) : inspector === "settings" ? (
								<SettingsInspector
									schema={settingsSchema}
									values={settingValues}
									loading={settingsLoading}
									onSet={(settingPath, scope, value) => void setSettingValue(settingPath, scope, value)}
									onReset={(settingPath, scope) => void resetSettingValue(settingPath, scope)}
								/>
							) : inspector === "resources" ? (
								<ResourcesInspector
									resources={resources}
									loading={resourcesLoading}
									onReload={() => void reloadResources()}
								/>
							) : inspector === "diagnostics" ? (
								<div className="space-y-4 p-4">
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
									<div>
										<dt className="text-xs">Session stats</dt>
										{sessionStatsLoading && !sessionStats ? (
											<dd className="mt-1 flex items-center gap-2 text-foreground">
												<LoaderCircle className="size-3 animate-spin" />
												Loading…
											</dd>
										) : sessionStats ? (
											<dd className="mt-1 space-y-1 text-foreground">
												<p>
													{sessionStats.userMessages} user · {sessionStats.assistantMessages} assistant ·{" "}
													{sessionStats.toolCalls} tool calls
												</p>
												<p>
													{sessionStats.tokens.total.toLocaleString()} tokens (
													{sessionStats.tokens.input.toLocaleString()} in /{" "}
													{sessionStats.tokens.output.toLocaleString()} out /{" "}
													{sessionStats.tokens.cacheRead.toLocaleString()} cache read)
												</p>
												<p>${sessionStats.cost.toFixed(4)}</p>
											</dd>
										) : (
											<dd className="mt-1 text-foreground">Not loaded.</dd>
										)}
									</div>
									<Button
										size="sm"
										variant="outline"
										className="h-7 text-[11px]"
										onClick={() => void handoffSession()}
									>
										Hand off session
									</Button>
								</div>
							) : inspector === "collab" ? (
								<CollabInspector
									collab={collabState}
									guest={collabGuestState}
									loading={collabLoading}
									relayUrl={collabRelayUrl}
									onRelayUrlChange={setCollabRelayUrl}
									onStart={() => void startCollab()}
									onStop={() => void stopCollab()}
									onOpenLink={openExternalUrl}
									joinLink={collabJoinLink}
									onJoinLinkChange={setCollabJoinLink}
									onJoin={() => void joinCollab()}
									onLeave={() => void leaveCollab()}
								/>
							) : (
								<p className="p-4 text-xs">
									This native workflow is part of the accepted Desktop Parity matrix.
								</p>
							)}
						</div>
					</aside>
				) : null}
			</section>

			{modelPickerOpen ? (
				<ModelPicker
					models={availableModels ?? []}
					loading={modelsLoading}
					current={session?.model}
					onSelect={model => void selectModel(model)}
					onClose={() => setModelPickerOpen(false)}
				/>
			) : null}

			{paletteOpen ? <CommandPalette actions={paletteActions} onClose={() => setPaletteOpen(false)} /> : null}

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
