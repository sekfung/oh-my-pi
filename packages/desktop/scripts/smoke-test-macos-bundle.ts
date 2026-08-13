#!/usr/bin/env bun
/**
 * Structural smoke test for the macOS installer bundles produced by
 * `tauri build` (.app, .dmg). Does not launch the GUI; verifies each package
 * is well-formed instead: the main binary and bundled sidecar are present
 * inside the .app with the executable bit set, Info.plist exists, and the
 * .dmg is a well-formed disk image per `hdiutil`.
 *
 * Usage: bun run packages/desktop/scripts/smoke-test-macos-bundle.ts
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

async function isExecutable(filePath: string): Promise<boolean> {
	try {
		const stat = await fs.stat(filePath);
		return stat.isFile() && (stat.mode & 0o111) !== 0;
	} catch {
		return false;
	}
}

async function checkApp(): Promise<void> {
	const macosDir = path.join(bundleDir, "macos");
	const entries = await fs.readdir(macosDir).catch(() => [] as string[]);
	const appName = entries.find(entry => entry.endsWith(".app"));
	if (!appName) {
		console.log("… no .app bundle found, skipping");
		return;
	}
	const appPath = path.join(macosDir, appName);
	const mainBinary = path.join(appPath, "Contents", "MacOS", "omp-desktop");
	const sidecarBinary = path.join(appPath, "Contents", "MacOS", "omp-desktop-sidecar");
	const infoPlist = path.join(appPath, "Contents", "Info.plist");

	if (await isExecutable(mainBinary)) ok("app: main binary present and executable");
	else fail(`app: main binary missing or not executable (${mainBinary})`);

	if (await isExecutable(sidecarBinary)) ok("app: sidecar binary present and executable");
	else fail(`app: sidecar binary missing or not executable (${sidecarBinary})`);

	if (await Bun.file(infoPlist).exists()) ok("app: Info.plist present");
	else fail("app: Info.plist missing");
}

async function checkDmg(): Promise<void> {
	const dmgDir = path.join(bundleDir, "dmg");
	const entries = await fs.readdir(dmgDir).catch(() => [] as string[]);
	const dmgName = entries.find(entry => entry.endsWith(".dmg"));
	if (!dmgName) {
		console.log("… no .dmg bundle found, skipping");
		return;
	}
	const dmgPath = path.join(dmgDir, dmgName);
	const file = Bun.file(dmgPath);
	if ((await file.exists()) && (await file.size) > 1_000_000) ok("dmg: bundle file present and non-trivial size");
	else fail("dmg: bundle file missing or too small");

	const hdiutil = await $`which hdiutil`.quiet().nothrow();
	if (hdiutil.exitCode !== 0) {
		console.log("… `hdiutil` unavailable, skipping disk-image validation");
		return;
	}
	const info = await $`hdiutil imageinfo ${dmgPath}`.quiet().nothrow();
	if (info.exitCode === 0) ok("dmg: valid disk image per hdiutil");
	else fail("dmg: hdiutil could not read the disk image");
}

await checkApp();
await checkDmg();

if (failures > 0) {
	console.error(`\n${failures} smoke check(s) failed.`);
	process.exit(1);
}
console.log("\nAll macOS bundle smoke checks passed.");
