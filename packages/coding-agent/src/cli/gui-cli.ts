import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { $which } from "@oh-my-pi/pi-utils";

export interface GuiCommandArgs {
	project?: string;
}

export interface DesktopExecutableLookup {
	platform: NodeJS.Platform;
	env: NodeJS.ProcessEnv;
	executablePath: string;
	homeDirectory: string;
	which(command: string): string | null;
	isExecutable(candidate: string): Promise<boolean>;
}

function defaultLookup(): DesktopExecutableLookup {
	return {
		platform: process.platform,
		env: process.env,
		executablePath: process.execPath,
		homeDirectory: os.homedir(),
		which: $which,
		async isExecutable(candidate) {
			try {
				await fs.access(candidate, process.platform === "win32" ? fs.constants.F_OK : fs.constants.X_OK);
				return true;
			} catch {
				return false;
			}
		},
	};
}

function desktopCandidates(lookup: DesktopExecutableLookup): string[] {
	const executableDirectory = path.dirname(lookup.executablePath);
	if (lookup.platform === "darwin") {
		return [
			path.join(executableDirectory, "Oh My Pi"),
			path.join(lookup.homeDirectory, "Applications", "Oh My Pi.app", "Contents", "MacOS", "Oh My Pi"),
			path.join("/Applications", "Oh My Pi.app", "Contents", "MacOS", "Oh My Pi"),
		];
	}
	if (lookup.platform === "win32") {
		return [
			path.join(executableDirectory, "omp-desktop.exe"),
			...(lookup.env.LOCALAPPDATA ? [path.join(lookup.env.LOCALAPPDATA, "Oh My Pi", "Oh My Pi.exe")] : []),
		];
	}
	return [
		path.join(executableDirectory, "omp-desktop"),
		path.join(lookup.homeDirectory, ".local", "bin", "omp-desktop"),
		"/usr/local/bin/omp-desktop",
		"/usr/bin/omp-desktop",
	];
}

/** Resolve an installed desktop executable without treating the CLI itself as the application. */
export async function resolveDesktopExecutable(
	lookup: DesktopExecutableLookup = defaultLookup(),
): Promise<string | undefined> {
	const override = lookup.env.OMP_DESKTOP_BINARY;
	if (override) {
		if (!(await lookup.isExecutable(override))) {
			throw new Error(`OMP_DESKTOP_BINARY is not executable: ${override}`);
		}
		return override;
	}

	const fromPath = lookup.which(lookup.platform === "win32" ? "omp-desktop.exe" : "omp-desktop");
	if (fromPath) return fromPath;
	for (const candidate of desktopCandidates(lookup)) {
		if (candidate !== lookup.executablePath && (await lookup.isExecutable(candidate))) return candidate;
	}
	return undefined;
}

export async function runGuiCommand(args: GuiCommandArgs): Promise<void> {
	const executable = await resolveDesktopExecutable();
	if (!executable) {
		throw new Error(
			"Oh My Pi Desktop is not installed. Install the desktop application or set OMP_DESKTOP_BINARY to its executable.",
		);
	}
	const project = args.project ? path.resolve(args.project) : undefined;
	const child = Bun.spawn([executable, ...(project ? ["--project", project] : [])], {
		stdin: "ignore",
		stdout: "ignore",
		stderr: "ignore",
	});
	child.unref();
}
