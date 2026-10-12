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
| Worker | `Active` | Cykliczne wykrywanie tokenów Solana z feedów DexScreener profiles/boosts i zapis nowych aktywnych rynków |
| PostgreSQL / Supabase | `Configurable` | Lokalny PostgreSQL albo odrębna baza Supabase dla stagingu i produkcji |
| Risk engine | `Partial` | Deterministyczne kontrole, bez wykonywania zleceń |
| Jupiter Swap v2 / Solana RPC | `Configurable` | Klucz Jupiter i endpoint RPC konfigurowane w `.env` |
| Wallet Desk | `Partial` | Portfel konta odblokowywany hasłem; kokpit admina odczytuje rzeczywiste salda SOL |
| Admin console | `Configurable` | Lista adminów z `ADMIN_EMAILS`; monitoring tylko do odczytu, operacje on-chain wymagają podpisu Phantom |
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

Worker co 30 sekund sprawdza najnowsze profile i podbicia tokenów Solana w
DexScreener, pobiera zagregowane pary dla znalezionych mintów i zapisuje
wykryte rynki w PostgreSQL. Widok **New tokens** pokazuje rekordy oraz pierwszy czas
wykrycia przez tę instancję. Okres można ustawić przez
`MARKET_DISCOVERY_INTERVAL_MS` (15–300 sekund). Feed jest agregatorem, a nie
kompletnym indeksem blockchaina: token pojawi się po wykryciu go przez
DexScreener, bez gwarancji indeksowania każdej nowej puli natychmiast po
utworzeniu. Funkcja wyłącznie odkrywa i prezentuje rynki — nie ocenia ich
bezpieczeństwa ani nie inicjuje transakcji.
Administrator lokalny lub konto z allowlisty `ADMIN_EMAILS` może w panelu
administracyjnym dodać istniejący,
aktywny mint Solana do sekcji **New tokens** wraz z krótką notatką rynkową.
API sprawdza, czy DexScreener zwraca dla mintu rynek Solana; użytkownicy muszą
być zalogowani, żeby zobaczyć rekomendacje. To nie tworzy tokena SPL, nie
inicjuje zakupu ani nie przenosi środków. Notatka administratora nie jest poradą
inwestycyjną. Funkcje lokalnego symulatora są dostępne tylko dla konta demo,
gdy `LOCAL_SECURITY_SIMULATOR=true`; na stagingu i produkcji panel admina jest
dostępny wyłącznie dla dokładnych adresów email z `ADMIN_EMAILS`.
Konto administratora musi zostać utworzone po ustawieniu allowlisty i wymaga
dodatkowo poprawnego `ADMIN_BOOTSTRAP_TOKEN` podczas rejestracji. Rola jest
zapisywana w bazie przy rejestracji; samo dopisanie istniejącego konta do
allowlisty nie nada mu uprawnień. Token generuj i przekazuj poza aplikacją
(np. bezpiecznym menedżerem sekretów), nie zapisuj go w repozytorium ani czacie.

W wariantach Supabase zastosuj migracje w kolejności:
`20261012020000_solana_token_discovery.sql`,
`20261012030000_admin_token_recommendations.sql`,
`20261012040000_admin_roles.sql`.
Kokpit admina zawiera również **Token Studio**: tworzenie klasycznych,
fungible SPL tokenów z kontem mint, kontem ATA administratora i metadanymi
Metaplex Token Metadata V3, mintowanie dodatkowej podaży, edycję metadanych oraz
nieodwracalne odebranie mint/freeze authority lub ustawienie metadanych jako
immutable. Podpisy odbywają się przez rozszerzenie Phantom po stronie
przeglądarki; klucz prywatny nie jest wysyłany do API. Używaj dedykowanego
portfela administratora z małym saldem na opłaty, nie portfela demo.

