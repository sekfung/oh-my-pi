/**
 * Translation lookups for the sidecar's settings schema.
 *
 * The schema (`packages/coding-agent/src/config/settings-schema.ts`) is shared
 * with the terminal UI and stays English. The desktop translates it through the
 * `schema` section of `src/locales/<locale>.json`; anything missing falls back
 * to the string the sidecar sent, so partial coverage degrades to mixed
 * language rather than blank labels.
 *
 * Product names (Mnemopi, Hindsight, Codex, MCP, LSP, …) are deliberately left
 * untranslated — they are identifiers users match against docs and config keys.
 */
import type { Locale } from "@/lib/i18n/locale";
import { schemaEntry, schemaGroup } from "@/lib/i18n/messages";

export function settingLabel(locale: Locale, path: string, fallback: string): string {
	return schemaEntry(locale, path)?.label || fallback;
}

export function settingDescription(locale: Locale, path: string, fallback: string): string {
	return schemaEntry(locale, path)?.description || fallback;
}

export function settingGroup(locale: Locale, group: string): string {
	return schemaGroup(locale, group) || group;
}
