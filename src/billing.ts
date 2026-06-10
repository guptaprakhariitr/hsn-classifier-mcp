// Quota enforcement + per-key usage tracking.
// CLOSED-SOURCE in practice (this is business logic + revenue control).
// Included in the template for completeness; you'd typically move this into a
// private repo when productizing.
//
// Storage convention (shared with auth.ts):
//   USAGE  "counter:<apikey>:<YYYY-MM>"  -> integer monthly call count
//   USAGE  "rate:<apikey>:<minute-ts>"   -> integer per-minute count (60s TTL)
//
// Each successful tool/call increments both counters. If either exceeds the
// tier's limit, the request returns 429 with a friendly upgrade link.

import { Tier, TIER_LIMITS, monthKey } from "./auth";

const UPGRADE_URL_DEFAULT = "https://example.workers.dev/upgrade";

export interface QuotaResult {
  allowed: boolean;
  callsRemaining: number;
  resetAt: number;
  reason?: "monthly_exceeded" | "rate_exceeded";
}

export async function checkAndIncrement(
  apiKey: string | null,
  tier: Tier,
  usage: KVNamespace,
  _upgradeUrl: string = UPGRADE_URL_DEFAULT
): Promise<QuotaResult> {
  const keyId = apiKey ?? `anon:${new Date().toISOString().slice(0, 10)}`;
  const { monthlyCalls, ratePerMin } = TIER_LIMITS[tier];
  const monthBucket = monthKey();

  // Monthly counter
  const monthlyKvKey = `counter:${keyId}:${monthBucket}`;
  const currentMonthly = parseInt((await usage.get(monthlyKvKey)) || "0", 10);
  if (currentMonthly >= monthlyCalls) {
    return {
      allowed: false,
      callsRemaining: 0,
      resetAt: startOfNextMonth().getTime(),
      reason: "monthly_exceeded",
    };
  }

  // Per-minute rate limit
  const minuteBucket = Math.floor(Date.now() / 60_000);
  const rateKvKey = `rate:${keyId}:${minuteBucket}`;
  const currentRate = parseInt((await usage.get(rateKvKey)) || "0", 10);
  if (currentRate >= ratePerMin) {
    return {
      allowed: false,
      callsRemaining: monthlyCalls - currentMonthly,
      resetAt: (minuteBucket + 1) * 60_000,
      reason: "rate_exceeded",
    };
  }

  // Increment both. Don't block on the writes — we accept that two simultaneous
  // requests at the exact same boundary may both pass; acceptable for $9-$79/mo
  // tiers, not for high-security.
  await Promise.all([
    usage.put(monthlyKvKey, String(currentMonthly + 1), { expirationTtl: 60 * 60 * 24 * 35 }),
    usage.put(rateKvKey, String(currentRate + 1), { expirationTtl: 65 }),
  ]);

  return {
    allowed: true,
    callsRemaining: monthlyCalls - currentMonthly - 1,
    resetAt: startOfNextMonth().getTime(),
  };
}

export function quotaErrorResponse(q: QuotaResult, upgradeUrl: string = UPGRADE_URL_DEFAULT): Response {
  const message =
    q.reason === "rate_exceeded"
      ? "Rate limit exceeded; please slow down or upgrade for higher rate limits."
      : "Monthly call quota exceeded; please upgrade to continue.";
  return new Response(
    JSON.stringify({
      error: q.reason,
      message,
      callsRemaining: q.callsRemaining,
      resetAt: q.resetAt,
      upgradeUrl,
    }),
    {
      status: 429,
      headers: {
        "Content-Type": "application/json",
        "Retry-After": String(Math.max(1, Math.floor((q.resetAt - Date.now()) / 1000))),
      },
    }
  );
}

function startOfNextMonth(now = Date.now()): Date {
  const d = new Date(now);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1, 0, 0, 0, 0));
}
