"use client";

import { useCallback, useEffect, useState } from "react";
import TokenManagementPanel from "./token-management-panel";

function formatSol(lamports) {
  try {
    return `${(Number(BigInt(lamports)) / 1_000_000_000).toFixed(4)} SOL`;
  } catch {
    return "Invalid balance";
  }
}

async function requestAdmin(method, payload, resource, offset = 0) {
  const response = await fetch(
    resource
      ? `/api/admin?resource=${encodeURIComponent(resource)}&offset=${offset}`
      : "/api/admin",
    {
      method,
      headers: payload ? { "Content-Type": "application/json" } : undefined,
      ...(payload ? { body: JSON.stringify(payload) } : {}),
      cache: "no-store",
      signal: AbortSignal.timeout(15_000)
    }
  );
  const result = await response.json();
  if (!response.ok) {
    const message = typeof result.error === "string"
      ? result.error.replaceAll("_", " ")
      : "admin request failed";
    throw new Error(message);
  }
  return result;
}

async function requestRecommendation(method, payload, mintAddress) {
  const url = mintAddress
    ? `/api/recommendations?mint=${encodeURIComponent(mintAddress)}`
    : "/api/recommendations";
  const response = await fetch(url, {
    method,
    headers: payload ? { "Content-Type": "application/json" } : undefined,
    ...(payload ? { body: JSON.stringify(payload) } : {}),
    cache: "no-store",
    signal: AbortSignal.timeout(15_000)
  });
  const result = await response.json();
  if (!response.ok) {
    const message = typeof result.error === "string"
      ? result.error.replaceAll("_", " ")
      : "recommendation request failed";
    throw new Error(message);
  }
  return result;
}

