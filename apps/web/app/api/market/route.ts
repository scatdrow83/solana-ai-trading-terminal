import { NextResponse } from "next/server";

const mintPattern = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const mintAddress = params.get("mint");
  const mintAddresses = params.get("addresses");
  const searchQuery = params.get("search");
  const view = params.get("view");
  let endpoint: string;

  if (mintAddress) {
    if (!mintPattern.test(mintAddress)) {
      return NextResponse.json(
        { error: "invalid_solana_mint" },
        { status: 400, headers: { "Cache-Control": "no-store" } }
      );
    }
    endpoint = `/market/tokens/${encodeURIComponent(mintAddress)}`;
  } else if (mintAddresses !== null) {
    const addresses = mintAddresses.split(",");
    if (
      addresses.length < 1 ||
      addresses.length > 10 ||
      addresses.some((address) => !mintPattern.test(address))
    ) {
      return NextResponse.json(
        { error: "provide_1_to_10_valid_solana_mints" },
        { status: 400, headers: { "Cache-Control": "no-store" } }
      );
    }
    endpoint = `/market/tokens?addresses=${encodeURIComponent(addresses.join(","))}`;
  } else if (searchQuery !== null) {
    if (searchQuery.length < 2 || searchQuery.length > 64) {
      return NextResponse.json(
        { error: "query_must_be_2_to_64_characters" },
        { status: 400, headers: { "Cache-Control": "no-store" } }
      );
    }
    endpoint = `/market/search?q=${encodeURIComponent(searchQuery)}`;
  } else if (view === "overview") {
    endpoint = "/market/overview";
  } else {
    return NextResponse.json(
      { error: "market_query_required" },
      { status: 400, headers: { "Cache-Control": "no-store" } }
    );
  }

  const apiUrl = process.env.API_INTERNAL_URL ?? "http://localhost:4000";
  try {
    const response = await fetch(
      `${apiUrl}${endpoint}`,
      { cache: "no-store", signal: AbortSignal.timeout(9000) }
    );
    const body: unknown = await response.json();

    return NextResponse.json(body, {
      status: response.status,
      headers: { "Cache-Control": "no-store" }
    });
  } catch (error) {
    console.error("Market data API request failed", error);
    return NextResponse.json(
      { error: "market_data_api_unavailable" },
      { status: 502, headers: { "Cache-Control": "no-store" } }
    );
  }
}
