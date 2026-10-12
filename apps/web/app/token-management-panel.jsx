"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AuthorityType,
  MINT_SIZE,
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountIdempotentInstruction,
  createBurnInstruction,
  createFreezeAccountInstruction,
  createInitializeMintInstruction,
  createMintToInstruction,
  createSetAuthorityInstruction,
  createThawAccountInstruction,
  getAccount,
  getAssociatedTokenAddress,
  getMint,
  getMinimumBalanceForRentExemptMint,
} from "@solana/spl-token";
import {
  createCreateMetadataAccountV3Instruction,
  createUpdateMetadataAccountV2Instruction,
} from "@metaplex-foundation/mpl-token-metadata";
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  clusterApiUrl,
} from "@solana/web3.js";

const TOKEN_METADATA_PROGRAM_ID = new PublicKey(
  "metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s"
);
const TOKEN_STORAGE_PREFIX = "solana-terminal-admin-tokens";
const TOKEN_ADDRESS_PATTERN = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const TOKEN_AMOUNT_PATTERN = /^(?:0|[1-9]\d*)(?:\.\d{1,9})?$/;
const U64_MAX = (1n << 64n) - 1n;

function phantomProvider() {
  if (typeof window === "undefined") return null;
  const provider = window.phantom?.solana ?? window.solana;
  return provider?.isPhantom ? provider : null;
}

function metadataAddress(mint) {
  return PublicKey.findProgramAddressSync(
    [
      Buffer.from("metadata"),
      TOKEN_METADATA_PROGRAM_ID.toBuffer(),
      mint.toBuffer(),
    ],
    TOKEN_METADATA_PROGRAM_ID
  )[0];
}

function toBaseUnits(amount, decimals) {
  if (typeof amount !== "string" || amount.length > 40 || !TOKEN_AMOUNT_PATTERN.test(amount)) {
    throw new Error("Enter a valid positive token amount.");
  }
  const [whole, fraction = ""] = amount.split(".");
  if (fraction.length > decimals) {
    throw new Error(`This token supports at most ${decimals} decimal places.`);
  }
  const result = BigInt(whole) * 10n ** BigInt(decimals) +
    BigInt((fraction + "0".repeat(decimals)).slice(0, decimals) || "0");
  if (result <= 0n || result > U64_MAX) {
    throw new Error("The token amount is outside the supported range.");
  }
  return result;
}

function readKnownTokens(walletAddress) {
  try {
    const raw = window.localStorage.getItem(`${TOKEN_STORAGE_PREFIX}:${walletAddress}`);
    const value = raw ? JSON.parse(raw) : [];
    return Array.isArray(value)
      ? value.filter((token) =>
          token &&
          typeof token.mintAddress === "string" &&
          TOKEN_ADDRESS_PATTERN.test(token.mintAddress)
        )
      : [];
  } catch (error) {
    console.error("Could not load this browser's token registry", error);
    return [];
  }
}

function saveKnownTokens(walletAddress, tokens) {
  try {
    window.localStorage.setItem(
      `${TOKEN_STORAGE_PREFIX}:${walletAddress}`,
      JSON.stringify(tokens)
    );
    return true;
  } catch (error) {
    console.error("Could not save this browser's token registry", error);
    return false;
  }
}

function validateMetadata(name, symbol, uri) {
  if (!name.trim() || new TextEncoder().encode(name.trim()).length > 32) {
    throw new Error("Token name must contain 1–32 characters.");
  }
  if (!symbol.trim() || new TextEncoder().encode(symbol.trim()).length > 10) {
    throw new Error("Token symbol must contain 1–10 characters.");
  }
  if (!uri.trim() || new TextEncoder().encode(uri.trim()).length > 200) {
    throw new Error("Metadata URI must contain 1–200 characters.");
  }
  let parsed;
  try {
    parsed = new URL(uri.trim());
  } catch {
    throw new Error("Enter a valid HTTPS or IPFS metadata JSON URI.");
  }
  if (!["https:", "ipfs:"].includes(parsed.protocol)) {
    throw new Error("Metadata URI must use HTTPS or IPFS.");
  }
}

