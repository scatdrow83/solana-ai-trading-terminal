import { createServer } from "node:http";
import { z } from "zod";

const environmentSchema = z.object({
  HOST: z.string().default("0.0.0.0"),
  PORT: z.coerce.number().int().min(1).max(65535).default(4001),
  API_INTERNAL_URL: z.string().url().default("http://api:4000"),
  MARKET_DISCOVERY_TOKEN: z.string().min(32),
  MARKET_DISCOVERY_INTERVAL_MS: z.coerce.number().int().min(15_000).max(300_000).default(30_000)
});

const environment = environmentSchema.parse(process.env);
const mintPattern = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const feeds = [
  "https://api.dexscreener.com/token-profiles/latest/v1",
  "https://api.dexscreener.com/token-boosts/latest/v1"
] as const;

function isDexScreenerLogo(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 512) {
    return false;
  }
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname === "cdn.dexscreener.com";
  } catch {
    return false;
  }
}

const scanState: {
  scanning: boolean;
  lastScanAt: string | null;
  lastError: string | null;
  discovered: number;
} = {
  scanning: false,
  lastScanAt: null,
  lastError: null,
  discovered: 0
};

async function fetchJson(url: string, init?: RequestInit): Promise<unknown> {
  const response = await fetch(url, {
    ...init,
    signal: AbortSignal.timeout(10_000)
  });
  if (!response.ok) {
    throw new Error(`provider_or_api_http_${response.status}`);
  }
  return response.json();
}

async function readFeed(url: string): Promise<Array<{ mintAddress: string; logoUri: string | null }>> {
  const payload = await fetchJson(url);
  if (!Array.isArray(payload)) {
    throw new Error("invalid_dexscreener_discovery_feed");
  }

  return payload.flatMap((entry) => {
    if (
      typeof entry !== "object" ||
      entry === null ||
      !("chainId" in entry) ||
      entry.chainId !== "solana" ||
      !("tokenAddress" in entry) ||
      typeof entry.tokenAddress !== "string" ||
      !mintPattern.test(entry.tokenAddress)
    ) {
      return [];
    }
    const logoUri = "icon" in entry && isDexScreenerLogo(entry.icon)
      ? entry.icon
      : null;
    return [{ mintAddress: entry.tokenAddress, logoUri }];
  });
}

async function discoverTokens(): Promise<void> {
  scanState.scanning = true;
  try {
    const feedResults = await Promise.allSettled(feeds.map(readFeed));
    const feedErrors: string[] = [];
    const feedMints = feedResults.flatMap((result, index) => {
      if (result.status === "fulfilled") {
        return result.value;
      }
      feedErrors.push(feeds[index] ?? "unknown_feed");
      return [];
    });
    if (feedErrors.length === feeds.length) {
      throw new Error("all_dexscreener_discovery_feeds_failed");
    }
    const profiles = new Map<string, string>();
    for (const profile of feedMints) {
      if (profile.logoUri && !profiles.has(profile.mintAddress)) {
        profiles.set(profile.mintAddress, profile.logoUri);
      }
    }
    const mintAddresses = [...new Set(feedMints.map(({ mintAddress }) => mintAddress))].slice(0, 100);

    if (mintAddresses.length > 0) {
      const result = await fetchJson(
        `${environment.API_INTERNAL_URL.replace(/\/+$/, "")}/market/discovery/ingest`,
        {
          method: "POST",
          headers: {
            authorization: `Bearer ${environment.MARKET_DISCOVERY_TOKEN}`,
            "content-type": "application/json"
          },
          body: JSON.stringify({
            mintAddresses,
            tokenIcons: Object.fromEntries(
              [...profiles].filter(([mint]) => mintAddresses.includes(mint))
            )
          })
        }
      );
      if (
        typeof result !== "object" ||
        result === null ||
        !("accepted" in result) ||
        typeof result.accepted !== "number"
      ) {
        throw new Error("invalid_discovery_ingest_response");
      }
      scanState.discovered = result.accepted;
    } else {
      scanState.discovered = 0;
    }

    scanState.lastError = feedErrors.length
      ? `partial_feed_failure:${feedErrors.length}`
      : null;
    scanState.lastScanAt = new Date().toISOString();
    if (scanState.lastError) {
      console.error("Solana token discovery completed with feed failures", feedErrors.length);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown_discovery_error";
    scanState.lastError = message.slice(0, 160);
    console.error("Solana token discovery scan failed", message);
  } finally {
    scanState.scanning = false;
    setTimeout(() => void discoverTokens(), environment.MARKET_DISCOVERY_INTERVAL_MS);
  }
}

const server = createServer((request, response) => {
  if (request.method === "GET" && request.url === "/health") {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({
      status: "ok",
      service: "worker",
      jobs: {
        tokenDiscovery: scanState.lastError ? "degraded" : scanState.lastScanAt ? "running" : "starting",
        intervalMs: environment.MARKET_DISCOVERY_INTERVAL_MS,
        lastScanAt: scanState.lastScanAt,
        lastError: scanState.lastError,
        discoveredLastScan: scanState.discovered,
        scanning: scanState.scanning
      }
    }));
    return;
  }

  response.writeHead(404, { "content-type": "application/json" });
  response.end(JSON.stringify({ error: "not_found" }));
});

server.listen(environment.PORT, environment.HOST, () => {
  void discoverTokens();
});
server.on("error", (error) => {
  console.error("Worker health server failed to start", error);
  process.exitCode = 1;
});