export default function AdminWalletPanel({ isLocalSimulator }) {
  const [wallets, setWallets] = useState([]);
  const [withdrawals, setWithdrawals] = useState([]);
  const [recommendations, setRecommendations] = useState([]);
  const [mintAddress, setMintAddress] = useState("");
  const [recommendationNote, setRecommendationNote] = useState("");
  const [selectedUserId, setSelectedUserId] = useState("");
  const [walletOffset, setWalletOffset] = useState(0);
  const [walletHasMore, setWalletHasMore] = useState(false);
  const [destination, setDestination] = useState("");
  const [amount, setAmount] = useState("0.1");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [message, setMessage] = useState(null);
  const [recommendationBusy, setRecommendationBusy] = useState(false);
  const [recommendationError, setRecommendationError] = useState(null);
  const [recommendationMessage, setRecommendationMessage] = useState(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      let walletList;
      if (isLocalSimulator) {
        const result = await requestAdmin("GET");
        if (
          result.mode !== "local_simulation_only" ||
          !Array.isArray(result.wallets) ||
          !Array.isArray(result.withdrawals)
        ) {
          throw new Error("The simulator returned an invalid response.");
        }
        walletList = result.wallets;
        setWallets(walletList);
        setWithdrawals(result.withdrawals);
      } else {
        const result = await requestAdmin("GET", undefined, "wallets", walletOffset);
        if (result.mode !== "read_only_mainnet" || !Array.isArray(result.wallets)) {
          throw new Error("The live wallet registry returned an invalid response.");
        }
        walletList = result.wallets;
        setWallets(walletList);
        setWithdrawals([]);
        setWalletHasMore(result.hasMore === true);
      }
      setSelectedUserId((current) =>
        walletList.some((wallet) => wallet.user_id === current)
          ? current
          : walletList[0]?.user_id ?? ""
      );
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Could not load local wallet records.");
    } finally {
      setLoading(false);
    }
  }, [isLocalSimulator, walletOffset]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const refreshRecommendations = useCallback(async () => {
    setRecommendationError(null);
    try {
      const result = await requestRecommendation("GET");
      if (!Array.isArray(result.recommendations)) {
        throw new Error("The recommendation service returned an invalid response.");
      }
      setRecommendations(result.recommendations);
    } catch (requestError) {
      setRecommendationError(requestError instanceof Error ? requestError.message : "Could not load token recommendations.");
    }
  }, []);

  useEffect(() => {
    void refreshRecommendations();
  }, [refreshRecommendations]);

  const selectedWallet = wallets.find((wallet) => wallet.user_id === selectedUserId);

  const submitWithdrawal = async (event) => {
    event.preventDefault();
    if (!selectedWallet) return;
    const confirmed = window.confirm(
      `Simulation only: record a ${amount} SOL test withdrawal from ${selectedWallet.email} to ${destination}? No blockchain transaction will be sent.`
    );
    if (!confirmed) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const result = await requestAdmin("POST", {
        walletUserId: selectedWallet.user_id,
        destinationAddress: destination.trim(),
        amountSol: amount
      });
      setMessage(
        `Simulation recorded; ${formatSol(result.withdrawal.amount_lamports)} deducted from the test ledger.`
      );
      await refresh();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Could not simulate withdrawal.");
    } finally {
      setBusy(false);
    }
  };

  const submitRecommendation = async (event) => {
    event.preventDefault();
    setRecommendationBusy(true);
    setRecommendationError(null);
    setRecommendationMessage(null);
    try {
      await requestRecommendation("POST", {
        mintAddress: mintAddress.trim(),
        note: recommendationNote.trim()
      });
      setMintAddress("");
      setRecommendationNote("");
      setRecommendationMessage("Token recommendation is now visible to signed-in accounts.");
      await refreshRecommendations();
    } catch (requestError) {
      setRecommendationError(requestError instanceof Error ? requestError.message : "Could not publish token recommendation.");
    } finally {
      setRecommendationBusy(false);
    }
  };

  const removeRecommendation = async (recommendation) => {
    if (!window.confirm(`Remove the recommendation for ${recommendation.symbol}? This will not affect the token or any user wallet.`)) {
      return;
    }
    setRecommendationBusy(true);
    setRecommendationError(null);
    setRecommendationMessage(null);
    try {
      await requestRecommendation("DELETE", undefined, recommendation.mintAddress);
      setRecommendationMessage(`${recommendation.symbol} recommendation removed.`);
      await refreshRecommendations();
    } catch (requestError) {
      setRecommendationError(requestError instanceof Error ? requestError.message : "Could not remove token recommendation.");
    } finally {
      setRecommendationBusy(false);
    }
  };

  return (
    <section className="admin-simulator admin-cockpit">
      <section className="admin-cockpit-deck" aria-label="Administrator command deck">
        <div className="admin-cockpit-title">
          <span className="eyebrow">{isLocalSimulator ? "COMMAND DECK · LOCAL STAGING" : "COMMAND DECK · PRODUCTION"}</span>
          <h2>{isLocalSimulator ? "Station operations" : "Mainnet operations"}</h2>
          <p>{isLocalSimulator ? "Solana Mainnet visibility · wallet execution disabled for demo" : "Read-only wallet monitoring · token actions require administrator wallet approval"}</p>
        </div>
        <div className="admin-cockpit-radar" aria-hidden="true">
          <div className="admin-radar-rings"><span /><span /><span /></div>
          <div className="admin-radar-sweep" />
          <i className="radar-contact contact-one" />
          <i className="radar-contact contact-two" />
          <i className="radar-contact contact-three" />
          <span className="radar-center">STN<br />01</span>
          <span className="radar-readout radar-readout-top">SOL / MAINNET</span>
          <span className="radar-readout radar-readout-bottom">LOCAL CONTROL</span>
        </div>
        <div className="admin-cockpit-instruments">
          <article className="cockpit-instrument">
            <span className="instrument-label">WALLETS IN SCOPE</span>
            <strong>{loading ? "—" : wallets.length}</strong>
            <span className="instrument-status"><i /> ACCOUNT REGISTRY</span>
          </article>
          <article className="cockpit-instrument">
            <span className="instrument-label">FEATURED MARKETS</span>
            <strong>{recommendations.length}</strong>
            <span className="instrument-status"><i /> CURATED FEED</span>
          </article>
          <article className="cockpit-instrument">
            <span className="instrument-label">{isLocalSimulator ? "AUDIT EVENTS" : "WALLET CUSTODY"}</span>
            <strong>{isLocalSimulator ? withdrawals.length : "USER"}</strong>
            <span className="instrument-status instrument-status-amber"><i /> {isLocalSimulator ? "SIMULATED ONLY" : "NON-CUSTODIAL"}</span>
          </article>
        </div>
      </section>

      {isLocalSimulator && <div className="admin-simulator-banner" role="note">
        <strong>Local security simulator · no real withdrawals</strong>
        <span>This panel lists account emails and public wallet addresses. The displayed SOL balances are fake ledger values. Submit only changes this local ledger and audit log; encrypted wallet keys are never returned, and no RPC, signer, or blockchain transaction is used.</span>
      </div>}
      {!isLocalSimulator && <div className="admin-simulator-banner" role="note">
        <strong>Non-custodial administration · owners control their funds</strong>
        <span>Wallet balances below are read live from Solana Mainnet. Administrators can never sign or withdraw from another account; each transfer requires the wallet owner&apos;s signature. Token actions are signed separately in the connected administrator wallet.</span>
      </div>}

      <TokenManagementPanel />

      <article className="panel admin-recommendations-panel">
        <div className="panel-heading">
          <div>
            <span className="eyebrow">ADMIN MARKET DESK · EXISTING MINTS ONLY</span>
            <h2>Recommend a token</h2>
            <p>Add a live, DexScreener-indexed Solana token to signed-in users&apos; New tokens feed.</p>
          </div>
        </div>
        <div className="admin-recommendation-notice" role="note">
          This does not create a token, launch it on-chain, or buy it for anyone. Recommendations are manually curated market notes, not financial advice; users must review the mint and decide for themselves.
        </div>
        {recommendationError && <div className="trade-feedback is-error" role="alert">{recommendationError}</div>}
        {recommendationMessage && <div className="trade-feedback is-success" role="status">{recommendationMessage}</div>}
        <form className="admin-recommendation-form" onSubmit={(event) => void submitRecommendation(event)}>
          <label htmlFor="recommendation-mint">Solana mint address</label>
          <input
            id="recommendation-mint"
            value={mintAddress}
            onChange={(event) => setMintAddress(event.target.value)}
            minLength={32}
            maxLength={44}
            autoComplete="off"
            spellCheck="false"
            required
          />
          <label htmlFor="recommendation-note">Why it is on the watchlist · 10–300 characters</label>
          <textarea
            id="recommendation-note"
            value={recommendationNote}
            onChange={(event) => setRecommendationNote(event.target.value)}
            minLength={10}
            maxLength={300}
            rows={3}
            required
          />
          <button className="button button-live" type="submit" disabled={recommendationBusy}>
            {recommendationBusy ? "Publishing…" : "Publish recommendation"}
          </button>
        </form>
        {recommendations.length > 0 ? (
          <div className="history-table-wrap">
            <table className="history-table">
              <thead><tr><th>Token</th><th>Admin market note</th><th>Added</th><th>Action</th></tr></thead>
              <tbody>{recommendations.map((recommendation) => (
                <tr key={recommendation.mintAddress}>
                  <td><strong>{recommendation.symbol}</strong><br /><code>{recommendation.mintAddress}</code></td>
                  <td>{recommendation.note}</td>
                  <td>{new Date(recommendation.recommendedAt).toLocaleString()}</td>
                  <td><button className="button button-secondary" type="button" onClick={() => void removeRecommendation(recommendation)} disabled={recommendationBusy}>Remove</button></td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        ) : (
          <div className="history-empty"><p>No administrator recommendations have been published.</p></div>
        )}
      </article>

      <article className="panel history-panel">
        <div className="panel-heading">
          <div>
            <span className="eyebrow">LOCAL ADMIN · TEST DATA ONLY</span>
            <h2>Registered wallets</h2>
            <p>{isLocalSimulator ? "Public addresses and simulated balances only · maximum 500 records" : "Live SOL balances on Solana Mainnet · 100 wallets per page"}</p>
          </div>
          <button className="button button-secondary" onClick={() => void refresh()} disabled={loading}>
            {loading ? "Loading…" : "Refresh"}
          </button>
          {!isLocalSimulator && <div className="wallet-pagination">
            <button className="button button-secondary" type="button" onClick={() => setWalletOffset((offset) => Math.max(0, offset - 100))} disabled={loading || walletOffset === 0}>Previous</button>
            <span>{Math.floor(walletOffset / 100) + 1}</span>
            <button className="button button-secondary" type="button" onClick={() => setWalletOffset((offset) => offset + 100)} disabled={loading || !walletHasMore}>Next</button>
          </div>}
        </div>
        {error && <div className="trade-feedback is-error" role="alert">{error}</div>}
        {message && <div className="trade-feedback is-success" role="status">{message}</div>}
        {loading && wallets.length === 0 ? (
          <div className="history-empty"><p>Loading local wallet records…</p></div>
        ) : wallets.length === 0 ? (
          <div className="history-empty"><h3>No registered wallets</h3><p>{isLocalSimulator ? "Create a local test account to exercise the simulator." : "New registered wallets will appear here."}</p></div>
        ) : (
          <div className="history-table-wrap">
            <table className="history-table admin-wallet-table">
              <thead><tr><th>Account</th><th>Public wallet address</th><th>Account type</th><th>{isLocalSimulator ? "Simulated balance" : "Mainnet SOL balance"}</th><th>Created</th></tr></thead>
              <tbody>{wallets.map((wallet) => (
                <tr key={wallet.user_id}>
                  <td>{wallet.email}</td>
                  <td><code>{wallet.wallet_address}</code></td>
                  <td>{wallet.is_demo ? "Local demo" : "Registered"}</td>
                  <td>{formatSol(wallet.balance_lamports)}</td>
                  <td>{new Date(wallet.created_at).toLocaleString()}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
      </article>

      {isLocalSimulator && <article className="panel admin-withdraw-panel">
        <div className="panel-heading"><div><span className="eyebrow">ATTACK-PATH EXERCISE</span><h2>Simulate an admin withdrawal</h2><p>Test how a compromised admin could abuse privileged access. This cannot move real funds.</p></div></div>
        <form className="admin-withdraw-form" onSubmit={(event) => void submitWithdrawal(event)}>
          <label htmlFor="sim-wallet">Source account</label>
          <select id="sim-wallet" value={selectedUserId} onChange={(event) => setSelectedUserId(event.target.value)} required disabled={busy || wallets.length === 0}>
            {wallets.map((wallet) => <option key={wallet.user_id} value={wallet.user_id}>{wallet.email} · {formatSol(wallet.balance_lamports)}</option>)}
          </select>
          <label htmlFor="sim-destination">Destination address (record only)</label>
          <input id="sim-destination" value={destination} onChange={(event) => setDestination(event.target.value)} minLength={32} maxLength={44} autoComplete="off" required />
          <label htmlFor="sim-amount">Amount · simulated SOL (max 10)</label>
          <input id="sim-amount" type="number" inputMode="decimal" min="0.000000001" max="10" step="0.000000001" value={amount} onChange={(event) => setAmount(event.target.value)} required />
          <button className="button button-live" type="submit" disabled={busy || !selectedWallet}>{busy ? "Recording simulation…" : "Record simulated withdrawal"}</button>
        </form>
      </article>}

      {isLocalSimulator && <article className="panel history-panel">
        <div className="panel-heading"><div><span className="eyebrow">AUDIT TRAIL</span><h2>Simulated withdrawals</h2><p>Newest 100 local simulator events</p></div></div>
        {withdrawals.length ? (
          <div className="history-table-wrap"><table className="history-table">
            <thead><tr><th>Source</th><th>Destination</th><th>Amount</th><th>Status</th><th>Time</th></tr></thead>
            <tbody>{withdrawals.map((withdrawal) => <tr key={withdrawal.id}>
              <td><code>{withdrawal.wallet_address}</code></td>
              <td><code>{withdrawal.destination_address}</code></td>
              <td>{formatSol(withdrawal.amount_lamports)}</td>
              <td><span className="history-status status-unknown">SIMULATED</span></td>
              <td>{new Date(withdrawal.created_at).toLocaleString()}</td>
            </tr>)}</tbody>
          </table></div>
        ) : <div className="history-empty"><h3>No simulated withdrawals</h3><p>Test events will be recorded here.</p></div>}
      </article>}
    </section>
  );
}
