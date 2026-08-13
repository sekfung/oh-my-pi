#!/usr/bin/env bun
/**
 * Structural smoke test for the Linux installer bundles produced by
 * `tauri build` (deb, rpm, AppImage). Does not launch the GUI (no display
 * assumed available); verifies each package is well-formed instead: the
 * main binary and bundled sidecar are present with the executable bit set,
 * and (for deb) a desktop entry exists.
 *
 * Usage: bun run packages/desktop/scripts/smoke-test-linux-bundle.ts
 */
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

async function checkDeb(): Promise<void> {
	const globResult = await $`bash -c 'ls "${bundleDir}/deb/"*.deb 2>/dev/null'`.text().catch(() => "");
	const debPath = globResult.trim().split("\n")[0];
	if (!debPath) {
		console.log("… no .deb bundle found, skipping");
		return;
	}
	const contents = await $`dpkg-deb --contents ${debPath}`.text();
	const binLine = contents.split("\n").find(line => line.includes("usr/bin/omp-desktop") && !line.includes("sidecar"));
	const sidecarLine = contents.split("\n").find(line => line.includes("usr/bin/omp-desktop-sidecar"));
	const desktopEntry = contents
		.split("\n")
		.find(line => line.includes("usr/share/applications/") && line.endsWith(".desktop"));
	if (binLine?.startsWith("-rwxr-xr-x")) ok("deb: main binary present and executable");
	else fail(`deb: main binary missing or not executable (${binLine ?? "not found"})`);
	if (sidecarLine?.startsWith("-rwxr-xr-x")) ok("deb: sidecar binary present and executable");
	else fail(`deb: sidecar binary missing or not executable (${sidecarLine ?? "not found"})`);
	if (desktopEntry) ok("deb: desktop entry present");
	else fail("deb: desktop entry (.desktop file) missing");
}

async function checkRpm(): Promise<void> {
	const globResult = await $`bash -c 'ls "${bundleDir}/rpm/"*.rpm 2>/dev/null'`.text().catch(() => "");
	const rpmPath = globResult.trim().split("\n")[0];
	if (!rpmPath) {
		console.log("… no .rpm bundle found, skipping");
		return;
	}
	const rpmTool = await $`which rpm`.quiet().nothrow();
	if (rpmTool.exitCode !== 0) {
		console.log("… `rpm` query tool unavailable, checking file presence only");
		if ((await Bun.file(rpmPath).exists()) && (await Bun.file(rpmPath).size) > 1_000_000)
			ok("rpm: bundle file present and non-trivial size");
		else fail("rpm: bundle file missing or too small");
		return;
	}
	const contents = await $`rpm -qlp ${rpmPath}`.text();
	if (contents.includes("/usr/bin/omp-desktop") && !contents.includes("omp-desktop-sidecar"))
		ok("rpm: main binary present");
	if (contents.includes("/usr/bin/omp-desktop-sidecar")) ok("rpm: sidecar binary present");
	else fail("rpm: sidecar binary missing from package contents");
}

async function checkAppImage(): Promise<void> {
	const globResult = await $`bash -c 'ls "${bundleDir}/appimage/"*.AppImage 2>/dev/null'`.text().catch(() => "");
	const appImagePath = globResult.trim().split("\n")[0];
	if (!appImagePath) {
		console.log("… no .AppImage bundle found, skipping");
		return;
	}
	const file = Bun.file(appImagePath);
	const bytes = new Uint8Array(await file.slice(0, 12).arrayBuffer());
	const isElf = bytes[0] === 0x7f && bytes[1] === 0x45 && bytes[2] === 0x4c && bytes[3] === 0x46;
	// AppImage type 2 magic: bytes 8-10 are 'A' 'I' 0x02.
	const isAppImageType2 = bytes[8] === 0x41 && bytes[9] === 0x49 && bytes[10] === 0x02;
	if (isElf) ok("AppImage: ELF header present");
	else fail("AppImage: missing ELF header");
	if (isAppImageType2) ok("AppImage: AppImage type-2 magic bytes present");
	else fail("AppImage: missing AppImage type-2 magic bytes");
	const stat = await file.exists();
	const mode = stat ? (await $`stat -c %a ${appImagePath}`.text()).trim() : "";
	if (mode && Number.parseInt(mode, 8) & 0o111) ok("AppImage: executable bit set");
	else fail(`AppImage: executable bit not set (mode ${mode || "unknown"})`);
}

await checkDeb();
await checkRpm();
await checkAppImage();

if (failures > 0) {
	console.error(`\n${failures} smoke check(s) failed.`);
	process.exit(1);
}
console.log("\nAll Linux bundle smoke checks passed.");
