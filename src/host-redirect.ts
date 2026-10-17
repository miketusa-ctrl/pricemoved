import type { Env } from "./env";
import { canonicalOrigin } from "./brand";
import { redirect } from "./util";

/**
 * After custom-domain cutover, BASE_URL is https://pricemoved.com (non-workers.dev).
 * Then:
 *   - *.workers.dev → 301 (GET/HEAD) or 308 (other methods) to BASE_URL origin + path + query
 *   - www.<apex> → 301 to apex (when BASE_URL is apex), or apex → www (when BASE_URL is www)
 * No-op when BASE_URL is empty/invalid/*.workers.dev (today's live waitlist), or when the
 * request already hits the canonical host. Local 127.0.0.1 is never redirected.
 */
export function legacyHostRedirect(request: Request, env: Env): Response | null {
  const origin = canonicalOrigin(env.BASE_URL);
  if (!origin) return null;

  const canonHost = new URL(origin).hostname.toLowerCase();
  const url = new URL(request.url);
  const host = url.hostname.toLowerCase();
  if (host === canonHost) return null;

  const isWorkersDev = host.endsWith(".workers.dev");
  const isWwwOfApex = !canonHost.startsWith("www.") && host === `www.${canonHost}`;
  const isApexOfWww = canonHost.startsWith("www.") && host === canonHost.slice(4);

  if (!isWorkersDev && !isWwwOfApex && !isApexOfWww) return null;

  const dest = new URL(origin);
  dest.pathname = url.pathname;
  dest.search = url.search;
  // GET/HEAD keep 301 (cacheable, SEO); other methods get 308 so a POST keeps its method and body.
  const method = request.method.toUpperCase();
  return redirect(dest.toString(), method === "GET" || method === "HEAD" ? 301 : 308);
}
