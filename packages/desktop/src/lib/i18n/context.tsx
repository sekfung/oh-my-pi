import { createContext, type ReactNode, use, useCallback, useMemo, useState } from "react";
import { DEFAULT_LOCALE, LOCALE_KEY, type Locale, resolveInitialLocale } from "@/lib/i18n/locale";
import { type MessageKey, message } from "@/lib/i18n/messages";

export type Translate = (key: MessageKey) => string;

interface LocaleContextValue {
	locale: Locale;
	setLocale(locale: Locale): void;
	t: Translate;
}

const LocaleContext = createContext<LocaleContextValue | undefined>(undefined);

export function LocaleProvider({ children }: { children: ReactNode }) {
	const [locale, setLocaleState] = useState<Locale>(resolveInitialLocale);

	const setLocale = useCallback((next: Locale) => {
		setLocaleState(next);
		localStorage.setItem(LOCALE_KEY, next);
		document.documentElement.lang = next;
	}, []);

	/** Falls back to English so a missing string never renders as a bare key. */
	const t = useCallback<Translate>(key => message(locale, key) ?? message(DEFAULT_LOCALE, key) ?? key, [locale]);

	const value = useMemo(() => ({ locale, setLocale, t }), [locale, setLocale, t]);
	return <LocaleContext value={value}>{children}</LocaleContext>;
}

export function useLocale(): LocaleContextValue {
	const value = use(LocaleContext);
	if (!value) throw new Error("useLocale must be used within a LocaleProvider");
	return value;
}

export function useT(): Translate {
	return useLocale().t;
}
