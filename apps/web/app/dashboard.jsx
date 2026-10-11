"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Keypair } from "@solana/web3.js";
import AdminWalletPanel from "./admin-wallet-panel";
import AccountGate from "./account-gate";
import TradeTicket from "./trade-ticket";

const SOL_MINT = "So11111111111111111111111111111111111111112";
const DEFAULT_WATCHLIST = [SOL_MINT];
const REFRESH_OPTIONS = [15_000, 30_000, 60_000];

const NAV_ITEMS = [
  { id: "overview", label: "Overview", icon: "grid", group: "Workspace" },
  { id: "markets", label: "Markets", icon: "chart", group: "Workspace" },
  { id: "watchlist", label: "Watchlist", icon: "bookmark", group: "Workspace" },
  { id: "portfolio", label: "Portfolio", icon: "wallet", group: "Trading" },
  { id: "activity", label: "Activity", icon: "activity", group: "Trading" },
  { id: "settings", label: "Settings", icon: "settings", group: "System" },
  { id: "admin", label: "Admin simulator", icon: "shield", group: "System" }
];

const VIEW_TITLES = {
  overview: {
    eyebrow: "MARKET OVERVIEW",
    title: "Your market, at a glance.",
    subtitle: "Live Solana prices and non-custodial Mainnet swaps."
  },
  markets: {
    eyebrow: "MARKET EXPLORER",
    title: "Find your next signal.",
    subtitle: "Explore tokens and liquidity across Solana DEXs."
  },
  watchlist: {
    eyebrow: "YOUR WATCHLIST",
    title: "Keep the good ones close.",
    subtitle: "Your saved tokens stay in this browser."
  },
  portfolio: {
    eyebrow: "PORTFOLIO",
    title: "Your positions, clearly.",
    subtitle: "Live wallet balances and transaction history."
  },
  activity: {
    eyebrow: "ACTIVITY",
    title: "Every move, accounted for.",
    subtitle: "Your recent actions will appear here."
  },
  settings: {
    eyebrow: "PREFERENCES",
    title: "Make it yours.",
    subtitle: "Market refresh and staging environment settings."
  },
  admin: {
    eyebrow: "LOCAL SECURITY TEST",
    title: "Admin access simulator.",
    subtitle: "Inspect public wallet metadata and exercise a non-broadcast withdrawal scenario."
  }
};

function isRecord(value) {
  return typeof value === "object" && value !== null;
}

function parseMarket(value) {
  if (
    !isRecord(value) ||
    typeof value.mintAddress !== "string" ||
    typeof value.symbol !== "string" ||
    typeof value.name !== "string" ||
    typeof value.priceUsd !== "number" ||
    !Number.isFinite(value.priceUsd) ||
    typeof value.liquidityUsd !== "number" ||
    !Number.isFinite(value.liquidityUsd) ||
    typeof value.source !== "string" ||
    typeof value.observedAt !== "string"
  ) {
    return null;
  }

  return {
    mintAddress: value.mintAddress,
    symbol: value.symbol,
    name: value.name,
    priceUsd: value.priceUsd,
    liquidityUsd: value.liquidityUsd,
    volume24hUsd:
      typeof value.volume24hUsd === "number" ? value.volume24hUsd : null,
    priceChange24h:
      typeof value.priceChange24h === "number" ? value.priceChange24h : null,
    marketCapUsd: typeof value.marketCapUsd === "number" ? value.marketCapUsd : null,
    fdvUsd: typeof value.fdvUsd === "number" ? value.fdvUsd : null,
    pairAddress: typeof value.pairAddress === "string" ? value.pairAddress : "",
    dexId: typeof value.dexId === "string" ? value.dexId : "unknown",
    url: typeof value.url === "string" ? value.url : null,
    source: value.source,
    observedAt: value.observedAt
  };
}

function parseMarkets(value) {
  if (!isRecord(value) || !Array.isArray(value.markets)) {
    throw new Error("The market service returned an unexpected response.");
  }
  return value.markets.flatMap((entry) => {
    const market = parseMarket(entry);
    return market ? [market] : [];
  });
}

async function requestJson(url) {
  const response = await fetch(url, {
    cache: "no-store",
    signal: AbortSignal.timeout(10_000)
  });
  const body = await response.json();
  if (!response.ok) {
    const code =
      isRecord(body) && typeof body.error === "string"
        ? body.error.replaceAll("_", " ")
        : "market data is unavailable";
    throw new Error(code);
  }
  return body;
}

function formatPrice(value) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumSignificantDigits: 8
  }).format(value);
}

function formatCurrency(value) {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    notation: value >= 1_000_000 ? "compact" : "standard",
    maximumFractionDigits: value >= 1 ? 2 : 6
  }).format(value);
}

