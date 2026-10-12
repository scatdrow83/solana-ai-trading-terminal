"use client";

import { useEffect, useState } from "react";
import { Keypair } from "@solana/web3.js";

const KDF_ITERATIONS = 600_000;

function toBase64(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function fromBase64(value) {
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

async function deriveWalletKey(password, salt) {
  const material = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveKey"]
  );
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations: KDF_ITERATIONS },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

async function encryptWallet(password, keypair) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveWalletKey(password, salt);
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    keypair.secretKey
  );
  return {
    version: 1,
    kdf: "PBKDF2-SHA256",
    iterations: KDF_ITERATIONS,
    salt: toBase64(salt),
    iv: toBase64(iv),
    ciphertext: toBase64(new Uint8Array(ciphertext))
  };
}

async function decryptWallet(password, encryptedWallet, walletAddress) {
  if (
    encryptedWallet?.version !== 1 ||
    encryptedWallet?.kdf !== "PBKDF2-SHA256" ||
    encryptedWallet?.iterations !== KDF_ITERATIONS
  ) {
    throw new Error("The encrypted wallet format is unsupported.");
  }
  const salt = fromBase64(encryptedWallet.salt);
  const iv = fromBase64(encryptedWallet.iv);
  if (salt.length !== 16 || iv.length !== 12) {
    throw new Error("The encrypted wallet data is invalid.");
  }
  const key = await deriveWalletKey(password, salt);
  let secretKey;
  try {
    secretKey = new Uint8Array(
      await crypto.subtle.decrypt(
        { name: "AES-GCM", iv },
        key,
        fromBase64(encryptedWallet.ciphertext)
      )
    );
  } catch {
    throw new Error("Incorrect password or damaged encrypted wallet.");
  }
  try {
    const keypair = Keypair.fromSecretKey(secretKey);
    if (keypair.publicKey.toBase58() !== walletAddress) {
      keypair.secretKey.fill(0);
      throw new Error("The wallet does not match this account.");
    }
    return keypair;
  } finally {
    secretKey.fill(0);
  }
}

async function postAuth(payload) {
  const response = await fetch("/api/auth", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    cache: "no-store",
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(20_000)
  });
  const body = await response.json();
  if (!response.ok) {
    const error = typeof body.error === "string"
      ? body.error.replaceAll("_", " ")
      : "account request failed";
    throw new Error(error);
  }
  return body;
}

