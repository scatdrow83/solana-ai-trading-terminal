# Bezpieczeństwo

## Aktualny zakres

To jest szkielet developerski. Podpisywanie, import sekretów portfeli, handel live,
autoryzacja API i integracje dostawców pozostają wyłączone lub niezaimplementowane.
Status HTTP `/health` potwierdza wyłącznie działanie procesu.

## Zasady

- Nie wpisuj sekretów do Git, logów, obrazu Dockera ani publicznych zmiennych `NEXT_PUBLIC_*`.
- `SUPABASE_SERVICE_ROLE_KEY` i klucze providerów są sekretami serwerowymi; nie są
  używane przez frontend.
- Nie przesyłaj kluczy prywatnych, seed phrase ani danych wrażliwych do AI.
- Nie włączaj podpisywania ani live trading, dopóki nie zostanie zaprojektowany i
  zweryfikowany zewnętrzny KMS/HSM/vault oraz ścieżka autoryzacji.
- Zgłoś podatność prywatnie maintainerowi repozytorium; nie umieszczaj sekretów
  ani danych użytkowników w zgłoszeniu.

## Lokalne sekrety

Skopiuj `.env.example` do `.env` dopiero przy późniejszym uruchomieniu. `.env` jest
ignorowany przez Git. Po ujawnieniu klucza należy go unieważnić u dostawcy.
