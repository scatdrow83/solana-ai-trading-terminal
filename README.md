# Solana Terminal

Solana Terminal to stagingowy terminal Solana Mainnet z notowaniami DexScreener,
konta użytkowników w PostgreSQL, przypisanym portfelem Solana oraz swapami Jupiter.
Portfel jest generowany w przeglądarce, a jego sekret szyfrowany hasłem konta przed
wysłaniem do API. Jawny klucz pozostaje w pamięci przeglądarki po odblokowaniu.

> **Uwaga: prawdziwe środki.** Swapy są wysyłane na Solana Mainnet. Kwotowania
> mogą się zmienić, transakcje mogą się nie powieść, a utrata środków jest możliwa.
> Zaczynaj od małych kwot, sprawdzaj pełne adresy mintów i zatwierdzaj transakcję
> tylko wtedy, gdy szczegóły zlecenia w terminalu są zgodne z oczekiwaniami.

## Status

| Obszar | Status | Zakres obecnego etapu |
| --- | --- | --- |
| Web | `Partial` | Dashboard, rynki, watchlista, rejestracja/logowanie i lokalne podpisywanie swapów |
| API | `Partial` | Flask REST API: notowania, auth, portfele, historia swapów i proxy Jupiter v2 |
| Worker | `Partial` | Proces z liveness; brak kolejki i zadań |
| PostgreSQL / Supabase | `Configurable` | Lokalny PostgreSQL albo odrębna baza Supabase dla stagingu i produkcji |
| Risk engine | `Partial` | Deterministyczne kontrole, bez wykonywania zleceń |
| Jupiter Swap v2 / Solana RPC | `Configurable` | Klucz Jupiter i endpoint RPC konfigurowane w `.env` |
| Wallet Desk | `Partial` | Portfel konta odblokowywany hasłem; saldo tokenów nie jest indeksowane |
| Live trading | `Live Mainnet` | Kupno/sprzedaż przez Jupiter; jawne kliknięcie podpisuje i wysyła swap |
| Redis/BullMQ | `Planned` | Celowo pominięte, dopóki worker nie wymaga kolejki |

## Szybki start — lokalny staging Docker

Wymagany jest Docker Engine z Docker Compose v2. Node.js, pnpm, Python i Supabase
CLI nie są potrzebne do uruchomienia wariantu lokalnego.

```bash
cp .env.example .env
docker compose -f docker-compose.yml up --build -d --wait
docker compose -f docker-compose.yml ps
```

Po statusie `healthy` otwórz <http://localhost:3000>. Serwisy są wystawione
wyłącznie na `127.0.0.1`; PostgreSQL jest dostępny tylko wewnątrz sieci Compose.
Dane kont, walletów, historii i symulatora pozostają w trwałym wolumenie
`postgres_data`. Zatrzymaj stack poleceniem `docker compose down`; nie dodawaj
`-v`, jeśli chcesz zachować dane.

Domyślny staging nie wymaga klucza Jupiter: notowania publiczne działają, ale
swapy pozostają niedostępne do czasu skonfigurowania `JUPITER_API_KEY`. Konto
demo admina i jego symulator są lokalne i nie mogą wykonać swapu Mainnet.
Nie udostępniaj wariantu lokalnego publicznie. W stagingu i produkcji wszystkie
swapowe transakcje są prawdziwymi transakcjami Mainnet wymagającymi podpisu
użytkownika w przeglądarce.

## Warianty wdrożenia

| Wariant | Compose | Baza | Dostęp |
| --- | --- | --- | --- |
| `staging-local` | `docker-compose.yml` | PostgreSQL w Compose, wolumen `postgres_data` | localhost, bez TLS |
| `staging` | `docker-compose.staging.yml` | Oddzielny staging project Supabase, schemat `terminal` | Caddy + HTTPS |
| `prod` | `docker-compose.prod.yml` | Produkcyjny project Supabase, schemat `terminal` | Caddy + HTTPS |

