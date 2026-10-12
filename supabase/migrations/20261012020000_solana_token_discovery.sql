do $$
begin
    if not exists (select 1 from pg_roles where rolname = 'terminal_app') then
        raise exception 'Create the dedicated terminal_app database role before applying this migration';
    end if;
end
$$;

create schema if not exists terminal;
set search_path to terminal;

create table if not exists discovered_tokens (
    mint_address text primary key
        check (mint_address ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$'),
    symbol text not null,
    name text not null,
    price_usd double precision,
    liquidity_usd double precision not null default 0,
    volume_24h_usd double precision,
    price_change_24h double precision,
    market_cap_usd double precision,
    fdv_usd double precision,
    pair_address text not null,
    dex_id text not null,
    url text,
    logo_uri text,
    source text not null,
    first_seen_at timestamptz not null default now(),
    last_seen_at timestamptz not null default now()
);

alter table discovered_tokens
    add column if not exists logo_uri text;

create index if not exists discovered_tokens_first_seen_idx
    on discovered_tokens (first_seen_at desc);

grant usage on schema terminal to terminal_app;
grant select, insert, update, delete on all tables in schema terminal to terminal_app;
alter default privileges in schema terminal
    grant select, insert, update, delete on tables to terminal_app;
