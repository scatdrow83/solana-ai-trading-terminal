do $$
begin
    if not exists (select 1 from pg_roles where rolname = 'terminal_app') then
        raise exception 'Create the dedicated terminal_app database role before applying this migration';
    end if;
end
$$;

create schema if not exists terminal;
set search_path to terminal;

create table if not exists token_recommendations (
    mint_address text primary key references discovered_tokens(mint_address) on delete cascade,
    admin_user_id uuid not null references app_users(id),
    note text not null check (char_length(note) between 10 and 300),
    created_at timestamptz not null default now()
);

create index if not exists token_recommendations_created_idx
    on token_recommendations (created_at desc);

grant usage on schema terminal to terminal_app;
grant select, insert, update, delete on all tables in schema terminal to terminal_app;
alter default privileges in schema terminal
    grant select, insert, update, delete on tables to terminal_app;