Każdy środowiskowy plik `.env` zawiera własny sekret sesji i URL bazy. Nie
używaj projektu/bazy produkcyjnej do stagingu ani konta demo w produkcji.
Wartości w plikach `*.example` są tylko szablonami i muszą być zastąpione
rzeczywistymi sekretami przed startem wariantów zdalnych. Klucz Jupiter jest
opcjonalny na stagingu, wymagany w Compose produkcyjnym. Użyj RPC z limitem
odpowiednim dla realnego handlu.

### Supabase staging

Utwórz osobny projekt Supabase dla stagingu, skopiuj
`.env.staging.example` do `.env.staging` i ustaw domenę stagingową wskazującą
na serwer, email ACME oraz connection string `Session pooler` (port 5432)
z `sslmode=require`. W Supabase SQL Editor utwórz dedykowaną rolę runtime:

```sql
create role terminal_app login password 'WSTAW_UNIKALNE_SILNE_HASLO';
```

Migracja nada tej roli dostęp wyłącznie do schematu `terminal`. Użyj nazwy
użytkownika `terminal_app.PROJECT_REF` w `SUPABASE_DATABASE_URL` i zakoduj znaki
specjalne hasła zgodnie z URL encoding. Połączenie właściciela projektu
pozostaw wyłącznie dla Supabase CLI i migracji:

```bash
openssl rand -hex 32
openssl rand -hex 32
supabase login
supabase link --project-ref TWOJ_STAGING_PROJECT_REF
supabase db push --linked
docker compose --env-file .env.staging -f docker-compose.staging.yml up --build -d --wait
```

Na serwerze domena DNS musi wskazywać na publiczny adres IP, a porty TCP 80/443
(oraz opcjonalnie UDP 443) muszą być dostępne dla Caddy. API i worker nie mają
portów hosta; publiczny ruch HTTP jest kierowany przez Caddy wyłącznie do web.
Wstaw dwa wygenerowane sekrety do `APP_SECRET_KEY` i `REDIS_PASSWORD` w `.env.staging`.

Staging i produkcja używają wewnętrznego Redis z uwierzytelnieniem jako
magazynu limitów: auth `20 POST/min/IP`, rynek `120 req/min/IP`, order/execute
`10 POST/min/IP`. API pobiera IP klienta z nagłówka przekazywanego przez Caddy
i same-origin proxy Next.

### Produkcja

Utwórz oddzielny produkcyjny projekt Supabase (backup/PITR włączony) i osobną
rolę runtime `terminal_app` powyższym poleceniem SQL. Ustaw jej unikalne hasło,
osobny sekret `APP_SECRET_KEY` i `REDIS_PASSWORD` (oba generowane przez
`openssl rand -hex 32`), produkcyjny klucz Jupiter i RPC. Skopiuj
`.env.production.example` do `.env.production`, wstaw sekrety oraz domenę
produkcyjną. Uruchom migracje na projekcie produkcyjnym i dopiero potem usługi:

```bash
supabase link --project-ref TWOJ_PRODUCTION_PROJECT_REF
supabase db push --linked
docker compose --env-file .env.production -f docker-compose.prod.yml up --build -d --wait
docker compose --env-file .env.production -f docker-compose.prod.yml ps
```

Konfiguracja produkcyjna odrzuca słaby/brakujący sekret sesji, HTTP-only cookie
bez HTTPS, włączony simulator i automatyczne DDL z API. API używa dedykowanego
schematu `terminal`, który nie koliduje z tabelą `public.wallets` tworzonych
przez pozostałe migracje Supabase. Konto aplikacji ma dostęp DML tylko do tego
schematu, a migracje uruchamiaj osobno kontem właściciela. `supabase db push`
musi zakończyć się przed wdrożeniem nowego API. Utrzymuj kopie zapasowe Supabase
i testuj ich odtwarzanie.

Supabase jest tutaj zarządzanym PostgreSQL. Rejestracja i sesje aplikacji nadal
korzystają z istniejącego Flask auth oraz tabel `terminal.app_users` i
`terminal.wallets`; nie jest to Supabase Auth. Sekret service-role/anon key nie
jest potrzebny w kontenerach ani nie trafia do przeglądarki. API łączy się z
PostgreSQL przez TLS (`sslmode=require`).

## Architektura

