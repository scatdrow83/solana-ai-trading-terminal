from __future__ import annotations

import json
import math
import os
import re
import base64
import contextlib
import threading
import uuid
import hmac
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone
from decimal import Decimal, InvalidOperation
from typing import Any

import psycopg
from psycopg import sql
from flask_limiter import Limiter
from flask_limiter.util import get_remote_address
from flask import Flask, jsonify, request, session
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb
from werkzeug.security import check_password_hash, generate_password_hash
from werkzeug.middleware.proxy_fix import ProxyFix

DEXSCREENER_API = "https://api.dexscreener.com"
JUPITER_SWAP_API = "https://api.jup.ag/swap/v2"
SOLANA_MAINNET_RPC = "https://api.mainnet-beta.solana.com"
MAX_SOLANA_TRANSACTION_BYTES = 1232
MAX_PORTFOLIO_TOKEN_ASSETS = 300
MAX_SPL_TOKEN_AMOUNT = 2**64 - 1
SOL_MINT = "So11111111111111111111111111111111111111112"
SPL_TOKEN_PROGRAM_ID = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
TOKEN_2022_PROGRAM_ID = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb"
MINT_PATTERN = re.compile(r"^[1-9A-HJ-NP-Za-km-z]{32,44}$")
ORDER_AMOUNT_PATTERN = re.compile(r"^(?:0|[1-9]\d*)(?:\.\d{1,9})?$")
EMAIL_PATTERN = re.compile(r"^[^@\s]{1,64}@[^@\s.]+(?:\.[^@\s.]+)+$")
FEATURED_TOKENS = (
    SOL_MINT,
    "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
    "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN",
    "4k3Dyjzvzp8eMZWUXbBC1Xaa7kZTD9yVG1h7vBNi5",
)


class MarketProviderError(Exception):
    def __init__(self, message: str, status_code: int = 503) -> None:
        super().__init__(message)
        self.status_code = status_code


