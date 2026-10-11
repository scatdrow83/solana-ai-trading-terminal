# Współtworzenie

1. Pracuj na małej, tematycznej zmianie.
2. Nie dodawaj sekretów, prawdziwych fraz seed, kluczy ani danych użytkowników.
3. Nowa integracja zewnętrzna wymaga adaptera, walidacji wejść i testów z mockami.
4. Każda zmiana reguł ryzyka wymaga testu jednostkowego; AI nie może omijać tych reguł.
5. Przed zgłoszeniem uruchom `pnpm lint`, `pnpm typecheck` i `pnpm test`.
6. Opisz ograniczenia i status implementacji; nie deklaruj działania funkcji, której
   nie zweryfikowano.

Szczegóły lokalnego środowiska znajdują się w [README.md](./README.md).