```text
apps/web (Next.js / React; account wallet generated and encrypted in browser)
    -> apps/api (Flask REST API) -> PostgreSQL
apps/api -> DexScreener (notowania)
apps/api -> Jupiter Swap API v2 (kwotowanie i wykonanie podpisanych swapów)
apps/api -> Solana Mainnet RPC (decimals tokenu)
apps/worker (oddzielny proces; zadania jeszcze nieaktywne)
packages/shared
packages/risk-engine
```

Szczegóły: [docs/architecture.md](./docs/architecture.md). Publiczny feed
DexScreener nie wymaga klucza. Lokalny Compose uruchamia PostgreSQL; warianty
staging/prod używają PostgreSQL zarządzanego przez odpowiedni projekt Supabase.

## Struktura

```text
apps/
  api/                 Python Flask REST API i healthcheck
  web/                 Next.js UI i health route
  worker/              Proces worker i healthcheck
packages/
  shared/              Wspólne kontrakty
  risk-engine/         Niezależne reguły ryzyka i testy
supabase/
  config.toml
  migrations/          Wersjonowane migracje SQL z RLS
  seed.sql             Pusty seed; bez fikcyjnych skanów
docs/
  architecture.md
```

## Wymagania dla uruchomienia poza Dockerem (opcjonalnie)

- Node.js `>=22.14.0`.
- pnpm `10.6.2` (aktywowany przez Corepack).
- Python 3.12 (dla uruchomienia i testów API poza Dockerem).
- Supabase CLI (opcjonalnie).

## WSL2 — przygotowanie środowiska developerskiego

W terminalu bash w katalogu repozytorium, jeśli chcesz pracować bez kontenerów:

```bash
corepack enable
pnpm install
```

Do testów staging-local skopiuj konfigurację i uruchom:

```bash
cp .env.example .env
docker compose -f docker-compose.yml up --build -d --wait
```

Lokalne konto podglądowe i simulator admina (tylko na tym stagingu):

- email/login: `admin@local.test`
- hasło: `admin`

Konto jest oznaczone jako demo. W zakładce `Admin simulator` można przeglądać
adresy publiczne i przećwiczyć wypłatę na fikcyjnym saldzie 10 SOL na portfel.
Symulacja zmienia wyłącznie lokalny testowy ledger i dziennik; nigdy nie wysyła
transakcji ani nie zwraca zaszyfrowanych kluczy. API blokuje dla kont demo swapy
Mainnet, nawet gdy klucz Jupiter jest skonfigurowany. **To słabe hasło jest
wyłącznie do lokalnych testów. Nie używaj ani nie zasilaj portfela demo.**
Simulator jest włączony w Compose, tylko gdy `LOCAL_SECURITY_SIMULATOR=true`;
nie wystawiaj tego stagingu do publicznej sieci.

Rejestracja jest dostępna pod <http://localhost:3000>. Utwórz konto, skopiuj
pokazany plik JSON klucza Solana do bezpiecznego offline backupu i potwierdź,
że został zapisany. Hasło konta szyfruje klucz w przeglądarce; nie ma odzyskiwania
klucza przez reset hasła. Swapy są prawdziwymi transakcjami Mainnet i wymagają
skonfigurowanego klucza Jupiter oraz SOL/tokenu na przypisanym portfelu. Dla bezpiecznej wartości
domyślnej ustaw np. hasło bazy jako 64 znaki szesnastkowe, aby uniknąć problemów
ze znakami specjalnymi w `DATABASE_URL`.

Lokalne uruchomienie API poza Dockerem:

```bash
python3 -m venv .venv
. .venv/bin/activate
pip install -r apps/api/requirements.txt
python apps/api/app.py
```

W drugim terminalu uruchom testy Flask API poleceniem
`python3 -m unittest discover -s apps/api/tests`. Nie dodawaj
`SUPABASE_SERVICE_ROLE_KEY` do ustawień `NEXT_PUBLIC_*` ani do przeglądarki.

### Supabase lokalny CLI (opcjonalny development)

```bash
supabase start
supabase db reset
```

Konta staging-local używają lokalnego PostgreSQL z Compose. Supabase CLI jest
używane do wersjonowanych migracji i zarządzanych projektów staging/production
zgodnie z instrukcjami powyżej.

### Aplikacje

