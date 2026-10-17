/**
 * Waitlist campaign tag ("?src=" on launch links). Cookieless: read from the form body (filled client-side from
 * location.search) or, as a no-JS fallback, from the same-origin Referer query. Anything not on the exact,
 * case-sensitive allowlist is stored as "direct". Existing rows (source "landing") are never rewritten.
 */
export const WAITLIST_SOURCES = ["x", "bsky", "threads", "li", "ih"] as const;
export const DEFAULT_WAITLIST_SOURCE = "direct";

export function allowedSource(v: unknown): string | null {
  return typeof v === "string" && (WAITLIST_SOURCES as readonly string[]).includes(v) ? v : null;
}

/** src from the Referer query, only when the Referer is the same origin as this request. */
export function refererSource(request: Request): string | null {
  const ref = request.headers.get("referer");
  if (!ref) return null;
  try {
    const r = new URL(ref);
    if (r.origin !== new URL(request.url).origin) return null;
    return allowedSource(r.searchParams.get("src"));
  } catch {
    return null;
  }
}

/**
 * Body src wins when present and allowlisted. A body src that is present but not allowlisted (forged/unknown)
 * is normalized to "direct" (no Referer lookup). Empty/missing body src → same-origin Referer → "direct".
 */
export function resolveWaitlistSource(bodySrc: unknown, request: Request): string {
  if (bodySrc !== undefined && bodySrc !== null && bodySrc !== "") return allowedSource(bodySrc) ?? DEFAULT_WAITLIST_SOURCE;
  return refererSource(request) ?? DEFAULT_WAITLIST_SOURCE;
}