Przed utworzeniem tokena administrator musi osobno opublikować plik JSON
Metaplex z metadanymi/obrazem w HTTPS lub IPFS i podać jego URI. Aplikacja nie
hostuje plików, nie dodaje płynności, nie rozsyła tokenów do kont użytkowników,
nie tworzy rozszerzeń Token-2022/NFT i nie gwarantuje indeksacji przez DEX.
Lista utworzonych tokenów jest lokalna dla przeglądarki. Każda operacja wymaga
osobnej zgody Phantom; transakcje są nieodwracalne i pobierają prawdziwe opłaty
Mainnet.
W produkcji kokpit portfeli odczytuje rzeczywiste salda SOL z RPC w porcjach po
100 kont; nie pokazuje fikcyjnych sald ani kluczy prywatnych. Administrator nie
może wypłacać środków z portfeli użytkowników — każdy transfer wymaga podpisu
właściciela portfela. Panel produkcyjny i rekomendacje są dostępne wyłącznie
dla dokładnych adresów email skonfigurowanych w `ADMIN_EMAILS`.
Ikony rynków pochodzą ze zweryfikowanych metadanych DexScreener; dla znanych
aktywów używane są zaufane mapowania, a brakujące loga kończą się neutralnym
placeholderem zamiast błędnie przypisanej ikony tokena kwotowanego.

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
openssl rand -hex 32
supabase login
supabase link --project-ref TWOJ_STAGING_PROJECT_REF
supabase db push --linked
docker compose --env-file .env.staging -f docker-compose.staging.yml up --build -d --wait
```

Na serwerze domena DNS musi wskazywać na publiczny adres IP, a porty TCP 80/443
(oraz opcjonalnie UDP 443) muszą być dostępne dla Caddy. API i worker nie mają
portów hosta; publiczny ruch HTTP jest kierowany przez Caddy wyłącznie do web.
Wstaw wygenerowane sekrety do `APP_SECRET_KEY`, `REDIS_PASSWORD` i
`MARKET_DISCOVERY_TOKEN` w `.env.staging`. Ustaw też `ADMIN_EMAILS` jako
rozdzieloną przecinkami listę dokładnych, zaufanych adresów administratorów.
Konto musi najpierw zarejestrować się z takim adresem; rola admina wynika z
serwerowej allowlisty, a nie z danych klienta. Ustaw unikalny
`ADMIN_BOOTSTRAP_TOKEN` poleceniem `openssl rand -hex 32` i przekaż go tylko
administratorowi przy rejestracji. Token discovery musi być unikalnym,
64-znakowym ciągiem hex wygenerowanym np. przez `openssl rand -hex 32`; API
wymaga go od workera przy zapisie odkryć.

Staging i produkcja używają wewnętrznego Redis z uwierzytelnieniem jako
magazynu limitów: auth `20 POST/min/IP`, rynek `120 req/min/IP`, order/execute
`10 POST/min/IP`. API pobiera IP klienta z nagłówka przekazywanego przez Caddy
i same-origin proxy Next.

### Produkcja

Utwórz oddzielny produkcyjny projekt Supabase (backup/PITR włączony) i osobną
rolę runtime `terminal_app` powyższym poleceniem SQL. Ustaw jej unikalne hasło,
osobne sekrety `APP_SECRET_KEY`, `REDIS_PASSWORD` i `MARKET_DISCOVERY_TOKEN`
(generowane przez `openssl rand -hex 32`), produkcyjny klucz Jupiter i RPC. Skopiuj
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
Ustaw `ADMIN_EMAILS` w `.env.production` na dokładne adresy zaufanych
administratorów. Dla tych kont pojawi się kokpit: odczyt sald SOL, rekomendacje
tokenów i Token Studio. Ustaw też odrębny `ADMIN_BOOTSTRAP_TOKEN` i przekazuj
go administratorom poza aplikacją. Admin nie może podpisać wypłaty z portfela użytkownika.

Supabase jest tutaj zarządzanym PostgreSQL. Rejestracja i sesje aplikacji nadal
korzystają z istniejącego Flask auth oraz tabel `terminal.app_users` i
`terminal.wallets`; nie jest to Supabase Auth. Sekret service-role/anon key nie
jest potrzebny w kontenerach ani nie trafia do przeglądarki. API łączy się z
PostgreSQL przez TLS (`sslmode=require`).

## Architektura

```text
apps/web (Next.js / React; account wallet generated and encrypted in browser)
    -> apps/api (Flask REST API) -> PostgreSQL
