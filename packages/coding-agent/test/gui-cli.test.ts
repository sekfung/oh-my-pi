import { describe, expect, test } from "bun:test";
import { type DesktopExecutableLookup, resolveDesktopExecutable } from "@oh-my-pi/pi-coding-agent/cli/gui-cli";

function lookup(overrides: Partial<DesktopExecutableLookup> = {}): DesktopExecutableLookup {
	return {
		platform: "linux",
		env: {},
		executablePath: "/opt/omp/omp",
		homeDirectory: "/home/tester",
		which: () => null,
		isExecutable: async () => false,
		...overrides,
	};
}

describe("desktop executable resolution", () => {
	test("honors an explicit executable only after validating it", async () => {
		const checks: string[] = [];
		const resolved = await resolveDesktopExecutable(
			lookup({
				env: { OMP_DESKTOP_BINARY: "/opt/omp/desktop" },
				isExecutable: async candidate => {
					checks.push(candidate);
					return true;
				},
			}),
		);
		expect(resolved).toBe("/opt/omp/desktop");
		expect(checks).toEqual(["/opt/omp/desktop"]);
	});

	test("prefers the desktop executable available on PATH", async () => {
		const resolved = await resolveDesktopExecutable(lookup({ which: () => "/usr/local/bin/omp-desktop" }));
		expect(resolved).toBe("/usr/local/bin/omp-desktop");
	});

	test("finds a standard per-user installation when PATH has no launcher", async () => {
		const expected = "/home/tester/.local/bin/omp-desktop";
		const resolved = await resolveDesktopExecutable(
			lookup({ isExecutable: async candidate => candidate === expected }),
		);
		expect(resolved).toBe(expected);
	});

	test("fails explicitly when an override is not executable", async () => {
		expect(resolveDesktopExecutable(lookup({ env: { OMP_DESKTOP_BINARY: "/missing/desktop" } }))).rejects.toThrow(
			"OMP_DESKTOP_BINARY is not executable",
		);
	});
});
