import { describe, expect, test } from "bun:test";
import * as path from "node:path";
import { TempDir } from "@oh-my-pi/pi-utils";
import { $ } from "bun";
import { buildWorkspaceReview } from "../src/application/workspace-review";

async function initRepo(dir: string): Promise<void> {
	await $`git init --initial-branch=main`.cwd(dir).quiet().nothrow();
	await $`git config user.email fixture@example.invalid`.cwd(dir).quiet().nothrow();
	await $`git config user.name Fixture`.cwd(dir).quiet().nothrow();
}

describe("buildWorkspaceReview", () => {
	test("projects real staged, unstaged, and untracked changes with bounded diffs and files", async () => {
		using tempDir = TempDir.createSync("@omp-review-");
		const root = tempDir.path();
		await initRepo(root);
		await Bun.write(path.join(root, "tracked.txt"), "one\n");
		await $`git add -A`.cwd(root).quiet().nothrow();
		await $`git commit -m baseline`.cwd(root).quiet().nothrow();

		await Bun.write(path.join(root, "tracked.txt"), "two\n");
		await Bun.write(path.join(root, "staged.txt"), "staged\n");
		await $`git add staged.txt`.cwd(root).quiet().nothrow();
		await Bun.write(path.join(root, "untracked.txt"), "untracked\n");
		await Bun.write(path.join(root, "subdir", "note.txt"), "note\n");

		const review = await buildWorkspaceReview(root);

		expect(review.repository).toEqual({ root, branch: "main" });
		expect(review.changes.summary).toEqual({ staged: 1, unstaged: 1, untracked: 2 });
		expect(review.changes.truncated).toBe(false);

		const tracked = review.changes.entries.find(entry => entry.path === "tracked.txt");
		expect(tracked).toMatchObject({ staged: false, unstaged: true, untracked: false });
		expect(tracked?.diff).toContain("+two");

		const staged = review.changes.entries.find(entry => entry.path === "staged.txt");
		expect(staged).toMatchObject({ staged: true, unstaged: false, untracked: false });
		expect(staged?.diff).toContain("+staged");

		const untracked = review.changes.entries.find(entry => entry.path === "untracked.txt");
		expect(untracked).toMatchObject({ staged: false, unstaged: false, untracked: true });

		expect(review.files).toContainEqual({ path: "tracked.txt", kind: "file" });
		expect(review.files).toContainEqual({ path: "staged.txt", kind: "file" });
		expect(review.files).toContainEqual({ path: "untracked.txt", kind: "file" });
		expect(review.files).toContainEqual({ path: "subdir", kind: "directory" });
		expect(review.files).toContainEqual({ path: "subdir/note.txt", kind: "file" });
		expect(review.files.some(entry => entry.path.startsWith(".git"))).toBe(false);
	});

	test("degrades to an empty change set outside a repository while still listing files", async () => {
		using tempDir = TempDir.createSync("@omp-review-norepo-");
		await Bun.write(path.join(tempDir.path(), "plain.txt"), "plain\n");

		const review = await buildWorkspaceReview(tempDir.path());

		expect(review.repository).toBeUndefined();
		expect(review.changes).toEqual({
			summary: { staged: 0, unstaged: 0, untracked: 0 },
			entries: [],
			truncated: false,
		});
		expect(review.files).toContainEqual({ path: "plain.txt", kind: "file" });
	});
});
