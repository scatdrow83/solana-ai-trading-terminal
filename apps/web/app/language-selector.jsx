"use client";

import { useLocale } from "./locale-provider";

export default function LanguageSelector({ compact = false }) {
  const { locale, setLocale, t } = useLocale();
  return (
    <label className={`language-selector ${compact ? "is-compact" : ""}`}>
      <span>{t("language.label")}</span>
      <select
        aria-label={t("language.label")}
        value={locale}
        onChange={(event) => setLocale(event.target.value)}
      >
        <option value="en">{t("language.english")}</option>
        <option value="pl">{t("language.polish")}</option>
      </select>
    </label>
  );
}
