import { NextResponse } from "next/server";

export async function GET(request: Request) {
  const headers = new Headers();
  const cookie = request.headers.get("cookie");
  const forwardedFor = request.headers.get("x-forwarded-for");
  if (cookie) headers.set("Cookie", cookie);
  if (forwardedFor) headers.set("X-Forwarded-For", forwardedFor);

  try {
    const response = await fetch(
      `${process.env.API_INTERNAL_URL ?? "http://localhost:4000"}/wallet/portfolio`,
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