function transactionMetadataPda(mintAddress) {
  if (!TOKEN_ADDRESS_PATTERN.test(mintAddress.trim())) {
    throw new Error("Enter a valid Solana token mint address.");
  }
  return new PublicKey(mintAddress.trim());
}

export default function TokenManagementPanel() {
  const connection = useMemo(
    () => new Connection(clusterApiUrl("mainnet-beta"), "confirmed"),
    []
  );
  const [provider, setProvider] = useState(null);
  const [walletAddress, setWalletAddress] = useState("");
  const [knownTokens, setKnownTokens] = useState([]);
  const [tokenName, setTokenName] = useState("");
  const [tokenSymbol, setTokenSymbol] = useState("");
  const [tokenDecimals, setTokenDecimals] = useState("9");
  const [initialSupply, setInitialSupply] = useState("1000000");
  const [metadataUri, setMetadataUri] = useState("");
  const [freezeAuthority, setFreezeAuthority] = useState(false);
  const [managementMint, setManagementMint] = useState("");
  const [managementName, setManagementName] = useState("");
  const [managementSymbol, setManagementSymbol] = useState("");
  const [managementUri, setManagementUri] = useState("");
  const [additionalSupply, setAdditionalSupply] = useState("");
  const [burnSupply, setBurnSupply] = useState("");
  const [tokenAccountAddress, setTokenAccountAddress] = useState("");
  const [newAuthorityAddress, setNewAuthorityAddress] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [message, setMessage] = useState(null);
  const [lastSignature, setLastSignature] = useState(null);

  useEffect(() => {
    const savedAddress = window.localStorage.getItem(`${TOKEN_STORAGE_PREFIX}:wallet`);
    if (savedAddress && TOKEN_ADDRESS_PATTERN.test(savedAddress)) {
      const existingProvider = phantomProvider();
      if (existingProvider?.publicKey?.toBase58?.() === savedAddress) {
        setProvider(existingProvider);
        setWalletAddress(savedAddress);
        setKnownTokens(readKnownTokens(savedAddress));
      }
    }
  }, []);

  useEffect(() => {
    if (!provider?.on) return undefined;
    const onAccountChanged = (publicKey) => {
      const address = publicKey?.toBase58?.();
      if (!address || !TOKEN_ADDRESS_PATTERN.test(address)) {
        setProvider(null);
        setWalletAddress("");
        setKnownTokens([]);
        window.localStorage.removeItem(`${TOKEN_STORAGE_PREFIX}:wallet`);
        return;
      }
      setWalletAddress(address);
      setKnownTokens(readKnownTokens(address));
      window.localStorage.setItem(`${TOKEN_STORAGE_PREFIX}:wallet`, address);
    };
    const onDisconnect = () => {
      setProvider(null);
      setWalletAddress("");
      setKnownTokens([]);
      window.localStorage.removeItem(`${TOKEN_STORAGE_PREFIX}:wallet`);
    };
    provider.on("accountChanged", onAccountChanged);
    provider.on("disconnect", onDisconnect);
    return () => {
      provider.removeListener?.("accountChanged", onAccountChanged);
      provider.removeListener?.("disconnect", onDisconnect);
    };
  }, [provider]);

  const connectWallet = async () => {
    setError(null);
    setMessage(null);
    try {
      const candidate = phantomProvider();
      if (!candidate || typeof candidate.connect !== "function") {
        throw new Error("Install or unlock the Phantom wallet extension to continue.");
      }
      const response = await candidate.connect();
      const address = response.publicKey?.toBase58?.() ?? candidate.publicKey?.toBase58?.();
      if (!address || !TOKEN_ADDRESS_PATTERN.test(address)) {
        throw new Error("The wallet did not return a valid Solana address.");
      }
      setProvider(candidate);
      setWalletAddress(address);
      setKnownTokens(readKnownTokens(address));
      window.localStorage.setItem(`${TOKEN_STORAGE_PREFIX}:wallet`, address);
      setMessage("Wallet connected. Check the network and every transaction in Phantom before approving.");
    } catch (connectError) {
      setError(connectError instanceof Error ? connectError.message : "Could not connect the administrator wallet.");
    }
  };

  const submitTransaction = useCallback(async (transaction, additionalSigner) => {
    if (!provider || !walletAddress) {
      throw new Error("Connect the administrator's Phantom wallet first.");
    }
    const publicKey = new PublicKey(walletAddress);
    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");
    transaction.feePayer = publicKey;
    transaction.recentBlockhash = blockhash;
    if (additionalSigner) transaction.partialSign(additionalSigner);
    const signedTransaction = await provider.signTransaction(transaction);
    const signature = await connection.sendRawTransaction(signedTransaction.serialize(), {
      preflightCommitment: "confirmed",
    });
    setLastSignature(signature);
    await connection.confirmTransaction(
      { signature, blockhash, lastValidBlockHeight },
      "confirmed"
    );
    return signature;
  }, [connection, provider, walletAddress]);

  const submitTokenCreation = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setMessage(null);
    setLastSignature(null);
    let mint;
    try {
      if (!provider || !walletAddress) throw new Error("Connect the administrator's Phantom wallet first.");
      validateMetadata(tokenName, tokenSymbol, metadataUri);
      const decimals = Number(tokenDecimals);
      if (!Number.isInteger(decimals) || decimals < 0 || decimals > 9) {
        throw new Error("Token decimals must be an integer from 0 to 9.");
      }
      const supply = toBaseUnits(initialSupply, decimals);
      mint = Keypair.generate();
      const authority = new PublicKey(walletAddress);
      const mintAta = await getAssociatedTokenAddress(mint.publicKey, authority);
      const metadataPda = metadataAddress(mint.publicKey);
      const rentLamports = await getMinimumBalanceForRentExemptMint(connection);
      const transaction = new Transaction().add(
        SystemProgram.createAccount({
          fromPubkey: authority,
          newAccountPubkey: mint.publicKey,
          lamports: rentLamports,
          space: MINT_SIZE,
          programId: TOKEN_PROGRAM_ID,
        }),
        createInitializeMintInstruction(
          mint.publicKey,
          decimals,
          authority,
          freezeAuthority ? authority : null,
          TOKEN_PROGRAM_ID
        ),
        createAssociatedTokenAccountIdempotentInstruction(
          authority,
          mintAta,
          authority,
          mint.publicKey,
          TOKEN_PROGRAM_ID
        ),
        createCreateMetadataAccountV3Instruction(
          {
            metadata: metadataPda,
            mint: mint.publicKey,
            mintAuthority: authority,
            payer: authority,
            updateAuthority: authority,
          },
          {
            createMetadataAccountArgsV3: {
              data: {
                name: tokenName.trim(),
                symbol: tokenSymbol.trim().toUpperCase(),
                uri: metadataUri.trim(),
                sellerFeeBasisPoints: 0,
                creators: null,
                collection: null,
                uses: null,
              },
              isMutable: true,
              collectionDetails: null,
            },
          }
        ),
        createMintToInstruction(
          mint.publicKey,
          mintAta,
          authority,
          supply,
          [],
          TOKEN_PROGRAM_ID
        )
      );
      const confirmed = window.confirm(
        `Create ${tokenName.trim()} (${tokenSymbol.trim().toUpperCase()}) on Solana Mainnet with initial supply ${initialSupply} and ${decimals} decimals? This permanently creates a mint and Metaplex metadata; network fees are real and non-refundable.`
      );
      if (!confirmed) return;
      const signature = await submitTransaction(transaction, mint);
      const record = {
        mintAddress: mint.publicKey.toBase58(),
        name: tokenName.trim(),
        symbol: tokenSymbol.trim().toUpperCase(),
        decimals,
        metadataUri: metadataUri.trim(),
        createdAt: new Date().toISOString(),
      };
      const updatedTokens = [
        record,
        ...readKnownTokens(walletAddress).filter(
          (token) => token.mintAddress !== record.mintAddress
        ),
      ].slice(0, 50);
      const registrySaved = saveKnownTokens(walletAddress, updatedTokens);
      setKnownTokens(updatedTokens);
      setManagementMint(record.mintAddress);
      setManagementName(record.name);
      setManagementSymbol(record.symbol);
      setManagementUri(record.metadataUri);
      setTokenName("");
      setTokenSymbol("");
      setMetadataUri("");
      setMessage(`Token created and initial supply minted to ${walletAddress}. Mint: ${record.mintAddress}. ${registrySaved ? "Token registry saved in this browser." : "Browser registry could not be saved; copy the mint address to manage it later."} Signature: ${signature}`);
    } catch (transactionError) {
      setError(transactionError instanceof Error ? transactionError.message : "Token creation failed.");
    } finally {
      mint?.secretKey.fill(0);
      setBusy(false);
    }
  };

  const submitMetadataUpdate = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setMessage(null);
    setLastSignature(null);
    try {
      validateMetadata(managementName, managementSymbol, managementUri);
      const mint = transactionMetadataPda(managementMint);
      const metadataPda = metadataAddress(mint);
      const transaction = new Transaction().add(
        createUpdateMetadataAccountV2Instruction(
          { metadata: metadataPda, updateAuthority: new PublicKey(walletAddress) },
          {
            updateMetadataAccountArgsV2: {
              data: {
                name: managementName.trim(),
                symbol: managementSymbol.trim().toUpperCase(),
                uri: managementUri.trim(),
                sellerFeeBasisPoints: 0,
                creators: null,
                collection: null,
                uses: null,
              },
              updateAuthority: null,
              primarySaleHappened: null,
              isMutable: null,
            },
          }
        )
      );
      if (!window.confirm("Update Metaplex token metadata? The metadata update authority must sign this Mainnet transaction.")) return;
      const signature = await submitTransaction(transaction);
      setMessage(`Metadata updated. Signature: ${signature}`);
      const updated = knownTokens.map((token) =>
        token.mintAddress === mint.toBase58()
          ? { ...token, name: managementName.trim(), symbol: managementSymbol.trim().toUpperCase(), metadataUri: managementUri.trim() }
          : token
      );
      setKnownTokens(updated);
      if (!saveKnownTokens(walletAddress, updated)) {
        setMessage(`Metadata updated on-chain. The local browser registry could not be updated. Signature: ${signature}`);
      }
    } catch (transactionError) {
      setError(transactionError instanceof Error ? transactionError.message : "Metadata update failed.");
    } finally {
      setBusy(false);
    }
  };

  const submitAdditionalMint = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setMessage(null);
    setLastSignature(null);
    try {
      const mint = transactionMetadataPda(managementMint);
      const mintInfo = await getMint(connection, mint, "confirmed", TOKEN_PROGRAM_ID);
      if (!Number.isInteger(mintInfo.decimals) || mintInfo.decimals < 0 || mintInfo.decimals > 9) {
        throw new Error("Could not read a supported SPL Token mint account.");
      }
      const supply = toBaseUnits(additionalSupply, mintInfo.decimals);
      const authority = new PublicKey(walletAddress);
      const destination = await getAssociatedTokenAddress(mint, authority);
      const transaction = new Transaction().add(
        createAssociatedTokenAccountIdempotentInstruction(
          authority,
          destination,
          authority,
          mint,
          TOKEN_PROGRAM_ID
        ),
        createMintToInstruction(mint, destination, authority, supply, [], TOKEN_PROGRAM_ID)
      );
      if (!window.confirm(`Mint ${additionalSupply} additional tokens to the connected wallet? This increases the public supply on Mainnet.`)) return;
      const signature = await submitTransaction(transaction);
      setMessage(`Additional supply minted to the connected wallet. Signature: ${signature}`);
      setAdditionalSupply("");
    } catch (transactionError) {
      setError(transactionError instanceof Error ? transactionError.message : "Additional mint failed.");
    } finally {
      setBusy(false);
    }
  };

  const revokeAuthority = async (authorityType, label) => {
    setBusy(true);
    setError(null);
    setMessage(null);
    setLastSignature(null);
    try {
      const mint = transactionMetadataPda(managementMint);
      if (!window.confirm(`Permanently revoke ${label} authority for ${mint.toBase58()}? This cannot be undone and may disable future token operations.`)) return;
      const transaction = new Transaction().add(
        createSetAuthorityInstruction(
          mint,
          new PublicKey(walletAddress),
          authorityType,
          null,
          [],
          TOKEN_PROGRAM_ID
        )
      );
      const signature = await submitTransaction(transaction);
      setMessage(`${label} authority permanently revoked. Signature: ${signature}`);
    } catch (transactionError) {
      setError(transactionError instanceof Error ? transactionError.message : "Authority update failed.");
    } finally {
      setBusy(false);
    }
  };

  const transferAuthority = async (authorityType, label) => {
    setBusy(true);
    setError(null);
    setMessage(null);
    setLastSignature(null);
    try {
      const mint = transactionMetadataPda(managementMint);
      if (!TOKEN_ADDRESS_PATTERN.test(newAuthorityAddress.trim())) {
        throw new Error("Enter a valid Solana address to receive this authority.");
      }
      const newAuthority = new PublicKey(newAuthorityAddress.trim());
      if (!window.confirm(`Transfer ${label} authority for ${mint.toBase58()} to ${newAuthority.toBase58()}? Only the new authority can use it after confirmation.`)) return;
      const transaction = new Transaction().add(
        createSetAuthorityInstruction(
          mint,
          new PublicKey(walletAddress),
          authorityType,
          newAuthority,
          [],
          TOKEN_PROGRAM_ID
        )
      );
      const signature = await submitTransaction(transaction);
      setMessage(`${label} authority transferred. Signature: ${signature}`);
    } catch (transactionError) {
      setError(transactionError instanceof Error ? transactionError.message : "Authority transfer failed.");
    } finally {
      setBusy(false);
    }
  };

  const updateMetadataAuthority = async () => {
    setBusy(true);
    setError(null);
    setMessage(null);
    setLastSignature(null);
    try {
      const mint = transactionMetadataPda(managementMint);
      if (!TOKEN_ADDRESS_PATTERN.test(newAuthorityAddress.trim())) {
        throw new Error("Enter a valid Solana address to receive metadata authority.");
      }
      const newAuthority = new PublicKey(newAuthorityAddress.trim());
      if (!window.confirm(`Transfer Metaplex metadata update authority for ${mint.toBase58()} to ${newAuthority.toBase58()}?`)) return;
      const transaction = new Transaction().add(
        createUpdateMetadataAccountV2Instruction(
          { metadata: metadataAddress(mint), updateAuthority: new PublicKey(walletAddress) },
          {
            updateMetadataAccountArgsV2: {
              data: null,
              updateAuthority: newAuthority,
              primarySaleHappened: null,
              isMutable: null,
            },
          }
        )
      );
      const signature = await submitTransaction(transaction);
      setMessage(`Metaplex metadata update authority transferred. Signature: ${signature}`);
    } catch (transactionError) {
      setError(transactionError instanceof Error ? transactionError.message : "Metadata authority transfer failed.");
    } finally {
      setBusy(false);
    }
  };

  const burnHeldTokens = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setMessage(null);
    setLastSignature(null);
    try {
      const mint = transactionMetadataPda(managementMint);
      const mintInfo = await getMint(connection, mint, "confirmed", TOKEN_PROGRAM_ID);
      const amount = toBaseUnits(burnSupply, mintInfo.decimals);
      const owner = new PublicKey(walletAddress);
      const ownerAta = await getAssociatedTokenAddress(mint, owner);
      const transaction = new Transaction().add(
        createBurnInstruction(ownerAta, mint, owner, amount, [], TOKEN_PROGRAM_ID)
      );
      if (!window.confirm(`Permanently burn ${burnSupply} tokens from this wallet? The supply reduction cannot be reversed.`)) return;
      const signature = await submitTransaction(transaction);
      setMessage(`Tokens burned from the connected wallet. Signature: ${signature}`);
      setBurnSupply("");
    } catch (transactionError) {
      setError(transactionError instanceof Error ? transactionError.message : "Token burn failed.");
    } finally {
      setBusy(false);
    }
  };

  const setAccountFrozen = async (freeze) => {
    setBusy(true);
    setError(null);
    setMessage(null);
    setLastSignature(null);
    try {
      const mint = transactionMetadataPda(managementMint);
      if (!TOKEN_ADDRESS_PATTERN.test(tokenAccountAddress.trim())) {
        throw new Error("Enter a valid token account address.");
      }
      const tokenAccount = new PublicKey(tokenAccountAddress.trim());
      const account = await getAccount(connection, tokenAccount, "confirmed", TOKEN_PROGRAM_ID);
      if (!account.mint.equals(mint)) {
        throw new Error("The token account does not belong to the selected mint.");
      }
      const transaction = new Transaction().add(
        freeze
          ? createFreezeAccountInstruction(tokenAccount, mint, new PublicKey(walletAddress), [], TOKEN_PROGRAM_ID)
          : createThawAccountInstruction(tokenAccount, mint, new PublicKey(walletAddress), [], TOKEN_PROGRAM_ID)
      );
      if (!window.confirm(`${freeze ? "Freeze" : "Thaw"} token account ${tokenAccount.toBase58()}? ${freeze ? "Its owner will be unable to transfer or burn tokens until it is thawed." : "The account will be able to transfer tokens again."}`)) return;
      const signature = await submitTransaction(transaction);
      setMessage(`Token account ${freeze ? "frozen" : "thawed"}. Signature: ${signature}`);
    } catch (transactionError) {
      setError(transactionError instanceof Error ? transactionError.message : "Token account update failed.");
    } finally {
      setBusy(false);
    }
  };

  const makeMetadataImmutable = async () => {
    setBusy(true);
    setError(null);
    setMessage(null);
    setLastSignature(null);
    try {
      const mint = transactionMetadataPda(managementMint);
      if (!window.confirm(`Make Metaplex metadata for ${mint.toBase58()} permanently immutable? No administrator will be able to change its name, symbol, or URI again.`)) return;
      const transaction = new Transaction().add(
        createUpdateMetadataAccountV2Instruction(
          { metadata: metadataAddress(mint), updateAuthority: new PublicKey(walletAddress) },
          {
            updateMetadataAccountArgsV2: {
              data: null,
              updateAuthority: null,
              primarySaleHappened: null,
              isMutable: false,
            },
          }
        )
      );
      const signature = await submitTransaction(transaction);
      setMessage(`Metadata is now permanently immutable. Signature: ${signature}`);
    } catch (transactionError) {
      setError(transactionError instanceof Error ? transactionError.message : "Could not make metadata immutable.");
    } finally {
      setBusy(false);
    }
  };

  const selectKnownToken = (token) => {
    setManagementMint(token.mintAddress);
    setManagementName(token.name);
    setManagementSymbol(token.symbol);
    setManagementUri(token.metadataUri);
  };

  const unlinkWallet = async () => {
    try {
      await provider?.disconnect?.();
    } catch (disconnectError) {
      console.error("Could not disconnect Phantom wallet", disconnectError);
    }
    window.localStorage.removeItem(`${TOKEN_STORAGE_PREFIX}:wallet`);
    setProvider(null);
    setWalletAddress("");
    setKnownTokens([]);
  };

  return (
    <article className="panel admin-chain-panel">
      <div className="panel-heading">
        <div>
          <span className="eyebrow">SOLANA MAINNET · METAPLEX TOKEN STUDIO</span>
          <h2>Create and manage SPL tokens</h2>
          <p>Create classic SPL fungible mints and Metaplex Token Metadata; manage the authorities held by the connected wallet.</p>
        </div>
        {walletAddress ? (
          <button className="button button-secondary chain-wallet-button" type="button" onClick={() => void unlinkWallet()} disabled={busy}>
            {walletAddress.slice(0, 5)}…{walletAddress.slice(-5)} · Disconnect
          </button>
        ) : (
          <button className="button button-live" type="button" onClick={() => void connectWallet()} disabled={busy}>
            Connect Phantom
          </button>
        )}
      </div>

      <div className="admin-chain-warning" role="alert">
        <strong>Real Mainnet operations. No simulation.</strong>
        <span>Phantom reviews and signs every transaction; this app never sends private keys to the API. Network fees are real. Creating a token does not upload its JSON/image, add liquidity, distribute tokens to users, or guarantee market listing. Use a funded, dedicated administrator wallet—not the local demo key.</span>
      </div>
      {error && <div className="trade-feedback is-error" role="alert">{error}</div>}
      {message && <div className="trade-feedback is-success" role="status">{message}</div>}
      {lastSignature && <p className="chain-signature"><a href={`https://solscan.io/tx/${lastSignature}`} target="_blank" rel="noreferrer">View confirmed transaction on Solscan ↗</a></p>}

      {walletAddress ? (
        <>
          <p className="chain-connected-wallet">Connected signing wallet: <code>{walletAddress}</code> · Mainnet-beta</p>
          <div className="chain-workspace">
            <section className="chain-operation-card">
              <h3>Issue a fungible token</h3>
              <p>Creates a new SPL mint, recipient ATA and mutable Metaplex metadata; initial supply goes to this wallet.</p>
              <form className="chain-form" onSubmit={(event) => void submitTokenCreation(event)}>
                <label htmlFor="chain-token-name">Token name</label>
                <input id="chain-token-name" value={tokenName} onChange={(event) => setTokenName(event.target.value)} maxLength={32} required />
                <label htmlFor="chain-token-symbol">Ticker · max 10 characters</label>
                <input id="chain-token-symbol" value={tokenSymbol} onChange={(event) => setTokenSymbol(event.target.value)} maxLength={10} required />
                <label htmlFor="chain-token-uri">Metaplex JSON metadata URI · upload JSON/image separately</label>
                <input id="chain-token-uri" type="url" value={metadataUri} onChange={(event) => setMetadataUri(event.target.value)} maxLength={200} placeholder="https://… or https://…/metadata.json" required />
                <label htmlFor="chain-token-decimals">Decimals · 0–9</label>
                <input id="chain-token-decimals" type="number" value={tokenDecimals} onChange={(event) => setTokenDecimals(event.target.value)} min="0" max="9" step="1" required />
                <label htmlFor="chain-initial-supply">Initial whole-token supply</label>
                <input id="chain-initial-supply" type="number" inputMode="decimal" value={initialSupply} onChange={(event) => setInitialSupply(event.target.value)} min="0.000000001" step="any" required />
                <label className="chain-checkbox" htmlFor="chain-freeze-authority">
                  <input id="chain-freeze-authority" type="checkbox" checked={freezeAuthority} onChange={(event) => setFreezeAuthority(event.target.checked)} />
                  Assign freeze authority to connected wallet
                </label>
                <button className="button button-live" type="submit" disabled={busy}>{busy ? "Awaiting wallet…" : "Create token on Mainnet"}</button>
              </form>
            </section>

            <section className="chain-operation-card">
              <h3>Manage an existing mint</h3>
              <p>On-chain authorities determine which actions succeed. Select a token created here or paste a mint you control.</p>
              {knownTokens.length > 0 && (
                <div className="chain-known-tokens">
                  <label htmlFor="chain-known-token">Created in this browser</label>
                  <select id="chain-known-token" defaultValue="" onChange={(event) => {
                    const token = knownTokens.find((item) => item.mintAddress === event.target.value);
                    if (token) selectKnownToken(token);
                  }}>
                    <option value="">Select a token…</option>
                    {knownTokens.map((token) => <option key={token.mintAddress} value={token.mintAddress}>{token.symbol} · {token.mintAddress.slice(0, 8)}…</option>)}
                  </select>
                </div>
              )}
              <div className="chain-form">
                <label htmlFor="chain-manage-mint">Token mint address</label>
                <input id="chain-manage-mint" value={managementMint} onChange={(event) => setManagementMint(event.target.value.trim())} minLength={32} maxLength={44} spellCheck="false" autoComplete="off" />
                <form className="chain-inline-form" onSubmit={(event) => void submitAdditionalMint(event)}>
                  <label htmlFor="chain-add-supply">Mint additional supply to connected wallet</label>
                  <input id="chain-add-supply" type="number" inputMode="decimal" value={additionalSupply} onChange={(event) => setAdditionalSupply(event.target.value)} min="0.000000001" step="any" required />
                  <button className="button button-secondary" type="submit" disabled={busy || !walletAddress}>Mint tokens</button>
                </form>
                <form className="chain-inline-form" onSubmit={(event) => void submitMetadataUpdate(event)}>
                  <label htmlFor="chain-metadata-name">Update Metaplex metadata · name</label>
                  <input id="chain-metadata-name" value={managementName} onChange={(event) => setManagementName(event.target.value)} maxLength={32} required />
                  <label htmlFor="chain-metadata-symbol">Ticker</label>
                  <input id="chain-metadata-symbol" value={managementSymbol} onChange={(event) => setManagementSymbol(event.target.value)} maxLength={10} required />
                  <label htmlFor="chain-metadata-uri">Metadata JSON URI</label>
                  <input id="chain-metadata-uri" type="url" value={managementUri} onChange={(event) => setManagementUri(event.target.value)} maxLength={200} required />
                  <button className="button button-secondary" type="submit" disabled={busy || !walletAddress}>Update metadata</button>
                </form>
                <div className="chain-authority-actions">
                  <button className="button button-danger" type="button" onClick={() => void revokeAuthority(AuthorityType.MintTokens, "mint")} disabled={busy || !walletAddress || !managementMint}>Revoke mint authority</button>
                  <button className="button button-danger" type="button" onClick={() => void revokeAuthority(AuthorityType.FreezeAccount, "freeze")} disabled={busy || !walletAddress || !managementMint}>Revoke freeze authority</button>
                  <button className="button button-danger" type="button" onClick={() => void makeMetadataImmutable()} disabled={busy || !walletAddress || !managementMint}>Make metadata immutable</button>
                </div>
              </div>
            </section>
          </div>

          {knownTokens.length > 0 && (
            <section className="chain-created-list">
              <h3>Tokens created in this browser</h3>
              <div className="history-table-wrap">
                <table className="history-table">
                  <thead><tr><th>Token</th><th>Mint address</th><th>Decimals</th><th>Metadata</th></tr></thead>
                  <tbody>{knownTokens.map((token) => (
                    <tr key={token.mintAddress}>
                      <td><strong>{token.symbol}</strong><br />{token.name}</td>
                      <td><code>{token.mintAddress}</code></td>
                      <td>{token.decimals}</td>
                      <td><button className="button button-secondary" type="button" onClick={() => selectKnownToken(token)}>Manage</button></td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
            </section>
          )}
        </>
      ) : (
        <div className="history-empty chain-wallet-empty">
          <h3>Connect a dedicated administrator wallet</h3>
          <p>Use Phantom on Solana Mainnet. Do not fund or use the demo admin wallet for token issuance.</p>
        </div>
      )}
    </article>
  );
}
