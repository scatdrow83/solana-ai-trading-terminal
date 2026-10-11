import { NextResponse } from "next/server";

const apiUrl = () => process.env.API_INTERNAL_URL ?? "http://localhost:4000";
const noStoreHeaders = { "Cache-Control": "no-store" };

async function proxyTrade(path: string, init?: RequestInit) {
  try {
    const response = await fetch(`${apiUrl()}${path}`, {
      ...init,
      cache: "no-store",
      signal: AbortSignal.timeout(15_000)
    });
    const body: unknown = await response.json();
    return NextResponse.json(body, {
      status: response.status,
      headers: noStoreHeaders
    });
  } catch (error) {
    console.error("Live trade API request failed", error);
    return NextResponse.json(
      { error: "live_trade_api_unavailable" },
      { status: 502, headers: noStoreHeaders }
    );
  }
}

export async function GET(request: Request) {
  const resource = new URL(request.url).searchParams.get("resource");
  if (resource === "history") {
    const cookie = request.headers.get("cookie");
    return proxyTrade("/trade/history", {
      method: "GET",
      headers: cookie ? { Cookie: cookie } : {}
    });
  }
  if (resource !== "status") {
    return NextResponse.json(
      { error: "trade_resource_required" },
      { status: 400, headers: noStoreHeaders }
    );
  }
  return proxyTrade("/trade/status");
}

export async function POST(request: Request) {
  const body: unknown = await request.json().catch(() => null);
  if (typeof body !== "object" || body === null || !("action" in body)) {
    return NextResponse.json(
      { error: "trade_action_required" },
      { status: 400, headers: noStoreHeaders }
    );
  }

  const action = body.action;
  if (action !== "order" && action !== "execute") {
    return NextResponse.json(
      { error: "unsupported_trade_action" },
      { status: 400, headers: noStoreHeaders }
    );
  }
  const payload = Object.fromEntries(
    Object.entries(body).filter(([key]) => key !== "action")
  );
  const cookie = request.headers.get("cookie");
  return proxyTrade(`/trade/${action}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(cookie ? { Cookie: cookie } : {})
    },
    body: JSON.stringify(payload)
  });
}
