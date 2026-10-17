/**
 * Cloudflare Web Analytics (cookieless) — manual beacon, OFF unless WEB_ANALYTICS_TOKEN is set.
 * The token is a public site token (it appears in page HTML), not a secret. Invalid values render nothing.
 * When on: exactly one beacon tag per HTML page, and the CSP allows only the two Cloudflare Insights hosts.
 */
export const BEACON_SRC = "https://static.cloudflareinsights.com/beacon.min.js";
export const BEACON_SCRIPT_HOST = "https://static.cloudflareinsights.com";
export const BEACON_CONNECT_HOST = "https://cloudflareinsights.com";
const TOKEN_RE = /^[0-9a-f]{32}$/;

export function analyticsToken(env: { WEB_ANALYTICS_TOKEN?: string } | undefined): string {
  const t = String(env?.WEB_ANALYTICS_TOKEN ?? "").trim().toLowerCase();
  return TOKEN_RE.test(t) ? t : "";
}

export function analyticsTag(env: { WEB_ANALYTICS_TOKEN?: string } | undefined): string {
  const t = analyticsToken(env);
  return t ? `<script defer src="${BEACON_SRC}" data-cf-beacon='{"token": "${t}"}'></script>\n` : "";
}

export function contentSecurityPolicy(env: { WEB_ANALYTICS_TOKEN?: string } | undefined): string {
  const on = !!analyticsToken(env);
  return (
    `default-src 'self'; script-src 'self' 'unsafe-inline'${on ? " " + BEACON_SCRIPT_HOST : ""}; style-src 'self' 'unsafe-inline'; img-src 'self' data:; ` +
    `connect-src 'self'${on ? " " + BEACON_CONNECT_HOST : ""}; form-action 'self'; frame-ancestors 'none'; base-uri 'none'; object-src 'none'`
  );
}
