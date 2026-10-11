import { NextResponse } from "next/server";

const noStoreHeaders = { "Cache-Control": "no-store" };

async function proxyAuth(request: Request, body?: string) {
  try {
    const response = await fetch(
      `${process.env.API_INTERNAL_URL ?? "http://localhost:4000"}/auth`,
      {
        method: body ? "POST" : "GET",
        headers: {
          ...(body ? { "Content-Type": "application/json" } : {}),
          ...(request.headers.get("cookie")
            ? { Cookie: request.headers.get("cookie")! }
            : {})
        },
        ...(body ? { body } : {}),
        cache: "no-store",
        signal: AbortSignal.timeout(15_000)
      }
    );
    const data: unknown = await response.json();
    const result = NextResponse.json(data, {
      status: response.status,
      headers: noStoreHeaders
    });
    for (const cookie of response.headers.getSetCookie()) {
      result.headers.append("Set-Cookie", cookie);
    }
    return result;
  } catch (error) {
    console.error("Account API request failed", error);
    return NextResponse.json(
      { error: "account_api_unavailable" },
      { status: 502, headers: noStoreHeaders }
    );
  }
}

export async function GET(request: Request) {
  return proxyAuth(request);
}

export async function POST(request: Request) {
  const body: unknown = await request.json().catch(() => null);
  if (
    typeof body !== "object" ||
    body === null ||
    !("action" in body) ||
    !["register", "login", "unlock", "logout"].includes(String(body.action))
  ) {
    return NextResponse.json(
      { error: "unsupported_auth_action" },
      { status: 400, headers: noStoreHeaders }
    );
  }
  return proxyAuth(request, JSON.stringify(body));
}
