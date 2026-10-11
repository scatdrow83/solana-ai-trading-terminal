# Bezpieczeństwo

## Portfel konta

- Nowy portfel Solana jest generowany w przeglądarce przy rejestracji.
- Aplikacja wyświetla standardowy plik JSON keypair. Skopiuj go do bezpiecznego
  offline backupu; nikt z obsługi aplikacji nie ma możliwości jego odzyskania.
- Przed wysłaniem danych do API przeglądarka szyfruje 64-bajtowy secret key
  AES-256-GCM. Klucz AES jest wyprowadzany z hasła konta przez PBKDF2-SHA256
  (600 000 iteracji, losowa sól 16 B); IV GCM ma 12 B.
- PostgreSQL przechowuje hash hasła, adres publiczny i wyłącznie szyfrogram.
  Serwer API nigdy nie otrzymuje jawnego klucza ani frazy seed.
- Po zalogowaniu szyfrogram wraca przez proxy do przeglądarki. Klucz jest
  odszyfrowywany i utrzymywany w pamięci strony do wylogowania/zamknięcia.
  Nie jest zapisywany w localStorage.
- Utrata hasła bez osobnego backupu klucza może oznaczać trwałą utratę środków.
  Zmiana/reset hasła nie odzyskuje klucza.

## Swapy Mainnet

Swapy przez Jupiter wykonują rzeczywiste transakcje na Solana Mainnet. Każdy
swap wymaga osobnego kliknięcia „Sign & submit Mainnet swap”; dopiero wtedy
portfel odblokowany w tej przeglądarce podpisuje transakcję, która trafia do API
i Jupiter `/execute`. Nie ma dodatkowego popupu Phantom/Solflare. Przed kliknięciem
sprawdź kierunek, minty i kwotę. Kupno jest ograniczone do 1 SOL. Brak `JUPITER_API_KEY`
blokuje składanie i wykonywanie swapów.

Lokalne konto `admin@local.test` (hasło `admin`) jest kontem demonstracyjnym;
API sprawdza flagę demo w bazie i blokuje na nim endpointy order/execute.
Wyłącznie do lokalnego UI, nie używać portfela do przechowywania ani wysyłania
środków. Nie udostępniaj stagingu publicznie.

Zakładka Admin simulator (włączana wyłącznie przez
`LOCAL_SECURITY_SIMULATOR=true`) pokazuje metadane email/publiczny adres oraz
zmienia fikcyjne saldo 10 test SOL po symulowanej wypłacie. Zapisuje zdarzenie
audytowe, ale nie wywołuje Solana RPC, nie składa transakcji i nie wybiera ani
nie odczytuje `encrypted_secret`. Wyłącz tę funkcję ustawiając
`LOCAL_SECURITY_SIMULATOR=false` przed wystawieniem innego środowiska.

## Wymagania operacyjne

- Nie commituj sekretów. `APP_SECRET_KEY`, hasło bazy Supabase i
  `JUPITER_API_KEY` muszą mieć unikalne, silne wartości dla każdego środowiska.
- `SESSION_COOKIE_SECURE=false` jest wyłącznie dla lokalnego HTTP. Używaj `true`
  w staging/production za reverse proxy Caddy z automatycznym HTTPS.
- `docker-compose.yml` jest wariantem wyłącznie localhost. Zdalne warianty nie
  wystawiają API ani workera na hosta; publiczny web jest dostępny przez Caddy.
- Przed publicznym wdrożeniem dodaj rate limiting i ochronę brute-force,
  przeprowadź przegląd bezpieczeństwa, testy obciążeniowe i test odtwarzania
  kopii zapasowej.
- PostgreSQL używa wolumenu `postgres_data`; `docker compose down -v` usuwa
  bazę i historię kont.
- Klucz Jupiter pozostaje w kontenerze API i nie może być publikowany w
  zmiennych `NEXT_PUBLIC_*`.
- Zdalne Compose wymagają `DATABASE_INITIALIZE=false`; strukturę bazy aktualizuj
  wersjonowanymi migracjami Supabase przed wdrożeniem API. Aplikacja korzysta
  z osobnego schematu `terminal`, bez kolizji z `public.wallets`.
- Supabase działa jako zarządzany PostgreSQL; logowanie nadal obsługuje Flask,
  a nie Supabase Auth.
- Swapy używają prawdziwych środków; sprawdzaj adresy tokenów i status transakcji
  przez historię konta oraz Solscan.