function formatPercent(value) {
  if (value === null || !Number.isFinite(value)) return "—";
  return `${value > 0 ? "+" : ""}${value.toFixed(2)}%`;
}

function formatTime(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "—"
    : new Intl.DateTimeFormat("en-US", {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit"
      }).format(date);
}

function shortMint(mint) {
  return `${mint.slice(0, 5)}…${mint.slice(-5)}`;
}

function Icon({ name, size = 18 }) {
  const common = {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.7,
    strokeLinecap: "round",
    strokeLinejoin: "round",
    "aria-hidden": true
  };
  switch (name) {
    case "grid":
      return <svg {...common}><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/></svg>;
    case "chart":
      return <svg {...common}><path d="M3 3v18h18"/><path d="m7 14 4-4 4 3 6-7"/></svg>;
    case "bookmark":
      return <svg {...common}><path d="M6 4.75A1.75 1.75 0 0 1 7.75 3h8.5A1.75 1.75 0 0 1 18 4.75V21l-6-4-6 4z"/></svg>;
    case "wallet":
      return <svg {...common}><rect x="3" y="5" width="18" height="15" rx="2"/><path d="M3 9h18M16 14h.01M7 5V3h12"/></svg>;
    case "activity":
      return <svg {...common}><path d="M3 12h4l3-8 4 16 3-8h4"/></svg>;
    case "settings":
      return <svg {...common}><circle cx="12" cy="12" r="3"/><path d="m19.4 15 .1.1 1.4 1.1-1.4 2.4-1.7-.6a8 8 0 0 1-1.8 1l-.3 1.8h-2.8l-.3-1.8a8 8 0 0 1-1.8-1l-1.7.6-1.4-2.4L7 15a8 8 0 0 1 0-2l-1.4-1.1L7 9.5l1.7.6a8 8 0 0 1 1.8-1l.3-1.8h2.8l.3 1.8a8 8 0 0 1 1.8 1l1.7-.6 1.4 2.4L19.4 13a8 8 0 0 1 0 2z"/></svg>;
    case "search":
      return <svg {...common}><circle cx="10.8" cy="10.8" r="6.8"/><path d="m16 16 4.5 4.5"/></svg>;
    case "arrow":
      return <svg {...common}><path d="M7 17 17 7M7 7h10v10"/></svg>;
    case "refresh":
      return <svg {...common}><path d="M20 7v5h-5M4 17v-5h5"/><path d="M5.6 9a7 7 0 0 1 11.6-2L20 12M4 12l2.8 5a7 7 0 0 0 11.6-2"/></svg>;
    case "plus":
      return <svg {...common}><path d="M12 5v14M5 12h14"/></svg>;
    case "check":
      return <svg {...common}><path d="m5 12 4 4L19 6"/></svg>;
    case "shield":
      return <svg {...common}><path d="M12 22s8-4 8-11V5l-8-3-8 3v6c0 7 8 11 8 11"/><path d="m9 12 2 2 4-4"/></svg>;
    case "copy":
      return <svg {...common}><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3"/></svg>;
    case "close":
      return <svg {...common}><path d="m18 6-12 12M6 6l12 12"/></svg>;
    default:
      return <svg {...common}><circle cx="12" cy="12" r="9"/></svg>;
  }
}

function ChangeBadge({ value }) {
  const positive = value !== null && value >= 0;
  return (
    <span className={`change-badge ${value === null ? "is-neutral" : positive ? "is-positive" : "is-negative"}`}>
      {value !== null && <span aria-hidden="true">{positive ? "↗" : "↘"}</span>}
      {formatPercent(value)}
    </span>
  );
}

function PriceChart({ snapshots, symbol }) {
  const points = useMemo(() => {
    if (snapshots.length < 2) return "";
    const values = snapshots.map((snapshot) => snapshot.price);
    const minimum = Math.min(...values);
    const maximum = Math.max(...values);
    const span = maximum - minimum || Math.max(maximum * 0.001, 0.00000001);
    return values
      .map((value, index) => {
        const x = 8 + (index / (values.length - 1)) * 984;
        const y = 166 - ((value - minimum) / span) * 142;
        return `${index === 0 ? "M" : "L"} ${x.toFixed(2)} ${y.toFixed(2)}`;
      })
      .join(" ");
  }, [snapshots]);

  if (snapshots.length < 2) {
    return (
      <div className="chart-empty">
        <div className="chart-empty-mark"><span /><span /><span /><span /><span /></div>
        <span>Collecting real-time observations for {symbol}…</span>
      </div>
    );
  }

  return (
    <div className="chart-canvas">
      <div className="chart-guides" aria-hidden="true"><span /><span /><span /></div>
      <svg viewBox="0 0 1000 180" preserveAspectRatio="none" role="img" aria-label={`Observed ${symbol} USD prices from this session`}>
        <defs>
          <linearGradient id="price-fill" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="#c7f36b" stopOpacity=".2" />
            <stop offset="100%" stopColor="#c7f36b" stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={`${points} L 992 180 L 8 180 Z`} fill="url(#price-fill)" />
        <path d={points} fill="none" stroke="#c7f36b" strokeWidth="2.5" vectorEffect="non-scaling-stroke" />
      </svg>
      <div className="chart-labels"><span>Earlier this session</span><span>Latest</span></div>
    </div>
  );
}

