import { NextResponse } from "next/server";

const noStoreHeaders = { "Cache-Control": "no-store" };
const mintPattern = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

async function proxyRecommendation(
  request: Request,
  method: "GET" | "POST" | "DELETE",
  body?: string
) {
  try {
    const url = new URL(request.url);
    const mint = url.searchParams.get("mint");
    if (method === "DELETE" && (!mint || !mintPattern.test(mint))) {
      return NextResponse.json(
        { error: "invalid_solana_mint" },
        { status: 400, headers: noStoreHeaders }
      );
    }
    const endpoint = method === "GET"
      ? "/market/recommendations"
      : `/admin/recommendations${method === "DELETE" ? `?mint=${encodeURIComponent(mint!)}` : ""}`;
    const response = await fetch(
      `${process.env.API_INTERNAL_URL ?? "http://localhost:4000"}${endpoint}`,
      {
        method,
        headers: {
          ...(body ? { "Content-Type": "application/json" } : {}),
          ...(request.headers.get("cookie")
            ? { Cookie: request.headers.get("cookie")! }
            : {}),
          ...(request.headers.get("x-forwarded-for")
            ? { "X-Forwarded-For": request.headers.get("x-forwarded-for")! }
            : {})
        },
        ...(body ? { body } : {}),
        cache: "no-store",
        signal: AbortSignal.timeout(15_000)
      }
    );
    return NextResponse.json(await response.json(), {
      status: response.status,
      headers: noStoreHeaders
    });
  } catch (error) {
    console.error("Token recommendation API request failed", error);
    return NextResponse.json(
      { error: "recommendation_api_unavailable" },
      { status: 502, headers: noStoreHeaders }
    );
  }
}

export async function GET(request: Request) {
  return proxyRecommendation(request, "GET");
}

export async function POST(request: Request) {
  const body: unknown = await request.json().catch(() => null);
  if (
    typeof body !== "object" ||
    body === null ||
    !("mintAddress" in body) ||
    typeof body.mintAddress !== "string" ||
    !mintPattern.test(body.mintAddress) ||
    !("note" in body) ||
    typeof body.note !== "string" ||
    body.note.trim().length < 10 ||
    body.note.trim().length > 300
  ) {
    return NextResponse.json(
      { error: "invalid_token_recommendation" },
      { status: 400, headers: noStoreHeaders }
    );
  }
  return proxyRecommendation(request, "POST", JSON.stringify(body));
}

export async function DELETE(request: Request) {
  return proxyRecommendation(request, "DELETE");
}
