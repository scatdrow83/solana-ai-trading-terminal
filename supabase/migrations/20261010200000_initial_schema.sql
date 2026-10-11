create extension if not exists pgcrypto with schema extensions;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id)
  values (new.id)
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

create table public.wallets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  address text not null,
  label text,
  custody_type text not null default 'external'
    check (custody_type in ('external', 'custodial_disabled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, address)
);

create table public.wallet_metadata (
  wallet_id uuid primary key references public.wallets (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.strategies (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  enabled boolean not null default false,
  configuration jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.strategy_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  strategy_id uuid not null references public.strategies (id) on delete cascade,
  status text not null default 'pending'
    check (status in ('pending', 'running', 'completed', 'failed', 'cancelled')),
  started_at timestamptz,
  finished_at timestamptz,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table public.tokens (
  id uuid primary key default gen_random_uuid(),
  mint_address text not null unique,
  symbol text,
  name text,
  first_detected_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.token_market_snapshots (
  id uuid primary key default gen_random_uuid(),
  token_id uuid not null references public.tokens (id) on delete cascade,
  observed_at timestamptz not null default now(),
  price_usd numeric(38, 18),
  liquidity_usd numeric(38, 18),
  volume_24h_usd numeric(38, 18),
  price_change_24h numeric(18, 8),
  buyers integer check (buyers is null or buyers >= 0),
  sellers integer check (sellers is null or sellers >= 0),
  source text not null,
  freshness text not null default 'unknown'
    check (freshness in ('fresh', 'stale', 'unknown'))
);

create table public.token_assessments (
  id uuid primary key default gen_random_uuid(),
  token_id uuid not null references public.tokens (id) on delete cascade,
  score numeric(5, 2) check (score is null or score between 0 and 100),
  uncertainty numeric(5, 2)
    check (uncertainty is null or uncertainty between 0 and 100),
  rationale text,
  risk_factors jsonb not null default '[]'::jsonb,
  sources jsonb not null default '[]'::jsonb,
  provider_status text not null default 'provider_not_configured',
  assessed_at timestamptz not null default now()
);

create table public.trading_signals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  strategy_id uuid references public.strategies (id) on delete set null,
  token_id uuid not null references public.tokens (id) on delete cascade,
  signal text not null check (signal in ('watch', 'buy', 'sell', 'blocked')),
  rationale text,
  created_at timestamptz not null default now()
);

create table public.orders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  strategy_id uuid references public.strategies (id) on delete set null,
  wallet_id uuid references public.wallets (id) on delete set null,
  token_id uuid not null references public.tokens (id) on delete restrict,
  idempotency_key text not null,
  side text not null check (side in ('buy', 'sell')),
  mode text not null default 'live' check (mode = 'live'),
  status text not null default 'pending'
    check (status in ('pending', 'submitted', 'confirmed', 'failed', 'unknown', 'cancelled')),
  requested_amount_base_units numeric(78, 0) not null
    check (requested_amount_base_units > 0),
  quoted_price_usd numeric(38, 18),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, idempotency_key)
);

create table public.transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  order_id uuid references public.orders (id) on delete set null,
  signature text,
  status text not null default 'unknown'
    check (status in ('unknown', 'submitted', 'confirmed', 'failed')),
  fee_lamports numeric(78, 0) check (fee_lamports is null or fee_lamports >= 0),
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.positions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  wallet_id uuid references public.wallets (id) on delete set null,
  token_id uuid not null references public.tokens (id) on delete restrict,
  quantity_base_units numeric(78, 0) not null default 0
    check (quantity_base_units >= 0),
  average_entry_price_usd numeric(38, 18),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, wallet_id, token_id)
);

create table public.pnl_snapshots (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  observed_at timestamptz not null default now(),
  realized_pnl_usd numeric(38, 18) not null default 0,
  unrealized_pnl_usd numeric(38, 18),
  equity_usd numeric(38, 18),
  drawdown numeric(18, 8),
  fees_usd numeric(38, 18) not null default 0,
  valuation_status text not null default 'unknown'
    check (valuation_status in ('fresh', 'stale', 'unknown'))
);

create table public.system_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users (id) on delete cascade,
  severity text not null default 'info'
    check (severity in ('debug', 'info', 'warning', 'error')),
  event_type text not null,
  message text not null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table public.audit_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  action text not null,
  resource_type text not null,
  resource_id text,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index wallets_user_id_idx on public.wallets (user_id);
create index strategies_user_id_idx on public.strategies (user_id);
create index strategy_runs_user_created_idx on public.strategy_runs (user_id, created_at desc);
create index token_snapshots_token_observed_idx
  on public.token_market_snapshots (token_id, observed_at desc);
create index token_assessments_token_assessed_idx
  on public.token_assessments (token_id, assessed_at desc);