function MarketTable({
  markets,
  selectedMint,
  onSelect,
  watchlist,
  onToggleWatchlist
}) {
  if (markets.length === 0) {
    return <div className="empty-state"><span className="empty-state-icon"><Icon name="chart" size={22} /></span><strong>No live markets found</strong><span>Try a token symbol or paste a different mint address.</span></div>;
  }

  return (
    <div className="table-scroll">
      <table className="market-table">
        <thead><tr><th>Asset</th><th>Price</th><th>24h change</th><th>24h volume</th><th>Liquidity</th><th aria-label="Actions" /></tr></thead>
        <tbody>
          {markets.map((market, index) => (
            <tr key={market.mintAddress} className={market.mintAddress === selectedMint ? "selected-row" : ""}>
              <td>
                <button className="asset-cell" title={`${market.name} · ${market.mintAddress}`} onClick={() => onSelect(market)}>
                  <span className={`token-avatar token-color-${index % 5}`}>{market.symbol.slice(0, 1)}</span>
                  <span className="asset-names"><strong>{market.symbol}</strong><small>{market.name} · {shortMint(market.mintAddress)}</small></span>
                </button>
              </td>
              <td className="number-cell">{formatPrice(market.priceUsd)}</td>
              <td><ChangeBadge value={market.priceChange24h} /></td>
              <td className="number-cell">{formatCurrency(market.volume24hUsd)}</td>
              <td className="number-cell">{formatCurrency(market.liquidityUsd)}</td>
              <td className="action-cell"><button className={`icon-button ${watchlist.includes(market.mintAddress) ? "is-saved" : ""}`} aria-label={`${watchlist.includes(market.mintAddress) ? "Remove from" : "Add to"} watchlist`} onClick={() => onToggleWatchlist(market.mintAddress)}><Icon name="bookmark" size={16} /></button></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function TerminalDashboard({ account, walletKeypair, onLogout }) {
  const [view, setView] = useState("overview");
  const [markets, setMarkets] = useState([]);
  const [market, setMarket] = useState(null);
  const [watchlistMarketData, setWatchlistMarketData] = useState([]);
  const [snapshots, setSnapshots] = useState([]);
  const [watchlist, setWatchlist] = useState(DEFAULT_WATCHLIST);
  const [search, setSearch] = useState("");
  const [hasSearched, setHasSearched] = useState(false);
  const [mintSearch, setMintSearch] = useState("");
  const [searchResults, setSearchResults] = useState([]);
  const [refreshMs, setRefreshMs] = useState(30_000);
  const [isLoading, setIsLoading] = useState(true);
  const [isSearching, setIsSearching] = useState(false);
  const [error, setError] = useState(null);
  const [copied, setCopied] = useState(false);
  const [lastUpdated, setLastUpdated] = useState(null);
  const walletAddress = account.walletAddress;
  const walletName = "Account wallet";
  const [tradeStatus, setTradeStatus] = useState(null);
  const [trades, setTrades] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState(null);

  const updateTradeHistory = useCallback(async () => {
    setHistoryLoading(true);
    setHistoryError(null);
    try {
      const result = await requestJson("/api/trade?resource=history");
      if (!isRecord(result) || !Array.isArray(result.trades)) {
        throw new Error("The account service returned invalid swap history.");
      }
      setTrades(result.trades);
    } catch (requestError) {
      setHistoryError(requestError instanceof Error ? requestError.message : "Swap history is unavailable.");
    } finally {
      setHistoryLoading(false);
    }
  }, []);

  const updateOverview = useCallback(async () => {
    const result = await requestJson("/api/market?view=overview");
    const nextMarkets = parseMarkets(result);
    setMarkets(nextMarkets);
    setLastUpdated(new Date().toISOString());
    setError(null);
    return nextMarkets;
  }, []);

  const updateSelectedMarket = useCallback(async (mint) => {
    const result = await requestJson(`/api/market?mint=${encodeURIComponent(mint)}`);
    const nextMarket = parseMarket(result);
    if (!nextMarket) throw new Error("The market service returned invalid token data.");
    setMarket(nextMarket);
    setSnapshots((previous) => [
      ...previous,
      { timestamp: Date.now(), price: nextMarket.priceUsd }
    ].slice(-60));
    setLastUpdated(new Date().toISOString());
    setError(null);
    return nextMarket;
  }, []);

  const updateWatchlistMarkets = useCallback(async () => {
    if (watchlist.length === 0) {
      setWatchlistMarketData([]);
      return;
    }
    const addresses = watchlist.map((address) => encodeURIComponent(address)).join(",");
    setWatchlistMarketData(parseMarkets(await requestJson(`/api/market?addresses=${addresses}`)));
  }, [watchlist]);

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem("solana-terminal-watchlist");
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.every((entry) => typeof entry === "string")) {
          setWatchlist(parsed);
        }
      }
    } catch (storageError) {
      console.error("Could not load the local watchlist", storageError);
    }
  }, []);

  useEffect(() => {
    if (view === "activity") void updateTradeHistory();
  }, [updateTradeHistory, view]);

  useEffect(() => {
    try {
      window.localStorage.setItem("solana-terminal-watchlist", JSON.stringify(watchlist));
    } catch (storageError) {
      console.error("Could not save the local watchlist", storageError);
    }
  }, [watchlist]);

  useEffect(() => {
    let cancelled = false;
    requestJson("/api/trade?resource=status")
      .then((status) => {
        if (!cancelled) setTradeStatus(status);
      })
      .catch((requestError) => {
        console.error("Could not load live trading status", requestError);
        if (!cancelled) setTradeStatus({ enabled: false, reason: "trade_status_unavailable" });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const refresh = async () => {
      try {
        const nextMarkets = await updateOverview();
        if (cancelled) return;
        try {
          await updateSelectedMarket(market?.mintAddress ?? SOL_MINT);
        } catch (requestError) {
          const firstMarket = nextMarkets[0];
          if (!cancelled && firstMarket && !market) {
            setMarket(firstMarket);
          } else if (!cancelled) {
            setError(requestError instanceof Error ? requestError.message : "Market data is unavailable.");
          }
        }
        if (view === "watchlist") {
          try {
            await updateWatchlistMarkets();
          } catch (requestError) {
            if (!cancelled) {
              setError(requestError instanceof Error ? requestError.message : "Watchlist market data is unavailable.");
            }
          }
        }
      } catch (requestError) {
        if (!cancelled) {
          setError(requestError instanceof Error ? requestError.message : "Market data is unavailable.");
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    };
    void refresh();
    const interval = window.setInterval(() => void refresh(), refreshMs);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [market?.mintAddress, refreshMs, updateOverview, updateSelectedMarket, updateWatchlistMarkets, view]);

  const pageCopy = VIEW_TITLES[view];
  const marketConnected = Boolean(lastUpdated && !error);
  const marketChange = market?.priceChange24h ?? null;

  const toggleWatchlist = (mint) => {
    if (!watchlist.includes(mint) && watchlist.length >= 10) {
      setError("Watchlist limit reached. Remove an asset before adding another.");
      return;
    }
    setWatchlist((previous) =>
      previous.includes(mint)
        ? previous.filter((savedMint) => savedMint !== mint)
        : [...previous, mint]
    );
  };

  const selectMarket = (selected) => {
    setMarket(selected);
    setSnapshots([]);
    setView("overview");
    void updateSelectedMarket(selected.mintAddress).catch((requestError) => {
      setError(requestError instanceof Error ? requestError.message : "Market data is unavailable.");
    });
  };

  const submitSearch = async (event) => {
    event.preventDefault();
    if (search.trim().length < 2) return;
    setView("markets");
    setIsSearching(true);
    setError(null);
    setHasSearched(true);
    try {
      setSearchResults(parseMarkets(await requestJson(`/api/market?search=${encodeURIComponent(search.trim())}`)));
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Search is unavailable.");
      setSearchResults([]);
    } finally {
      setIsSearching(false);
    }
  };

  const submitMint = async (event) => {
    event.preventDefault();
    const mint = mintSearch.trim();
    setError(null);
    setIsSearching(true);
    try {
      const nextMarket = parseMarket(await requestJson(`/api/market?mint=${encodeURIComponent(mint)}`));
      if (!nextMarket) throw new Error("The market service returned invalid token data.");
      setMarket(nextMarket);
      setSnapshots([]);
      setView("overview");
      setMintSearch("");
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Token market data is unavailable.");
    } finally {
      setIsSearching(false);
    }
  };

  const refreshNow = async () => {
    setIsLoading(true);
    try {
      await updateOverview();
      await updateSelectedMarket(market?.mintAddress ?? SOL_MINT);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Market data is unavailable.");
    } finally {
      setIsLoading(false);
    }
  };

  const copyMint = async () => {
    if (!market) return;
    try {
      await navigator.clipboard.writeText(market.mintAddress);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch (copyError) {
      setError(copyError instanceof Error ? "Clipboard access was denied." : "Could not copy the token address.");
    }
  };

  const watchlistMarkets = useMemo(() => {
    const savedMarkets = [...watchlistMarketData];
    if (market && watchlist.includes(market.mintAddress) &&
        !savedMarkets.some((item) => item.mintAddress === market.mintAddress)) {
      savedMarkets.push(market);
    }
    return savedMarkets;
  }, [market, watchlist, watchlistMarketData]);

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a className="brand" href="/" aria-label="Solana Terminal home">
          <span className="brand-mark"><span /><span /><span /></span>
          <span className="brand-name">solana<span>terminal</span></span>
        </a>
        <div className="workspace-switcher">
          <span className="workspace-avatar">S</span>
          <span className="workspace-copy"><strong>Personal workspace</strong><small>Local staging</small></span>
          <span className="workspace-chevron">⌄</span>
        </div>
        <nav className="side-nav" aria-label="Main navigation">
          {["Workspace", "Trading", "System"].map((group) => (
            <div className="nav-group" key={group}>
              <span className="nav-group-label">{group}</span>
              {NAV_ITEMS.filter((item) => item.group === group && (
                item.id !== "admin" || (
                  account.isDemo && account.email === "admin@local.test"
                )
              )).map((item) => (
                <button
                  key={item.id}
                  className={`nav-item ${view === item.id ? "active" : ""}`}
                  onClick={() => setView(item.id)}
                  aria-label={item.label}
                  title={item.label}
                  aria-current={view === item.id ? "page" : undefined}
                >
                  <Icon name={item.icon} size={17} />
                  <span>{item.label}</span>
                  {item.id === "watchlist" && <span className="nav-count">{watchlist.length}</span>}
                </button>
              ))}
            </div>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="sidebar-safety"><span className="safety-icon"><Icon name="shield" size={16} /></span><span><strong>{account.isDemo ? "Local demo account" : "Mainnet trading"}</strong><small>{account.isDemo ? "Swap execution disabled" : "Explicit submit required"}</small></span><span className="safety-dot" /></div>
          <div className="sidebar-user"><span className="user-avatar">{account.email.slice(0, 1).toUpperCase()}</span><span className="workspace-copy"><strong>{account.email}</strong><small>{walletAddress.slice(0, 5)}…{walletAddress.slice(-5)}</small></span><button className="icon-button" aria-label="Sign out" onClick={() => void onLogout()}><Icon name="close" size={16} /></button></div>
        </div>
      </aside>

      <main className="main-panel">
        <header className="topbar">
          <div className="breadcrumbs"><span>Workspace</span><span className="breadcrumb-divider">/</span><strong>{NAV_ITEMS.find((item) => item.id === view)?.label}</strong></div>
          <div className="topbar-actions">
            <span className={`connection-status ${marketConnected ? "" : "is-offline"}`}><span className="status-dot" />{marketConnected ? "Markets connected" : error ? "Markets unavailable" : "Connecting to markets"}</span>
            <span className="topbar-divider" />
            <span className="wallet-button account-wallet-label"><Icon name="wallet" size={16} />{walletAddress.slice(0, 5)}…{walletAddress.slice(-5)}<span className="wallet-disabled-label">Account</span></span>
            <button className="topbar-avatar" type="button" aria-label="Sign out" title="Sign out" onClick={() => void onLogout()}>{account.email.slice(0, 1).toUpperCase()}</button>
          </div>
        </header>

        <div className="page-content">
          <section className="page-heading">
            <div><p className="eyebrow">{pageCopy.eyebrow}</p><h1>{pageCopy.title}</h1><p className="page-subtitle">{pageCopy.subtitle}</p></div>
            <div className="heading-actions">
              <span className="read-only-chip"><span className="status-dot" />SOLANA MAINNET</span>
              <button className="button button-secondary refresh-button" onClick={() => void refreshNow()} disabled={isLoading} aria-label="Refresh market data"><Icon name="refresh" size={16} /><span>{isLoading ? "Updating…" : "Refresh"}</span></button>
            </div>
          </section>

          {error && <div className="alert-banner" role="alert"><span className="alert-symbol">!</span><span>{error}</span><button onClick={() => setError(null)} aria-label="Dismiss message"><Icon name="close" size={16} /></button></div>}

          {account.isDemo && <div className="demo-account-notice" role="status"><Icon name="shield" size={17} /><span><strong>Local test account · Mainnet swaps disabled</strong><small>This wallet is for UI and account-flow testing only. Do not send funds to it or export its key.</small></span></div>}

          {(view === "overview" || view === "markets" || view === "watchlist") && (
            <section className="market-ribbon" aria-label="Featured Solana market prices">
              <span className={`ribbon-label ${marketConnected ? "" : "is-offline"}`}><span className="status-dot" />{marketConnected ? "LIVE MARKETS" : error ? "MARKETS OFFLINE" : "CONNECTING"}</span>
              <div className="ribbon-assets">
                {markets.slice(0, 4).map((item) => (
                  <button className="ribbon-asset" key={item.mintAddress} onClick={() => selectMarket(item)}>
                    <span className={`ribbon-token token-color-${markets.indexOf(item) % 5}`}>{item.symbol.slice(0, 1)}</span>
                    <span className="ribbon-symbol">{item.symbol}</span><strong>{formatPrice(item.priceUsd)}</strong><ChangeBadge value={item.priceChange24h} />
                  </button>
                ))}
                {markets.length === 0 && <span className="ribbon-loading">{isLoading ? "Connecting to live market data…" : "No featured markets available"}</span>}
              </div>
              <span className="ribbon-time">{lastUpdated ? `Updated ${formatTime(lastUpdated)}` : "Connecting…"}</span>
            </section>
          )}

          {(view === "overview" || view === "markets" || view === "watchlist") && (
            <section className="stats-grid" aria-label="Selected asset statistics">
              <article className="stat-card stat-card-featured">
                <div className="stat-head"><span>Selected asset</span><span className="stat-icon"><Icon name="chart" size={16} /></span></div>
                <strong className="stat-value stat-token-value">{market ? <><span className="token-avatar token-color-0">{market.symbol.slice(0, 1)}</span><span>{market.symbol}<small>{market.name}</small></span></> : isLoading ? "Loading…" : "No asset selected"}</strong>
                <span className="stat-foot">{market ? shortMint(market.mintAddress) : "Select a market to inspect"}</span>
              </article>
              <article className="stat-card"><div className="stat-head"><span>Last price</span><span className="stat-icon"><Icon name="activity" size={16} /></span></div><strong className="stat-value">{market ? formatPrice(market.priceUsd) : "—"}</strong><span className="stat-foot"><ChangeBadge value={marketChange} /><span>24 hour change</span></span></article>
              <article className="stat-card"><div className="stat-head"><span>24h trading volume</span><span className="stat-icon"><Icon name="chart" size={16} /></span></div><strong className="stat-value">{formatCurrency(market?.volume24hUsd)}</strong><span className="stat-foot">Across tracked liquidity pools</span></article>
              <article className="stat-card"><div className="stat-head"><span>Pool liquidity</span><span className="stat-icon"><Icon name="shield" size={16} /></span></div><strong className="stat-value">{formatCurrency(market?.liquidityUsd)}</strong><span className="stat-foot">Source: {market?.source ?? "Awaiting market data"}</span></article>
            </section>
          )}

          {(view === "overview" || view === "markets") && (
            <section className="content-grid">
              <article className="panel chart-panel">
                <div className="panel-heading">
                  <div><div className="panel-title-line"><h2>{market ? `${market.symbol} / USD` : "Live price"}</h2><span className="live-indicator"><span className="status-dot" />LIVE</span></div><p>Observed price updates during this session</p></div>
                  <div className="chart-current">{market && <><strong>{formatPrice(market.priceUsd)}</strong><ChangeBadge value={marketChange} /></>}</div>
                </div>
                <PriceChart snapshots={snapshots} symbol={market?.symbol ?? "token"} />
                <div className="chart-footer"><span>Only actual provider observations are plotted — no historical data is fabricated.</span><span>{refreshMs / 1000} SEC REFRESH</span></div>
              </article>
              <article className="panel token-panel">
                <div className="panel-heading"><div><h2>Explore a token</h2><p>Search by symbol or paste a mint address</p></div><span className="panel-menu"><Icon name="search" size={17} /></span></div>
                <form className="search-form" onSubmit={(event) => void submitSearch(event)}><span className="input-icon"><Icon name="search" size={16} /></span><input aria-label="Search token markets" placeholder="Search tokens, e.g. SOL or BONK" value={search} onChange={(event) => setSearch(event.target.value)} minLength={2} maxLength={64} /><button aria-label="Search markets" type="submit" disabled={isSearching}><Icon name="arrow" size={17} /></button></form>
                <form className="mint-form" onSubmit={(event) => void submitMint(event)}><label htmlFor="mint-lookup">Or look up a token mint</label><div className="mint-input-row"><input id="mint-lookup" value={mintSearch} onChange={(event) => setMintSearch(event.target.value)} maxLength={44} placeholder="Paste Solana mint address" spellCheck={false} autoComplete="off" required /><button className="button button-secondary" type="submit" disabled={isSearching}>{isSearching ? "Loading…" : "Look up"}</button></div></form>
                <div className="provider-note"><Icon name="shield" size={15} /><span>Data comes from public markets. Always verify the mint address.</span></div>
              </article>
            </section>
          )}

          {!account.isDemo && view === "overview" && market && market.mintAddress !== SOL_MINT && (
            <section className="trade-section">
              <TradeTicket
                market={market}
                walletAddress={walletAddress}
                walletSigner={walletKeypair}
                tradeStatus={tradeStatus}
                onTradeComplete={() => void refreshNow()}
              />
            </section>
          )}
          {account.isDemo && view === "overview" && market && market.mintAddress !== SOL_MINT && <section className="panel demo-trading-disabled"><Icon name="shield" size={17} /><span><strong>Swap panel disabled for this test account</strong><small>Explore the market UI safely. Sign in with a separate account to use live Mainnet trading.</small></span></section>}

          {(view === "overview" || view === "markets" || view === "watchlist") && (
            <section className="panel markets-panel">
              <div className="panel-heading markets-heading"><div><div className="panel-title-line"><h2>{view === "watchlist" ? "Saved assets" : view === "markets" && hasSearched ? `Search results for “${search}”` : "Featured markets"}</h2><span className="result-count">{view === "watchlist" ? watchlistMarkets.length : view === "markets" && hasSearched ? searchResults.length : markets.length}</span></div><p>{view === "watchlist" ? "Your locally saved Solana tokens" : "Top available pairs by pool liquidity"}</p></div><button className="text-button" onClick={() => setView("markets")}>Explore markets<Icon name="arrow" size={14} /></button></div>
              <MarketTable markets={view === "watchlist" ? watchlistMarkets : view === "markets" && hasSearched ? searchResults : markets} selectedMint={market?.mintAddress ?? null} onSelect={selectMarket} watchlist={watchlist} onToggleWatchlist={toggleWatchlist} />
              <div className="table-footer"><span><span className="status-dot" />Public market data</span><span>Tokens may impersonate other assets. Verify the exact mint and price.</span></div>
            </section>
          )}

          {view === "overview" && market && (
            <section className="content-grid lower-grid">
              <article className="panel token-details-panel"><div className="panel-heading"><div><h2>Asset details</h2><p>Pair and token information</p></div></div><dl className="detail-list"><div><dt>Token contract</dt><dd><code>{shortMint(market.mintAddress)}</code><button className="icon-button" onClick={() => void copyMint()} aria-label="Copy token address"><Icon name={copied ? "check" : "copy"} size={15} /></button></dd></div><div><dt>Market cap</dt><dd>{formatCurrency(market.marketCapUsd)}</dd></div><div><dt>Fully diluted value</dt><dd>{formatCurrency(market.fdvUsd)}</dd></div><div><dt>Primary DEX</dt><dd className="dex-name"><span className="dex-mark">{market.dexId.slice(0, 1).toUpperCase()}</span>{market.dexId}</dd></div><div><dt>Last provider update</dt><dd>{formatTime(market.observedAt)}</dd></div></dl>{market.url && <a className="external-link" href={market.url} target="_blank" rel="noreferrer">View pair on DexScreener<Icon name="arrow" size={14} /></a>}</article>
              <article className="panel session-panel"><div className="panel-heading"><div><h2>Session status</h2><p>Solana Mainnet</p></div><span className={`status-pill ${marketConnected ? "" : "is-offline"}`}><span className="status-dot" />{marketConnected ? "Connected" : error ? "Unavailable" : "Connecting"}</span></div><div className="session-rows"><div><span>Market data feed</span><strong className={marketConnected ? "text-positive" : ""}>{marketConnected ? "Connected" : error ? "Unavailable" : "Connecting"}</strong></div><div><span>Network</span><strong>Solana Mainnet</strong></div><div><span>Execution</span><strong>{tradeStatus?.enabled ? "Jupiter Swap v2" : "API key required"}</strong></div><div><span>Wallet signing</span><strong>Account key · browser only</strong></div><div><span>Real funds</span><strong>Yes · explicit submit required</strong></div></div><div className="safety-callout"><Icon name="shield" size={17} /><span><strong>Non-custodial execution</strong><small>Each swap needs your explicit action; signing happens in this browser.</small></span></div></article>
            </section>
          )}

          {view === "portfolio" && <section className="empty-panel panel"><span className="empty-state-icon"><Icon name="wallet" size={24} /></span><span className="eyebrow">MAINNET WALLET</span><h2>Account wallet</h2><p>{walletAddress}. Token balance indexing is not configured yet. Swap records and transaction signatures appear in Activity.</p><a className="button button-secondary" href={`https://solscan.io/account/${walletAddress}`} target="_blank" rel="noreferrer">View on Solscan<Icon name="arrow" size={15} /></a></section>}
          {view === "activity" && <section className="panel history-panel"><div className="panel-heading"><div><span className="eyebrow">MAINNET ACTIVITY</span><h2>Swap history</h2><p>Recent swaps created by this account</p></div><button className="button button-secondary" onClick={() => void updateTradeHistory()} disabled={historyLoading}><Icon name="refresh" size={15} />{historyLoading ? "Loading…" : "Refresh"}</button></div>{historyError && <div className="trade-feedback is-error" role="alert">{historyError}</div>}{trades.length ? <div className="history-table-wrap"><table className="history-table"><thead><tr><th>Direction</th><th>Assets</th><th>Status</th><th>Time</th><th>Transaction</th></tr></thead><tbody>{trades.map((trade) => <tr key={trade.request_id}><td><span className={`history-side ${trade.side === "buy" ? "is-buy" : "is-sell"}`}>{trade.side}</span></td><td><code>{shortMint(trade.input_mint)} → {shortMint(trade.output_mint)}</code></td><td><span className={`history-status status-${trade.status}`}>{trade.status.replaceAll("_", " ")}</span></td><td>{formatTime(trade.created_at)}</td><td>{trade.signature ? <a href={`https://solscan.io/tx/${encodeURIComponent(trade.signature)}`} target="_blank" rel="noreferrer">View on Solscan <Icon name="arrow" size={13} /></a> : "—"}</td></tr>)}</tbody></table></div> : !historyLoading && !historyError && <div className="history-empty"><span className="empty-state-icon"><Icon name="activity" size={24} /></span><h3>No swaps yet</h3><p>Once you place a swap, its status and on-chain transaction link will appear here.</p><button className="button button-secondary" onClick={() => setView("markets")}>Explore markets<Icon name="arrow" size={15} /></button></div>}</section>}
          {view === "settings" && <section className="panel settings-panel"><div className="panel-heading"><div><h2>Trading & market settings</h2><p>Live swaps on Solana Mainnet require your explicit submit action.</p></div></div><label className="setting-row" htmlFor="refresh-rate"><span><strong>Market refresh interval</strong><small>Applies to live token and overview data.</small></span><select id="refresh-rate" value={refreshMs} onChange={(event) => setRefreshMs(Number(event.target.value))}>{REFRESH_OPTIONS.map((option) => <option value={option} key={option}>{option / 1000} seconds</option>)}</select></label><div className="setting-row"><span><strong>Market data provider</strong><small>Public market prices</small></span><span className="status-pill"><span className="status-dot" />DexScreener</span></div><div className="setting-row"><span><strong>Trading mode</strong><small>Real transactions on Solana Mainnet</small></span><span className="mode-chip"><Icon name="shield" size={14} />Live Mainnet</span></div><div className="setting-row"><span><strong>Swap provider</strong><small>Server-side Jupiter API key required</small></span><span className={tradeStatus?.enabled ? "status-pill" : "disabled-label"}>{tradeStatus?.enabled ? "Ready" : "Setup required"}</span></div><div className="setting-row"><span><strong>Wallet signing</strong><small>The unlocked account key signs in this browser after your explicit action.</small></span><span className="status-pill">{walletName}</span></div><div className="setting-row"><span><strong>Local watchlist</strong><small>Saved in this browser; never sent to the API.</small></span><button className="text-button" onClick={() => { setWatchlist(DEFAULT_WATCHLIST); }}>Reset watchlist</button></div></section>}
          {view === "admin" && account.isDemo && account.email === "admin@local.test" && <AdminWalletPanel />}
        </div>
        <footer className="app-footer"><span>Solana Terminal <span className="footer-separator">·</span> Local staging</span><span><span className="status-dot" />Solana Mainnet <span className="footer-separator">·</span> Every swap requires explicit submit</span></footer>
      </main>

    </div>
  );
}

export default function Dashboard() {
  const [account, setAccount] = useState(null);
  const [walletKeypair, setWalletKeypair] = useState(null);

  const unlockAccount = useCallback((nextAccount, keypair) => {
    walletKeypair?.secretKey.fill(0);
    setAccount(nextAccount);
    setWalletKeypair(keypair);
  }, [walletKeypair]);

  const logout = useCallback(async () => {
    try {
      const response = await fetch("/api/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({ action: "logout" }),
        signal: AbortSignal.timeout(15_000)
      });
      if (!response.ok) throw new Error("Could not end the account session.");
      walletKeypair?.secretKey.fill(0);
      setWalletKeypair(null);
      setAccount(null);
    } catch (logoutError) {
      console.error("Account logout failed", logoutError);
    }
  }, [walletKeypair]);

  if (!account || !walletKeypair) {
    return <AccountGate onUnlocked={unlockAccount} />;
  }
  if (!(walletKeypair instanceof Keypair) || walletKeypair.publicKey.toBase58() !== account.walletAddress) {
    if (walletKeypair instanceof Keypair) walletKeypair.secretKey.fill(0);
    return <AccountGate onUnlocked={unlockAccount} />;
  }
  return <TerminalDashboard account={account} walletKeypair={walletKeypair} onLogout={logout} />;
}
