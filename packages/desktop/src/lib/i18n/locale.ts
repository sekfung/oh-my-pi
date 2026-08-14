/**
 * Desktop-only localisation. The sidecar's settings schema stays English — its
 * strings are translated by an overlay keyed on setting path (see `settings.ts`)
 * so the shared schema, which the terminal UI also consumes, is left untouched.
 */

export const LOCALES = [
	{ id: "en", label: "English" },
	{ id: "zh-CN", label: "简体中文" },
] as const;

export type Locale = (typeof LOCALES)[number]["id"];

export const LOCALE_KEY = "omp.desktop.locale";

export const DEFAULT_LOCALE: Locale = "en";

/** A stored choice wins; otherwise follow the browser/system language. */
export function resolveInitialLocale(): Locale {
	const stored = localStorage.getItem(LOCALE_KEY);
	if (stored && LOCALES.some(locale => locale.id === stored)) return stored as Locale;
	return navigator.language.toLowerCase().startsWith("zh") ? "zh-CN" : DEFAULT_LOCALE;
}
