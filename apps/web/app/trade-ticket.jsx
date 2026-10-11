"use client";

import { useEffect, useState } from "react";
import { VersionedTransaction } from "@solana/web3.js";

const SOL_MINT = "So11111111111111111111111111111111111111112";

function formatAtomic(amount, decimals) {
  try {
    const value = BigInt(amount);
    const scale = 10n ** BigInt(decimals);
    const whole = value / scale;
    const fraction = (value % scale)
      .toString()
      .padStart(decimals, "0")
      .slice(0, 6)
      .replace(/0+$/, "");
    return fraction ? `${whole}.${fraction}` : whole.toString();
  } catch {
    return "unavailable";
  }
}

function decodeBase64(value) {
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function encodeBase64(bytes) {
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

async function postTrade(payload) {
  const response = await fetch("/api/trade", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    cache: "no-store",
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(20_000)
  });
  const body = await response.json();
  if (!response.ok) {
    const code =
      typeof body.error === "string"
        ? body.error.replaceAll("_", " ")
        : "trade request failed";
    throw new Error(code);
  }
  return body;
}

export default function TradeTicket({
  market,
  walletAddress,
  walletSigner,
  tradeStatus,
  onTradeComplete
}) {
  const [side, setSide] = useState("buy");
  const [amount, setAmount] = useState("0.01");
  const [order, setOrder] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);

  useEffect(() => {
    setOrder(null);
    setResult(null);
  }, [market.mintAddress]);

  const getOrder = async (event) => {
    event.preventDefault();
    setError(null);
    setResult(null);
    setOrder(null);
    if (!walletAddress) {
      setError("Connect your Solana wallet before requesting an order.");
      return;
    }
    if (!tradeStatus?.enabled) {
      setError("Live swaps are unavailable until a Jupiter API key is configured.");
      return;
    }
    setBusy(true);
    try {
      const nextOrder = await postTrade({
        action: "order",
        side,
        amount,
        mintAddress: market.mintAddress,
        walletAddress
      });
      if (
        typeof nextOrder.transaction !== "string" ||
        typeof nextOrder.requestId !== "string" ||
        !/^\d+$/.test(nextOrder.outAmount) ||
        !Number.isInteger(nextOrder.inputDecimals) ||
        !Number.isInteger(nextOrder.outputDecimals) ||
        nextOrder.inputMint !== (side === "buy" ? SOL_MINT : market.mintAddress) ||
        nextOrder.outputMint !== (side === "buy" ? market.mintAddress : SOL_MINT)
      ) {
        throw new Error("Jupiter returned an invalid or unexpected order.");
      }
      setOrder(nextOrder);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Could not request a Jupiter order.");
    } finally {
      setBusy(false);
    }
  };

  const signAndExecute = async () => {
    if (!order || !walletSigner || !walletAddress) return;
    if (walletSigner.publicKey?.toBase58() !== walletAddress) {
      setError("The account wallet changed. Unlock it again and request a fresh order.");
      setOrder(null);
      return;
    }
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const transaction = VersionedTransaction.deserialize(
        decodeBase64(order.transaction)
      );
      const requiredSigners = transaction.message.staticAccountKeys.slice(
        0,
        transaction.message.header.numRequiredSignatures
      );
      if (!requiredSigners.some((key) => key.toBase58() === walletAddress)) {
        throw new Error("The quoted transaction does not require a signature from this wallet.");
      }
      transaction.sign([walletSigner]);
      const response = await postTrade({
        action: "execute",
        requestId: order.requestId,
        signedTransaction: encodeBase64(transaction.serialize()),
        walletAddress
      });
      setOrder(null);
      setResult(response);
      if (response.status === "Success") onTradeComplete();
    } catch (requestError) {
      setOrder(null);
      setError(
        requestError instanceof Error
          ? `${requestError.message}. Check your wallet and transaction activity before retrying.`
          : "Swap status is unknown. Check your wallet and transaction activity before retrying."
      );
    } finally {
      setBusy(false);
    }
  };

  const outputDecimals = order?.outputDecimals ?? 0;
  const outputAmount = order
    ? formatAtomic(order.outAmount, outputDecimals)
    : null;

  return (
    <article className="panel trade-ticket">
      <div className="panel-heading">
        <div>
          <div className="panel-title-line">
            <h2>Swap on Solana Mainnet</h2>
            <span className="mainnet-badge">REAL FUNDS</span>
          </div>
          <p>Non-custodial execution through Jupiter Swap API v2</p>
        </div>
        <span className="panel-menu"><span className="status-dot" />MAINNET</span>
      </div>

      <div className="trade-warning" role="note">
        <strong>Mainnet transactions use real funds.</strong>
        <span>Verify both mint addresses and the amount. The next step signs with your unlocked account wallet in this browser and submits a real transaction.</span>
      </div>

      {!tradeStatus?.enabled && (
        <div className="trade-setup" role="status">
          Live swaps require a Jupiter API key on the API server.
          <a href="https://portal.jup.ag/" target="_blank" rel="noreferrer">Get a Jupiter API key <span aria-hidden="true">↗</span></a>
        </div>
      )}

      <div className="trade-direction" aria-label="Swap direction">
        <button
          type="button"
          className={side === "buy" ? "active" : ""}
          onClick={() => { setSide("buy"); setOrder(null); setError(null); setResult(null); }}
          disabled={busy}
        >Buy {market.symbol}</button>
        <button
          type="button"
          className={side === "sell" ? "active" : ""}
          onClick={() => { setSide("sell"); setOrder(null); setError(null); setResult(null); }}
          disabled={busy}
        >Sell {market.symbol}</button>
      </div>

      <form className="trade-form" onSubmit={(event) => void getOrder(event)}>
        <label htmlFor="trade-amount">{side === "buy" ? "You pay · SOL" : `You sell · ${market.symbol}`}</label>
        <div className="trade-amount-row">
          <input
            id="trade-amount"
            type="number"
            inputMode="decimal"
            min="0.000001"
            max={side === "buy" ? tradeStatus?.maxBuySol ?? "1" : undefined}
            step="any"
            value={amount}
            onChange={(event) => { setAmount(event.target.value); setOrder(null); setResult(null); }}
            required
            disabled={busy}
          />
          <span>{side === "buy" ? "SOL" : market.symbol}</span>
        </div>
        {side === "buy" && <small className="trade-limit">Maximum per buy: {tradeStatus?.maxBuySol ?? 1} SOL</small>}
        <div className="trade-asset-line">
          <span>{side === "buy" ? "You receive" : "You receive · SOL"}</span>
          <strong>{side === "buy" ? market.symbol : "SOL"}</strong>
        </div>
        <button
          className="button button-secondary trade-quote-button"
          type="submit"
          disabled={busy || !walletAddress || !tradeStatus?.enabled || !market.mintAddress || market.mintAddress === SOL_MINT}
        >{busy ? "Working…" : "Get fresh Jupiter quote"}</button>
      </form>

      {market.mintAddress === SOL_MINT && <p className="trade-inline-note">Select a token market first to create a swap order.</p>}
      {!walletAddress && <span className="text-button trade-connect">Sign in and unlock your account wallet to continue <span aria-hidden="true">→</span></span>}

      {order && (
        <section className="order-review" aria-label="Review swap order">
          <div className="order-review-heading"><strong>Review before wallet signature</strong><span>QUOTE · {order.router}</span></div>
          <div className="order-review-amounts">
            <div><span>Pay</span><strong>{formatAtomic(order.inputAmount, order.inputDecimals)} {side === "buy" ? "SOL" : market.symbol}</strong></div>
            <span aria-hidden="true">→</span>
            <div><span>Estimated receive</span><strong>{outputAmount} {side === "buy" ? market.symbol : "SOL"}</strong></div>
          </div>
          <div className="order-mints">
            <span>Input mint <code>{order.inputMint}</code></span>
            <span>Output mint <code>{order.outputMint}</code></span>
          </div>
          <p>The quote expires quickly. Selecting the button signs with the account wallet unlocked in this browser and submits the transaction to Jupiter on Mainnet.</p>
          <button className="button button-live" onClick={() => void signAndExecute()} disabled={busy}>
            {busy ? "Signing / submitting…" : "Sign & submit Mainnet swap"}
          </button>
          <button className="text-button order-cancel" onClick={() => setOrder(null)} disabled={busy}>Cancel quote</button>
        </section>
      )}

      {error && <div className="trade-feedback is-error" role="alert">{error}</div>}
      {result && (
        <div className={`trade-feedback ${result.status === "Success" ? "is-success" : "is-error"}`} role="status">
          <strong>{result.status === "Success" ? "Swap confirmed by Jupiter" : "Jupiter reported a failed swap"}</strong>
          {result.signature && <a href={`https://solscan.io/tx/${encodeURIComponent(result.signature)}`} target="_blank" rel="noreferrer">View Mainnet transaction <span aria-hidden="true">↗</span></a>}
          {result.error && <span>{result.error}</span>}
        </div>
      )}
      <div className="trade-wallet-line">
        <span className={`status-dot ${walletAddress ? "" : "is-offline"}`} />
        {walletAddress ? `Connected wallet · ${walletAddress}` : "Wallet not connected"}
        <span className="trade-custody-note">Your key is decrypted only in this browser session.</span>
      </div>
    </article>
  );
}
