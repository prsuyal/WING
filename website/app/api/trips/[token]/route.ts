import { summarySchema, validToken } from "../../../../lib/summary.ts";

export const dynamic = "force-dynamic";
const headers = {
  "Cache-Control": "no-store, private",
  "X-Robots-Tag": "noindex, nofollow, noarchive",
  "Referrer-Policy": "no-referrer",
};
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  if (!validToken(token))
    return Response.json(
      { error: "Link unavailable" },
      { status: 404, headers },
    );
  try {
    const origin = new URL(
      process.env.WING_BACKEND_URL || "http://127.0.0.1:3001",
    );
    if (
      !["http:", "https:"].includes(origin.protocol) ||
      origin.username ||
      origin.password
    )
      throw new Error("Invalid backend configuration");
    const response = await fetch(new URL(`/public/trips/${token}`, origin), {
      cache: "no-store",
      signal: AbortSignal.timeout(8000),
      redirect: "error",
    });
    if (response.status === 404)
      return Response.json(
        { error: "Link unavailable" },
        { status: 404, headers },
      );
    if (!response.ok) throw new Error("Backend unavailable");
    // Validate the allowlist again: accidental new backend fields must never leak.
    const parsed = summarySchema.parse(await response.json());
    return Response.json(parsed, { headers });
  } catch {
    return Response.json(
      { error: "Trip temporarily unavailable" },
      { status: 503, headers: { ...headers, "Retry-After": "15" } },
    );
  }
}
