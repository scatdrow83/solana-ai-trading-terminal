# Route and feature coverage / Pokrycie tras i funkcji

This is the acceptance register for the current repository, not a claim of
production readiness. “Partial” means a UI or backend slice exists but the
full workflow, bilingual coverage, or required tests are not complete.

To jest rejestr akceptacyjny bieżącego repozytorium, a nie deklaracja gotowości
produkcyjnej. „Częściowo” oznacza, że istnieje część interfejsu lub backendu,
ale pełny przepływ, obsługa obu języków albo wymagane testy nie są ukończone.

## User-accessible routes / Trasy dostępne użytkownikom

| Route / Trasa | Surface / Widok | EN | PL | Workflow and data / Przepływ i dane | Acceptance |
|---|---|---:|---:|---|---|
| `/` | Account gate / Logowanie i rejestracja | Partial / Częściowo | Partial / Częściowo | Custom account session and browser-side wallet unlock; migration to Supabase Auth and account-wide locale persistence are outstanding. / Własna sesja i odblokowanie portfela w przeglądarce; migracja do Supabase Auth i synchronizacja języka na koncie są nieukończone. | Not accepted / Niezaakceptowane |
| `/` | Market overview, markets, token discovery / Przegląd rynku, rynki, odkrywanie tokenów | Partial / Częściowo | Missing / Brak | Public provider data, DB-backed discovery and local watchlist exist; full token screening/detail workflows and localized loading/error/status states need completion and tests. / Istnieją publiczne dane dostawcy, odkrywanie oparte na DB i lokalna lista obserwowanych; pełna ocena tokenów, szczegóły i tłumaczenia stanów wymagają dokończenia oraz testów. | Not accepted / Niezaakceptowane |
| `/` | Token search and market chart / Wyszukiwanie tokenów i wykres | Partial / Częściowo | Missing / Brak | Search uses provider data; chart displays observed session snapshots only. Historical ranges, complete translated controls and error states are outstanding. / Wyszukiwanie korzysta z danych dostawcy; wykres pokazuje wyłącznie obserwacje z bieżącej sesji. Brakuje historii, tłumaczeń kontrolek i pełnej obsługi błędów. | Not accepted / Niezaakceptowane |
| `/` | Watchlist / Lista obserwowanych | Partial / Częściowo | Missing / Brak | Browser-local persistence only; cross-device persistence, complete states and localization outstanding. / Dane wyłącznie lokalnie w przeglądarce; synchronizacja urządzeń, pełne stany i tłumaczenia nieukończone. | Not accepted / Niezaakceptowane |
| `/` | Read-only portfolio / Portfolio tylko do odczytu | Partial / Częściowo | Partial / Częściowo | Public SOL/SPL balances and estimated provider valuation; data caps and provider limitations are shown. API regression tests were added; end-to-end and provider outage checks remain. / Publiczne salda SOL/SPL i szacunkowe wyceny dostawcy; pokazano limity i ograniczenia. Dodano testy regresji API; brakuje testów E2E i awarii dostawcy. | Not accepted / Niezaakceptowane |
| `/` | Jupiter swap / Swap Jupiter | Partial / Częściowo | Partial / Częściowo | Quote, browser-side signing and submission path exist; acceptance requires credentials, end-to-end tests, failure reconciliation and explicit production controls. / Istnieje ścieżka wyceny, podpisu w przeglądarce i wysyłki; akceptacja wymaga poświadczeń, testów E2E, uzgadniania błędów i jawnych zabezpieczeń produkcyjnych. | Not accepted / Niezaakceptowane |
| `/` | Activity and account preferences / Aktywność i ustawienia konta | Partial / Częściowo | Missing / Brak | Swap history is available; complete preferences, alerts, reports and persistence are not implemented. / Dostępna jest historia swapów; komplet ustawień, alerty, raporty i trwałość danych nie są zaimplementowane. | Not accepted / Niezaakceptowane |
| `/` | Administrator cockpit / Kokpit administratora | Partial / Częściowo | Missing / Brak | Server authorization, public wallet registry, recommendations and local-only simulated ledger exist; broader operations are absent and the interface is English-only. / Istnieją autoryzacja serwerowa, rejestr publicznych portfeli, rekomendacje i lokalny symulator; pozostałe operacje nie istnieją, a interfejs jest tylko po angielsku. | Not accepted / Niezaakceptowane |
| `/` | Metaplex Token Studio / Token Studio Metaplex | Partial / Częściowo | Missing / Brak | Wallet-signed Mainnet mint and management transactions exist; browser registry, provider setup and complete bilingual workflow/audit tests remain. / Istnieją transakcje Mainnet podpisywane portfelem; pozostają rejestr przeglądarkowy, konfiguracja dostawcy i pełny dwujęzyczny przepływ oraz testy audytowe. | Not accepted / Niezaakceptowane |
| `/_not-found` | Not-found / Nie znaleziono strony | Missing / Brak | Missing / Brak | No custom bilingual not-found page or error-boundary coverage is present. / Brakuje własnej dwujęzycznej strony 404 i obsługi granic błędów. | Not accepted / Niezaakceptowane |

