import os
import base64
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app import FEATURED_TOKENS, MarketProviderError, create_app
from werkzeug.security import check_password_hash

SOL_MINT = FEATURED_TOKENS[0]
USDC_MINT = FEATURED_TOKENS[1]


class MemoryDatabase:
    def __init__(self, authenticated=False, demo=False):
        self.accounts = {}
        self.wallets = {}
        self.swaps = {}
        self.simulated_withdrawals = []
        if authenticated:
            account = {
                "id": "test-user",
                "email": "admin@local.test" if demo else "trader@example.com",
                "password_hash": "unused",
                "wallet_address": SOL_MINT,
                "is_demo": demo,
            }
            self.accounts[account["id"]] = account
            self.wallets[account["id"]] = {
                **account,
                "encrypted_secret": {"test": "ciphertext"},
                "balance_lamports": "10000000000",
            }

    def initialize(self):
        pass

    def create_account(self, user_id, email, password_hash, wallet_address, encrypted_secret):
        if any(account["email"] == email for account in self.accounts.values()):
            return False
        if any(wallet["wallet_address"] == wallet_address for wallet in self.wallets.values()):
            return False
        account = {
            "id": user_id,
            "email": email,
            "password_hash": password_hash,
            "wallet_address": wallet_address,
            "is_demo": False,
        }
        self.accounts[user_id] = account
        self.wallets[user_id] = {
            **account,
            "encrypted_secret": encrypted_secret,
            "balance_lamports": "10000000000",
        }
        return True

    def authenticate(self, email):
        return next(
            (account for account in self.accounts.values() if account["email"] == email),
            None,
        )

    def get_account(self, user_id, include_encrypted=False):
        stored = self.wallets.get(user_id)
        if stored is None:
            return None
        return dict(stored if include_encrypted else {
            key: value for key, value in stored.items() if key != "encrypted_secret"
        })

    def create_swap(self, user_id, wallet_address, order):
        self.swaps[order["requestId"]] = {
            "user_id": user_id,
            "wallet_address": wallet_address,
            **order,
            "status": "awaiting_signature",
            "signature": None,
        }

    def update_swap(self, request_id, status, signature):
        self.swaps[request_id]["status"] = status
        self.swaps[request_id]["signature"] = signature

    def list_swaps(self, user_id, limit=50):
        return [
            trade for trade in self.swaps.values()
            if trade["user_id"] == user_id
        ][:limit]

    def list_admin_wallets(self):
        return [
            {
                "user_id": user_id,
                "email": wallet["email"],
                "is_demo": wallet["is_demo"],
                "wallet_address": wallet["wallet_address"],
                "balance_lamports": wallet["balance_lamports"],
                "created_at": "2026-01-01T00:00:00+00:00",
            }
            for user_id, wallet in self.wallets.items()
        ][:500]

    def simulate_admin_withdrawal(
        self, admin_user_id, wallet_user_id, destination_address, amount_lamports
    ):
        wallet = self.wallets.get(wallet_user_id)
        if wallet is None:
            return None
        if amount_lamports > int(wallet["balance_lamports"]):
            return {"insufficient_balance": True}
        wallet["balance_lamports"] = str(int(wallet["balance_lamports"]) - amount_lamports)
        result = {
            "id": str(len(self.simulated_withdrawals) + 1),
            "wallet_address": wallet["wallet_address"],
            "destination_address": destination_address,
            "amount_lamports": str(amount_lamports),
            "balance_lamports": wallet["balance_lamports"],
            "status": "simulated",
            "created_at": "2026-01-01T00:00:00+00:00",
        }
        self.simulated_withdrawals.insert(0, result)
        return result

    def list_admin_simulated_withdrawals(self, limit=100):
        return self.simulated_withdrawals[:limit]


def sol_pair():
    return {
        "chainId": "solana",
        "dexId": "raydium",
        "pairAddress": "pair-address",
        "url": "https://dexscreener.com/solana/pair-address",
        "baseToken": {"address": SOL_MINT, "name": "Wrapped SOL", "symbol": "SOL"},
        "quoteToken": {"address": USDC_MINT, "name": "USD Coin", "symbol": "USDC"},
        "priceUsd": "150.25",
        "priceNative": "150.25",
        "liquidity": {"usd": 1000000},
        "volume": {"h24": 500000},
        "priceChange": {"h24": 2.5},
        "marketCap": 1000000000,
        "fdv": 1200000000,
    }


