import { NextResponse } from "next/server";

const noStoreHeaders = { "Cache-Control": "no-store" };

async function proxyAdmin(request: Request, body?: string) {
  try {
    const response = await fetch(
      `${process.env.API_INTERNAL_URL ?? "http://localhost:4000"}/admin/security-simulator`,
      {
        method: body ? "POST" : "GET",
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
    console.error("Local admin simulator API request failed", error);
    return NextResponse.json(
      { error: "admin_simulator_api_unavailable" },
      { status: 502, headers: noStoreHeaders }
    );
  }
}

export async function GET(request: Request) {
  return proxyAdmin(request);
}

export async function POST(request: Request) {
  const body: unknown = await request.json().catch(() => null);
  if (typeof body !== "object" || body === null) {
    return NextResponse.json(
      { error: "json_body_required" },
      { status: 400, headers: noStoreHeaders }
    );
  }
  return proxyAdmin(request, JSON.stringify(body));
}
