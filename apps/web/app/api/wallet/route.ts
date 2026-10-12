import { NextResponse } from "next/server";

const solanaPublicKey = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

export async function GET(request: Request) {
  const address = new URL(request.url).searchParams.get("address");
  if (address !== null && !solanaPublicKey.test(address)) {
    return NextResponse.json(
      { error: "invalid_solana_wallet_address" },
      { status: 400, headers: { "Cache-Control": "no-store" } }
    );
  }
  const headers = new Headers();
  const cookie = request.headers.get("cookie");
  const forwardedFor = request.headers.get("x-forwarded-for");
  if (cookie) headers.set("Cookie", cookie);
  if (forwardedFor) headers.set("X-Forwarded-For", forwardedFor);

  try {
    const response = await fetch(
      `${process.env.API_INTERNAL_URL ?? "http://localhost:4000"}/wallet/portfolio${address ? `?address=${encodeURIComponent(address)}` : ""}`,
      {
        headers,
        cache: "no-store",
        signal: AbortSignal.timeout(20_000)
      }
    );
    const body: unknown = await response.json();
    return NextResponse.json(body, {
      status: response.status,
      headers: { "Cache-Control": "no-store" }
    });
  } catch (error) {
    console.error("Wallet portfolio API request failed", error);
    return NextResponse.json(
      { error: "wallet_portfolio_api_unavailable" },
      { status: 502, headers: { "Cache-Control": "no-store" } }
    );
  }
}