class FlaskApiTests(unittest.TestCase):
    def setUp(self):
        self.app = create_app(lambda _url: {"pairs": [sol_pair()]})
        self.app.config["TESTING"] = True
        self.client = self.app.test_client()

    def test_health_reports_mainnet_mode_without_fabricating_trading_readiness(self):
        response = self.client.get("/health")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json["trading"], "not_configured")
        self.assertEqual(response.json["mode"], "live")
        self.assertEqual(response.json["integrations"]["swap"], "not_configured")

    def test_production_requires_secure_supabase_database_configuration(self):
        production_environment = {
            "APP_ENV": "production",
            "APP_SECRET_KEY": "p" * 64,
            "DATABASE_URL": "postgresql://user:password@supabase.example.com/postgres?sslmode=require",
            "DATABASE_SCHEMA": "terminal",
            "DATABASE_INITIALIZE": "false",
            "SESSION_COOKIE_SECURE": "true",
            "LOCAL_SECURITY_SIMULATOR": "false",
            "TRADING_MODE": "live",
            "LIVE_TRADING_ENABLED": "true",
            "JUPITER_API_KEY": "configured-production-key",
        }
        with patch.dict(os.environ, production_environment, clear=True):
            app = create_app(lambda _url: {"pairs": [sol_pair()]})
        self.assertTrue(app.config["SESSION_COOKIE_SECURE"])
        self.assertFalse(app.config["LOCAL_SECURITY_SIMULATOR"])
        self.assertEqual(app.config["APP_ENV"], "production")

        for overrides, expected_error in (
            ({"APP_SECRET_KEY": "short"}, "at least 32 characters"),
            (
                {"APP_SECRET_KEY": "replace-with-a-unique-random-secret-of-at-least-32-characters"},
                "at least 32 characters",
            ),
            (
                {"APP_SECRET_KEY": "local-staging-session-secret-change-before-deploy"},
                "at least 32 characters",
            ),
            ({"DATABASE_URL": "postgresql://user:password@supabase.example.com/postgres"}, "sslmode=require"),
            ({"DATABASE_SCHEMA": "public"}, "DATABASE_SCHEMA must be terminal"),
            ({"SESSION_COOKIE_SECURE": "false"}, "SESSION_COOKIE_SECURE=true"),
            ({"DATABASE_INITIALIZE": "true"}, "versioned migrations"),
            ({"LOCAL_SECURITY_SIMULATOR": "true"}, "must be disabled"),
            ({"JUPITER_API_KEY": ""}, "production JUPITER_API_KEY"),
        ):
            invalid_environment = {**production_environment, **overrides}
            with self.subTest(expected_error=expected_error), patch.dict(
                os.environ, invalid_environment, clear=True
            ):
                with self.assertRaisesRegex(RuntimeError, expected_error):
                    create_app()

    def test_trade_status_requires_a_server_side_jupiter_api_key(self):
        response = self.client.get("/trade/status")
        self.assertEqual(response.status_code, 200)
        self.assertFalse(response.json["enabled"])
        self.assertEqual(response.json["network"], "solana-mainnet-beta")
        self.assertEqual(response.json["reason"], "jupiter_api_key_required")

    def make_trading_client(self):
        self.swap_calls = []
        database = MemoryDatabase(authenticated=True)

        def swap_fetcher(url, method="GET", payload=None, headers=None):
            self.swap_calls.append((url, method, payload, headers))
            if url.endswith("/execute"):
                return {"status": "Success", "signature": "transaction-signature"}
            return {
                "transaction": base64.b64encode(b"unsigned-tx").decode(),
                "requestId": "jupiter-request-12345",
                "outAmount": "2500000",
                "router": "metis",
                "feeBps": 0,
                "feeMint": USDC_MINT,
            }

        def rpc_fetcher(_url, method="GET", payload=None, headers=None):
            self.assertEqual(method, "POST")
            self.assertEqual(payload["method"], "getTokenSupply")
            return {"result": {"value": {"decimals": 6}}}

        with patch.dict(
            os.environ,
            {
                "TRADING_MODE": "live",
                "LIVE_TRADING_ENABLED": "true",
                "JUPITER_API_KEY": "test-server-key",
            },
        ):
            app = create_app(
                lambda _url: {"pairs": [sol_pair()]},
                swap_fetcher=swap_fetcher,
                rpc_fetcher=rpc_fetcher,
                database=database,
            )
        app.config["TESTING"] = True
        client = app.test_client()
        with client.session_transaction() as session:
            session["user_id"] = "test-user"
        return client

    def test_demo_account_cannot_request_or_execute_mainnet_swaps(self):
        database = MemoryDatabase(authenticated=True, demo=True)
        self.swap_calls = []

        def swap_fetcher(*_args, **_kwargs):
            self.swap_calls.append(True)
            return {}

        def rpc_fetcher(*_args, **_kwargs):
            self.fail("Demo account should not call Solana RPC")

        with patch.dict(
            os.environ,
            {
                "TRADING_MODE": "live",
                "LIVE_TRADING_ENABLED": "true",
                "JUPITER_API_KEY": "test-server-key",
            },
        ):
            app = create_app(
                lambda _url: {"pairs": [sol_pair()]},
                swap_fetcher=swap_fetcher,
                rpc_fetcher=rpc_fetcher,
                database=database,
            )
        app.config["TESTING"] = True
        client = app.test_client()
        with client.session_transaction() as session:
            session["user_id"] = "test-user"
        self.assertTrue(client.get("/auth").json["account"]["isDemo"])

        body = {
            "side": "buy",
            "amount": "0.01",
            "mintAddress": USDC_MINT,
            "walletAddress": SOL_MINT,
        }
        order = client.post("/trade/order", json=body)
        self.assertEqual(order.status_code, 403)
        self.assertEqual(order.json["error"], "mainnet_trading_disabled_for_demo_account")
        execution = client.post("/trade/execute", json={
            "requestId": "some-order-id",
            "signedTransaction": base64.b64encode(b"signed-tx").decode(),
            "walletAddress": SOL_MINT,
        })
        self.assertEqual(execution.status_code, 403)
        self.assertEqual(self.swap_calls, [])

    def test_local_admin_withdrawal_only_changes_simulated_ledger(self):
        database = MemoryDatabase(authenticated=True, demo=True)
        second_user_id = "b6c2eac4-457a-4e3c-86e5-12c3a2d0876c"
        database.create_account(
            second_user_id, "second@example.test", "unused",
            USDC_MINT, {"encrypted": "never_return_this"},
        )
        with patch.dict(
            os.environ,
            {
                "TRADING_MODE": "live",
                "LIVE_TRADING_ENABLED": "true",
                "LOCAL_SECURITY_SIMULATOR": "true",
            },
        ):
            app = create_app(database=database)
        app.config.update(TESTING=True, SESSION_COOKIE_SECURE=False)
        client = app.test_client()
        with client.session_transaction() as session:
            session["user_id"] = "test-user"

        listed = client.get("/admin/security-simulator")
        self.assertEqual(listed.status_code, 200)
        self.assertEqual(len(listed.json["wallets"]), 2)
        self.assertTrue(all("encrypted_secret" not in wallet for wallet in listed.json["wallets"]))

        response = client.post("/admin/security-simulator", json={
            "walletUserId": second_user_id,
            "destinationAddress": SOL_MINT,
            "amountSol": "1.25",
        })
        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.json["withdrawal"]["status"], "simulated")
        self.assertEqual(response.json["withdrawal"]["amount_lamports"], "1250000000")
        self.assertEqual(database.wallets[second_user_id]["balance_lamports"], "8750000000")
        self.assertEqual(database.wallets[second_user_id]["encrypted_secret"], {"encrypted": "never_return_this"})
        self.assertEqual(client.get("/admin/security-simulator").json["withdrawals"][0]["status"], "simulated")

    def test_local_admin_simulator_denies_regular_accounts_and_can_be_disabled(self):
        database = MemoryDatabase(authenticated=True)
        with patch.dict(
            os.environ,
            {
                "TRADING_MODE": "live",
                "LIVE_TRADING_ENABLED": "true",
                "LOCAL_SECURITY_SIMULATOR": "true",
            },
        ):
            app = create_app(database=database)
        app.config.update(TESTING=True, SESSION_COOKIE_SECURE=False)
        client = app.test_client()
        with client.session_transaction() as session:
            session["user_id"] = "test-user"
        self.assertEqual(client.get("/admin/security-simulator").status_code, 403)

        with patch.dict(
            os.environ,
            {
                "TRADING_MODE": "live",
                "LIVE_TRADING_ENABLED": "true",
                "LOCAL_SECURITY_SIMULATOR": "false",
            },
        ):
            disabled_app = create_app(database=database)
        disabled_app.config.update(TESTING=True, SESSION_COOKIE_SECURE=False)
        disabled_client = disabled_app.test_client()
        with disabled_client.session_transaction() as session:
            session["user_id"] = "test-user"
        self.assertEqual(disabled_client.get("/admin/security-simulator").status_code, 404)

    def test_buy_order_is_built_for_mainnet_and_uses_server_api_key(self):
        client = self.make_trading_client()
        response = client.post(
            "/trade/order",
            json={
                "side": "buy",
                "amount": "0.01",
                "mintAddress": USDC_MINT,
                "walletAddress": SOL_MINT,
            },
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json["inputMint"], SOL_MINT)
        self.assertEqual(response.json["outputMint"], USDC_MINT)
        self.assertEqual(response.json["inputAmount"], "10000000")
        self.assertEqual(response.json["outputDecimals"], 6)
        self.assertEqual(self.swap_calls[0][3], {"x-api-key": "test-server-key"})

    def test_sell_order_uses_token_decimals_to_convert_amount(self):
        client = self.make_trading_client()
        response = client.post(
            "/trade/order",
            json={
                "side": "sell",
                "amount": "1.25",
                "mintAddress": USDC_MINT,
                "walletAddress": SOL_MINT,
            },
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json["inputMint"], USDC_MINT)
        self.assertEqual(response.json["outputMint"], SOL_MINT)
        self.assertEqual(response.json["inputAmount"], "1250000")
        self.assertEqual(response.json["inputDecimals"], 6)

    def test_live_buy_limit_and_invalid_wallet_are_rejected(self):
        client = self.make_trading_client()
        request_body = {
            "side": "buy",
            "amount": "1.01",
            "mintAddress": USDC_MINT,
            "walletAddress": SOL_MINT,
        }
        self.assertEqual(client.post("/trade/order", json=request_body).status_code, 400)
        request_body["amount"] = "0.01"
        request_body["walletAddress"] = "not-a-wallet"
        self.assertEqual(client.post("/trade/order", json=request_body).status_code, 400)
        self.assertEqual(self.swap_calls, [])

    def test_order_rejects_amount_more_precise_than_token_decimals(self):
        client = self.make_trading_client()
        response = client.post(
            "/trade/order",
            json={
                "side": "sell",
                "amount": "1.0000001",
                "mintAddress": USDC_MINT,
                "walletAddress": SOL_MINT,
            },
        )
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json["error"], "amount_exceeds_token_precision")
        self.assertEqual(self.swap_calls, [])

    def test_execution_requires_a_fresh_order_for_the_same_wallet_and_is_one_time(self):
        client = self.make_trading_client()
        order = client.post(
            "/trade/order",
            json={
                "side": "buy",
                "amount": "0.01",
                "mintAddress": USDC_MINT,
                "walletAddress": SOL_MINT,
            },
        )
        execute_body = {
            "requestId": order.json["requestId"],
            "signedTransaction": base64.b64encode(b"signed-tx").decode(),
            "walletAddress": SOL_MINT,
        }
        response = client.post("/trade/execute", json=execute_body)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json["status"], "Success")
        self.assertEqual(response.json["signature"], "transaction-signature")
        self.assertEqual(
            client.post("/trade/execute", json=execute_body).status_code, 409
        )
        self.assertEqual(len(self.swap_calls), 2)

    def test_trading_endpoints_fail_closed_without_jupiter_key(self):
        response = self.client.post(
            "/trade/order",
            json={
                "side": "buy",
                "amount": "0.01",
                "mintAddress": USDC_MINT,
                "walletAddress": SOL_MINT,
            },
        )
        self.assertEqual(response.status_code, 503)
        self.assertEqual(response.json["error"], "live_trading_not_configured")

    def test_account_registration_login_and_unlock_preserve_encrypted_wallet(self):
        database = MemoryDatabase()
        app = create_app(lambda _url: {"pairs": [sol_pair()]}, database=database)
        app.config.update(TESTING=True, SESSION_COOKIE_SECURE=False)
        client = app.test_client()
        encrypted_wallet = {
            "version": 1,
            "kdf": "PBKDF2-SHA256",
            "iterations": 600_000,
            "salt": base64.b64encode(b"s" * 16).decode(),
            "iv": base64.b64encode(b"i" * 12).decode(),
            "ciphertext": base64.b64encode(b"c" * 80).decode(),
        }
        registration = client.post("/auth", json={
            "action": "register",
            "email": "Trader@example.com",
            "password": "long-test-password",
            "walletAddress": SOL_MINT,
            "encryptedWallet": encrypted_wallet,
        })
        self.assertEqual(registration.status_code, 201)
        self.assertEqual(registration.json["account"]["email"], "trader@example.com")
        self.assertNotIn("encryptedWallet", registration.json)
        self.assertTrue(check_password_hash(
            database.accounts[registration.json["account"]["id"]]["password_hash"],
            "long-test-password",
        ))

        client.post("/auth", json={"action": "logout"})
        login = client.post("/auth", json={
            "action": "login",
            "email": "trader@example.com",
            "password": "long-test-password",
        })
        self.assertEqual(login.status_code, 200)
        self.assertEqual(login.json["encryptedWallet"], encrypted_wallet)
        self.assertEqual(client.get("/auth").json["account"]["walletAddress"], SOL_MINT)
        unlock = client.post("/auth", json={"action": "unlock"})
        self.assertEqual(unlock.json["encryptedWallet"], encrypted_wallet)

    def test_trade_order_requires_authenticated_account_wallet(self):
        client = self.make_trading_client()
        with client.session_transaction() as session:
            session.clear()
        response = client.post("/trade/order", json={
            "side": "buy",
            "amount": "0.01",
            "mintAddress": USDC_MINT,
            "walletAddress": SOL_MINT,
        })
        self.assertEqual(response.status_code, 401)

    def test_swap_history_is_scoped_to_the_authenticated_account(self):
        client = self.make_trading_client()
        response = client.post("/trade/order", json={
            "side": "buy",
            "amount": "0.01",
            "mintAddress": USDC_MINT,
            "walletAddress": SOL_MINT,
        })
        self.assertEqual(response.status_code, 200)
        history = client.get("/trade/history")
        self.assertEqual(history.status_code, 200)
        self.assertEqual(len(history.json["trades"]), 1)
        self.assertEqual(history.json["trades"][0]["requestId"], response.json["requestId"])

    def test_non_live_configuration_is_rejected_at_startup(self):
        with patch.dict(
            os.environ,
            {
                "TRADING_MODE": "simulated",
                "LIVE_TRADING_ENABLED": "false",
                "JUPITER_API_KEY": "configured-but-not-usable-outside-mainnet",
            },
        ):
            with self.assertRaisesRegex(RuntimeError, "only supports live"):
                create_app()

    def test_token_route_returns_verified_market_data(self):
        response = self.client.get(f"/market/tokens/{SOL_MINT}")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json["symbol"], "SOL")
        self.assertEqual(response.json["priceUsd"], 150.25)
        self.assertEqual(response.json["source"], "DexScreener")

    def test_batch_tokens_supports_watchlist_hydration(self):
        response = self.client.get(
            f"/market/tokens?addresses={SOL_MINT},{USDC_MINT}"
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            {market["mintAddress"] for market in response.json["markets"]},
            {SOL_MINT, USDC_MINT},
        )

    def test_batch_tokens_rejects_invalid_mints(self):
        response = self.client.get("/market/tokens?addresses=not-a-mint")
        self.assertEqual(response.status_code, 400)

    def test_invalid_mint_is_rejected_before_provider_request(self):
        response = self.client.get("/market/tokens/not-a-mint")
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json["error"], "invalid_solana_mint")

    def test_overview_contains_only_supported_featured_assets(self):
        response = self.client.get("/market/overview")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            {market["mintAddress"] for market in response.json["markets"]},
            {SOL_MINT, USDC_MINT},
        )

    def test_search_rejects_short_queries(self):
        response = self.client.get("/market/search?q=S")
        self.assertEqual(response.status_code, 400)

    def test_search_does_not_return_unmatched_quote_assets(self):
        response = self.client.get("/market/search?q=SOL")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            {market["mintAddress"] for market in response.json["markets"]},
            {SOL_MINT},
        )

    def test_provider_outage_returns_service_unavailable(self):
        unavailable_app = create_app(
            lambda _url: (_ for _ in ()).throw(
                MarketProviderError("market_data_unavailable")
            )
        )
        response = unavailable_app.test_client().get("/market/overview")
        self.assertEqual(response.status_code, 503)
        self.assertEqual(response.json["error"], "market_data_unavailable")


if __name__ == "__main__":
    unittest.main()