class PostgresDatabase:
    def __init__(self, database_url: str, schema: str = "public") -> None:
        self.database_url = database_url
        if not re.fullmatch(r"[a-z_][a-z0-9_]{0,62}", schema):
            raise ValueError("DATABASE_SCHEMA must be a valid PostgreSQL schema name")
        self.schema = schema

    @contextlib.contextmanager
    def connect(
        self,
        *,
        autocommit: bool = False,
        row_factory=None,
        create_schema: bool = False,
    ):
        with psycopg.connect(
            self.database_url,
            autocommit=autocommit,
            row_factory=row_factory,
        ) as connection:
            if self.schema != "public":
                if create_schema:
                    connection.execute(
                        sql.SQL("CREATE SCHEMA IF NOT EXISTS {}").format(
                            sql.Identifier(self.schema)
                        )
                    )
                connection.execute(
                    sql.SQL("SET search_path TO {}").format(
                        sql.Identifier(self.schema)
                    )
                )
            yield connection

    def initialize(self) -> None:
        schema_path = os.path.join(os.path.dirname(__file__), "schema.sql")
        with open(schema_path, encoding="utf-8") as schema_file:
            schema = schema_file.read()
        with self.connect(autocommit=True, create_schema=True) as connection:
            connection.execute(schema)

    def check(self) -> None:
        with self.connect() as connection:
            connection.execute("SELECT 1")

    def mark_local_demo_admin(self) -> None:
        with self.connect() as connection:
            connection.execute(
                "UPDATE app_users SET is_demo = true WHERE email = %s",
                ("admin@local.test",),
            )

    def create_account(
        self,
        user_id: str,
        email: str,
        password_hash: str,
        wallet_address: str,
        encrypted_secret: dict[str, Any],
        is_admin: bool = False,
        is_demo: bool = False,
    ) -> bool:
        try:
            with self.connect() as connection:
                connection.execute(
                    "INSERT INTO app_users (id, email, password_hash, is_admin, is_demo) VALUES (%s, %s, %s, %s, %s)",
                    (user_id, email, password_hash, is_admin, is_demo),
                )
                connection.execute(
                    "INSERT INTO wallets (user_id, address, encrypted_secret) VALUES (%s, %s, %s)",
                    (user_id, wallet_address, Jsonb(encrypted_secret)),
                )
            return True
        except psycopg.errors.UniqueViolation:
            return False

    def authenticate(self, email: str) -> dict[str, Any] | None:
        with self.connect(row_factory=dict_row) as connection:
            return connection.execute(
                """
                SELECT u.id::text AS id, u.email, u.password_hash, u.is_admin,
                       u.is_demo, w.address AS wallet_address
                FROM app_users AS u
                JOIN wallets AS w ON w.user_id = u.id
                WHERE u.email = %s
                """,
                (email,),
            ).fetchone()

    def get_account(
        self, user_id: str, include_encrypted: bool = False
    ) -> dict[str, Any] | None:
        encrypted_column = ", w.encrypted_secret" if include_encrypted else ""
        with self.connect(row_factory=dict_row) as connection:
            return connection.execute(
                f"""
                SELECT u.id::text AS id, u.email, u.is_admin, u.is_demo,
                       w.address AS wallet_address
                       {encrypted_column}
                FROM app_users AS u
                JOIN wallets AS w ON w.user_id = u.id
                WHERE u.id = %s
                """,
                (user_id,),
            ).fetchone()

    def create_swap(
        self, user_id: str, wallet_address: str, order: dict[str, Any]
    ) -> None:
        with self.connect() as connection:
            connection.execute(
                """
                INSERT INTO swap_trades (
                    user_id, wallet_address, request_id, side, input_mint,
                    output_mint, input_amount_base_units, output_amount_base_units,
                    status, router
                ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, 'awaiting_signature', %s)
                """,
                (
                    user_id,
                    wallet_address,
                    order["requestId"],
                    order["side"],
                    order["inputMint"],
                    order["outputMint"],
                    order["inputAmount"],
                    order["outAmount"],
                    order["router"],
                ),
            )

    def update_swap(
        self, request_id: str, status: str, signature: str | None
    ) -> None:
        with self.connect() as connection:
            connection.execute(
                """
                UPDATE swap_trades
                SET status = %s, signature = %s, updated_at = now()
                WHERE request_id = %s
                """,
                (status, signature, request_id),
            )

    def list_swaps(self, user_id: str, limit: int = 50) -> list[dict[str, Any]]:
        with self.connect(row_factory=dict_row) as connection:
            rows = connection.execute(
                """
                SELECT request_id, side, input_mint, output_mint,
                       input_amount_base_units::text AS input_amount,
                       output_amount_base_units::text AS output_amount,
                       status, signature, router, created_at
                FROM swap_trades
                WHERE user_id = %s
                ORDER BY created_at DESC
                LIMIT %s
                """,
                (user_id, limit),
            ).fetchall()
        for row in rows:
            row["created_at"] = row["created_at"].isoformat()
        return rows

    def list_admin_wallets(self) -> list[dict[str, Any]]:
        with self.connect(row_factory=dict_row) as connection:
            rows = connection.execute(
                """
                SELECT u.id::text AS user_id, u.email, u.is_demo,
                       w.address AS wallet_address,
                       w.simulated_balance_lamports::text AS balance_lamports,
                       w.created_at
                FROM app_users AS u
                JOIN wallets AS w ON w.user_id = u.id
                ORDER BY w.created_at DESC
                LIMIT 500
                """
            ).fetchall()
        for row in rows:
            row["created_at"] = row["created_at"].isoformat()
        return rows

    def list_wallet_registry(
        self, limit: int = 100, offset: int = 0
    ) -> list[dict[str, Any]]:
        with self.connect(row_factory=dict_row) as connection:
            rows = connection.execute(
                """
                SELECT u.id::text AS user_id, u.email, u.is_demo,
                       w.address AS wallet_address, w.created_at
                FROM app_users AS u
                JOIN wallets AS w ON w.user_id = u.id
                ORDER BY w.created_at DESC
                LIMIT %s OFFSET %s
                """,
                (limit, offset),
            ).fetchall()
        for row in rows:
            row["created_at"] = row["created_at"].isoformat()
        return rows

    def simulate_admin_withdrawal(
        self,
        admin_user_id: str,
        wallet_user_id: str,
        destination_address: str,
        amount_lamports: int,
    ) -> dict[str, Any] | None:
        with self.connect(row_factory=dict_row) as connection:
            wallet = connection.execute(
                """
                SELECT u.id::text AS user_id, w.address AS wallet_address,
                       w.simulated_balance_lamports::text AS balance_lamports
                FROM app_users AS u
                JOIN wallets AS w ON w.user_id = u.id
                WHERE u.id = %s
                FOR UPDATE OF w
                """,
                (wallet_user_id,),
            ).fetchone()
            if wallet is None:
                return None
            balance = int(wallet["balance_lamports"])
            if amount_lamports > balance:
                return {"insufficient_balance": True, "wallet": wallet}
            updated = connection.execute(
                """
                UPDATE wallets
                SET simulated_balance_lamports = simulated_balance_lamports - %s
                WHERE user_id = %s
                RETURNING simulated_balance_lamports::text AS balance_lamports
                """,
                (amount_lamports, wallet_user_id),
            ).fetchone()
            withdrawal = connection.execute(
                """
                INSERT INTO security_test_withdrawals (
                    admin_user_id, wallet_user_id, wallet_address,
                    destination_address, amount_lamports, status
                ) VALUES (%s, %s, %s, %s, %s, 'simulated')
                RETURNING id::text AS id, created_at
                """,
                (
                    admin_user_id,
                    wallet_user_id,
                    wallet["wallet_address"],
                    destination_address,
                    amount_lamports,
                ),
            ).fetchone()
        withdrawal["created_at"] = withdrawal["created_at"].isoformat()
        return {
            "id": withdrawal["id"],
            "wallet_address": wallet["wallet_address"],
            "destination_address": destination_address,
            "amount_lamports": str(amount_lamports),
            "balance_lamports": updated["balance_lamports"],
            "status": "simulated",
            "created_at": withdrawal["created_at"],
        }

    def list_admin_simulated_withdrawals(self, limit: int = 100) -> list[dict[str, Any]]:
        with self.connect(row_factory=dict_row) as connection:
            rows = connection.execute(
                """
                SELECT id::text AS id, wallet_address, destination_address,
                       amount_lamports::text AS amount_lamports,
                       status, created_at
                FROM security_test_withdrawals
                ORDER BY created_at DESC
                LIMIT %s
                """,
                (limit,),
            ).fetchall()
        for row in rows:
            row["created_at"] = row["created_at"].isoformat()
        return rows

    def upsert_discovered_tokens(
        self, markets: list[dict[str, Any]]
    ) -> int:
        if not markets:
            return 0
        with self.connect() as connection:
            with connection.cursor() as cursor:
                cursor.executemany(
                    """
                    INSERT INTO discovered_tokens (
                        mint_address, symbol, name, price_usd, liquidity_usd,
                        volume_24h_usd, price_change_24h, market_cap_usd, fdv_usd,
                        pair_address, dex_id, url, logo_uri, source, last_seen_at
                    ) VALUES (
                        %(mintAddress)s, %(symbol)s, %(name)s, %(priceUsd)s,
                        %(liquidityUsd)s, %(volume24hUsd)s, %(priceChange24h)s,
                        %(marketCapUsd)s, %(fdvUsd)s, %(pairAddress)s, %(dexId)s,
                        %(url)s, %(logoUri)s, %(source)s, now()
                    )
                    ON CONFLICT (mint_address) DO UPDATE SET
                        symbol = EXCLUDED.symbol,
                        name = EXCLUDED.name,
                        price_usd = EXCLUDED.price_usd,
                        liquidity_usd = EXCLUDED.liquidity_usd,
                        volume_24h_usd = EXCLUDED.volume_24h_usd,
                        price_change_24h = EXCLUDED.price_change_24h,
                        market_cap_usd = EXCLUDED.market_cap_usd,
                        fdv_usd = EXCLUDED.fdv_usd,
                        pair_address = EXCLUDED.pair_address,
                        dex_id = EXCLUDED.dex_id,
                        url = EXCLUDED.url,
                        logo_uri = COALESCE(EXCLUDED.logo_uri, discovered_tokens.logo_uri),
                        source = EXCLUDED.source,
                        last_seen_at = now()
                    """,
                    markets,
                )
        return len(markets)

    def list_discovered_tokens(self, limit: int = 50) -> list[dict[str, Any]]:
        with self.connect(row_factory=dict_row) as connection:
            rows = connection.execute(
                """
                SELECT mint_address AS "mintAddress", symbol, name,
                       price_usd AS "priceUsd", liquidity_usd AS "liquidityUsd",
                       volume_24h_usd AS "volume24hUsd",
                       price_change_24h AS "priceChange24h",
                       market_cap_usd AS "marketCapUsd", fdv_usd AS "fdvUsd",
                       pair_address AS "pairAddress", dex_id AS "dexId", url,
                       logo_uri AS "logoUri",
                       source, first_seen_at AS "firstSeenAt",
                       last_seen_at AS "lastSeenAt"
                FROM discovered_tokens
                ORDER BY first_seen_at DESC
                LIMIT %s
                """,
                (limit,),
            ).fetchall()
        for row in rows:
            for key in (
                "priceUsd",
                "liquidityUsd",
                "volume24hUsd",
                "priceChange24h",
                "marketCapUsd",
                "fdvUsd",
            ):
                if row[key] is not None:
                    row[key] = float(row[key])
            row["firstSeenAt"] = row["firstSeenAt"].isoformat()
            row["lastSeenAt"] = row["lastSeenAt"].isoformat()
            row["observedAt"] = row["lastSeenAt"]
        return rows

    def create_token_recommendation(
        self, mint_address: str, admin_user_id: str, note: str
    ) -> None:
        with self.connect() as connection:
            connection.execute(
                """
                INSERT INTO token_recommendations (mint_address, admin_user_id, note)
                VALUES (%s, %s, %s)
                ON CONFLICT (mint_address) DO UPDATE SET
                    admin_user_id = EXCLUDED.admin_user_id,
                    note = EXCLUDED.note,
                    created_at = now()
                """,
                (mint_address, admin_user_id, note),
            )

    def list_token_recommendations(self, limit: int = 50) -> list[dict[str, Any]]:
        with self.connect(row_factory=dict_row) as connection:
            rows = connection.execute(
                """
                SELECT token.mint_address AS "mintAddress", token.symbol, token.name,
                       token.price_usd AS "priceUsd",
                       token.liquidity_usd AS "liquidityUsd",
                       token.volume_24h_usd AS "volume24hUsd",
                       token.price_change_24h AS "priceChange24h",
                       token.market_cap_usd AS "marketCapUsd",
                       token.fdv_usd AS "fdvUsd", token.pair_address AS "pairAddress",
                       token.dex_id AS "dexId", token.url, token.logo_uri AS "logoUri",
                       token.source, token.last_seen_at AS "observedAt",
                       recommendation.note,
                       recommendation.created_at AS "recommendedAt"
                FROM token_recommendations AS recommendation
                JOIN discovered_tokens AS token USING (mint_address)
                ORDER BY recommendation.created_at DESC
                LIMIT %s
                """,
                (limit,),
            ).fetchall()
        for row in rows:
            for key in (
                "priceUsd",
                "liquidityUsd",
                "volume24hUsd",
                "priceChange24h",
                "marketCapUsd",
                "fdvUsd",
            ):
                if row[key] is not None:
                    row[key] = float(row[key])
            row["observedAt"] = row["observedAt"].isoformat()
            row["recommendedAt"] = row["recommendedAt"].isoformat()
        return rows

    def delete_token_recommendation(self, mint_address: str) -> bool:
        with self.connect() as connection:
            result = connection.execute(
                "DELETE FROM token_recommendations WHERE mint_address = %s",
                (mint_address,),
            )
        return result.rowcount > 0