apps/api -> DexScreener (notowania i zagregowane pary)
apps/api -> Jupiter Swap API v2 (kwotowanie i wykonanie podpisanych swapów)
apps/api -> Solana Mainnet RPC (decimals tokenu)
apps/worker -> DexScreener (najnowsze profile/podbicia co 30 s)
apps/worker -> apps/api -> PostgreSQL (autoryzowany zapis wykrytych rynków)
packages/shared
packages/risk-engine
```

Szczegóły: [docs/architecture.md](./docs/architecture.md). Publiczny feed
DexScreener nie wymaga klucza. Lokalny Compose uruchamia PostgreSQL; warianty
staging/prod używają PostgreSQL zarządzanego przez odpowiedni projekt Supabase.
Tokeny w widoku **New tokens** są kandydatami do późniejszej analizy, nie
rekomendacją ani oceną bezpieczeństwa. Nie ma jeszcze modelu AI, automatycznego
kupna ani indeksowania wszystkich zdarzeń on-chain.

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

Lokalne konto demo i symulator admina (tylko na staging-local):

- email/login: `admin@local.test`
- hasło: `admin`

Przy pierwszym uruchomieniu konto trzeba utworzyć z formularza rejestracji
(dane `admin@local.test` / `admin` są wypełnione automatycznie). Konto jest
oznaczone jako demo. W zakładce `Admin simulator` można przeglądać adresy
publiczne i przećwiczyć wypłatę na fikcyjnym saldzie 10 SOL na portfel.
Symulacja zmienia wyłącznie lokalny testowy ledger i dziennik; nigdy nie wysyła
transakcji ani nie zwraca zaszyfrowanych kluczy. API blokuje dla kont demo swapy
Mainnet, nawet gdy klucz Jupiter jest skonfigurowany. **To słabe hasło jest
wyłącznie do lokalnych testów. Nie używaj ani nie zasilaj portfela demo.**
Simulator jest włączony w Compose, tylko gdy `LOCAL_SECURITY_SIMULATOR=true`;
nie wystawiaj tego stagingu do publicznej sieci.

Rejestracja zwykłych kont jest dostępna pod <http://localhost:3000>. Utwórz
konto, skopiuj pokazany plik JSON klucza Solana do bezpiecznego offline backupu i potwierdź,
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
pary, widok nowych listingów oraz swapy Mainnet. Odświeżanie można ustawić na
15, 30 lub 60 sekund. API udostępnia
`GET /health`, `GET /market/overview`, `GET /market/search?q=SOL`,
`GET /market/new`,
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
walidację zleceń Mainnet, limit kupna, decimals tokenu, jednokrotne wykonanie,
blokadę handlu bez klucza Jupiter, read-only salda SOL/tokenów SPL oraz
uwierzytelnione ingestowanie nowych tokenów.

## Integracje i ograniczenia

- **DexScreener:** publiczne notowania read-only, bez klucza. To dane zewnętrzne;
  worker odpytuje feedy profili/podbitych tokenów Solana i pobiera zagregowane
  pary z DEX-ów indeksowanych przez DexScreener. Feed nie jest pełnym indeksem
  on-chain i nie gwarantuje natychmiastowego wykrycia wszystkich pul.
- **Jupiter Swap API v2:** serwerowe `/order` i `/execute`; wymaga klucza API
  i jawnej akcji podpisu w przeglądarce.
- **Solana RPC:** pobiera decimals przy budowie zlecenia i potwierdzone salda
  natywnego SOL oraz SPL/Token-2022 dla zalogowanego użytkownika;
  `SOLANA_RPC_URL` pozwala skonfigurować własnego dostawcę. Demo admin nie
  odpytuje Mainnet.
- **AI/scoring tokenów:** niezaimplementowane; nowe wpisy nie są oceną
  bezpieczeństwa ani rekomendacją kupna.
- **Konta/portfele:** hasło konta i zaszyfrowany klucz są przechowywane osobno;
  odszyfrowanie oraz podpis transakcji odbywają się w przeglądarce.
- **Portfolio:** ekran pokazuje do 100 sald SOL i SPL/Token-2022 spośród maks.
  300 skanowanych tokenów. Ceny oraz USD są szacunkami DexScreener; przy
  aktywach bez wyceny lub przyciętym wyniku suma jest oznaczona jako częściowa.
  Można podać dowolny publiczny adres Solana; endpoint analizy jest read-only,
  ograniczony limitem zapytań i nie pobiera ani nie zwraca kluczy podpisujących.
  Nie jest to indeks historii transakcji ani PnL.
- **Zlecenia:** rejestr swapów zapisuje status i podpis transakcji; automatyczne
  strategie oraz indeksowanie PnL nie są podłączone. Kokpit administratora
  pokazuje wyłącznie natywne saldo SOL i nie umożliwia wypłat z portfeli
  użytkowników.
- **PnL:** niezaimplementowane; nie powstają losowe wyceny ani wykresy.

## Przed wdrożeniem produkcyjnym

Staging i produkcja wymagają prawdziwego Supabase, RPC dostawcy z limitami
odpowiednimi do ruchu, klucza Jupiter, domeny/DNS i sekretów z menedżera
sekretów. Nie da się ich bezpiecznie ustawić z repozytorium; przykładowe
wartości `.env.*.example` nie uruchamiają wdrożenia. Uruchom najpierw osobny
staging, wykonaj testy portfela i transakcji na małych kwotach, skonfiguruj
monitoring/alerty oraz rate limiting i dopiero po ręcznym przeglądzie publikuj
adres produkcyjny. Nie wykonuj testów transakcyjnych na środkach użytkowników.
