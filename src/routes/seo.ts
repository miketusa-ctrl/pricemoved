import type { Env } from "../env";
import { canonicalOrigin } from "../brand";

/** Indexable public pages. Everything else is noindex or disallowed below. */
export const SITEMAP_PATHS = ["/", "/privacy", "/terms", "/bot"] as const;
/** Non-public prefixes crawlers should skip (API, dashboard, auth, signed email actions, billing webhooks, health). */
export const ROBOTS_DISALLOW = ["/api/", "/app", "/auth/", "/actions/", "/webhooks/", "/health"] as const;

/**
 * /robots.txt built from BASE_URL. The Sitemap line is absolute (RFC 9309 §2.2.4) and only emitted when BASE_URL
 * is a real public origin (never *.workers.dev: that host 301s to the custom domain anyway).
 */
export function robotsTxtBody(env: Env): string {
  const origin = canonicalOrigin(env.BASE_URL);
  const lines = ["User-agent: *", "Allow: /", ...ROBOTS_DISALLOW.map((p) => `Disallow: ${p}`)];
  if (origin) lines.push("", `Sitemap: ${origin}/sitemap.xml`);
  return lines.join("\n") + "\n";
}

export function robotsTxt(env: Env): Response {
  return new Response(robotsTxtBody(env), {
    headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "public, max-age=3600" },
  });
}

function xmlEsc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** /sitemap.xml (sitemaps.org 0.9) with absolute URLs from BASE_URL; null when there is no public origin. */
export function sitemapXmlBody(env: Env): string | null {
  const origin = canonicalOrigin(env.BASE_URL);
  if (!origin) return null;
  const urls = SITEMAP_PATHS.map((p) => `  <url><loc>${xmlEsc(origin + p)}</loc></url>`).join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
}

export function sitemapXml(env: Env): Response | null {
  const body = sitemapXmlBody(env);
  if (body === null) return null;
  return new Response(body, {
    headers: { "content-type": "application/xml; charset=utf-8", "cache-control": "public, max-age=3600" },
  });
}