export default function AccountGate({ onUnlocked }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [adminBootstrapToken, setAdminBootstrapToken] = useState("");
  const [account, setAccount] = useState(null);
  const [demoAvailable, setDemoAvailable] = useState(false);
  const [mode, setMode] = useState("register");
  const [newKeypair, setNewKeypair] = useState(null);
  const [savedKey, setSavedKey] = useState(false);
  const [copied, setCopied] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/auth", { cache: "no-store" })
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.error ?? "account API unavailable");
        if (!cancelled && body.demoAvailable === true) {
          setDemoAvailable(true);
          setEmail("admin@local.test");
          setPassword("admin");
        }
        if (!cancelled && body.authenticated) {
          setAccount(body.account);
          setEmail(body.account.email);
          setMode("login");
        }
      })
      .catch((requestError) => {
        console.error("Could not restore the account session", requestError);
        if (!cancelled) {
          setError(
            requestError instanceof Error
              ? requestError.message
              : "The account service is unavailable."
          );
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const generateWallet = () => {
    setError(null);
    const isDemoSignup =
      demoAvailable &&
      email.trim().toLowerCase() === "admin@local.test" &&
      password === "admin";
    if (password.length < 12 && !isDemoSignup) {
      setError("Use an account password with at least 12 characters.");
      return;
    }
    if (!crypto?.subtle) {
      setError("A secure browser context is required to create an encrypted wallet.");
      return;
    }
    newKeypair?.secretKey.fill(0);
    setNewKeypair(Keypair.generate());
    setSavedKey(false);
  };

  const finishUnlock = async (response) => {
    if (!response?.account || !response?.encryptedWallet) {
      throw new Error("The account response is missing wallet data.");
    }
    const keypair = await decryptWallet(
      password,
      response.encryptedWallet,
      response.account.walletAddress
    );
    setPassword("");
    onUnlocked(response.account, keypair);
  };

  const submitRegister = async (event) => {
    event.preventDefault();
    setError(null);
    const isDemoSignup =
      demoAvailable &&
      email.trim().toLowerCase() === "admin@local.test" &&
      password === "admin";
    if (!newKeypair || (!isDemoSignup && !savedKey)) {
      setError("Create the wallet and confirm you have safely backed up its secret key.");
      return;
    }
    setBusy(true);
    try {
      const encryptedWallet = await encryptWallet(password, newKeypair);
      const response = await postAuth({
        action: "register",
        email,
        password,
        walletAddress: newKeypair.publicKey.toBase58(),
        encryptedWallet,
        adminBootstrapToken
      });
      setAccount(response.account);
      setPassword("");
      setAdminBootstrapToken("");
      onUnlocked(response.account, newKeypair);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Account creation failed.");
    } finally {
      setBusy(false);
    }
  };

  const submitLogin = async (event) => {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const response = account
        ? await postAuth({ action: "unlock" })
        : await postAuth({ action: "login", email, password });
      if (response.account) {
        setAccount(response.account);
        setEmail(response.account.email);
      }
      await finishUnlock(response);
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Could not unlock this account wallet."
      );
    } finally {
      setBusy(false);
    }
  };

  const copySecretKey = async () => {
    if (!newKeypair) return;
    try {
      await navigator.clipboard.writeText(JSON.stringify(Array.from(newKeypair.secretKey)));
      setCopied(true);
    } catch (copyError) {
      setError(copyError instanceof Error ? copyError.message : "Clipboard access was denied.");
    }
  };

  const changeMode = (nextMode) => {
    if (newKeypair) newKeypair.secretKey.fill(0);
    setNewKeypair(null);
    setSavedKey(false);
    setError(null);
    setMode(nextMode);
    if (nextMode === "register") setAccount(null);
  };

  const isDemoSignup =
    demoAvailable &&
    email.trim().toLowerCase() === "admin@local.test" &&
    password === "admin";

  if (loading) {
    return <main className="account-shell"><div className="account-card"><span className="eyebrow">SOLANA MAINNET</span><h1>Loading your account…</h1></div></main>;
  }

  return (
    <main className="account-shell">
      <section className="account-card">
        <a className="brand account-brand" href="/" aria-label="Solana Terminal home">
          <span className="brand-mark"><span /><span /><span /></span>
          <span className="brand-name">solana<span>terminal</span></span>
        </a>
        <p className="eyebrow account-eyebrow">SOLANA MAINNET · PERSONAL ACCOUNT</p>
        <h1>{mode === "register" ? "Create your account." : "Welcome back."}</h1>
        <p className="account-subtitle">
          {mode === "register"
            ? "Registration generates a new Solana wallet and assigns its public address to your account."
            : account
              ? `Unlock the encrypted wallet for ${account.email}.`
              : "Sign in to unlock your encrypted Solana wallet."}
        </p>

        {error && <div className="trade-feedback is-error" role="alert">{error}</div>}

        {mode === "register" && !newKeypair ? (
          <form className="account-form" onSubmit={(event) => { event.preventDefault(); generateWallet(); }}>
            <label htmlFor="account-email">Email</label>
            <input id="account-email" type="email" autoComplete="email" maxLength={254} value={email} onChange={(event) => setEmail(event.target.value)} required />
            <label htmlFor="account-password">Account password</label>
            <input id="account-password" type="password" autoComplete="new-password" minLength={demoAvailable && email.trim().toLowerCase() === "admin@local.test" ? 5 : 12} maxLength={128} value={password} onChange={(event) => setPassword(event.target.value)} required />
            <small>{demoAvailable && email.trim().toLowerCase() === "admin@local.test" ? "Local demo credentials only: admin / admin. Never fund the demo wallet." : "At least 12 characters. This password encrypts your wallet key in your browser."}</small>
            <button className="button button-primary" type="submit">{demoAvailable && email.trim().toLowerCase() === "admin@local.test" ? "Generate local demo wallet" : "Generate my Solana wallet"}</button>
          </form>
        ) : mode === "register" ? (
          <form className="account-form" onSubmit={(event) => void submitRegister(event)}>
            <label htmlFor="account-email">Email</label>
            <input id="account-email" type="email" autoComplete="email" maxLength={254} value={email} onChange={(event) => setEmail(event.target.value)} required />
            <label htmlFor="account-password">Account password</label>
            <input id="account-password" type="password" autoComplete="new-password" minLength={demoAvailable && email.trim().toLowerCase() === "admin@local.test" ? 5 : 12} maxLength={128} value={password} onChange={(event) => setPassword(event.target.value)} required />
            {!isDemoSignup && <>
              <label htmlFor="admin-bootstrap-token">Admin bootstrap token <span>(administrator accounts only)</span></label>
              <input id="admin-bootstrap-token" type="password" autoComplete="off" maxLength={64} value={adminBootstrapToken} onChange={(event) => setAdminBootstrapToken(event.target.value)} />
              <small>Only enter this if an operator explicitly provisioned your email as an administrator.</small>
            </>}
            {isDemoSignup ? (
              <div className="demo-account-notice" role="note">
                <strong>Local demo only · never fund this wallet</strong>
                <small>This account has no funds, cannot place Mainnet swaps, and uses a weak test password. Do not reuse these credentials anywhere else.</small>
              </div>
            ) : <div className="wallet-backup-panel">
              <strong>Back up this wallet secret now</strong>
              <span>It is shown only on this screen. Anyone with this key can control the wallet. The server only stores its encrypted form.</span>
              <code>{JSON.stringify(Array.from(newKeypair.secretKey))}</code>
              <button className="button button-secondary" type="button" onClick={() => void copySecretKey()}>{copied ? "Copied — store it safely" : "Copy Solana CLI keypair JSON"}</button>
              <label className="account-checkbox"><input type="checkbox" checked={savedKey} onChange={(event) => setSavedKey(event.target.checked)} /><span>I saved this secret key securely. I understand that losing my password and key can mean permanent loss of access.</span></label>
            </div>}
            <button className="button button-live" type="submit" disabled={busy || (!isDemoSignup && !savedKey)}>{busy ? "Creating account…" : isDemoSignup ? "Create local demo admin" : "Create account & assign wallet"}</button>
          </form>
        ) : (
          <form className="account-form" onSubmit={(event) => void submitLogin(event)}>
            {!account && <>
              <label htmlFor="account-email">Email</label>
              <input id="account-email" type="email" autoComplete="email" maxLength={254} value={email} onChange={(event) => setEmail(event.target.value)} required />
            </>}
            <label htmlFor="account-password">Account password</label>
            <input id="account-password" type="password" autoComplete="current-password" maxLength={128} value={password} onChange={(event) => setPassword(event.target.value)} required />
            {account && <div className="account-address"><span>Assigned Solana address</span><code>{account.walletAddress}</code></div>}
            <button className="button button-live" type="submit" disabled={busy}>{busy ? "Unlocking…" : account ? "Unlock wallet" : "Sign in & unlock wallet"}</button>
          </form>
        )}

        <div className="account-safety">
          <strong>{isDemoSignup ? "Local demo account · no Mainnet swaps" : "Self-custody and real Mainnet funds"}</strong>
          <span>{isDemoSignup ? "This is a local-only account for exercising the admin interface. Never send funds to its generated address." : "The wallet is created on your device. Its key is encrypted with your account password before upload; the API/database cannot decrypt it. There is no password reset recovery for the wallet."}</span>
          <span>{isDemoSignup ? "Use only on localhost. The demo password is intentionally weak and must never be reused." : "Never share the displayed key. Verify every swap and mint before signing."}</span>
        </div>
        {!account && (
          <button className="text-button account-mode-switch" onClick={() => changeMode(mode === "register" ? "login" : "register")}>
            {mode === "register" ? "Already registered? Sign in" : "New here? Create an account"}
          </button>
        )}
      </section>
    </main>
  );
}
