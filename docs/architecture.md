# Architektura stagingu

```text
Przeglądarka (Next.js/React)
   | same-origin auth/trade proxy; wallet key generated, encrypted, decrypted
   v
apps/web -> apps/api (Python/Flask REST API) -> PostgreSQL
                         |-> DexScreener (notowania i zagregowane pary)
                         |-> Solana Mainnet RPC (decimals tokenu)
                         `-> Jupiter Swap API v2 (/order, /execute)

apps/worker -> DexScreener (najnowsze profile i podbicia tokenów Solana)
apps/worker -> apps/api -> PostgreSQL (autoryzowany ingest odkrytych rynków)
Redis (zdalne profile; współdzielony magazyn rate limitów, bez portu hosta)
packages/shared
packages/risk-engine (reguły deterministyczne, bez wysyłania transakcji)
```

`docker-compose.yml` uruchamia lokalny PostgreSQL z trwałym wolumenem, API, web
i worker; porty są związane z localhost. `docker-compose.staging.yml` i
`docker-compose.prod.yml` łączą się z oddzielnymi zarządzanymi projektami
Supabase PostgreSQL przez TLS i wystawiają web przez Caddy/HTTPS. W środowiskach
zdalnych API używa własnego schematu `terminal` i nie mutuje schematu Supabase
przy starcie. Przed wdrożeniem wymagane jest `supabase db push --linked`.
Serwis API i worker nie są publicznie wystawiane przez Compose.

Supabase pełni rolę zarządzanego PostgreSQL. Uwierzytelnianie kont pozostaje
w Flask i nie korzysta obecnie z Supabase Auth; hasła są hashowane przez
Werkzeug, a klucze walletów szyfrowane w przeglądarce.

## Odkrywanie nowych tokenów

- Worker od razu po starcie, a następnie co 30 sekund (konfigurowalne w
  zakresie 15–300 sekund), odpytuje feedy DexScreener latest token profiles
  oraz latest token boosts. Zachowuje wyłącznie poprawne adresy tokenów sieci
  Solana i ogranicza pojedynczy cykl do 100 mintów.
- Worker przekazuje adresy do wewnętrznego endpointu API z osobnym
  `MARKET_DISCOVERY_TOKEN`. API weryfikuje sekret stałoczasowo, sprawdza minty,
  pobiera ich zagregowane pary w partiach do 30 i trwale upsertuje rynki
  znalezione przez DexScreener do `discovered_tokens`.
- `first_seen_at` nie zmienia się przy kolejnych skanach; `last_seen_at`
  aktualizuje się przy ponownym wykryciu. Dashboard odczytuje najnowsze wpisy
  przez `GET /market/new`.
- Healthcheck workera pokazuje ostatni błąd/skan. Błędy feedu nie są ukrywane:
  są logowane, widoczne jako stan `degraded`, a worker ponawia cykl po
  skonfigurowanym interwale.
- To polling agregatora rynków, a nie subskrypcja wszystkich programów DEX
  Solany lub pełny indeks blockchaina. Wykrycie zależy od publikacji wpisu przez
  DexScreener; nie jest gwarantowane natychmiastowe ani kompletne. Wpisy są
  wyłącznie kandydatami do późniejszej analizy, bez AI scoringu i auto-tradingu.

## Konta i własność portfela

- `app_users`: znormalizowany unikalny email i hash hasła.
- `wallets`: jeden przypisany, unikalny adres na konto oraz JSONB zawierający
  wyłącznie szyfrogram klucza portfela.
- Rejestracja generuje keypair w przeglądarce. AES-256-GCM szyfruje secret key
  przy użyciu klucza PBKDF2-SHA256 z 600 000 iteracji, losowej soli 16 B i IV
  12 B. API waliduje format i rozmiar szyfrogramu; nie dostaje jawnego sekretu.
- Logowanie weryfikuje hash hasła i zwraca zaszyfrowany keypair. Odszyfrowanie
  oraz porównanie adresu publicznego odbywa się w przeglądarce.
- Flask signed session identyfikuje konto. Proxy Next.js przekazuje cookie do API.
- Staging/production wymagają Redis dla współdzielonych limitów: auth 20 POST,
  market 120 żądań, trade order/execute 10 POST na minutę/IP. Caddy ustala
  `X-Forwarded-For`; Next przekazuje je do API, a `ProxyFix` ufa jednemu proxy.
- Konto lokalnego demo ma flagę `is_demo`; endpointy tworzenia i wykonywania
  swapów zwracają `403` niezależnie od konfiguracji Jupiter. Hasło demonstracyjne
  jest wyłącznie do lokalnych testów UI; tego portfela nie należy zasilać.
- Produkcyjne role admina są nadawane tylko podczas rejestracji dokładnego emaila
  z `ADMIN_EMAILS` wraz z `ADMIN_BOOTSTRAP_TOKEN`; flaga `app_users.is_admin`
  jest trwała w bazie. Wdrożenie wymaga migracji `20261012040000_admin_roles.sql`.
  Zmiana allowlisty sama w sobie nie podnosi uprawnień już istniejących kont.
- Osobny simulator (`LOCAL_SECURITY_SIMULATOR=true`) zwraca wyłącznie email,
  publiczny adres i fikcyjne saldo 10 test SOL; symulowana wypłata aktualizuje
  testowy ledger i tabelę audytu bez RPC ani transakcji Mainnet. Admin jest
  rozpoznawany przez lokalne demo konto `admin@local.test`. Ustaw flagę na
  `false` poza lokalnym stagingiem.
- Produkcyjny `GET /admin/wallets` jest tylko do odczytu: zwraca publiczne adresy
  i natywne saldo SOL pobrane z RPC w stronach po 100 kont. Nie udostępnia
  szyfrogramów kluczy ani endpointu wypłat. Właściciel portfela musi podpisać
  każdą transakcję ze swoich środków; uprawnienia admina tego nie omijają.
- `swap_trades`: zlecenie, status i podpis są przypisane do `user_id`, adresu
  portfela i unikalnego request ID Jupiter. Endpoint historii ogranicza wyniki
  do zalogowanego konta.

## Swapy Mainnet

1. Zalogowany i odblokowany użytkownik wybiera token oraz prosi o świeże
   kwotowanie Jupiter.
2. API weryfikuje sesję i zgodność wallet address z przypisanym kontem, waliduje
   kwotę i mint, ogranicza kupno do 1 SOL, sprawdza decimals w Solana RPC oraz
   zapisuje request jako `awaiting_signature`.
3. UI pokazuje minty, kwotę wejściową i szacowany output.
4. Jawne kliknięcie użytkownika podpisuje transakcję keypairem w pamięci
   przeglądarki. Podpisana transakcja i request ID trafiają do API/Jupiter.
5. API wykonuje jednorazowe, krótkotrwałe zlecenie i zapisuje wynik/signature.

Nie ma podpisu Phantom/Solflare ani popupu providera. Bez `JUPITER_API_KEY`
API jawnie blokuje składanie i wykonanie zleceń. Kod aplikacji nie wykonuje
samodzielnie swapa bez akcji użytkownika.

## Ograniczenia i decyzje

- Bez resetu/odzyskiwania klucza; backup JSON pokazany raz podczas rejestracji
  należy zabezpieczyć offline.
- Klucz jawny przebywa w pamięci strony po odblokowaniu i jest zerowany w
  pamięci przy wylogowaniu. Nie jest przechowywany w localStorage.
- Lokalny API inicjalizuje `apps/api/schema.sql` przy starcie. Staging i
  produkcja używają wersjonowanej migracji `supabase/migrations/*terminal_runtime.sql`;
  migrację należy wykonać przed uruchomieniem API.
- Nie ma MFA, potwierdzenia email, indeksowania sald, PnL ani automatycznych
  strategii. Przed publicznym wdrożeniem przeprowadź niezależny przegląd
  bezpieczeństwa, testy obciążeniowe i procedurę odtworzenia backupu.
- DexScreener jest dostawcą danych rynkowych; ceny i output kwotowania nie są
  gwarantowane.
