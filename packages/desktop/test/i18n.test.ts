import { describe, expect, test } from "bun:test";
import { LOCALES } from "../src/lib/i18n/locale";
import { message, schemaEntry, schemaGroup } from "../src/lib/i18n/messages";
import { settingDescription, settingGroup, settingLabel } from "../src/lib/i18n/settings";
import en from "../src/locales/en.json";
import zhCN from "../src/locales/zh-CN.json";

/** Every dot path addressing a string leaf, so catalogues can be compared key-for-key. */
function leafPaths(value: unknown, prefix = ""): string[] {
	if (typeof value === "string") return [prefix];
	if (!value || typeof value !== "object") return [];
	return Object.entries(value).flatMap(([key, child]) => leafPaths(child, prefix ? `${prefix}.${key}` : key));
}

describe("locale catalogues", () => {
	test("every locale in LOCALES has a catalogue", () => {
		expect(LOCALES.map(locale => locale.id).sort()).toEqual(["en", "zh-CN"]);
	});

	test("zh-CN covers exactly the keys English defines", () => {
		expect(leafPaths(zhCN).sort()).toEqual(leafPaths(en).sort());
	});

	test("no catalogue value is left empty", () => {
		for (const [name, doc] of [
			["en", en],
			["zh-CN", zhCN],
		] as const) {
			const blank = leafPaths(doc).filter(path => {
				const value = path.split(".").reduce<unknown>((node, key) => (node as Record<string, unknown>)?.[key], doc);
				return typeof value === "string" && value.trim() === "";
			});
			expect(`${name}: ${blank.join(", ")}`).toBe(`${name}: `);
		}
	});

	test("every schema setting carries both a label and a description", () => {
		for (const [path, entry] of Object.entries(zhCN.schema.paths)) {
			expect(entry.label, `${path} label`).toBeTruthy();
			expect(entry.description, `${path} description`).toBeTruthy();
		}
	});

	test("Chinese settings actually differ from English", () => {
		// Guards against a catalogue regenerated from the wrong source.
		const translated = Object.entries(zhCN.schema.paths).filter(
			([path, entry]) =>
				entry.description !== (en.schema.paths as Record<string, { description: string }>)[path]?.description,
		);
		expect(translated.length).toBe(Object.keys(en.schema.paths).length);
	});
});

describe("lookups", () => {
	test("message resolves nested dot paths", () => {
		expect(message("en", "settings.tab.appearance")).toBe("Appearance");
		expect(message("zh-CN", "settings.tab.appearance")).toBe("外观");
	});

	test("schema lookups resolve by setting path and group name", () => {
		expect(schemaEntry("zh-CN", "theme.dark")?.label).toBe("深色主题");
		expect(schemaGroup("zh-CN", "Status Line")).toBe("状态栏");
	});

	test("unknown keys fall back to the sidecar's own string", () => {
		expect(settingLabel("zh-CN", "not.a.real.setting", "Fallback")).toBe("Fallback");
		expect(settingDescription("zh-CN", "not.a.real.setting", "Fallback")).toBe("Fallback");
		expect(settingGroup("zh-CN", "Unknown Group")).toBe("Unknown Group");
	});
});
