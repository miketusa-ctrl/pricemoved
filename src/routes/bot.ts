import type { Env } from "../env";
import { contactEmail, isWaitlistMode } from "../env";
import { BOT_TOKEN, BOT_VERSION, BRAND_NAME } from "../brand";
import { HOST_MIN_GAP_MS, MAX_CHECKS_PER_HOST_PER_RUN } from "../check/runner";
import { ROBOTS_MAX_BYTES, ROBOTS_MAX_PATH_LEN, ROBOTS_MAX_PATTERN_LEN, ROBOTS_MAX_RULES } from "../check/robots";
import { shell } from "../legal/pages";
import { escapeHtml, html } from "../util";

/**
 * Public crawler info page, linked from the bot's User-Agent. Relative links only. Every statement
 * here must match src/check/robots.ts, src/check/runner.ts and src/check/extract.ts
 * (tests/robots.test.mjs covers the robots.txt behavior described below).
 */
export function renderBotHtml(env: Env): string {
  const em = escapeHtml(contactEmail(env));
  const gapS = Math.round(HOST_MIN_GAP_MS / 1000);
  const status = isWaitlistMode(env)
    ? `<p>${BRAND_NAME} is currently in <strong>waitlist-only</strong> mode, so ${BOT_TOKEN} is not fetching any pages yet. This page describes how it will behave once monitoring is switched on.</p>`
    : "";
  const body = `<h1>${BOT_TOKEN}</h1>
<p>${BOT_TOKEN} is the crawler for ${BRAND_NAME}. ${BRAND_NAME} will watch public competitor pricing pages and tell subscribers when they change.</p>
${status}
<h2>How it identifies itself</h2>
<p>Every request, including robots.txt requests, sends the User-Agent <code>${BOT_TOKEN}/${BOT_VERSION}</code> followed by a link to this page.</p>
<h2>What it fetches</h2>
<ul>
<li>Only public URLs that a ${BRAND_NAME} subscriber has added. It does not follow links or discover new pages.</li>
<li>Plain GET requests with no cookies or credentials, so it only sees what a logged-out visitor sees. It never submits forms.</li>
<li>Each URL at most daily, every 6 hours, or hourly, depending on the subscriber’s plan.</li>
</ul>
<h2>robots.txt</h2>
<p>${BOT_TOKEN} requests <code>/robots.txt</code> again before every page fetch and follows RFC 9309:</p>
<ul>
<li>Rules in a <code>User-agent: ${BOT_TOKEN}</code> group apply (matched case-insensitively; <code>User-agent: ${BRAND_NAME}</code> also counts). If no group names it, the <code>User-agent: *</code> group applies. A group may list several <code>User-agent</code> lines.</li>
<li><code>Allow</code> and <code>Disallow</code> are both supported, including <code>*</code> wildcards and the <code>$</code> end anchor. The longest matching rule wins. If an <code>Allow</code> and a <code>Disallow</code> rule are the same length, <code>Allow</code> wins.</li>
<li>If a URL is disallowed, it is not fetched.</li>
<li>If robots.txt returns a server error or 429 (Too Many Requests), or can’t be reached, the URL is skipped for that run.</li>
<li>If robots.txt returns any other client error, such as 404, there are no rules and the URL may be fetched.</li>
<li>If the rules that apply to ${BOT_TOKEN} are too large to evaluate safely (more than ${ROBOTS_MAX_RULES.toLocaleString("en-US")} rules, a rule longer than ${ROBOTS_MAX_PATTERN_LEN.toLocaleString("en-US")} characters, a URL path and query longer than ${ROBOTS_MAX_PATH_LEN.toLocaleString("en-US")} characters, or too much work to parse and match them), the URL is skipped for that run.</li>
<li>Only the first ${ROBOTS_MAX_BYTES / 1024} KiB of robots.txt is read; anything after that is ignored.</li>
</ul>
<p>To block ${BOT_TOKEN} from your whole site:</p>
<pre>User-agent: ${BOT_TOKEN}
Disallow: /</pre>
<h2>Rate limits</h2>
<ul>
<li>At least ${gapS} seconds between checks of the same host (each check is one robots.txt request followed by one page request).</li>
<li>At most ${MAX_CHECKS_PER_HOST_PER_RUN} pages per host per scheduled run.</li>
</ul>
<h2>Contact</h2>
<p>Questions, or want your site excluded? Email <a href="mailto:${em}">${em}</a>. See also our <a href="/privacy">Privacy Policy</a> and <a href="/terms">Terms</a>.</p>`;
  return shell(`About ${BOT_TOKEN}`, body, env, "/bot",
    `${BOT_TOKEN} is the ${BRAND_NAME} crawler: how it identifies itself, how it follows robots.txt, its rate limits, and how to block it.`);
}

export function botPage(env: Env): Response {
  return html(renderBotHtml(env));
}
