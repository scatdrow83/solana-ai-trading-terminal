"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { messages, translate } from "./i18n";

const LocaleContext = createContext(null);
const STORAGE_KEY = "solana-terminal-locale";

export function LocaleProvider({ children }) {
  const [locale, setLocaleState] = useState("en");

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(STORAGE_KEY);
      if (stored === "en" || stored === "pl") setLocaleState(stored);
    } catch (error) {
      console.error("Could not load the saved language preference", error);
    }
  }, []);

  useEffect(() => {
    document.documentElement.lang = locale;
    try {
      window.localStorage.setItem(STORAGE_KEY, locale);
    } catch (error) {
      console.error("Could not save the language preference", error);
    }
  }, [locale]);

  const setLocale = useCallback((nextLocale) => {
    if (nextLocale === "en" || nextLocale === "pl") setLocaleState(nextLocale);
  }, []);
  const t = useCallback((key, values) => translate(locale, key, values), [locale]);
  const value = useMemo(
    () => ({ locale, setLocale, t, availableLocales: Object.keys(messages) }),
    [locale, setLocale, t]
  );
  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

export function useLocale() {
  const context = useContext(LocaleContext);
  if (!context) throw new Error("useLocale must be used inside LocaleProvider");
  return context;
}
