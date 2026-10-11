"use client";

import { useCallback, useEffect, useState } from "react";

function formatSol(lamports) {
  try {
    return `${(Number(BigInt(lamports)) / 1_000_000_000).toFixed(4)} SOL`;
  } catch {
    return "Invalid balance";
  }
}

async function requestAdmin(method, payload) {
  const response = await fetch("/api/admin", {
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
      : "admin request failed";
    throw new Error(message);
  }
  return result;
}

export default function AdminWalletPanel() {
  const [wallets, setWallets] = useState([]);
  const [withdrawals, setWithdrawals] = useState([]);
  const [selectedUserId, setSelectedUserId] = useState("");
  const [destination, setDestination] = useState("");
  const [amount, setAmount] = useState("0.1");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [message, setMessage] = useState(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await requestAdmin("GET");
      if (
        result.mode !== "local_simulation_only" ||
        !Array.isArray(result.wallets) ||
        !Array.isArray(result.withdrawals)
      ) {
        throw new Error("The simulator returned an invalid response.");
      }
      setWallets(result.wallets);
      setWithdrawals(result.withdrawals);
      setSelectedUserId((current) =>
        result.wallets.some((wallet) => wallet.user_id === current)
          ? current
          : result.wallets[0]?.user_id ?? ""
      );
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Could not load local wallet records.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

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

  return (
    <section className="admin-simulator">
      <div className="admin-simulator-banner" role="note">
        <strong>Local security simulator · no real withdrawals</strong>
        <span>This panel lists account emails and public wallet addresses. The displayed SOL balances are fake ledger values. Submit only changes this local ledger and audit log; encrypted wallet keys are never returned, and no RPC, signer, or blockchain transaction is used.</span>
      </div>

      <article className="panel history-panel">
        <div className="panel-heading">
          <div>
            <span className="eyebrow">LOCAL ADMIN · TEST DATA ONLY</span>
            <h2>Registered wallets</h2>
            <p>Public addresses and simulated balances only · maximum 500 records</p>
          </div>
          <button className="button button-secondary" onClick={() => void refresh()} disabled={loading}>
            {loading ? "Loading…" : "Refresh"}
          </button>
        </div>
        {error && <div className="trade-feedback is-error" role="alert">{error}</div>}
        {message && <div className="trade-feedback is-success" role="status">{message}</div>}
        {loading && wallets.length === 0 ? (
          <div className="history-empty"><p>Loading local wallet records…</p></div>
        ) : wallets.length === 0 ? (
          <div className="history-empty"><h3>No registered wallets</h3><p>Create a local test account to exercise the simulator.</p></div>
        ) : (
          <div className="history-table-wrap">
            <table className="history-table admin-wallet-table">
              <thead><tr><th>Account</th><th>Public wallet address</th><th>Account type</th><th>Simulated balance</th><th>Created</th></tr></thead>
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

      <article className="panel admin-withdraw-panel">
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
      </article>

      <article className="panel history-panel">
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
      </article>
    </section>
  );
}
