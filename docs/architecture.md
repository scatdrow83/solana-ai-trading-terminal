# Architektura stagingu

```text
Przeglądarka (Next.js/React)
   | same-origin auth/trade proxy; wallet key generated, encrypted, decrypted
   v
apps/web -> apps/api (Python/Flask REST API) -> PostgreSQL
                         |-> DexScreener (notowania)
                         |-> Solana Mainnet RPC (decimals tokenu)
                         `-> Jupiter Swap API v2 (/order, /execute)

apps/worker (osobny proces, obecnie tylko healthcheck)
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
- Konto lokalnego demo ma flagę `is_demo`; endpointy tworzenia i wykonywania
  swapów zwracają `403` niezależnie od konfiguracji Jupiter. Hasło demonstracyjne
  jest wyłącznie do lokalnych testów UI; tego portfela nie należy zasilać.
- Osobny simulator (`LOCAL_SECURITY_SIMULATOR=true`) zwraca wyłącznie email,
  publiczny adres i fikcyjne saldo 10 test SOL; symulowana wypłata aktualizuje
  testowy ledger i tabelę audytu bez RPC ani transakcji Mainnet. Admin jest
  rozpoznawany przez lokalne demo konto `admin@local.test`. Ustaw flagę na
  `false` poza lokalnym stagingiem.
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
- Nie ma rate limiting logowania, indeksowania sald, PnL ani automatycznych
  strategii. Przed publicznym wdrożeniem przeprowadź niezależny przegląd
  bezpieczeństwa, testy obciążeniowe i procedurę odtworzenia backupu.
- DexScreener jest dostawcą danych rynkowych; ceny i output kwotowania nie są
  gwarantowane.
