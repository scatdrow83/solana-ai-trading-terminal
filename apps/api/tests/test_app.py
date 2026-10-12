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
        self.discovered_tokens = {}
        self.token_recommendations = {}
        if authenticated:
            account = {
                "id": "test-user",
                "email": "admin@local.test" if demo else "trader@example.com",
                "password_hash": "unused",
                "wallet_address": SOL_MINT,
                "is_admin": False,
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

    def mark_local_demo_admin(self):
        account = self.authenticate("admin@local.test")
        if account:
            account["is_demo"] = True
            self.wallets[account["id"]]["is_demo"] = True

    def create_account(
        self,
        user_id,
        email,
        password_hash,
        wallet_address,
        encrypted_secret,
        is_admin=False,
        is_demo=False,
    ):
        if any(account["email"] == email for account in self.accounts.values()):
            return False
        if any(wallet["wallet_address"] == wallet_address for wallet in self.wallets.values()):
            return False
        account = {
            "id": user_id,
            "email": email,
            "password_hash": password_hash,
            "wallet_address": wallet_address,
            "is_admin": is_admin,
            "is_demo": is_demo,
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

    def list_wallet_registry(self, limit=101, offset=0):
        return [
            {
                "user_id": user_id,
                "email": wallet["email"],
                "is_demo": wallet["is_demo"],
                "wallet_address": wallet["wallet_address"],
                "created_at": "2026-01-01T00:00:00+00:00",
            }
            for user_id, wallet in list(self.wallets.items())[offset : offset + limit]
        ]

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

    def upsert_discovered_tokens(self, markets):
        for market in markets:
            current = self.discovered_tokens.get(market["mintAddress"], {})
            self.discovered_tokens[market["mintAddress"]] = {
                **market,
                "logoUri": market.get("logoUri"),
                "firstSeenAt": current.get("firstSeenAt", "2026-01-01T00:00:00+00:00"),
                "lastSeenAt": "2026-01-01T00:00:01+00:00",
                "observedAt": "2026-01-01T00:00:01+00:00",
            }
        return len(markets)

    def list_discovered_tokens(self, limit=50):
        return list(self.discovered_tokens.values())[:limit]

    def create_token_recommendation(self, mint_address, admin_user_id, note):
        self.token_recommendations[mint_address] = {
            "adminUserId": admin_user_id,
            "note": note,
            "recommendedAt": "2026-01-01T00:00:00+00:00",
        }

    def list_token_recommendations(self, limit=50):
        recommendations = []
        for mint_address, recommendation in self.token_recommendations.items():
            market = self.discovered_tokens.get(mint_address)
            if market:
                recommendations.append({
                    **market,
                    "note": recommendation["note"],
                    "recommendedAt": recommendation["recommendedAt"],
                })
        return recommendations[:limit]

    def delete_token_recommendation(self, mint_address):
        return self.token_recommendations.pop(mint_address, None) is not None


def sol_pair():
    return {
        "chainId": "solana",
        "dexId": "raydium",
        "pairAddress": "pair-address",
        "url": "https://dexscreener.com/solana/pair-address",
        "info": {"imageUrl": "https://cdn.dexscreener.com/cms/images/sol.png?width=64"},
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

    def test_auth_requests_return_json_when_rate_limited(self):
        for _ in range(20):
            self.assertNotEqual(
                self.client.post("/auth", json={}).status_code,
                429,
            )
        response = self.client.post("/auth", json={})
        self.assertEqual(response.status_code, 429)
        self.assertEqual(response.json, {"error": "rate_limit_exceeded"})

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
            "ADMIN_EMAILS": "admin@example.com",
            "ADMIN_BOOTSTRAP_TOKEN": "3" * 64,
            "RATELIMIT_STORAGE_URI": f"redis://:{'1' * 64}@redis:6379/0",
            "MARKET_DISCOVERY_TOKEN": "2" * 64,
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
            ({"ADMIN_EMAILS": ""}, "ADMIN_EMAILS must contain"),
            ({"ADMIN_EMAILS": "not-an-email"}, "ADMIN_EMAILS must contain valid email"),
            ({"ADMIN_BOOTSTRAP_TOKEN": "replace-with-64-random-hex-characters"}, "ADMIN_BOOTSTRAP_TOKEN must be"),
            ({"LOCAL_SECURITY_SIMULATOR": "true"}, "must be disabled"),
            ({"JUPITER_API_KEY": ""}, "production JUPITER_API_KEY"),
            ({"RATELIMIT_STORAGE_URI": "memory://"}, "rate limits must use the Redis"),
            (
                {"RATELIMIT_STORAGE_URI": "redis://:replace-with-64-random-hex-characters@redis:6379/0"},
                "64 hexadecimal characters",
            ),
            (
                {"MARKET_DISCOVERY_TOKEN": "short"},
                "MARKET_DISCOVERY_TOKEN must be 64 hexadecimal characters",
            ),
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

    def test_wallet_portfolio_reads_and_aggregates_spl_token_accounts(self):
        database = MemoryDatabase(authenticated=True)
        rpc_methods = []

        def rpc_fetcher(_url, method="GET", payload=None, headers=None):
            rpc_methods.append(payload["method"])
            if payload["method"] == "getBalance":
                return {"result": {"value": 2_500_000_000}}
            if payload["params"][1]["programId"] == "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA":
                return {
                    "result": {
                        "value": [
                            {
                                "account": {
                                    "data": {
                                        "parsed": {
                                            "info": {
                                                "mint": USDC_MINT,
                                                "tokenAmount": {
                                                    "amount": "7000000",
                                                    "decimals": 6,
                                                },
                                            }
                                        }
                                    }
                                }
                            },
                            {
                                "account": {
                                    "data": {
                                        "parsed": {
                                            "info": {
                                                "mint": USDC_MINT,
                                                "tokenAmount": {
                                                    "amount": "3000000",
                                                    "decimals": 6,
                                                },
                                            }
                                        }
                                    }
                                }
                            },
                        ]
                    }
                }
            return {"result": {"value": []}}

        with patch.dict(os.environ, {"APP_ENV": "staging-local"}):
            app = create_app(
                lambda _url: {"pairs": [sol_pair()]},
                rpc_fetcher=rpc_fetcher,
                database=database,
            )
        app.config.update(TESTING=True, SESSION_COOKIE_SECURE=False)
        client = app.test_client()
        with client.session_transaction() as session:
            session["user_id"] = "test-user"

        response = client.get("/wallet/portfolio")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(rpc_methods, ["getBalance", "getTokenAccountsByOwner", "getTokenAccountsByOwner"])
        portfolio = response.json
        self.assertEqual(portfolio["walletAddress"], SOL_MINT)
        self.assertEqual(portfolio["unpricedCount"], 0)
        self.assertAlmostEqual(portfolio["totalUsd"], 385.625)
        self.assertEqual(len(portfolio["balances"]), 2)
        usdc = next(item for item in portfolio["balances"] if item["mintAddress"] == USDC_MINT)
        self.assertEqual(usdc["amount"], "10")
        self.assertAlmostEqual(usdc["valueUsd"], 10)

    def test_demo_wallet_portfolio_never_calls_mainnet_rpc(self):
        database = MemoryDatabase(authenticated=True, demo=True)
        with patch.dict(os.environ, {"APP_ENV": "staging-local"}):
            app = create_app(
                rpc_fetcher=lambda *_args, **_kwargs: self.fail("Demo wallet must not query Mainnet"),
                database=database,
            )
        app.config.update(TESTING=True, SESSION_COOKIE_SECURE=False)
        client = app.test_client()
        with client.session_transaction() as session:
            session["user_id"] = "test-user"

        response = client.get("/wallet/portfolio")

        self.assertEqual(response.status_code, 403)
        self.assertEqual(response.json["error"], "mainnet_wallet_data_disabled_for_demo_account")

    def test_wallet_portfolio_caps_market_lookups_for_large_wallets(self):
        database = MemoryDatabase(authenticated=True)
        alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"

        def mint_for(index):
            encoded = ""
            while index:
                index, remainder = divmod(index, len(alphabet))
                encoded = alphabet[remainder] + encoded
            return "1" * (32 - len(encoded)) + encoded

        mints = [mint_for(index) for index in range(1, 302)]

        def rpc_fetcher(_url, method="GET", payload=None, headers=None):
            if payload["method"] == "getBalance":
                return {"result": {"value": 0}}
            if payload["params"][1]["programId"] == "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA":
                return {
                    "result": {
                        "value": [
                            {
                                "account": {
                                    "data": {
                                        "parsed": {
                                            "info": {
                                                "mint": mint,
                                                "tokenAmount": {"amount": str(index), "decimals": 0},
                                            }
                                        }
                                    }
                                }
                            }
                            for index, mint in enumerate(mints, start=1)
                        ]
                    }
                }
            return {"result": {"value": []}}

        market_urls = []

        def market_fetcher(url):
            market_urls.append(url)
            return {"pairs": []}

        with patch.dict(os.environ, {"APP_ENV": "staging-local"}):
            app = create_app(
                market_fetcher=market_fetcher,
                rpc_fetcher=rpc_fetcher,
                database=database,
            )
        app.config.update(TESTING=True, SESSION_COOKIE_SECURE=False)
        client = app.test_client()
        with client.session_transaction() as session:
            session["user_id"] = "test-user"

        response = client.get("/wallet/portfolio")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(market_urls), 11)
        self.assertEqual(response.json["omittedCount"], 1)
        self.assertTrue(response.json["truncated"])
        self.assertIsNone(response.json["totalUsd"])
        self.assertEqual(len(response.json["balances"]), 100)

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

    def test_admin_can_recommend_a_live_token_without_triggering_a_swap(self):
        database = MemoryDatabase(authenticated=True, demo=True)
        with patch.dict(
            os.environ,
            {
                "TRADING_MODE": "live",
                "LIVE_TRADING_ENABLED": "true",
                "LOCAL_SECURITY_SIMULATOR": "true",
            },
        ):
            app = create_app(
                market_fetcher=lambda _url: {"pairs": [sol_pair()]},
                database=database,
            )
        app.config.update(TESTING=True, SESSION_COOKIE_SECURE=False)
        client = app.test_client()
        with client.session_transaction() as session:
            session["user_id"] = "test-user"

        response = client.post("/admin/recommendations", json={
            "mintAddress": SOL_MINT,
            "note": "Deep liquidity and strong recent volume.",
        })
        self.assertEqual(response.status_code, 201)
        self.assertEqual(database.swaps, {})
        self.assertEqual(database.token_recommendations[SOL_MINT]["adminUserId"], "test-user")

        listed = client.get("/market/recommendations")
        self.assertEqual(listed.status_code, 200)
        self.assertEqual(listed.json["recommendations"][0]["mintAddress"], SOL_MINT)
        self.assertEqual(listed.json["recommendations"][0]["note"], "Deep liquidity and strong recent volume.")

        deleted = client.delete(f"/admin/recommendations?mint={SOL_MINT}")
        self.assertEqual(deleted.status_code, 200)
        self.assertEqual(client.get("/market/recommendations").json["recommendations"], [])

    def test_admin_recommendation_requires_admin_and_live_market(self):
        regular_database = MemoryDatabase(authenticated=True)
        with patch.dict(
            os.environ,
            {
                "TRADING_MODE": "live",
                "LIVE_TRADING_ENABLED": "true",
                "LOCAL_SECURITY_SIMULATOR": "true",
            },
        ):
            regular_app = create_app(database=regular_database)
        regular_app.config.update(TESTING=True, SESSION_COOKIE_SECURE=False)
        regular_client = regular_app.test_client()
        with regular_client.session_transaction() as session:
            session["user_id"] = "test-user"
        self.assertEqual(
            regular_client.post("/admin/recommendations", json={
                "mintAddress": SOL_MINT,
                "note": "Deep liquidity and strong recent volume.",
            }).status_code,
            403,
        )
        self.assertEqual(regular_client.get("/market/recommendations").status_code, 200)

        admin_database = MemoryDatabase(authenticated=True, demo=True)
        with patch.dict(
            os.environ,
            {
                "TRADING_MODE": "live",
                "LIVE_TRADING_ENABLED": "true",
                "LOCAL_SECURITY_SIMULATOR": "true",
            },
        ):
            admin_app = create_app(
                market_fetcher=lambda _url: {"pairs": []},
                database=admin_database,
            )
        admin_app.config.update(TESTING=True, SESSION_COOKIE_SECURE=False)
        admin_client = admin_app.test_client()
        with admin_client.session_transaction() as session:
            session["user_id"] = "test-user"
        self.assertEqual(
            admin_client.post("/admin/recommendations", json={
                "mintAddress": "not-a-mint",
                "note": "This token is worth buying.",
            }).status_code,
            400,
        )
        self.assertEqual(
            admin_client.post("/admin/recommendations", json={
                "mintAddress": SOL_MINT,
                "note": "Buy it",
            }).status_code,
            400,
        )
        self.assertEqual(
            admin_client.post("/admin/recommendations", json={
                "mintAddress": SOL_MINT,
                "note": "Deep liquidity and strong recent volume.",
            }).status_code,
            404,
        )

    def test_recommendations_are_not_visible_without_authentication(self):
        with patch.dict(os.environ, {"APP_ENV": "staging-local"}):
            app = create_app(database=MemoryDatabase())
        app.config.update(TESTING=True, SESSION_COOKIE_SECURE=False)
        response = app.test_client().get("/market/recommendations")
        self.assertEqual(response.status_code, 401)

    def test_admin_access_uses_persisted_role_and_reads_real_balance(self):
        database = MemoryDatabase(authenticated=True)
        database.accounts["test-user"]["email"] = "ops@example.com"
        database.accounts["test-user"]["is_admin"] = True
        database.wallets["test-user"]["email"] = "ops@example.com"
        database.wallets["test-user"]["is_admin"] = True
        rpc_calls = []

        def rpc_fetcher(_url, method="GET", payload=None, headers=None):
            rpc_calls.append(payload)
            return {"result": {"value": [{"lamports": 7_500_000_000, "data": ["", "base64"]}]}}

        with patch.dict(
            os.environ,
            {"ADMIN_EMAILS": "ops@example.com", "TRADING_MODE": "live", "LIVE_TRADING_ENABLED": "true"},
        ):
            app = create_app(database=database, rpc_fetcher=rpc_fetcher)
        app.config["TESTING"] = True
        client = app.test_client()
        with client.session_transaction() as session:
            session["user_id"] = "test-user"

        account = client.get("/auth").json["account"]
        self.assertTrue(account["isAdmin"])
        wallets = client.get("/admin/wallets")
        self.assertEqual(wallets.status_code, 200)
        self.assertEqual(wallets.json["mode"], "read_only_mainnet")
        self.assertEqual(wallets.json["wallets"][0]["balance_lamports"], "7500000000")
        self.assertEqual(rpc_calls[0]["method"], "getMultipleAccounts")
        self.assertEqual(
            client.post("/admin/security-simulator", json={}).status_code,
            403,
        )

    def test_admin_registration_requires_bootstrap_token(self):
        database = MemoryDatabase()
        with patch.dict(
            os.environ,
            {
                "ADMIN_EMAILS": "ops@example.com",
                "ADMIN_BOOTSTRAP_TOKEN": "a" * 64,
            },
        ):
            app = create_app(database=database)
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
        registration = {
            "action": "register",
            "email": "ops@example.com",
            "password": "long-test-password",
            "walletAddress": SOL_MINT,
            "encryptedWallet": encrypted_wallet,
        }
        self.assertEqual(client.post("/auth", json=registration).status_code, 403)
        registration["adminBootstrapToken"] = "a" * 64
        response = client.post("/auth", json=registration)
        self.assertEqual(response.status_code, 201)
        self.assertTrue(response.json["account"]["isAdmin"])

    def test_local_demo_admin_can_be_provisioned_without_mainnet_trading(self):
        database = MemoryDatabase()
        with patch.dict(
            os.environ,
            {
                "APP_ENV": "staging-local",
                "LOCAL_SECURITY_SIMULATOR": "true",
                "TRADING_MODE": "live",
                "LIVE_TRADING_ENABLED": "true",
            },
        ):
            app = create_app(database=database)
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
        response = client.post("/auth", json={
            "action": "register",
            "email": "admin@local.test",
            "password": "admin",
            "walletAddress": SOL_MINT,
            "encryptedWallet": encrypted_wallet,
        })
        self.assertEqual(response.status_code, 201)
        self.assertTrue(response.json["account"]["isDemo"])
        self.assertTrue(response.json["account"]["isAdmin"])

    def test_unlisted_user_cannot_access_live_admin_wallet_registry(self):
        database = MemoryDatabase(authenticated=True)
        database.accounts["test-user"]["email"] = "ops@example.com"
        database.wallets["test-user"]["email"] = "ops@example.com"
        rpc_calls = []
        with patch.dict(os.environ, {"ADMIN_EMAILS": "ops@example.com"}):
            app = create_app(
                database=database,
                rpc_fetcher=lambda *_args, **_kwargs: rpc_calls.append(True),
            )
        app.config["TESTING"] = True
        client = app.test_client()
        with client.session_transaction() as session:
            session["user_id"] = "test-user"
        self.assertFalse(client.get("/auth").json["account"]["isAdmin"])
        response = client.get("/admin/wallets")
        self.assertEqual(response.status_code, 403)
        self.assertEqual(rpc_calls, [])

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
        self.assertEqual(
            response.json["logoUri"],
            "https://cdn.dexscreener.com/cms/images/sol.png?width=64",
        )

    def test_market_data_rejects_untrusted_token_image_hosts(self):
        app = create_app(
            lambda _url: {
                "pairs": [{
                    **sol_pair(),
                    "info": {
                        "imageUrl": "https://attacker.example/collect-wallet-data.png"
                    },
                }]
            }
        )
        response = app.test_client().get(f"/market/tokens/{SOL_MINT}")
        self.assertEqual(response.status_code, 200)
        self.assertIsNone(response.json["logoUri"])

    def test_market_pair_image_is_not_misapplied_to_the_quote_token(self):
        response = self.client.get(f"/market/tokens/{USDC_MINT}")
        self.assertEqual(response.status_code, 200)
        self.assertIsNone(response.json["logoUri"])

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

    def test_new_token_discovery_ingest_requires_worker_auth_and_valid_mints(self):
        database = MemoryDatabase()
        discovered_mint = "TokenMint11111111111111111111111111111"

        def discovery_fetcher(url):
            if discovered_mint in url:
                return {
                    "pairs": [{
                        **sol_pair(),
                        "info": {},
                        "baseToken": {
                            "address": discovered_mint,
                            "name": "Fresh token",
                            "symbol": "FRESH",
                        },
                        "liquidity": {"usd": 12500},
                        "priceUsd": "0.00025",
                        "dexId": "raydium",
                    }]
                }
            return {"pairs": []}

        app = create_app(discovery_fetcher, database=database)
        client = app.test_client()
        denied = client.post(
            "/market/discovery/ingest",
            json={"mintAddresses": [discovered_mint]},
        )
        self.assertEqual(denied.status_code, 401)

        headers = {
            "Authorization": "Bearer local-staging-discovery-token-change-before-deploy"
        }
        logo_uri = "https://cdn.dexscreener.com/cms/images/fresh.png"
        invalid = client.post(
            "/market/discovery/ingest",
            headers=headers,
            json={"mintAddresses": ["not-a-solana-mint"]},
        )
        self.assertEqual(invalid.status_code, 400)

        ingested = client.post(
            "/market/discovery/ingest",
            headers=headers,
            json={
                "mintAddresses": [discovered_mint],
                "tokenIcons": {discovered_mint: logo_uri},
            },
        )
        self.assertEqual(ingested.status_code, 200)
        self.assertEqual(ingested.json["accepted"], 1)
        listed = client.get("/market/new")
        self.assertEqual(listed.status_code, 200)
        self.assertEqual(listed.json["markets"][0]["mintAddress"], discovered_mint)
        self.assertEqual(listed.json["markets"][0]["symbol"], "FRESH")
        self.assertEqual(listed.json["markets"][0]["logoUri"], logo_uri)

        unsafe_logo = client.post(
            "/market/discovery/ingest",
            headers=headers,
            json={
                "mintAddresses": [discovered_mint],
                "tokenIcons": {discovered_mint: "https://malicious.example/logo.png"},
            },
        )
        self.assertEqual(unsafe_logo.status_code, 400)

    def test_new_token_discovery_rejects_invalid_limits(self):
        app = create_app(database=MemoryDatabase())
        client = app.test_client()
        self.assertEqual(client.get("/market/new?limit=0").status_code, 400)
        self.assertEqual(client.get("/market/new?limit=101").status_code, 400)


if __name__ == "__main__":
    unittest.main()
