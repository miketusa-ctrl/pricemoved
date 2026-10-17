/** Public brand. Internal resource names (Worker pagewatch-api, D1 pagewatch-db, APP_NAME) intentionally unchanged. */
export const BRAND_NAME = "PriceMoved";
export const BOT_TOKEN = "PriceMovedBot";
export const BOT_VERSION = "1.0";
/** Sent on every robots.txt and page fetch. Info URL is the /bot page (see src/routes/bot.ts). */
export const BOT_UA = `${BOT_TOKEN}/${BOT_VERSION} (+https://pricemoved.com/bot)`;

/**
 * Canonical origin from BASE_URL (set per deploy with --var BASE_URL:...). Never hardcoded in HTML.
 * Returns "" when BASE_URL is missing/invalid or a *.workers.dev host; then no canonical/og:url tags are emitted.
 */
export function canonicalOrigin(baseUrl: string | undefined): string {
  const raw = (baseUrl || "").trim();
  if (!raw) return "";
  try {
    const u = new URL(raw);
    if (u.protocol !== "https:" && u.protocol !== "http:") return "";
    // Never name the internal workers.dev host as canonical (it leaks the old worker name/handle). Tags
    // appear automatically once BASE_URL is the real domain.
    if (u.hostname.endsWith(".workers.dev")) return "";
    return u.origin;
  } catch {
    return "";
  }
}

function escAttr(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** <link rel="canonical"> + Open Graph tags for a public page path, derived from BASE_URL. */
export function canonicalTags(baseUrl: string | undefined, path: string, title: string, description = ""): string {
  const origin = canonicalOrigin(baseUrl);
  const tags = [
    `<meta property="og:site_name" content="${BRAND_NAME}"/>`,
    `<meta property="og:title" content="${escAttr(title)}"/>`,
    `<meta property="og:type" content="website"/>`,
  ];
  if (description) tags.push(`<meta property="og:description" content="${escAttr(description)}"/>`);
  if (origin) {
    const href = escAttr(origin + path);
    tags.unshift(`<link rel="canonical" href="${href}"/>`);
    tags.push(`<meta property="og:url" content="${href}"/>`);
  }
  return tags.join("\n");
}

/** Simple brand favicon (served at /favicon.svg, same-origin so CSP img-src 'self' covers it). */
export const FAVICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#0b1020"/><path d="M14 44 L28 30 L36 38 L50 20" fill="none" stroke="#6ee7b7" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/><path d="M40 20 H50 V30" fill="none" stroke="#6ee7b7" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
export const FAVICON_LINK = `<link rel="icon" href="/favicon.svg" type="image/svg+xml"/>`;
