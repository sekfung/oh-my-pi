import type { Locale } from "@/lib/i18n/locale";
import en from "@/locales/en.json";
import zhCN from "@/locales/zh-CN.json";

/**
 * Locale catalogues live as JSON under `src/locales/`, one file per language.
 *
 * - UI strings nest by area (`settings.tab.appearance`) and are addressed with
 *   dot paths through `t()`.
 * - `schema.*` translates the sidecar's settings schema, which stays English
 *   because the terminal UI shares it. Its `paths` keys are setting identifiers
 *   (`theme.dark`), so they stay flat rather than nesting.
 *
 * English is the source of truth: `MessageKey` is derived from `en.json`, so a
 * key that only exists in a translation — or a missing one — fails typecheck.
 */
export type LocaleDocument = typeof en;

type UiMessages = Omit<LocaleDocument, "schema">;

/** Every dot path that addresses a string leaf, e.g. `settings.tab.appearance`. */
type LeafPaths<T> = {
	[K in keyof T & string]: T[K] extends string ? K : `${K}.${LeafPaths<T[K]>}`;
}[keyof T & string];

export type MessageKey = LeafPaths<UiMessages>;

export interface SchemaEntry {
	label: string;
	description: string;
}

const DOCUMENTS: Record<Locale, LocaleDocument> = { en, "zh-CN": zhCN };

/** Dot-path lookup table built once per locale, so `t()` stays a map read. */
function flatten(value: unknown, prefix: string, out: Map<string, string>): void {
	if (typeof value === "string") {
		out.set(prefix, value);
		return;
	}
	if (!value || typeof value !== "object") return;
	for (const [key, child] of Object.entries(value)) {
		flatten(child, prefix ? `${prefix}.${key}` : key, out);
	}
}

const FLAT_UI = new Map<Locale, Map<string, string>>();
for (const [locale, document] of Object.entries(DOCUMENTS) as Array<[Locale, LocaleDocument]>) {
	const table = new Map<string, string>();
	const { schema: _schema, ...ui } = document;
	flatten(ui, "", table);
	FLAT_UI.set(locale, table);
}

export function message(locale: Locale, key: MessageKey): string | undefined {
	return FLAT_UI.get(locale)?.get(key);
}

export function schemaEntry(locale: Locale, path: string): SchemaEntry | undefined {
	return (DOCUMENTS[locale].schema.paths as Record<string, SchemaEntry | undefined>)[path];
}

export function schemaGroup(locale: Locale, group: string): string | undefined {
	return (DOCUMENTS[locale].schema.groups as Record<string, string | undefined>)[group];
}
