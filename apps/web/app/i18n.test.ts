import { describe, expect, it } from "vitest";
import { messages, translate, type Locale, type MessageKey } from "./i18n";

function placeholders(message: string): string[] {
  return [...message.matchAll(/\{([^}]+)\}/g)].map((match) => match[1]).sort();
}

describe("locale dictionaries", () => {
  it("contain the same keys in English and Polish", () => {
    expect(Object.keys(messages.pl).sort()).toEqual(Object.keys(messages.en).sort());
  });

  it("use equivalent interpolation variables in both languages", () => {
    for (const key of Object.keys(messages.en) as MessageKey[]) {
      expect(placeholders(messages.pl[key]), `placeholder parity for ${key}`)
        .toEqual(placeholders(messages.en[key]));
    }
  });

  it("never displays a missing key as a translation", () => {
    expect(() => translate("pl" as Locale, "missing.key" as MessageKey)).toThrow(
      "Missing pl translation for missing.key"
    );
  });

  it("interpolates dynamic trade content in the selected language", () => {
    expect(translate("pl", "trade.buy", { symbol: "SOL" })).toBe("Kup SOL");
    expect(translate("en", "trade.retryCheck", { error: "Rejected" }))
      .toContain("Rejected.");
  });
});
