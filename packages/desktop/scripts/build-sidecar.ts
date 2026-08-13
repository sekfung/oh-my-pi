#!/usr/bin/env bun

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { $ } from "bun";

const packageDir = path.join(import.meta.dir, "..");
const codingAgentDir = path.join(packageDir, "..", "coding-agent");
const binariesDir = path.join(packageDir, "src-tauri", "binaries");

async function targetTriple(): Promise<string> {
	if (Bun.env.TAURI_ENV_TARGET_TRIPLE) return Bun.env.TAURI_ENV_TARGET_TRIPLE;
	const result = await $`rustc -vV`.quiet().nothrow();
	if (result.exitCode !== 0) throw new Error("Unable to determine the Rust target triple");
	const host = /^host:\s*(.+)$/m.exec(result.text())?.[1];
	if (!host) throw new Error("rustc did not report a host target triple");
	return host;
}

async function buildSource(): Promise<string> {
	const override = Bun.env.OMP_DESKTOP_SIDECAR;
	if (override) {
		const file = Bun.file(override);
		if (!(await file.exists())) throw new Error(`OMP_DESKTOP_SIDECAR does not exist: ${override}`);
		return path.resolve(override);
	}
	const result = await $`bun run build`.cwd(codingAgentDir).nothrow();
	if (result.exitCode !== 0) throw new Error("Unable to build the Oh My Pi desktop sidecar");
	return path.join(codingAgentDir, "dist", process.platform === "win32" ? "omp.exe" : "omp");
}

const triple = await targetTriple();
const source = await buildSource();
const extension = triple.includes("windows") ? ".exe" : "";
const destination = path.join(binariesDir, `omp-desktop-sidecar-${triple}${extension}`);
await fs.mkdir(binariesDir, { recursive: true });
await Bun.write(destination, Bun.file(source));
if (!extension) await fs.chmod(destination, 0o755);
