import type { Env } from "../env";
import { contactEmail, isWaitlistMode, mailingAddress, operatorName } from "../env";
import { escapeHtml, html } from "../util";
import { BRAND_NAME, FAVICON_LINK, canonicalTags } from "../brand";
import { analyticsTag, analyticsToken } from "../analytics";

/** Privacy wording for Cloudflare Web Analytics; rendered only when the beacon is actually on (WEB_ANALYTICS_TOKEN set). */
const ANALYTICS_COLLECT = `<li><strong>Visit statistics</strong> — we use Cloudflare Web Analytics to count page views. It records the page visited, the referring site, browser and device type, country (estimated by Cloudflare from your IP address), and page-load timing. It does not use cookies or local storage or fingerprint visitors, and we see only aggregate totals, not individual visitors.</li>`;
const ANALYTICS_UPDATED = "2026-09-28";
/** Privacy "Last updated": 2026-10-14 in both analytics states (daily visitor count + robots-check rate limit added for v0.2.0). */
const PRIVACY_UPDATED = "2026-10-14";
const VISITOR_COLLECT = `<li><strong>A daily visitor count</strong> — to count how many different visitors the site and its API and MCP endpoints get each day, we store a one-way, salted hash of your network address and the date. We never store the raw IP, your browser details or the pages you visit, and the hash can’t be linked from one day to the next. These hashes are deleted automatically after about <strong>9 days</strong>.</li>`;
const ANALYTICS_WHY = " Visit statistics tell us how many people see the site and which sites send them.";
const ANALYTICS_COOKIES = " Our visit statistics are cookieless.";
const ANALYTICS_RETENTION = ` Visit statistics are stored by Cloudflare as aggregate reports under Cloudflare’s own retention limits; we don’t export them.`;

/** Shared public-page shell (also used by /bot). Canonical host comes from env.BASE_URL, never hardcoded. */
export const shell = (title: string, body: string, env?: Env, path = "", description = "") => `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>${title} — ${BRAND_NAME}</title>
${description ? `<meta name="description" content="${escapeHtml(description)}"/>\n` : ""}${FAVICON_LINK}
${canonicalTags(env?.BASE_URL, path, `${title} — ${BRAND_NAME}`, description)}
<style>body{font-family:system-ui;background:#0b1020;color:#e8ecf7;line-height:1.55;margin:0}
.wrap{max-width:720px;margin:0 auto;padding:48px 20px 80px}a{color:#6ee7b7}
h1{font-size:1.8rem}h2{font-size:1.2rem;margin-top:28px}.note{color:#9aa3b8;font-size:.9rem}
a[href^="mailto:"]{overflow-wrap:anywhere}</style>
</head><body><div class="wrap">${body}<p class="note"><a href="/">← Home</a></p></div>${analyticsTag(env)}</body></html>`;

/** OPERATOR_NAME is rendered verbatim — no "Operator:" prefix added. */
function identityLine(env: Env, withAddress: boolean, updated = "2026-09-26"): string {
  const op = escapeHtml(operatorName(env));
  const em = escapeHtml(contactEmail(env));
  const addr = mailingAddress(env);
  const addrPart = withAddress && addr ? ` Mailing address: ${escapeHtml(addr)}.` : "";
  return `<p class="note">Last updated: ${updated}. ${op}. Contact: <a href="mailto:${em}">${em}</a>.${addrPart}</p>`;
}

function mailto(env: Env): string {
  const em = escapeHtml(contactEmail(env));
  return `<a href="mailto:${em}">${em}</a>`;
}

