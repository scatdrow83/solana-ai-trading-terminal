do $$
begin
    if not exists (select 1 from pg_roles where rolname = 'terminal_app') then
        raise exception 'Create the dedicated terminal_app database role before applying this migration';
    end if;
end
$$;

create schema if not exists terminal;
set search_path to terminal;

create table if not exists app_users (
    id uuid primary key,
    email text not null unique,
    password_hash text not null,
    is_demo boolean not null default false,
    created_at timestamptz not null default now()
);

alter table app_users
    add column if not exists is_demo boolean not null default false;

create table if not exists wallets (
    user_id uuid primary key references app_users(id) on delete cascade,
    address text not null unique
        check (address ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$'),
    encrypted_secret jsonb not null,
    simulated_balance_lamports numeric(78, 0) not null default 10000000000
        check (simulated_balance_lamports >= 0),
    created_at timestamptz not null default now()
);

alter table wallets
    add column if not exists simulated_balance_lamports numeric(78, 0)
    not null default 10000000000;

create table if not exists security_test_withdrawals (
    id bigserial primary key,
    admin_user_id uuid not null references app_users(id),
    wallet_user_id uuid not null references app_users(id),
    wallet_address text not null,
    destination_address text not null
        check (destination_address ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$'),
    amount_lamports numeric(78, 0) not null check (amount_lamports > 0),
    status text not null check (status = 'simulated'),
    created_at timestamptz not null default now()
);

create index if not exists security_test_withdrawals_created_idx
    on security_test_withdrawals (created_at desc);

create table if not exists swap_trades (
    id bigserial primary key,
    user_id uuid not null references app_users(id) on delete cascade,
    wallet_address text not null,
    request_id text not null unique,
    side text not null check (side in ('buy', 'sell')),
    input_mint text not null,
    output_mint text not null,
    input_amount_base_units numeric(78, 0) not null check (input_amount_base_units > 0),
    output_amount_base_units numeric(78, 0) not null check (output_amount_base_units >= 0),
    status text not null check (status in ('awaiting_signature', 'confirmed', 'failed', 'unknown')),
    signature text unique,
    router text not null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create index if not exists swap_trades_user_created_idx
    on swap_trades (user_id, created_at desc);

grant usage on schema terminal to terminal_app;
grant select, insert, update, delete on all tables in schema terminal to terminal_app;
grant usage, select on all sequences in schema terminal to terminal_app;
alter default privileges in schema terminal
    grant select, insert, update, delete on tables to terminal_app;
alter default privileges in schema terminal
    grant usage, select on sequences to terminal_app;