## API routes and integrations / Trasy API i integracje

| Route / Trasa | Access / Dostęp | Status | Remaining acceptance evidence / Brakujące dowody akceptacji |
|---|---|---|---|
| `/api/auth` | Public and session / Publiczny i sesyjny | Partial / Częściowo | Supabase Auth migration, account lifecycle tests, localized server errors, and session-security review. / Migracja do Supabase Auth, testy cyklu konta, tłumaczone błędy serwera i przegląd bezpieczeństwa sesji. |
| `/api/market` | Public, rate-limited / Publiczny, limitowany | Partial / Częściowo | Provider connectivity/timeout/rate-limit tests, freshness/staleness presentation, translated provider errors. / Testy łączności, timeoutów i limitów dostawcy, prezentacja świeżości danych oraz tłumaczone błędy. |
| `/api/wallet` | Session + public address / Sesja + adres publiczny | Partial / Częściowo | RPC outage/timeout integration tests and E2E privacy/authorization coverage. / Testy integracyjne awarii RPC i timeoutów oraz E2E prywatności i autoryzacji. |
| `/api/trade` | Authenticated / Wymaga logowania | Partial / Częściowo | Jupiter-configured integration tests, transaction reconciliation, and explicit production configuration verification. / Testy integracyjne z Jupiter, uzgadnianie transakcji i weryfikacja konfiguracji produkcyjnej. |
| `/api/admin` | Administrator only / Tylko administrator | Partial / Częściowo | Authorization/RLS tests and complete user, role, audit, health, and operational workflows. / Testy autoryzacji/RLS oraz pełna obsługa użytkowników, ról, audytu, zdrowia i operacji. |
| `/api/recommendations` | Read public; write admin / Odczyt publiczny; zapis admina | Partial / Częściowo | End-to-end persistence, authorization regression tests, and localized client states. / Trwałość E2E, testy regresji autoryzacji i tłumaczone stany interfejsu. |
| `/api/health` | Public / Publiczny | Partial / Częściowo | Provider diagnostics and operational dependency checks beyond process/database reachability. / Diagnostyka dostawców i zależności operacyjnych wykraczająca poza dostępność procesu/bazy. |

## Acceptance checklist / Lista akceptacyjna

- [x] English and Polish dictionaries have compile-time key parity.
- [x] A selected locale persists in the current browser and updates `html.lang`.
- [x] The public-wallet workflow and Jupiter swap interface have partial PL/EN coverage.
- [x] A locale dictionary test checks key parity, interpolation parity and missing-key failures.
- [ ] Every user-visible string and state is localized in every route and admin workflow.
- [ ] Locale preference is synchronized across authenticated devices.
- [ ] Complete route-by-route keyboard, responsive, authorization and persistence tests exist.
- [ ] Configured provider integration, withdrawal reconciliation and production deployment checks pass.
- [ ] No required client, admin, AI, alerting, saved-report or donation workflow remains absent.

- [x] Słowniki angielski i polski mają zgodność kluczy sprawdzaną przez TypeScript.
- [x] Wybrany język jest zapisywany w bieżącej przeglądarce i ustawia `html.lang`.
- [x] Przepływ publicznego portfela i interfejs swapu Jupiter mają częściową obsługę PL/EN.
- [x] Test słowników sprawdza zgodność kluczy, zmiennych interpolacji i błąd brakującego tłumaczenia.
- [ ] Każdy tekst i stan interfejsu jest przetłumaczony we wszystkich trasach oraz przepływach administratora.
- [ ] Preferencja języka jest synchronizowana między zalogowanymi urządzeniami.
- [ ] Istnieją kompletne testy tras dla klawiatury, responsywności, uprawnień i trwałości danych.
- [ ] Testy skonfigurowanych dostawców, uzgadniania wypłat i wdrożenia produkcyjnego przechodzą.
- [ ] Nie brakuje żadnego wymaganego przepływu klienta, administratora, AI, alertów, raportów ani darowizn.

Last reviewed: 2026-10-12. Update each row only with test evidence; a rendered interface or a healthy container is not acceptance evidence.

Ostatni przegląd: 2026-10-12. Wiersze aktualizuj wyłącznie na podstawie dowodów z testów; widoczny interfejs ani działający kontener nie stanowią dowodu akceptacji.