function privacyWaitlist(env: Env): string {
  const ga = !!analyticsToken(env);
  return `<h1>Privacy Policy</h1>
${identityLine(env, true, PRIVACY_UPDATED)}
<p>PriceMoved is currently in <strong>waitlist-only</strong> mode. There are no accounts, sign-in, or payments yet. This policy describes the only data the public site collects.</p>
<h2>What we collect</h2>
<ul>
<li><strong>Your email address</strong> — the address you submit on the waitlist form.</li>
<li><strong>A timestamp</strong> — when you joined the waitlist.</li>
<li><strong>Which link you came from</strong> — a short campaign tag (for example “x” or “bsky”) if you arrived via one of our tagged launch links, otherwise “direct”. It is stored with your waitlist entry, not in a cookie.</li>
<li><strong>A short-lived hashed IP</strong> — a one-way, salted hash of your IP address (never the raw IP), used only to rate-limit the waitlist form (at most 5 signups per hour per network) and the robots.txt check offered through our API and MCP server (at most 30 checks per hour per network). These hashes are deleted automatically within about <strong>24 hours</strong>. Web addresses sent to the robots.txt check are not stored.</li>
${VISITOR_COLLECT}
${ga ? ANALYTICS_COLLECT + "\n" : ""}</ul>
<p>We do <strong>not</strong> send a confirmation email while PriceMoved is waitlist-only, and we don’t sell or share your email.</p>
<h2>Why we collect it</h2>
<p>To invite you when early access and paid plans open, to prevent abuse of the waitlist form and the robots.txt check, to see which of our launch links bring people to the waitlist, and to count daily visitors.${ga ? ANALYTICS_WHY : ""}</p>
<h2>Retention</h2>
<p>Waitlist emails, their timestamps and link tags are kept until you ask us to remove them or we close the waitlist. Rate-limit hashes are kept for about 24 hours. Daily visitor hashes are kept for about 9 days.${ga ? ANALYTICS_RETENTION : ""}</p>
<h2>Processors</h2>
<ul>
<li><strong>Cloudflare</strong> — hosting and database (Workers / D1)${ga ? ", plus cookieless Web Analytics" : ""}. This is the only processor while PriceMoved is waitlist-only.</li>
<li><strong>Email provider</strong> (Resend or Postmark) — future processor when paid plans launch and we start sending email.</li>
<li><strong>Polar</strong> — future Merchant of Record when paid plans launch.</li>
</ul>
<h2>How to delete your data</h2>
<p>Email ${mailto(env)} from the address you signed up with and ask to be removed. We’ll delete your waitlist entry and confirm within a reasonable time.</p>
<h2>Cookies</h2>
<p>The waitlist site does not set tracking or account cookies.${ga ? ANALYTICS_COOKIES : ""}</p>`;
}

function privacyFull(env: Env): string {
  const ga = !!analyticsToken(env);
  return `<h1>Privacy Policy</h1>
${identityLine(env, true, PRIVACY_UPDATED)}
<p>This policy describes how PriceMoved handles data when you use our website and product.</p>
<h2>What we collect</h2>
<ul>
<li><strong>Account email</strong> — when you sign in (magic link) or join the waitlist.</li>
<li><strong>Waitlist link tag</strong> — which tagged launch link (campaign tag) brought you to the waitlist form, or “direct”; stored with your waitlist entry, not in a cookie.</li>
<li><strong>Watched URLs</strong> — public page URLs you ask us to monitor, plus optional CSS selectors and intervals.</li>
<li><strong>Snapshots and diffs</strong> — minimal text extracts and fingerprints needed to detect changes, plus change summaries and delivery logs.</li>
<li><strong>Billing metadata</strong> — Polar customer/subscription identifiers when you subscribe (Polar is Merchant of Record).</li>
<li><strong>Optional Slack webhook URL</strong> — if you enable Slack alerts on Pro.</li>
<li><strong>Short-lived hashed IP</strong> — for waitlist and robots.txt-check rate limiting only (~24h retention); raw IP is not stored.</li>
${VISITOR_COLLECT}
${ga ? ANALYTICS_COLLECT + "\n" : ""}</ul>
<h2>Why we collect it</h2>
<p>To operate the change-monitoring service, send alerts you request, manage your subscription, invite waitlist signups to early access, see which of our launch links bring people to the waitlist, and count daily visitors.${ga ? ANALYTICS_WHY : ""}</p>
<h2>Retention</h2>
<p>Raw page snapshots are retained according to your plan, then deleted: Free <strong>14 days</strong>, Starter <strong>60 days</strong>, Pro <strong>90 days</strong>. We also keep at most a small number of recent snapshots per watch. Waitlist emails are kept until you ask to be removed or we close the waitlist. Daily visitor hashes are kept for about 9 days.${ga ? ANALYTICS_RETENTION : ""}</p>
<h2>Processors</h2>
<ul>
<li><strong>Cloudflare</strong> — hosting (Workers / D1)${ga ? ", plus cookieless Web Analytics" : ""}.</li>
<li><strong>Email provider</strong> — Resend or Postmark (when live sending is enabled).</li>
<li><strong>Polar</strong> — Merchant of Record for paid subscriptions.</li>
<li><strong>Workers AI / LLM</strong> — optional summarization of diffs when enabled.</li>
</ul>
<h2>robots.txt</h2>
<p>We only fetch public URLs you add. If robots.txt disallows our bot, we do not fetch that URL.</p>
<h2>How to delete your data</h2>
<p>Email ${mailto(env)} to request deletion of your account, watches, snapshots, or waitlist entry.</p>
<h2>Cookies / sessions</h2>
<p>We use an HTTP-only session cookie after magic-link sign-in.${ga ? ANALYTICS_COOKIES : ""}</p>`;
}