Włączony Docker Desktop powinien udostępniać Docker CLI w WSL2.

```bash
docker compose up --build
```

Adresy lokalne:

- Web: <http://localhost:3000>
- API liveness: <http://localhost:4000/health>
- Worker liveness: <http://localhost:4001/health>
- PostgreSQL nie jest wystawiony na hosta.

Terminal pokazuje notowania SOL, USDC, JUP i RAY, wyszukiwanie tokenów, wykres
sesyjnych obserwacji cenowych, watchlistę zapisywaną w przeglądarce i szczegóły
pary oraz swapy Mainnet. Odświeżanie można ustawić na 15, 30 lub 60 sekund. API udostępnia
`GET /health`, `GET /market/overview`, `GET /market/search?q=SOL`,
`GET /market/tokens/<mintAddress>` oraz wsadowe
`GET /market/tokens?addresses=<mint1>,<mint2>`, `GET /trade/status`,
`POST /trade/order` i `POST /trade/execute`. Prywatne endpointy kont i swapów
wymagają ciasteczka sesji. Kupno jest ograniczone do maksymalnie 1 SOL na swap.
Kwotowanie wygasa po 90 sekundach i jest jednorazowe dla portfela, który o nie
poprosił. Historia swapów jest przypisana do konta. API udostępnia również
`GET /auth`, `POST /auth` i uwierzytelniony `GET /trade/history`. Usługi są
związane wyłącznie z localhost.

Kliknięcie „Sign & submit Mainnet swap” podpisuje transakcję przypisanym kluczem
w przeglądarce, a API przekazuje podpisaną transakcję do Jupiter `/execute`.
Klucz Jupiter nigdy nie trafia do frontendu. Nie wklejaj cudzej frazy seed ani
klucza do aplikacji. Zapisz wygenerowany klucz portfela offline. Sprawdzaj
status transakcji w historii konta i na Solscan.

Zatrzymanie:

```bash
docker compose down
```

Usunięcie bazy kont, walletów i historii (nieodwracalne):

```bash
docker compose down -v
```

## Testy i kontrola jakości

Po zainstalowaniu zależności:

```bash
pnpm lint
pnpm typecheck
pnpm test
python3 -m unittest discover -s apps/api/tests
```

Testy silnika ryzyka sprawdzają limity i błędne dane. Testy API weryfikują
walidację zleceń Mainnet, limit kupna, decimals tokenu, jednokrotne wykonanie
oraz blokadę handlu bez klucza Jupiter.

## Integracje i ograniczenia

- **DexScreener:** publiczne notowania read-only, bez klucza. To dane zewnętrzne;
  sprawdzaj źródło i czas aktualizacji.
- **Jupiter Swap API v2:** serwerowe `/order` i `/execute`; wymaga klucza API
  i jawnej akcji podpisu w przeglądarce.
- **Solana RPC:** pobiera decimals tokenu z Mainnet; `SOLANA_RPC_URL` pozwala
  skonfigurować własnego dostawcę.
- **Token Radar/AI:** brak providerów; konfiguracja bez klucza ma jawny status
  `provider_not_configured`.
- **Konta/portfele:** hasło konta i zaszyfrowany klucz są przechowywane osobno;
  odszyfrowanie oraz podpis transakcji odbywają się w przeglądarce.
- **Zlecenia:** rejestr swapów zapisuje status i podpis transakcji; automatyczne
  strategie, saldo portfela i indeksowanie PnL nie są podłączone.
- **PnL:** niezaimplementowane; nie powstają losowe wyceny ani wykresy.

## Następne etapy

1. Walidacja lokalnego toolchainu oraz uruchomienie lint/typecheck/test.
2. Rate limiting logowania i egzekwowanie limitów prób auth.
3. Adaptery tylko do odczytu dla Solana RPC i dostawcy danych zewnętrznych.
4. Zapis rzeczywistych, oznaczonych czasem snapshotów i transakcji Mainnet.
5. Przed publicznym wdrożeniem dodaj rate limiting i brute-force protection,
   migruj inicjalizację DB na wersjonowane migracje i przeprowadź przegląd
   bezpieczeństwa; obecny staging jest ograniczony do localhost.