create index signals_user_created_idx on public.trading_signals (user_id, created_at desc);
create index orders_user_created_idx on public.orders (user_id, created_at desc);
create index transactions_user_created_idx on public.transactions (user_id, created_at desc);
create index positions_user_id_idx on public.positions (user_id);
create index pnl_snapshots_user_observed_idx
  on public.pnl_snapshots (user_id, observed_at desc);
create index system_events_user_created_idx
  on public.system_events (user_id, created_at desc);
create index audit_events_user_created_idx
  on public.audit_events (user_id, created_at desc);

create trigger profiles_updated_at before update on public.profiles
  for each row execute procedure public.set_updated_at();
create trigger wallets_updated_at before update on public.wallets
  for each row execute procedure public.set_updated_at();
create trigger wallet_metadata_updated_at before update on public.wallet_metadata
  for each row execute procedure public.set_updated_at();
create trigger strategies_updated_at before update on public.strategies
  for each row execute procedure public.set_updated_at();
create trigger tokens_updated_at before update on public.tokens
  for each row execute procedure public.set_updated_at();
create trigger orders_updated_at before update on public.orders
  for each row execute procedure public.set_updated_at();
create trigger transactions_updated_at before update on public.transactions
  for each row execute procedure public.set_updated_at();
create trigger positions_updated_at before update on public.positions
  for each row execute procedure public.set_updated_at();

alter table public.profiles enable row level security;
alter table public.wallets enable row level security;
alter table public.wallet_metadata enable row level security;
alter table public.strategies enable row level security;
alter table public.strategy_runs enable row level security;
alter table public.tokens enable row level security;
alter table public.token_market_snapshots enable row level security;
alter table public.token_assessments enable row level security;
alter table public.trading_signals enable row level security;
alter table public.orders enable row level security;
alter table public.transactions enable row level security;
alter table public.positions enable row level security;
alter table public.pnl_snapshots enable row level security;
alter table public.system_events enable row level security;
alter table public.audit_events enable row level security;

create policy "Users manage their profile" on public.profiles
  for all to authenticated using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);
create policy "Users manage their wallets" on public.wallets
  for all to authenticated using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
create policy "Users manage their wallet metadata" on public.wallet_metadata
  for all to authenticated using ((select auth.uid()) = user_id)
  with check (
    (select auth.uid()) = user_id
    and exists (
      select 1 from public.wallets
      where wallets.id = wallet_metadata.wallet_id
        and wallets.user_id = (select auth.uid())
    )
  );
create policy "Users manage their strategies" on public.strategies
  for all to authenticated using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
create policy "Users access their strategy runs" on public.strategy_runs
  for all to authenticated using ((select auth.uid()) = user_id)
  with check (
    (select auth.uid()) = user_id
    and exists (
      select 1 from public.strategies
      where strategies.id = strategy_runs.strategy_id
        and strategies.user_id = (select auth.uid())
    )
  );
create policy "Authenticated users read token catalog" on public.tokens
  for select to authenticated using (true);
create policy "Authenticated users read market snapshots" on public.token_market_snapshots
  for select to authenticated using (true);
create policy "Authenticated users read token assessments" on public.token_assessments
  for select to authenticated using (true);
create policy "Users manage their signals" on public.trading_signals
  for all to authenticated using ((select auth.uid()) = user_id)
  with check (
    (select auth.uid()) = user_id
    and (
      strategy_id is null
      or exists (
        select 1 from public.strategies
        where strategies.id = trading_signals.strategy_id
          and strategies.user_id = (select auth.uid())
      )
    )
  );
create policy "Users manage their orders" on public.orders
  for all to authenticated using ((select auth.uid()) = user_id)
  with check (
    (select auth.uid()) = user_id
    and (wallet_id is null or exists (
      select 1 from public.wallets
      where wallets.id = orders.wallet_id
        and wallets.user_id = (select auth.uid())
    ))
    and (strategy_id is null or exists (
      select 1 from public.strategies
      where strategies.id = orders.strategy_id
        and strategies.user_id = (select auth.uid())
    ))
  );
create policy "Users manage their transactions" on public.transactions
  for all to authenticated using ((select auth.uid()) = user_id)
  with check (
    (select auth.uid()) = user_id
    and (order_id is null or exists (
      select 1 from public.orders
      where orders.id = transactions.order_id
        and orders.user_id = (select auth.uid())
    ))
  );
create policy "Users manage their positions" on public.positions
  for all to authenticated using ((select auth.uid()) = user_id)
  with check (
    (select auth.uid()) = user_id
    and (wallet_id is null or exists (
      select 1 from public.wallets
      where wallets.id = positions.wallet_id
        and wallets.user_id = (select auth.uid())
    ))
  );
create policy "Users read their PnL snapshots" on public.pnl_snapshots
  for all to authenticated using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
create policy "Users read their system events" on public.system_events
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "Users read their audit events" on public.audit_events
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "Users append their audit events" on public.audit_events
  for insert to authenticated with check ((select auth.uid()) = user_id);

revoke all on function public.handle_new_user() from public, anon, authenticated;
revoke all on function public.set_updated_at() from public, anon, authenticated;