function termsBody(env: Env): string {
  const op = escapeHtml(operatorName(env));
  const waitlist = isWaitlistMode(env);
  return `<h1>Terms of Use</h1>
${identityLine(env, true)}
${waitlist ? `<p>PriceMoved is in waitlist-only mode. Joining the waitlist does not create a paid subscription or monitoring account.</p>` : ""}
<h2>Acceptable use</h2>
<p>You may only monitor <strong>public URLs</strong> you are allowed to access. You must not use PriceMoved to bypass logins, paywalls, authentication, or access controls, or to violate a site’s terms or robots.txt.</p>
<h2>Subscriptions</h2>
<p>${
    waitlist
      ? `Paid plans will be billed through <strong>Polar</strong> as Merchant of Record when paid plans launch. Polar’s terms and invoices will apply to payment, tax, and refunds.`
      : `Paid plans are billed through <strong>Polar</strong> as Merchant of Record. Polar’s terms and invoices apply to payment, tax, and refunds as provided by Polar.`
  }</p>
<h2>No warranty</h2>
<p>PriceMoved is an early-access beta. There is no service-level agreement (SLA).</p>
<p>PriceMoved is provided “as is.” Monitoring may miss changes, produce false positives, or be delayed. We do not guarantee uninterrupted service.</p>
<h2>Limitation of liability</h2>
<p>To the maximum extent permitted by law, ${op}, is not liable for indirect, incidental, or consequential damages, or for business decisions you make based on alerts. Liability for direct damages is limited to fees you paid for the service in the three months before the claim.</p>
<h2>Early access pricing</h2>
<p>Plan prices and limits may change. We will describe current limits in the product.</p>
<h2>Contact</h2>
<p>${mailto(env)}</p>`;
}

export function renderPrivacyHtml(env: Env): string {
  return shell("Privacy", isWaitlistMode(env) ? privacyWaitlist(env) : privacyFull(env), env, "/privacy",
    `What ${BRAND_NAME} stores, how long it keeps it, and how to delete your data.`);
}
export function renderTermsHtml(env: Env): string {
  return shell("Terms", termsBody(env), env, "/terms", `Terms of use for ${BRAND_NAME}: public URLs only, early-access beta, no SLA.`);
}
export function privacyPage(env: Env): Response {
  return html(renderPrivacyHtml(env));
}
export function termsPage(env: Env): Response {
  return html(renderTermsHtml(env));
}
