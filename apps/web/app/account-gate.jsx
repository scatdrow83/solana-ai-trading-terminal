"use client";

import { useEffect, useState } from "react";
import { Keypair } from "@solana/web3.js";
import LanguageSelector from "./language-selector";
import { useLocale } from "./locale-provider";

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
  const { t } = useLocale();
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
    return <main className="account-shell"><div className="account-card"><LanguageSelector /><span className="eyebrow">{t("account.solanaMainnet")}</span><h1>{t("account.loading")}</h1></div></main>;
  }

  return (
    <main className="account-shell">
      <section className="account-card">
        <LanguageSelector />
        <a className="brand account-brand" href="/" aria-label="Solana Terminal home">
          <span className="brand-mark"><span /><span /><span /></span>
          <span className="brand-name">solana<span>terminal</span></span>
        </a>
        <p className="eyebrow account-eyebrow">{t("account.personalAccount")}</p>
        <h1>{mode === "register" ? t("account.createTitle") : t("account.welcomeTitle")}</h1>
        <p className="account-subtitle">
          {mode === "register"
            ? t("account.createPublicWallet")
            : account
              ? `${t("account.unlockDescription")} (${account.email})`
              : t("account.unlockDescription")}
        </p>

        {error && <div className="trade-feedback is-error" role="alert">{error}</div>}

        {mode === "register" && !newKeypair ? (
          <form className="account-form" onSubmit={(event) => { event.preventDefault(); generateWallet(); }}>
            <label htmlFor="account-email">{t("account.email")}</label>
            <input id="account-email" type="email" autoComplete="email" maxLength={254} value={email} onChange={(event) => setEmail(event.target.value)} required />
            <label htmlFor="account-password">{t("account.password")}</label>
            <input id="account-password" type="password" autoComplete="new-password" minLength={demoAvailable && email.trim().toLowerCase() === "admin@local.test" ? 5 : 12} maxLength={128} value={password} onChange={(event) => setPassword(event.target.value)} required />
            <small>{demoAvailable && email.trim().toLowerCase() === "admin@local.test" ? t("account.demoPasswordHint") : t("account.passwordEncryptionHint")}</small>
            <button className="button button-primary" type="submit">{demoAvailable && email.trim().toLowerCase() === "admin@local.test" ? t("account.generateDemoWallet") : t("account.generateWallet")}</button>
          </form>
        ) : mode === "register" ? (
          <form className="account-form" onSubmit={(event) => void submitRegister(event)}>
            <label htmlFor="account-email">{t("account.email")}</label>
            <input id="account-email" type="email" autoComplete="email" maxLength={254} value={email} onChange={(event) => setEmail(event.target.value)} required />
            <label htmlFor="account-password">{t("account.password")}</label>
            <input id="account-password" type="password" autoComplete="new-password" minLength={demoAvailable && email.trim().toLowerCase() === "admin@local.test" ? 5 : 12} maxLength={128} value={password} onChange={(event) => setPassword(event.target.value)} required />
            {!isDemoSignup && <>
              <label htmlFor="admin-bootstrap-token">{t("account.adminBootstrap")} <span>{t("account.adminOnly")}</span></label>
              <input id="admin-bootstrap-token" type="password" autoComplete="off" maxLength={64} value={adminBootstrapToken} onChange={(event) => setAdminBootstrapToken(event.target.value)} />
              <small>{t("account.adminBootstrapHint")}</small>
            </>}
            {isDemoSignup ? (
              <div className="demo-account-notice" role="note">
                <strong>{t("account.localDemo")}</strong>
                <small>{t("account.localDemoWarning")} {t("account.demoPasswordWarning")}</small>
              </div>
            ) : <div className="wallet-backup-panel">
              <strong>{t("account.walletBackup")}</strong>
              <span>{t("account.walletBackupWarning")}</span>
              <code>{JSON.stringify(Array.from(newKeypair.secretKey))}</code>
              <button className="button button-secondary" type="button" onClick={() => void copySecretKey()}>{copied ? t("account.copiedKey") : t("account.copyKey")}</button>
              <label className="account-checkbox"><input type="checkbox" checked={savedKey} onChange={(event) => setSavedKey(event.target.checked)} /><span>{t("account.savedKeyConfirmation")}</span></label>
            </div>}
            <button className="button button-live" type="submit" disabled={busy || (!isDemoSignup && !savedKey)}>{busy ? t("account.creating") : isDemoSignup ? t("account.registerButton") : t("account.createAndAssign")}</button>
          </form>
        ) : (
          <form className="account-form" onSubmit={(event) => void submitLogin(event)}>
            {!account && <>
              <label htmlFor="account-email">{t("account.email")}</label>
              <input id="account-email" type="email" autoComplete="email" maxLength={254} value={email} onChange={(event) => setEmail(event.target.value)} required />
            </>}
            <label htmlFor="account-password">{t("account.password")}</label>
            <input id="account-password" type="password" autoComplete="current-password" maxLength={128} value={password} onChange={(event) => setPassword(event.target.value)} required />
            {account && <div className="account-address"><span>{t("account.publicAddress")}</span><code>{account.walletAddress}</code></div>}
            <button className="button button-live" type="submit" disabled={busy}>{busy ? t("account.unlocking") : account ? t("account.unlock") : t("account.enter")}</button>
          </form>
        )}

        <div className="account-safety">
          <strong>{isDemoSignup ? t("account.demoAccount") : t("account.selfCustody")}</strong>
          <span>{isDemoSignup ? t("account.demoDetail") : t("account.selfCustodyDetail")}</span>
          <span>{isDemoSignup ? t("account.demoPasswordWarning") : t("account.keySafety")}</span>
        </div>
        {!account && (
          <button className="text-button account-mode-switch" onClick={() => changeMode(mode === "register" ? "login" : "register")}>
            {mode === "register" ? t("account.alreadyRegistered") : t("account.newHere")}
          </button>
        )}
      </section>
    </main>
  );
}
