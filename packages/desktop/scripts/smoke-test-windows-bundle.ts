#!/usr/bin/env bun
/**
 * Structural smoke test for the Windows installer bundles produced by
 * `tauri build` (.msi, NSIS .exe). Does not run the installer; verifies each
 * package is well-formed instead: non-trivial file size, a valid PE header on
 * the NSIS installer, and (when `7z` is available) the main binary and
 * bundled sidecar are present inside the archive contents.
 *
 * Usage: bun run packages/desktop/scripts/smoke-test-windows-bundle.ts
 */
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { $ } from "bun";

const repoRoot = path.join(import.meta.dir, "..", "..", "..");
const bundleDir = path.join(repoRoot, "target", "release", "bundle");

let failures = 0;

function fail(message: string): void {
	failures++;
	console.error(`✗ ${message}`);
}

function ok(message: string): void {
	console.log(`✓ ${message}`);
}

async function findBundle(subdir: string, suffix: string): Promise<string | undefined> {
	const dir = path.join(bundleDir, subdir);
	const entries = await fs.readdir(dir).catch(() => [] as string[]);
	const name = entries.find(entry => entry.endsWith(suffix));
	return name ? path.join(dir, name) : undefined;
}

async function checkContentsWith7z(archivePath: string, label: string): Promise<void> {
	const sevenZip = await $`where 7z`.quiet().nothrow();
	if (sevenZip.exitCode !== 0) {
		console.log(`… \`7z\` unavailable, skipping ${label} content listing`);
		return;
	}
	const listing = await $`7z l ${archivePath}`.text().catch(() => "");
	if (listing.includes("omp-desktop.exe")) ok(`${label}: main binary present in archive contents`);
	else fail(`${label}: main binary not found in archive contents`);
	if (listing.includes("omp-desktop-sidecar.exe")) ok(`${label}: sidecar binary present in archive contents`);
	else fail(`${label}: sidecar binary not found in archive contents`);
}

async function checkMsi(): Promise<void> {
	const msiPath = await findBundle("msi", ".msi");
	if (!msiPath) {
		console.log("… no .msi bundle found, skipping");
		return;
	}
	const file = Bun.file(msiPath);
	if ((await file.exists()) && (await file.size) > 1_000_000) ok("msi: bundle file present and non-trivial size");
	else fail("msi: bundle file missing or too small");
	await checkContentsWith7z(msiPath, "msi");
}

async function checkNsis(): Promise<void> {
	const exePath = await findBundle("nsis", "-setup.exe");
	if (!exePath) {
		console.log("… no NSIS installer found, skipping");
		return;
	}
	const file = Bun.file(exePath);
	const bytes = new Uint8Array(await file.slice(0, 64).arrayBuffer());
	const isMz = bytes[0] === 0x4d && bytes[1] === 0x5a; // "MZ"
	if (isMz) ok("nsis: MZ (PE) header present");
	else fail("nsis: missing MZ header — not a valid PE executable");
	if ((await file.exists()) && (await file.size) > 1_000_000) ok("nsis: bundle file present and non-trivial size");
	else fail("nsis: bundle file missing or too small");
	await checkContentsWith7z(exePath, "nsis");
}

await checkMsi();
await checkNsis();

if (failures > 0) {
	console.error(`\n${failures} smoke check(s) failed.`);
	process.exit(1);
}
console.log("\nAll Windows bundle smoke checks passed.");
