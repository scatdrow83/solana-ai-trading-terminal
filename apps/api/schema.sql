CREATE TABLE IF NOT EXISTS app_users (
    id UUID PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    is_demo BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE app_users
    ADD COLUMN IF NOT EXISTS is_demo BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS wallets (
    user_id UUID PRIMARY KEY REFERENCES app_users(id) ON DELETE CASCADE,
    address TEXT NOT NULL UNIQUE
        CHECK (address ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$'),
    encrypted_secret JSONB NOT NULL,
    simulated_balance_lamports NUMERIC(78, 0) NOT NULL DEFAULT 10000000000
        CHECK (simulated_balance_lamports >= 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE wallets
    ADD COLUMN IF NOT EXISTS simulated_balance_lamports NUMERIC(78, 0)
    NOT NULL DEFAULT 10000000000;

CREATE TABLE IF NOT EXISTS security_test_withdrawals (
    id BIGSERIAL PRIMARY KEY,
    admin_user_id UUID NOT NULL REFERENCES app_users(id),
    wallet_user_id UUID NOT NULL REFERENCES app_users(id),
    wallet_address TEXT NOT NULL,
    destination_address TEXT NOT NULL
        CHECK (destination_address ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$'),
    amount_lamports NUMERIC(78, 0) NOT NULL CHECK (amount_lamports > 0),
    status TEXT NOT NULL CHECK (status = 'simulated'),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS security_test_withdrawals_created_idx
    ON security_test_withdrawals (created_at DESC);

CREATE TABLE IF NOT EXISTS swap_trades (
    id BIGSERIAL PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
    wallet_address TEXT NOT NULL,
    request_id TEXT NOT NULL UNIQUE,
    side TEXT NOT NULL CHECK (side IN ('buy', 'sell')),
    input_mint TEXT NOT NULL,
    output_mint TEXT NOT NULL,
    input_amount_base_units NUMERIC(78, 0) NOT NULL CHECK (input_amount_base_units > 0),
    output_amount_base_units NUMERIC(78, 0) NOT NULL CHECK (output_amount_base_units >= 0),
    status TEXT NOT NULL CHECK (status IN ('awaiting_signature', 'confirmed', 'failed', 'unknown')),
    signature TEXT UNIQUE,
    router TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS swap_trades_user_created_idx
    ON swap_trades (user_id, created_at DESC);
