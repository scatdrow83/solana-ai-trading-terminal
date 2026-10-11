# Solana Terminal

Solana Terminal to lokalny fundament terminala do monitorowania rynku Solana,
analizy aktywów i zarządzania strategiami. Repozytorium jest na pierwszym etapie:
nie wykonuje rzeczywistego skanowania, nie przechowuje kluczy portfeli i nie
składa ani nie podpisuje transakcji.

> **Trading live: Disabled.** Początkowy interfejs i endpointy health są szkieletem,
> a nie działającym terminalem inwestycyjnym. Brak danych lub integracji nie jest
> zastępowany przykładowymi wynikami udającymi prawdziwe.

## Status

| Obszar | Status | Zakres obecnego etapu |
| --- | --- | --- |
| Web | `Partial` | Strona startowa i statusy usług |
| API | `Partial` | Fastify i liveness `/health` |
| Worker | `Partial` | Proces z liveness; brak kolejki i zadań |
| Supabase | `Partial` | Początkowa migracja, RLS i konfiguracja CLI |
| Risk engine | `Partial` | Deterministyczne kontrole, bez wykonywania zleceń |
| Jupiter, Solana RPC, AI | `Planned` | Brak skonfigurowanych providerów |
| Wallet Desk i podpisywanie | `Disabled` | Brak magazynu sekretów/KMS |
| Live trading | `Disabled` | Niezaimplementowany |
| Redis/BullMQ | `Planned` | Celowo pominięte, dopóki worker nie wymaga kolejki |

## Architektura

```text
apps/web (Next.js) -> apps/api (Fastify) -> lokalny Supabase
apps/worker (oddzielny proces; zadania jeszcze nieaktywne)
packages/shared
packages/risk-engine
```

Szczegóły: [docs/architecture.md](./docs/architecture.md). Supabase CLI uruchamia
lokalną bazę i Auth; Docker Compose uruchamia wyłącznie aplikacje. Compose nie
tworzy drugiego PostgreSQL. Brak Redis na obecnym etapie.

## Struktura

```text
apps/
  api/                 Fastify API i healthcheck
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

## Wymagania przy późniejszym uruchomieniu

- WSL2 (zalecany Ubuntu) i Docker Desktop z włączoną integracją WSL2.
- Node.js `>=22.14.0`.
- pnpm `10.6.2` (aktywowany przez Corepack).
- Supabase CLI.

Nie weryfikowano dostępności tych narzędzi w ramach przygotowania plików.

## WSL2 — przygotowanie środowiska

W terminalu bash w katalogu repozytorium:

```bash
corepack enable
pnpm install
cp .env.example .env
```

Uzupełnij wyłącznie klucze providerów, których rzeczywiście używasz. Nie dodawaj
`SUPABASE_SERVICE_ROLE_KEY` do ustawień `NEXT_PUBLIC_*` ani do klienta przeglądarki.

### Supabase

```bash
supabase start
supabase db reset
```

Konfiguracja lokalna jest w `supabase/config.toml`; schemat tworzy migracja w
`supabase/migrations`. Reset lokalnej bazy usuwa lokalne dane i odtwarza migracje
oraz pusty seed. Nie uruchamiaj równoległego PostgreSQL przez Compose.

### Aplikacje

Włączony Docker Desktop powinien udostępniać Docker CLI w WSL2.

```bash
docker compose up --build
```

Adresy lokalne:

- Web: <http://localhost:3000>
- API liveness: <http://localhost:4000/health>
- Worker liveness: <http://localhost:4001/health>
- Supabase API: <http://127.0.0.1:54321>
- Supabase Studio: <http://127.0.0.1:54323>

Compose nie czeka na Supabase, ponieważ ten etap nie łączy aplikacji z bazą.
Healthchecki potwierdzają wyłącznie dostępność procesów HTTP; nie oznaczają
gotowości integracji ani poprawności danych.

Zatrzymanie:

```bash
docker compose down
supabase stop
```

Reset bazy lokalnej (usuwa jej dane):

```bash
supabase db reset
```

## Testy i kontrola jakości

Po zainstalowaniu zależności:

```bash
pnpm lint
pnpm typecheck
pnpm test
```

Testy silnika ryzyka sprawdzają kill switch, limity pozycji i salda, świeżość
kwotowania, slippage, płynność oraz nieprawidłowe dane. W tym zadaniu testów nie
uruchomiono.

## Integracje i ograniczenia

- **Solana RPC/Jupiter:** niezaimplementowane. Przed rozpoczęciem adaptera należy
  sprawdzić aktualną dokumentację i wersję API.
- **Token Radar/AI:** brak providerów; konfiguracja bez klucza ma jawny status
  `provider_not_configured`.
- **Wallet Desk:** obecne rekordy przechowują wyłącznie adresy publiczne i metadane.
  Import seed phrase, kluczy prywatnych oraz podpisywanie są wyłączone.
- **Strategie/zlecenia:** silnik ryzyka jest czystą kontrolą deterministyczną;
  nie jest podłączony do endpointu handlowego.
- **PnL:** niezaimplementowane; nie powstają losowe wyceny ani wykresy.

## Następne etapy

1. Walidacja lokalnego toolchainu oraz uruchomienie lint/typecheck/test.
2. Klienci Supabase po stronie serwera/przeglądarki i testy RLS/autoryzacji.
3. Adaptery tylko do odczytu dla Solana RPC i dostawcy danych zewnętrznych.
4. UI terminala i zapis rzeczywistych, oznaczonych czasem snapshotów.
5. Paper trading; dopiero osobny przegląd bezpieczeństwa może rozważyć kolejne kroki.

Nie przechodź do integracji podpisywania ani mainnetu bez jawnej decyzji i projektu
bezpieczeństwa.
