"use client";

import { useEffect, useState } from "react";
import { VersionedTransaction } from "@solana/web3.js";
import { useLocale } from "./locale-provider";

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
  const { t } = useLocale();
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
      setError(t("trade.connectBeforeOrder"));
      return;
    }
    if (!tradeStatus?.enabled) {
      setError(t("trade.notConfigured"));
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
        throw new Error(t("trade.invalidOrder"));
      }
      setOrder(nextOrder);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : t("trade.requestFailed"));
    } finally {
      setBusy(false);
    }
  };

  const signAndExecute = async () => {
    if (!order || !walletSigner || !walletAddress) return;
    if (walletSigner.publicKey?.toBase58() !== walletAddress) {
      setError(t("trade.walletChanged"));
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
        throw new Error(t("trade.signatureMissing"));
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
          ? t("trade.retryCheck", { error: requestError.message })
          : t("trade.unknownStatus")
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
            <h2>{t("trade.title")}</h2>
              <span className="mainnet-badge">{t("trade.realFunds")}</span>
          </div>
          <p>{t("trade.nonCustodial")}</p>
        </div>
        <span className="panel-menu"><span className="status-dot" />{t("trade.mainnet")}</span>
      </div>

      <div className="trade-warning" role="note">
        <strong>{t("trade.warningTitle")}</strong>
        <span>{t("trade.warningBody")}</span>
      </div>

      {!tradeStatus?.enabled && (
        <div className="trade-setup" role="status">
          {t("trade.setupRequired")}
          <a href="https://portal.jup.ag/" target="_blank" rel="noreferrer">{t("trade.getApiKey")} <span aria-hidden="true">↗</span></a>
        </div>
      )}

      <div className="trade-direction" aria-label={t("trade.direction")}>
        <button
          type="button"
          className={side === "buy" ? "active" : ""}
          onClick={() => { setSide("buy"); setOrder(null); setError(null); setResult(null); }}
          disabled={busy}
        >{t("trade.buy", { symbol: market.symbol })}</button>
        <button
          type="button"
          className={side === "sell" ? "active" : ""}
          onClick={() => { setSide("sell"); setOrder(null); setError(null); setResult(null); }}
          disabled={busy}
        >{t("trade.sell", { symbol: market.symbol })}</button>
      </div>

      <form className="trade-form" onSubmit={(event) => void getOrder(event)}>
        <label htmlFor="trade-amount">{side === "buy" ? t("trade.youPaySol") : t("trade.youSell", { symbol: market.symbol })}</label>
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
        {side === "buy" && <small className="trade-limit">{t("trade.maximumPerBuy", { amount: tradeStatus?.maxBuySol ?? 1 })}</small>}
        <div className="trade-asset-line">
          <span>{side === "buy" ? t("trade.youReceive") : t("trade.youReceiveSol")}</span>
          <strong>{side === "buy" ? market.symbol : "SOL"}</strong>
        </div>
        <button
          className="button button-secondary trade-quote-button"
          type="submit"
          disabled={busy || !walletAddress || !tradeStatus?.enabled || !market.mintAddress || market.mintAddress === SOL_MINT}
        >{busy ? t("trade.working") : t("trade.getQuote")}</button>
      </form>

      {market.mintAddress === SOL_MINT && <p className="trade-inline-note">{t("trade.selectMarket")}</p>}
      {!walletAddress && <span className="text-button trade-connect">{t("trade.unlockPrompt")} <span aria-hidden="true">→</span></span>}

      {order && (
        <section className="order-review" aria-label={t("trade.orderReview")}>
          <div className="order-review-heading"><strong>{t("trade.reviewBeforeSign")}</strong><span>{t("trade.quote", { router: order.router })}</span></div>
          <div className="order-review-amounts">
            <div><span>{t("trade.pay")}</span><strong>{formatAtomic(order.inputAmount, order.inputDecimals)} {side === "buy" ? "SOL" : market.symbol}</strong></div>
            <span aria-hidden="true">→</span>
            <div><span>{t("trade.estimatedReceive")}</span><strong>{outputAmount} {side === "buy" ? market.symbol : "SOL"}</strong></div>
          </div>
          <div className="order-mints">
            <span>{t("trade.inputMint")} <code>{order.inputMint}</code></span>
            <span>{t("trade.outputMint")} <code>{order.outputMint}</code></span>
          </div>
          <p>{t("trade.quoteWarning")}</p>
          <button className="button button-live" onClick={() => void signAndExecute()} disabled={busy}>
            {busy ? t("trade.signing") : t("trade.submit")}
          </button>
          <button className="text-button order-cancel" onClick={() => setOrder(null)} disabled={busy}>{t("trade.cancelQuote")}</button>
        </section>
      )}

      {error && <div className="trade-feedback is-error" role="alert">{error}</div>}
      {result && (
        <div className={`trade-feedback ${result.status === "Success" ? "is-success" : "is-error"}`} role="status">
          <strong>{result.status === "Success" ? t("trade.swapConfirmed") : t("trade.swapFailed")}</strong>
          {result.signature && <a href={`https://solscan.io/tx/${encodeURIComponent(result.signature)}`} target="_blank" rel="noreferrer">{t("trade.viewTransaction")} <span aria-hidden="true">↗</span></a>}
          {result.error && <span>{result.error}</span>}
        </div>
      )}
      <div className="trade-wallet-line">
        <span className={`status-dot ${walletAddress ? "" : "is-offline"}`} />
        {walletAddress ? t("trade.connectedWallet", { address: walletAddress }) : t("trade.walletDisconnected")}
        <span className="trade-custody-note">{t("trade.browserKeyNote")}</span>
      </div>
    </article>
  );
}
