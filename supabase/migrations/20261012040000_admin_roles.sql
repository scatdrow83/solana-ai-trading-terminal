alter table terminal.app_users
    add column if not exists is_admin boolean not null default false;
