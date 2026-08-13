import type { Dirent } from "node:fs";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as git from "../utils/git";
import type { WorkspaceReview } from "./application-types";

const MAX_CHANGE_ENTRIES = 500;
const MAX_DIFF_BYTES = 32_768;
const MAX_FILE_ENTRIES = 1000;
const DIFF_TRUNCATED_SUFFIX = "\n\n… (diff truncated)";

export interface WorkspaceReviewOptions {
	signal?: AbortSignal;
}

interface StatusEntry {
	path: string;
	staged: boolean;
	unstaged: boolean;
	untracked: boolean;
}

/**
 * Read-only Files/Changes projection for desktop hosts. Never mutates the
 * repository; all git subprocesses run with the central read-only wrappers and
 * every listing/diff is bounded so a huge working tree cannot stall the UI.
 */
export async function buildWorkspaceReview(
	cwd: string,
	options: WorkspaceReviewOptions = {},
): Promise<WorkspaceReview> {
	const signal = options.signal;
	const statusResult = await readStatusEntries(cwd, signal);
	const repository = statusResult ? await readRepositoryInfo(cwd, signal) : undefined;
	const summary = statusResult
		? ((await readStatusSummary(cwd, signal)) ?? { staged: 0, unstaged: 0, untracked: 0 })
		: { staged: 0, unstaged: 0, untracked: 0 };
	const statusEntries = statusResult ?? [];
	const entries = statusEntries.slice(0, MAX_CHANGE_ENTRIES);
	const diffs = await readTrackedDiffs(cwd, signal);

	const changes = entries.map(entry => ({
		...entry,
		diff: boundText(diffs.get(entry.path) ?? ""),
	}));
	const files = await listWorkspaceFiles(cwd);

	return {
		...(repository ? { repository } : {}),
		changes: {
			summary,
			entries: changes,
			truncated: statusEntries.length > MAX_CHANGE_ENTRIES,
		},
		files: files.entries,
		filesTruncated: files.truncated,
	};
}

async function readRepositoryInfo(
	cwd: string,
	signal: AbortSignal | undefined,
): Promise<{ root: string; branch?: string } | undefined> {
	try {
		const root = await git.repo.root(cwd, signal);
		if (!root) return undefined;
		const headState = await git.head.resolve(cwd, signal);
		const branch = headState?.kind === "ref" && headState.branchName ? headState.branchName : undefined;
		return { root, ...(branch ? { branch } : {}) };
	} catch {
		return undefined;
	}
}

async function readStatusSummary(
	cwd: string,
	signal: AbortSignal | undefined,
): Promise<{ staged: number; unstaged: number; untracked: number } | null> {
	try {
		return await git.status.summary(cwd, signal);
	} catch {
		return null;
	}
}

async function readStatusEntries(cwd: string, signal: AbortSignal | undefined): Promise<StatusEntry[] | null> {
	let text: string;
	try {
		text = await git.status(cwd, { porcelainV1: true, untrackedFiles: "all", signal });
	} catch {
		return null;
	}

	const entries: StatusEntry[] = [];
	for (const line of text.split("\n")) {
		if (line.length < 3) continue;
		const stagedColumn = line[0] ?? " ";
		const unstagedColumn = line[1] ?? " ";
		const untracked = stagedColumn === "?" && unstagedColumn === "?";
		const rawPath = line.slice(3);
		const separator = rawPath.lastIndexOf(" -> ");
		const entryPath = separator >= 0 ? rawPath.slice(separator + 4) : rawPath;
		if (!entryPath) continue;
		entries.push({
			path: entryPath,
			staged: stagedColumn !== " " && stagedColumn !== "?",
			unstaged: unstagedColumn !== " " && unstagedColumn !== "?",
			untracked,
		});
	}
	return entries;
}

async function readTrackedDiffs(cwd: string, signal: AbortSignal | undefined): Promise<Map<string, string>> {
	const diffs = new Map<string, string>();
	try {
		const [unstaged, staged] = await Promise.all([
			git.diff(cwd, { allowFailure: true, signal }),
			git.diff(cwd, { cached: true, allowFailure: true, signal }),
		]);
		for (const file of git.diff.parseFiles(unstaged)) {
			if (file.content) diffs.set(file.filename, file.content);
		}
		for (const file of git.diff.parseFiles(staged)) {
			const current = diffs.get(file.filename) ?? "";
			diffs.set(file.filename, current ? `${current}\n${file.content}` : file.content);
		}
	} catch {
		// Review is best-effort: a missing git binary or unreadable index must not
		// break the desktop presentation.
	}
	return diffs;
}

async function listWorkspaceFiles(root: string): Promise<{ entries: WorkspaceReview["files"]; truncated: boolean }> {
	const entries: WorkspaceReview["files"] = [];
	let truncated = false;
	const stack: string[] = ["."];

	while (stack.length > 0 && entries.length < MAX_FILE_ENTRIES) {
		const relativeDir = stack.pop();
		if (relativeDir === undefined) break;
		const absoluteDir = path.resolve(root, relativeDir);
		let children: Dirent[];
		try {
			children = await fs.readdir(absoluteDir, { withFileTypes: true });
		} catch {
			continue;
		}
		children.sort((left, right) => left.name.localeCompare(right.name));
		const directories: string[] = [];
		for (const child of children) {
			if (entries.length >= MAX_FILE_ENTRIES) {
				truncated = true;
				break;
			}
			if (child.name === ".git") continue;
			const relative = relativeDir === "." ? child.name : `${relativeDir}/${child.name}`;
			if (child.isDirectory()) {
				entries.push({ path: relative, kind: "directory" });
				directories.push(relative);
			} else if (child.isFile() || child.isSymbolicLink()) {
				entries.push({ path: relative, kind: "file" });
			}
		}
		for (let index = directories.length - 1; index >= 0; index--) stack.push(directories[index]);
	}

	return { entries, truncated: truncated || stack.length > 0 };
}

function boundText(text: string): string {
	if (text.length <= MAX_DIFF_BYTES) return text;
	return `${text.slice(0, MAX_DIFF_BYTES)}${DIFF_TRUNCATED_SUFFIX}`;
}
