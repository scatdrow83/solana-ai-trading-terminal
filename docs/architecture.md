# Architektura — etap fundamentów

```text
Przeglądarka
   | HTTP
   v
apps/web (Next.js) ---> apps/api (Fastify)
                            |
                            +--> Supabase (lokalnie przez Supabase CLI)

apps/worker (osobny proces, obecnie tylko healthcheck)
packages/shared
packages/risk-engine (reguły deterministyczne; nie wysyła transakcji)
```

Repozytorium jest monorepo pnpm. API pozostaje modularnym monolitem; worker jest
oddzielnym procesem, ale kolejki i Redis są odłożone do czasu, gdy będą potrzebne.
Supabase CLI zarządza PostgreSQL i Auth, dlatego Compose nie uruchamia drugiej bazy.

## Status komponentów

- Web: `Partial` — strona startowa informująca o wyłączonych integracjach.
- API: `Partial` — proces Fastify i liveness `/health`; brak autoryzowanych domenowych endpointów.
- Worker: `Partial` — proces i liveness; nie uruchamia zadań.
- Supabase: `Partial` — początkowy schemat i RLS; brak klienta aplikacyjnego.
- Risk engine: `Partial` — czyste reguły wejściowe; nie autoryzuje ani nie wykonuje transakcji.
- Portfele, skaner, AI, Jupiter, PnL i trading: `Planned` lub `Disabled`.

## Decyzje bezpieczeństwa

- API nie przyjmuje ani nie podpisuje transakcji w tym etapie.
- Ograniczenie `check (mode <> 'live')` uniemożliwia zapis zlecenia live w bazie.
- Nie ma tabel na klucze prywatne, frazy seed ani sekrety vaulta.
- Liveness nie potwierdza gotowości integracji z bazą ani z providerami.
- RLS wiąże rekordy użytkownika z `auth.uid()`; tabela audytowa jest tylko do odczytu
  i dopisywania przez właściciela.