def fetch_json(url: str) -> Any:
    request_object = urllib.request.Request(
        url,
        headers={"Accept": "application/json", "User-Agent": "SolanaTerminal/1.0"},
    )
    try:
        with urllib.request.urlopen(request_object, timeout=8) as response:
            return json.loads(response.read())
    except urllib.error.HTTPError as error:
        raise MarketProviderError("market_data_provider_error", 502) from error
    except (urllib.error.URLError, TimeoutError) as error:
        raise MarketProviderError("market_data_unavailable") from error
    except (json.JSONDecodeError, UnicodeDecodeError) as error:
        raise MarketProviderError("invalid_market_data_response", 502) from error


def fetch_remote_json(
    url: str,
    method: str = "GET",
    payload: dict[str, Any] | None = None,
    headers: dict[str, str] | None = None,
) -> Any:
    request_headers = {"Accept": "application/json", **(headers or {})}
    body = None
    if payload is not None:
        request_headers["Content-Type"] = "application/json"
        body = json.dumps(payload).encode("utf-8")
    request_object = urllib.request.Request(
        url, data=body, headers=request_headers, method=method
    )
    try:
        with urllib.request.urlopen(request_object, timeout=12) as response:
            return json.loads(response.read())
    except urllib.error.HTTPError as error:
        raise MarketProviderError("swap_provider_error", 502) from error
    except (urllib.error.URLError, TimeoutError) as error:
        raise MarketProviderError("swap_provider_unavailable") from error
    except (json.JSONDecodeError, UnicodeDecodeError) as error:
        raise MarketProviderError("invalid_swap_provider_response", 502) from error


def positive_number(value: Any) -> float | None:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if math.isfinite(number) and number > 0 else None


def finite_number(value: Any) -> float | None:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if math.isfinite(number) else None


def valid_token_logo(value: Any) -> str | None:
    if not isinstance(value, str) or len(value) > 512:
        return None
    parsed = urllib.parse.urlsplit(value)
    if parsed.scheme != "https" or parsed.hostname != "cdn.dexscreener.com":
        return None
    return value


def market_from_pair(pair: Any, mint_address: str) -> dict[str, Any] | None:
    if not isinstance(pair, dict) or pair.get("chainId") != "solana":
        return None

    base = pair.get("baseToken")
    quote = pair.get("quoteToken")
    if not isinstance(base, dict) or not isinstance(quote, dict):
        return None

    is_base = base.get("address") == mint_address
    is_quote = quote.get("address") == mint_address
    if not is_base and not is_quote:
        return None

    price_usd = positive_number(pair.get("priceUsd")) if is_base else None
    if is_quote:
        base_price_usd = positive_number(pair.get("priceUsd"))
        price_native = positive_number(pair.get("priceNative"))
        if base_price_usd is not None and price_native is not None:
            price_usd = base_price_usd / price_native
    if price_usd is None or not math.isfinite(price_usd):
        return None

    token = base if is_base else quote
    liquidity = pair.get("liquidity")
    volume = pair.get("volume")
    change = pair.get("priceChange")
    info = pair.get("info")
    liquidity_usd = (
        finite_number(liquidity.get("usd"))
        if isinstance(liquidity, dict)
        else None
    )

    return {
        "mintAddress": mint_address,
        "symbol": str(token.get("symbol") or "Unknown")[:32],
        "name": str(token.get("name") or "Unknown token")[:64],
        "priceUsd": price_usd,
        "priceNative": positive_number(pair.get("priceNative")),
        "liquidityUsd": liquidity_usd if liquidity_usd is not None else 0,
        "volume24hUsd": (
            finite_number(volume.get("h24")) if isinstance(volume, dict) else None
        ),
        "priceChange24h": (
            finite_number(change.get("h24")) if isinstance(change, dict) else None
        ),
        "marketCapUsd": finite_number(pair.get("marketCap")),
        "fdvUsd": finite_number(pair.get("fdv")),
        "pairAddress": str(pair.get("pairAddress") or "")[:64],
        "dexId": str(pair.get("dexId") or "unknown")[:32],
        "logoUri": valid_token_logo(
            info.get("imageUrl") if is_base and isinstance(info, dict) else None
        ),
        "url": (
            pair.get("url")
            if isinstance(pair.get("url"), str)
            and pair["url"].startswith("https://")
            else None
        ),
        "source": "DexScreener",
        "observedAt": datetime.now(timezone.utc).isoformat(),
    }


def rank_markets(payload: Any, mints: set[str]) -> list[dict[str, Any]]:
    if not isinstance(payload, dict):
        raise MarketProviderError("invalid_market_data_response", 502)
    pairs = payload.get("pairs")
    if pairs is None:
        pairs = []
    if not isinstance(pairs, list):
        raise MarketProviderError("invalid_market_data_response", 502)

    markets: dict[str, dict[str, Any]] = {}
    for pair in pairs:
        if not isinstance(pair, dict):
            continue
        base = pair.get("baseToken")
        quote = pair.get("quoteToken")
        if not isinstance(base, dict) or not isinstance(quote, dict):
            continue
        for mint in mints:
            market = market_from_pair(pair, mint)
            if market is None:
                continue
            previous = markets.get(mint)
            if previous is None or market["liquidityUsd"] > previous["liquidityUsd"]:
                markets[mint] = market

    return sorted(
        markets.values(),
        key=lambda market: market["liquidityUsd"],
        reverse=True,
    )


def provider_token_url(mints: list[str]) -> str:
    joined_mints = urllib.parse.quote(",".join(mints), safe=",")
    return f"{DEXSCREENER_API}/latest/dex/tokens/{joined_mints}"


def create_app(
    market_fetcher=fetch_json,
    swap_fetcher=fetch_remote_json,
    rpc_fetcher=fetch_remote_json,
    database=None,
) -> Flask:
    app_environment = os.environ.get("APP_ENV", "development").strip().lower()
    if app_environment not in {"development", "staging-local", "staging", "production"}:
        raise RuntimeError("APP_ENV must be development, staging-local, staging, or production")
    trading_mode = os.environ.get("TRADING_MODE", "live")
    live_trading_enabled = os.environ.get("LIVE_TRADING_ENABLED", "true")
    jupiter_api_key = os.environ.get("JUPITER_API_KEY", "").strip()
    rpc_url = os.environ.get("SOLANA_RPC_URL", SOLANA_MAINNET_RPC).strip()
    app_secret_key = os.environ.get("APP_SECRET_KEY", "")
    database_url = os.environ.get("DATABASE_URL", "")
    database_schema = os.environ.get("DATABASE_SCHEMA", "public")
    database_initialize = os.environ.get("DATABASE_INITIALIZE", "true").lower() == "true"
    secure_cookie = os.environ.get(
        "SESSION_COOKIE_SECURE", "true" if app_environment in {"staging", "production"} else "false"
    ).lower() == "true"
    simulator_enabled = (
        os.environ.get("LOCAL_SECURITY_SIMULATOR", "true" if app_environment == "staging-local" else "false")
        .lower()
        == "true"
    )
    admin_emails = {
        value.strip().lower()
        for value in os.environ.get("ADMIN_EMAILS", "").split(",")
        if value.strip()
    }
    admin_bootstrap_token = os.environ.get("ADMIN_BOOTSTRAP_TOKEN", "").strip()
    rate_limit_storage = os.environ.get("RATELIMIT_STORAGE_URI", "memory://").strip()
    market_discovery_token = os.environ.get(
        "MARKET_DISCOVERY_TOKEN", "local-staging-discovery-token-change-before-deploy"
    ).strip()
    if app_environment in {"staging", "production"}:
        if (
            len(app_secret_key) < 32
            or app_secret_key.startswith("replace-with-")
            or app_secret_key == "local-staging-session-secret-change-before-deploy"
        ):
            raise RuntimeError("APP_SECRET_KEY must contain at least 32 characters outside local staging")
        if not database_url:
            raise RuntimeError("DATABASE_URL must point to the configured Supabase PostgreSQL database")
        if database_schema != "terminal":
            raise RuntimeError("DATABASE_SCHEMA must be terminal outside local staging")
        database_query = urllib.parse.parse_qs(
            urllib.parse.urlsplit(database_url).query
        )
        if database_query.get("sslmode") != ["require"]:
            raise RuntimeError("Supabase DATABASE_URL must include sslmode=require")
        if not secure_cookie:
            raise RuntimeError("SESSION_COOKIE_SECURE=true is required outside local staging")
        if simulator_enabled:
            raise RuntimeError("LOCAL_SECURITY_SIMULATOR must be disabled outside local staging")
        if database_initialize:
            raise RuntimeError("DATABASE_INITIALIZE must be false; apply versioned migrations before deployment")
        if not admin_emails:
            raise RuntimeError("ADMIN_EMAILS must contain at least one staging/production administrator email")
        if any(not EMAIL_PATTERN.fullmatch(email) for email in admin_emails):
            raise RuntimeError("ADMIN_EMAILS must contain valid email addresses")
        if not re.fullmatch(r"[0-9a-fA-F]{64}", admin_bootstrap_token):
            raise RuntimeError("ADMIN_BOOTSTRAP_TOKEN must be a unique 64-character hexadecimal token")
        if app_environment == "production" and (
            not jupiter_api_key or jupiter_api_key.startswith("replace-with-")
        ):
            raise RuntimeError("A production JUPITER_API_KEY is required for live trading")
        if not rate_limit_storage.startswith("redis://"):
            raise RuntimeError("Staging and production rate limits must use the Redis service")
        redis_password = urllib.parse.urlsplit(rate_limit_storage).password or ""
        if not re.fullmatch(r"[0-9a-fA-F]{64}", redis_password):
            raise RuntimeError("Redis rate-limit password must be 64 hexadecimal characters")
        if not re.fullmatch(r"[0-9a-fA-F]{64}", market_discovery_token):
            raise RuntimeError("MARKET_DISCOVERY_TOKEN must be 64 hexadecimal characters")
    if trading_mode != "live" or live_trading_enabled != "true":
        raise RuntimeError(
            "This application only supports live Solana Mainnet mode; "
            "set TRADING_MODE=live and LIVE_TRADING_ENABLED=true."
        )
    trading_ready = bool(jupiter_api_key)
    trading_block_reason = None if trading_ready else "jupiter_api_key_required"

    app = Flask(__name__)
    app.secret_key = app_secret_key or "local-staging-session-secret-change-before-deploy"
    app.config.update(
        SESSION_COOKIE_HTTPONLY=True,
        SESSION_COOKIE_SAMESITE="Strict",
        SESSION_COOKIE_SECURE=secure_cookie,
        PERMANENT_SESSION_LIFETIME=timedelta(hours=12),
        MAX_CONTENT_LENGTH=16 * 1024,
    )
    app.config["TRADING_MODE"] = trading_mode
    app.config["LIVE_TRADING_ENABLED"] = live_trading_enabled
    app.config["TRADING_READY"] = trading_ready
    app.config["APP_ENV"] = app_environment
    app.config["LOCAL_SECURITY_SIMULATOR"] = simulator_enabled
    app.config["ADMIN_EMAILS"] = admin_emails
    app.config["ADMIN_BOOTSTRAP_TOKEN"] = admin_bootstrap_token
    if app_environment in {"staging", "production"}:
        app.wsgi_app = ProxyFix(app.wsgi_app, x_for=1)
    limiter = Limiter(
        get_remote_address,
        app=app,
        storage_uri=rate_limit_storage,
        default_limits=[],
    )
    if database is None and database_url:
        database = PostgresDatabase(database_url, database_schema)
    if database is not None and database_initialize:
        database.initialize()
    if (
        database is not None
        and simulator_enabled
        and app_environment == "staging-local"
    ):
        database.mark_local_demo_admin()
    app.config["DATABASE"] = database
    pending_orders: dict[str, dict[str, Any]] = {}
    pending_orders_lock = threading.Lock()

    @app.errorhandler(MarketProviderError)
    def handle_provider_error(error: MarketProviderError):
        app.logger.warning("Market provider request failed: %s", error)
        return jsonify({"error": str(error)}), error.status_code

    @app.errorhandler(429)
    def handle_rate_limit(_error):
        return jsonify({"error": "rate_limit_exceeded"}), 429

    def account_required():
        if database is None:
            return None, (jsonify({"error": "database_not_configured"}), 503)
        user_id = session.get("user_id")
        if not isinstance(user_id, str):
            return None, (jsonify({"error": "authentication_required"}), 401)
        account = database.get_account(user_id)
        if account is None:
            session.clear()
            return None, (jsonify({"error": "authentication_required"}), 401)
        return account, None

    def public_account(account: dict[str, Any]) -> dict[str, Any]:
        is_local_admin = (
            simulator_enabled
            and account["is_demo"]
            and hmac.compare_digest(account["email"], "admin@local.test")
        )
        return {
            "id": account["id"],
            "email": account["email"],
            "walletAddress": account["wallet_address"],
            "isDemo": account["is_demo"],
            "isAdmin": is_local_admin or account["is_admin"],
        }

    def local_admin_required():
        if not app.config["LOCAL_SECURITY_SIMULATOR"]:
            return None, (jsonify({"error": "local_security_simulator_disabled"}), 404)
        account, failure = account_required()
        if failure:
            return None, failure
        is_local_admin = (
            account["is_demo"]
            and hmac.compare_digest(account["email"], "admin@local.test")
        )
        if not is_local_admin:
            return None, (jsonify({"error": "admin_required"}), 403)
        return account, None

    def admin_required():
        account, failure = account_required()
        if failure:
            return None, failure
        is_local_admin = (
            simulator_enabled
            and account["is_demo"]
            and hmac.compare_digest(account["email"], "admin@local.test")
        )
        if not is_local_admin and not account["is_admin"]:
            return None, (jsonify({"error": "admin_required"}), 403)
        return account, None

    @app.get("/wallet/portfolio")
    @limiter.limit("30 per minute")
    def wallet_portfolio():
        account, failure = account_required()
        if failure:
            return failure
        if account["is_demo"]:
            return jsonify({"error": "mainnet_wallet_data_disabled_for_demo_account"}), 403

        wallet_address = account["wallet_address"]
        balance_result = rpc_fetcher(
            rpc_url,
            "POST",
            {
                "jsonrpc": "2.0",
                "id": "terminal-wallet-sol-balance",
                "method": "getBalance",
                "params": [wallet_address, {"commitment": "confirmed"}],
            },
        )
        sol_result = balance_result.get("result") if isinstance(balance_result, dict) else None
        sol_value = sol_result.get("value") if isinstance(sol_result, dict) else None
        if type(sol_value) is not int or not 0 <= sol_value <= MAX_SPL_TOKEN_AMOUNT:
            raise MarketProviderError("solana_wallet_balance_unavailable", 502)

        token_accounts: dict[str, dict[str, Any]] = {}
        for token_program in (SPL_TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID):
            token_result = rpc_fetcher(
                rpc_url,
                "POST",
                {
                    "jsonrpc": "2.0",
                    "id": f"terminal-wallet-tokens-{token_program[:8]}",
                    "method": "getTokenAccountsByOwner",
                    "params": [
                        wallet_address,
                        {"programId": token_program},
                        {"commitment": "confirmed", "encoding": "jsonParsed"},
                    ],
                },
            )
            parsed_result = token_result.get("result") if isinstance(token_result, dict) else None
            values = parsed_result.get("value") if isinstance(parsed_result, dict) else None
            if not isinstance(values, list):
                raise MarketProviderError("solana_wallet_tokens_unavailable", 502)
            for entry in values:
                try:
                    token_info = entry["account"]["data"]["parsed"]["info"]["tokenAmount"]
                    mint_address = entry["account"]["data"]["parsed"]["info"]["mint"]
                    raw_amount = token_info["amount"]
                    decimals = token_info["decimals"]
                    if (
                        not isinstance(mint_address, str)
                        or not MINT_PATTERN.fullmatch(mint_address)
                        or not isinstance(raw_amount, str)
                        or not raw_amount.isdigit()
                        or len(raw_amount) > 20
                        or not isinstance(decimals, int)
                        or isinstance(decimals, bool)
                        or not 0 <= decimals <= 18
                    ):
                        raise ValueError("invalid token amount")
                    amount = int(raw_amount)
                    if amount > MAX_SPL_TOKEN_AMOUNT:
                        raise ValueError("invalid token amount")
                except (KeyError, TypeError, ValueError) as error:
                    raise MarketProviderError("invalid_solana_wallet_token_data", 502) from error
                if amount == 0:
                    continue
                holding = token_accounts.get(mint_address)
                if holding is not None and holding["decimals"] != decimals:
                    raise MarketProviderError("inconsistent_solana_wallet_token_data", 502)
                if holding is None:
                    token_accounts[mint_address] = {"amount": amount, "decimals": decimals}
                else:
                    holding["amount"] += amount

        assets: dict[str, dict[str, Any]] = {
            SOL_MINT: {
                "mintAddress": SOL_MINT,
                "symbol": "SOL",
                "name": "Solana",
                "amount": format(Decimal(sol_value) / Decimal(1_000_000_000), "f"),
                "decimals": 9,
                "priceUsd": None,
                "valueUsd": None,
                "logoUri": None,
            }
        }
        ordered_token_accounts = sorted(
            token_accounts.items(),
            key=lambda item: Decimal(item[1]["amount"]) / (Decimal(10) ** item[1]["decimals"]),
            reverse=True,
        )
        omitted_count = max(0, len(ordered_token_accounts) - MAX_PORTFOLIO_TOKEN_ASSETS)
        for mint_address, holding in ordered_token_accounts[:MAX_PORTFOLIO_TOKEN_ASSETS]:
            assets[mint_address] = {
                "mintAddress": mint_address,
                "symbol": "Unknown",
                "name": "Unknown token",
                "amount": format(
                    Decimal(holding["amount"]) / (Decimal(10) ** holding["decimals"]),
                    "f",
                ),
                "decimals": holding["decimals"],
                "priceUsd": None,
                "valueUsd": None,
                "logoUri": None,
            }

        mint_addresses = list(assets)
        markets_by_mint: dict[str, dict[str, Any]] = {}
        for start in range(0, len(mint_addresses), 30):
            batch = mint_addresses[start : start + 30]
            market_payload = market_fetcher(provider_token_url(batch))
            markets_by_mint.update(
                (market["mintAddress"], market)
                for market in rank_markets(market_payload, set(batch))
            )

        priced_total = Decimal(0)
        unpriced_count = 0
        for mint_address, asset in assets.items():
            market = markets_by_mint.get(mint_address)
            if market is None:
                unpriced_count += 1
                continue
            amount = Decimal(asset["amount"])
            price = Decimal(str(market["priceUsd"]))
            value = amount * price
            asset.update(
                {
                    "symbol": market["symbol"],
                    "name": market["name"],
                    "priceUsd": float(price),
                    "valueUsd": float(value),
                    "logoUri": market["logoUri"],
                }
            )
            priced_total += value

        holdings = sorted(
            assets.values(),
            key=lambda asset: (
                asset["valueUsd"] is not None,
                asset["valueUsd"] or 0,
                Decimal(asset["amount"]),
            ),
            reverse=True,
        )
        truncated = len(holdings) > 100
        holdings = holdings[:100]
        return jsonify(
            {
                "walletAddress": wallet_address,
                "balances": holdings,
                "totalUsd": (
                    float(priced_total)
                    if unpriced_count == 0 and omitted_count == 0
                    else None
                ),
                "pricedTotalUsd": float(priced_total),
                "unpricedCount": unpriced_count,
                "omittedCount": omitted_count,
                "truncated": truncated or omitted_count > 0,
                "source": "Solana RPC and DexScreener",
                "observedAt": datetime.now(timezone.utc).isoformat(),
            }
        )

    @app.route("/auth", methods=["GET", "POST"])
    @limiter.limit("20 per minute", methods=["POST"])
    def auth():
        if database is None:
            return jsonify({"error": "database_not_configured"}), 503
        if request.method == "GET":
            user_id = session.get("user_id")
            account = (
                database.get_account(user_id)
                if isinstance(user_id, str)
                else None
            )
            if account is None:
                session.clear()
                return jsonify({
                    "authenticated": False,
                    "demoAvailable": (
                        simulator_enabled and app_environment == "staging-local"
                    ),
                })
            return jsonify({"authenticated": True, "account": public_account(account)})

        body = request.get_json(silent=True)
        if not isinstance(body, dict):
            return jsonify({"error": "json_body_required"}), 400
        action = body.get("action")
        if action == "logout":
            session.clear()
            return jsonify({"authenticated": False})
        if action == "unlock":
            account, failure = account_required()
            if failure:
                return failure
            stored = database.get_account(account["id"], include_encrypted=True)
            if stored is None:
                session.clear()
                return jsonify({"error": "authentication_required"}), 401
            return jsonify(
                {
                    "authenticated": True,
                    "account": public_account(stored),
                    "encryptedWallet": stored["encrypted_secret"],
                }
            )
        if action == "register":
            email = body.get("email")
            password = body.get("password")
            wallet_address = body.get("walletAddress")
            encrypted_secret = body.get("encryptedWallet")
            normalized_email = email.strip().lower() if isinstance(email, str) else ""
            is_demo_registration = (
                simulator_enabled
                and app_environment == "staging-local"
                and normalized_email == "admin@local.test"
                and password == "admin"
            )
            if (
                simulator_enabled
                and app_environment == "staging-local"
                and normalized_email == "admin@local.test"
                and not is_demo_registration
            ):
                return jsonify({"error": "local_demo_credentials_required"}), 400
            if (
                not isinstance(email, str)
                or len(email) > 254
                or not EMAIL_PATTERN.fullmatch(email.strip())
                or not isinstance(password, str)
                or not (
                    (len(password) == 5 and is_demo_registration)
                    or 12 <= len(password) <= 128
                )
                or not isinstance(wallet_address, str)
                or not MINT_PATTERN.fullmatch(wallet_address)
                or not isinstance(encrypted_secret, dict)
                or encrypted_secret.get("version") != 1
                or encrypted_secret.get("kdf") != "PBKDF2-SHA256"
                or encrypted_secret.get("iterations") != 600_000
            ):
                return jsonify({"error": "invalid_registration"}), 400
            try:
                salt = base64.b64decode(encrypted_secret.get("salt", ""), validate=True)
                iv = base64.b64decode(encrypted_secret.get("iv", ""), validate=True)
                ciphertext = base64.b64decode(
                    encrypted_secret.get("ciphertext", ""), validate=True
                )
            except (ValueError, base64.binascii.Error):
                return jsonify({"error": "invalid_encrypted_wallet"}), 400
            if len(salt) != 16 or len(iv) != 12 or len(ciphertext) != 80:
                return jsonify({"error": "invalid_encrypted_wallet"}), 400

            provided_admin_token = body.get("adminBootstrapToken")
            if normalized_email in admin_emails and (
                not isinstance(provided_admin_token, str)
                or not re.fullmatch(r"[0-9a-fA-F]{64}", provided_admin_token)
                or not hmac.compare_digest(provided_admin_token, admin_bootstrap_token)
            ):
                return jsonify({"error": "admin_bootstrap_token_required"}), 403
            user_id = str(uuid.uuid4())
            created = database.create_account(
                user_id,
                normalized_email,
                generate_password_hash(password, method="scrypt"),
                wallet_address,
                encrypted_secret,
                is_admin=normalized_email in admin_emails,
                is_demo=is_demo_registration,
            )
            if not created:
                return jsonify({"error": "email_or_wallet_already_registered"}), 409
            session.clear()
            session["user_id"] = user_id
            session.permanent = True
            account = database.get_account(user_id)
            return jsonify(
                {"authenticated": True, "account": public_account(account)}
            ), 201
        if action == "login":
            email = body.get("email")
            password = body.get("password")
            if (
                not isinstance(email, str)
                or len(email) > 254
                or not isinstance(password, str)
                or len(password) > 128
            ):
                return jsonify({"error": "invalid_credentials"}), 400
            account = database.authenticate(email.strip().lower())
            if account is None or not check_password_hash(
                account["password_hash"], password
            ):
                return jsonify({"error": "invalid_email_or_password"}), 401
            wallet = database.get_account(account["id"], include_encrypted=True)
            if wallet is None:
                return jsonify({"error": "wallet_not_found"}), 409
            session.clear()
            session["user_id"] = account["id"]
            session.permanent = True
            return jsonify(
                {
                    "authenticated": True,
                    "account": public_account(wallet),
                    "encryptedWallet": wallet["encrypted_secret"],
                }
            )
        return jsonify({"error": "unsupported_auth_action"}), 400

    @app.route("/admin/security-simulator", methods=["GET", "POST"])
    def admin_security_simulator():
        account, failure = local_admin_required()
        if failure:
            return failure
        if request.method == "GET":
            return jsonify(
                {
                    "mode": "local_simulation_only",
                    "wallets": database.list_admin_wallets(),
                    "withdrawals": database.list_admin_simulated_withdrawals(),
                }
            )

        body = request.get_json(silent=True)
        if not isinstance(body, dict):
            return jsonify({"error": "json_body_required"}), 400
        wallet_user_id = body.get("walletUserId")
        destination_address = body.get("destinationAddress")
        amount_text = body.get("amountSol")
        try:
            normalized_user_id = str(uuid.UUID(wallet_user_id))
        except (ValueError, TypeError, AttributeError):
            return jsonify({"error": "invalid_wallet_user_id"}), 400
        if (
            not isinstance(destination_address, str)
            or not MINT_PATTERN.fullmatch(destination_address)
            or not isinstance(amount_text, str)
            or len(amount_text) > 40
            or not ORDER_AMOUNT_PATTERN.fullmatch(amount_text)
        ):
            return jsonify({"error": "invalid_simulated_withdrawal"}), 400
        try:
            amount_sol = Decimal(amount_text)
        except InvalidOperation:
            return jsonify({"error": "invalid_simulated_withdrawal"}), 400
        if amount_sol <= 0 or amount_sol > Decimal("10"):
            return jsonify({"error": "simulated_withdrawal_out_of_range"}), 400
        amount_lamports = amount_sol * Decimal(10**9)
        if amount_lamports != amount_lamports.to_integral_value():
            return jsonify({"error": "invalid_simulated_withdrawal_precision"}), 400

        result = database.simulate_admin_withdrawal(
            account["id"],
            normalized_user_id,
            destination_address,
            int(amount_lamports),
        )
        if result is None:
            return jsonify({"error": "wallet_not_found"}), 404
        if result.get("insufficient_balance"):
            return jsonify({"error": "insufficient_simulated_balance"}), 409
        return jsonify({"withdrawal": result}), 201

    @app.route("/admin/recommendations", methods=["GET", "POST", "DELETE"])
    @limiter.limit("30 per minute", methods=["POST", "DELETE"])
    def admin_recommendations():
        account, failure = admin_required()
        if failure:
            return failure
        if request.method == "GET":
            return jsonify(
                {"recommendations": database.list_token_recommendations(limit=100)}
            )
        if request.method == "DELETE":
            mint_address = request.args.get("mint", "")
            if not MINT_PATTERN.fullmatch(mint_address):
                return jsonify({"error": "invalid_solana_mint"}), 400
            if not database.delete_token_recommendation(mint_address):
                return jsonify({"error": "recommendation_not_found"}), 404
            return jsonify({"removed": True})

        body = request.get_json(silent=True)
        if not isinstance(body, dict):
            return jsonify({"error": "json_body_required"}), 400
        mint_address = body.get("mintAddress")
        note = body.get("note")
        if (
            not isinstance(mint_address, str)
            or not MINT_PATTERN.fullmatch(mint_address)
            or not isinstance(note, str)
            or not 10 <= len(note.strip()) <= 300
        ):
            return jsonify({"error": "invalid_token_recommendation"}), 400

        payload = market_fetcher(provider_token_url([mint_address]))
        market = next(iter(rank_markets(payload, {mint_address})), None)
        if market is None:
            return jsonify({"error": "market_data_not_found"}), 404
        database.upsert_discovered_tokens([market])
        database.create_token_recommendation(
            mint_address, account["id"], note.strip()
        )
        return jsonify({"recommended": True, "mintAddress": mint_address}), 201

    @app.get("/admin/wallets")
    @limiter.limit("30 per minute")
    def admin_wallet_registry():
        _account, failure = admin_required()
        if failure:
            return failure
        if database is None:
            return jsonify({"error": "database_not_configured"}), 503
        try:
            offset = int(request.args.get("offset", "0"))
        except ValueError:
            return jsonify({"error": "offset_must_be_non_negative"}), 400
        if not 0 <= offset <= 100_000:
            return jsonify({"error": "offset_must_be_non_negative"}), 400

        wallet_page = database.list_wallet_registry(limit=101, offset=offset)
        has_more = len(wallet_page) > 100
        wallets = wallet_page[:100]
        if not wallets:
            return jsonify({
                "mode": "read_only_mainnet",
                "wallets": [],
                "hasMore": False,
                "observedAt": datetime.now(timezone.utc).isoformat(),
            })

        rpc_result = rpc_fetcher(
            rpc_url,
            "POST",
            {
                "jsonrpc": "2.0",
                "id": "terminal-admin-wallet-balances",
                "method": "getMultipleAccounts",
                "params": [
                    [wallet["wallet_address"] for wallet in wallets],
                    {"commitment": "confirmed", "encoding": "base64"},
                ],
            },
        )
        result = rpc_result.get("result") if isinstance(rpc_result, dict) else None
        values = result.get("value") if isinstance(result, dict) else None
        if not isinstance(values, list) or len(values) != len(wallets):
            raise MarketProviderError("solana_wallet_balance_unavailable", 502)
        for wallet, chain_account in zip(wallets, values, strict=True):
            lamports = chain_account.get("lamports") if isinstance(chain_account, dict) else 0
            if not isinstance(lamports, int) or lamports < 0:
                raise MarketProviderError("invalid_solana_wallet_balance", 502)
            wallet["balance_lamports"] = str(lamports)

        return jsonify({
            "mode": "read_only_mainnet",
            "wallets": wallets,
            "hasMore": has_more,
            "observedAt": datetime.now(timezone.utc).isoformat(),
        })

    @app.get("/health")
    def health():
        database_status = "not_configured"
        if database is not None:
            try:
                database.check()
                database_status = "postgres"
            except psycopg.Error:
                app.logger.exception("Database health check failed")
                return jsonify({"error": "database_unavailable", "status": "error"}), 503
        return jsonify(
            {
                "status": "ok",
                "service": "api",
                "integrations": {
                    "marketData": "dexscreener",
                    "tokenDiscovery": "ready" if database is not None else "not_configured",
                    "swap": "jupiter" if trading_ready else "not_configured",
                    "database": database_status,
                },
                "trading": "enabled" if trading_ready else "not_configured",
                "mode": trading_mode,
            }
        )

    @app.get("/trade/status")
    def trade_status():
        return jsonify(
            {
                "network": "solana-mainnet-beta",
                "provider": "jupiter-swap-v2",
                "mode": trading_mode,
                "enabled": trading_ready,
                "reason": trading_block_reason,
                "maxBuySol": 1,
                "custody": "non-custodial-wallet-signature-required",
            }
        )

    @app.post("/trade/order")
    @limiter.limit("10 per minute")
    def trade_order():
        if not trading_ready:
            return jsonify({"error": "live_trading_not_configured"}), 503

        account, failure = account_required()
        if failure:
            return failure
        if account["is_demo"]:
            return jsonify({"error": "mainnet_trading_disabled_for_demo_account"}), 403
        body = request.get_json(silent=True)
        if not isinstance(body, dict):
            return jsonify({"error": "json_body_required"}), 400
        side = body.get("side")
        mint = body.get("mintAddress")
        wallet = body.get("walletAddress")
        amount_text = body.get("amount")
        if (
            side not in ("buy", "sell")
            or not isinstance(mint, str)
            or not MINT_PATTERN.fullmatch(mint)
            or mint == SOL_MINT
            or not isinstance(wallet, str)
            or not MINT_PATTERN.fullmatch(wallet)
            or wallet != account["wallet_address"]
            or not isinstance(amount_text, str)
            or len(amount_text) > 40
            or not ORDER_AMOUNT_PATTERN.fullmatch(amount_text)
        ):
            return jsonify({"error": "invalid_live_order"}), 400

        try:
            amount = Decimal(amount_text)
        except InvalidOperation:
            return jsonify({"error": "invalid_live_order_amount"}), 400
        if amount <= 0:
            return jsonify({"error": "invalid_live_order_amount"}), 400

        if side == "buy":
            if amount > Decimal("1"):
                return jsonify({"error": "buy_limit_exceeded_max_1_sol"}), 400
            input_mint, output_mint = SOL_MINT, mint
            input_decimals = 9
            output_decimals = None
        else:
            input_mint, output_mint = mint, SOL_MINT
            input_decimals = None
            output_decimals = 9

        rpc_request = {
            "jsonrpc": "2.0",
            "id": "terminal-token-decimals",
            "method": "getTokenSupply",
            "params": [mint, {"commitment": "confirmed"}],
        }
        rpc_result = rpc_fetcher(rpc_url, "POST", rpc_request)
        supply = (
            rpc_result.get("result", {}).get("value")
            if isinstance(rpc_result, dict)
            and isinstance(rpc_result.get("result"), dict)
            else None
        )
        decimals = supply.get("decimals") if isinstance(supply, dict) else None
        if not isinstance(decimals, int) or not 0 <= decimals <= 18:
            return jsonify({"error": "token_decimals_unavailable"}), 502
        if side == "buy":
            output_decimals = decimals
        else:
            input_decimals = decimals

        amount_scale = Decimal(10) ** input_decimals
        scaled_amount = amount * amount_scale
        if scaled_amount != scaled_amount.to_integral_value():
            return jsonify({"error": "amount_exceeds_token_precision"}), 400

        order_params = urllib.parse.urlencode(
            {
                "inputMint": input_mint,
                "outputMint": output_mint,
                "amount": str(int(scaled_amount)),
                "taker": wallet,
            }
        )
        order = swap_fetcher(
            f"{JUPITER_SWAP_API}/order?{order_params}",
            headers={"x-api-key": jupiter_api_key},
        )
        if (
            not isinstance(order, dict)
            or not isinstance(order.get("transaction"), str)
            or not order["transaction"]
            or not isinstance(order.get("requestId"), str)
            or not order.get("requestId")
            or not isinstance(order.get("outAmount"), str)
            or not order["outAmount"].isdigit()
            or len(order["transaction"]) > 2000
        ):
            return jsonify({"error": "jupiter_order_unavailable"}), 502
        try:
            unsigned_bytes = base64.b64decode(order["transaction"], validate=True)
        except (ValueError, base64.binascii.Error):
            return jsonify({"error": "jupiter_order_unavailable"}), 502
        if not unsigned_bytes or len(unsigned_bytes) > MAX_SOLANA_TRANSACTION_BYTES:
            return jsonify({"error": "jupiter_order_unavailable"}), 502

        now = datetime.now(timezone.utc).timestamp()
        with pending_orders_lock:
            expired = [
                request_id
                for request_id, item in pending_orders.items()
                if item["expiresAt"] < now
            ]
            for request_id in expired:
                del pending_orders[request_id]
            if len(pending_orders) >= 1000:
                return jsonify({"error": "too_many_pending_orders"}), 503
            if order["requestId"] in pending_orders:
                return jsonify({"error": "duplicate_jupiter_order_id"}), 409
            pending_orders[order["requestId"]] = {
                "wallet": wallet,
                "userId": account["id"],
                "expiresAt": now + 90,
                "state": "ready",
            }

        normalized_order = {
                "transaction": order["transaction"],
                "requestId": order["requestId"],
                "outAmount": order["outAmount"],
                "inputAmount": str(int(scaled_amount)),
                "inputDecimals": input_decimals,
                "outputDecimals": output_decimals,
                "inputMint": input_mint,
                "outputMint": output_mint,
                "side": side,
                "router": str(order.get("router") or "Jupiter")[:32],
                "feeBps": order.get("feeBps"),
                "feeMint": order.get("feeMint"),
            }
        database.create_swap(account["id"], wallet, normalized_order)
        return jsonify(normalized_order)

    @app.post("/trade/execute")
    @limiter.limit("10 per minute")
    def trade_execute():
        if not trading_ready:
            return jsonify({"error": "live_trading_not_configured"}), 503
        account, failure = account_required()
        if failure:
            return failure
        if account["is_demo"]:
            return jsonify({"error": "mainnet_trading_disabled_for_demo_account"}), 403
        body = request.get_json(silent=True)
        if not isinstance(body, dict):
            return jsonify({"error": "json_body_required"}), 400
        request_id = body.get("requestId")
        signed_transaction = body.get("signedTransaction")
        wallet = body.get("walletAddress")
        if (
            not isinstance(request_id, str)
            or not 8 <= len(request_id) <= 200
            or not isinstance(wallet, str)
            or not MINT_PATTERN.fullmatch(wallet)
            or wallet != account["wallet_address"]
            or not isinstance(signed_transaction, str)
            or len(signed_transaction) > 1644
        ):
            return jsonify({"error": "invalid_signed_order"}), 400
        try:
            signed_bytes = base64.b64decode(signed_transaction, validate=True)
        except (ValueError, base64.binascii.Error):
            return jsonify({"error": "invalid_signed_order"}), 400
        if not signed_bytes or len(signed_bytes) > MAX_SOLANA_TRANSACTION_BYTES:
            return jsonify({"error": "invalid_signed_order"}), 400

        now = datetime.now(timezone.utc).timestamp()
        with pending_orders_lock:
            order_state = pending_orders.get(request_id)
            if (
                order_state is None
                or order_state["expiresAt"] < now
                or order_state["wallet"] != wallet
                or order_state["userId"] != account["id"]
                or order_state["state"] != "ready"
            ):
                return jsonify({"error": "live_order_expired_or_already_used"}), 409
            order_state["state"] = "executing"

        try:
            result = swap_fetcher(
                f"{JUPITER_SWAP_API}/execute",
                method="POST",
                payload={
                    "signedTransaction": signed_transaction,
                    "requestId": request_id,
                },
                headers={"x-api-key": jupiter_api_key},
            )
        except MarketProviderError:
            with pending_orders_lock:
                pending_orders.pop(request_id, None)
            database.update_swap(request_id, "unknown", None)
            raise
        with pending_orders_lock:
            pending_orders.pop(request_id, None)
        if (
            not isinstance(result, dict)
            or result.get("status") not in ("Success", "Failed")
            or not isinstance(result.get("signature"), str)
        ):
            database.update_swap(request_id, "unknown", None)
            return jsonify({"error": "jupiter_execution_status_unknown"}), 502
        database.update_swap(
            request_id,
            "confirmed" if result["status"] == "Success" else "failed",
            result["signature"] or None,
        )
        return jsonify(
            {
                "status": result["status"],
                "signature": result["signature"],
                "error": result.get("error"),
            }
        )

    @app.get("/trade/history")
    def trade_history():
        account, failure = account_required()
        if failure:
            return failure
        return jsonify({"trades": database.list_swaps(account["id"])})

    @app.get("/market/overview")
    @limiter.limit("120 per minute")
    def market_overview():
        payload = market_fetcher(provider_token_url(list(FEATURED_TOKENS)))
        return jsonify(
            {
                "markets": rank_markets(payload, set(FEATURED_TOKENS)),
                "source": "DexScreener",
                "observedAt": datetime.now(timezone.utc).isoformat(),
            }
        )

    @app.get("/market/tokens/<mint_address>")
    @limiter.limit("120 per minute")
    def market_token(mint_address: str):
        if not MINT_PATTERN.fullmatch(mint_address):
            return jsonify({"error": "invalid_solana_mint"}), 400

        payload = market_fetcher(provider_token_url([mint_address]))
        market = next(iter(rank_markets(payload, {mint_address})), None)
        if market is None:
            return jsonify({"error": "market_data_not_found"}), 404
        return jsonify(market)

    @app.get("/market/tokens")
    @limiter.limit("120 per minute")
    def market_tokens():
        raw_addresses = request.args.get("addresses", "")
        mint_addresses = list(dict.fromkeys(raw_addresses.split(",")))
        if (
            not mint_addresses
            or len(mint_addresses) > 10
            or any(not MINT_PATTERN.fullmatch(mint) for mint in mint_addresses)
        ):
            return jsonify({"error": "provide_1_to_10_valid_solana_mints"}), 400

        payload = market_fetcher(provider_token_url(mint_addresses))
        return jsonify(
            {
                "markets": rank_markets(payload, set(mint_addresses)),
                "source": "DexScreener",
                "observedAt": datetime.now(timezone.utc).isoformat(),
            }
        )

    @app.get("/market/search")
    @limiter.limit("120 per minute")
    def market_search():
        query = request.args.get("q", "").strip()
        if len(query) < 2 or len(query) > 64:
            return jsonify({"error": "query_must_be_2_to_64_characters"}), 400

        encoded_query = urllib.parse.quote(query, safe="")
        payload = market_fetcher(
            f"{DEXSCREENER_API}/latest/dex/search?q={encoded_query}"
        )
        if not isinstance(payload, dict) or not isinstance(
            payload.get("pairs", []), list
        ):
            return jsonify({"error": "invalid_market_data_response"}), 502

        normalized_query = query.casefold()
        mint_addresses: set[str] = set()
        for pair in payload.get("pairs", []):
            if not isinstance(pair, dict) or pair.get("chainId") != "solana":
                continue
            for token in (pair.get("baseToken"), pair.get("quoteToken")):
                if not isinstance(token, dict):
                    continue
                address = token.get("address")
                if not isinstance(address, str) or not MINT_PATTERN.fullmatch(address):
                    continue
                searchable_fields = (
                    token.get("symbol"),
                    token.get("name"),
                    address,
                )
                if any(
                    isinstance(field, str)
                    and normalized_query in field.casefold()
                    for field in searchable_fields
                ):
                    mint_addresses.add(address)
        return jsonify(
            {
                "markets": rank_markets(payload, mint_addresses)[:25],
                "source": "DexScreener",
                "observedAt": datetime.now(timezone.utc).isoformat(),
            }
        )

    @app.get("/market/new")
    @limiter.limit("120 per minute")
    def market_new_tokens():
        if database is None:
            return jsonify({"error": "database_not_configured"}), 503
        try:
            limit = int(request.args.get("limit", "50"))
        except ValueError:
            return jsonify({"error": "limit_must_be_between_1_and_100"}), 400
        if not 1 <= limit <= 100:
            return jsonify({"error": "limit_must_be_between_1_and_100"}), 400
        return jsonify(
            {
                "markets": database.list_discovered_tokens(limit),
                "source": "DexScreener",
                "observedAt": datetime.now(timezone.utc).isoformat(),
            }
        )

    @app.get("/market/recommendations")
    @limiter.limit("120 per minute")
    def market_recommendations():
        _account, failure = account_required()
        if failure:
            return failure
        if database is None:
            return jsonify({"error": "database_not_configured"}), 503
        return jsonify(
            {
                "recommendations": database.list_token_recommendations(limit=100),
                "observedAt": datetime.now(timezone.utc).isoformat(),
            }
        )

    @app.post("/market/discovery/ingest")
    def market_discovery_ingest():
        provided_token = request.headers.get("Authorization", "")
        expected_token = f"Bearer {market_discovery_token}"
        if not market_discovery_token or not hmac.compare_digest(
            provided_token, expected_token
        ):
            return jsonify({"error": "worker_authentication_required"}), 401
        if database is None:
            return jsonify({"error": "database_not_configured"}), 503
        body = request.get_json(silent=True)
        addresses = body.get("mintAddresses") if isinstance(body, dict) else None
        token_icons = body.get("tokenIcons", {}) if isinstance(body, dict) else {}
        if (
            not isinstance(addresses, list)
            or not addresses
            or len(addresses) > 100
            or any(
                not isinstance(address, str)
                or not MINT_PATTERN.fullmatch(address)
                for address in addresses
            )
        ):
            return jsonify({"error": "provide_1_to_100_valid_solana_mints"}), 400
        if not isinstance(token_icons, dict) or any(
            not isinstance(mint, str)
            or not MINT_PATTERN.fullmatch(mint)
            or valid_token_logo(logo_uri) is None
            for mint, logo_uri in token_icons.items()
        ):
            return jsonify({"error": "invalid_token_icons"}), 400
        mint_addresses = list(dict.fromkeys(addresses))
        markets = []
        for start in range(0, len(mint_addresses), 30):
            batch = mint_addresses[start : start + 30]
            payload = market_fetcher(provider_token_url(batch))
            markets.extend(
                rank_markets(payload, set(batch))
            )
        for market in markets:
            market["logoUri"] = market["logoUri"] or token_icons.get(
                market["mintAddress"]
            )
        stored = database.upsert_discovered_tokens(markets)
        return jsonify({"accepted": stored, "observedAt": datetime.now(timezone.utc).isoformat()})

    return app


app = create_app()


if __name__ == "__main__":
    host = os.environ.get("HOST", "0.0.0.0")
    port = int(os.environ.get("PORT", "4000"))
    app.run(host=host, port=port, debug=False)
