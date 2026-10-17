/**
 * PriceMoved agent layer: the REST routes (/api/product, /api/robots-check) and the MCP tools call the SAME
 * authenticate() + runCheck(), so limits, cache and validation are never re-implemented in mcp.js.
 *
 * Waitlist-only product: there is NO page fetch / diff tool here (F1–F4 CPU/memory risks stay unreachable).
 * Tools:
 *  - product_info: static facts from the site copy (LANDING_CONTENT + PLAN_LIMITS). No I/O.
 *  - robots_check: one robots.txt fetch through the EXISTING capped path (robotsAllowed: 500 KiB byte cap,
 *    1,000,000-step parse budget) plus a 5 s timeout, a 10-minute result cache, a per-IP per-minute cap, a per-IP
 *    hourly cap (salted hash in D1 waitlist_rate, same ~24 h prune) and a per-isolate global per-minute cap.
 * Also: the privacy-friendly daily-unique-visitor counter (SchemaGate/RichProof pattern, D1 instead of KV).
 */
import { robotsAllowed, ROBOTS_MAX_PATH_LEN } from '../check/robots';
import { LANDING_CONTENT } from '../landing/content-data';
import { PLAN_LIMITS } from '../env';
import { BOT_UA, BOT_TOKEN, BRAND_NAME } from '../brand';
import { VERSION, CONTACT } from './version.js';

export const ROBOTS_TIMEOUT_MS = 5000;
export const ROBOTS_PER_MIN = 10; // per IP bucket, per isolate
export const ROBOTS_PER_HOUR = 30; // per IP bucket, D1 (shared across isolates)
export const ROBOTS_GLOBAL_PER_MIN = 120; // per isolate, all callers (bounds outbound fetches)
export const ROBOTS_CACHE_MS = 10 * 60 * 1000;
export const MAX_URL_LEN = 2048;
export const LIMITS = { robotsPerMin: ROBOTS_PER_MIN, robotsPerHour: ROBOTS_PER_HOUR, robotsTimeoutMs: ROBOTS_TIMEOUT_MS };

// ---------- shared helpers ----------
const mem = new Map();
export function memLimit(key, limit, windowMs, now = Date.now()) {
  if (mem.size > 5000) mem.clear();
  const e = mem.get(key);
  if (!e || now - e.t >= windowMs) { mem.set(key, { t: now, n: 1 }); return true; }
  return ++e.n <= limit;
}
const cache = new Map();
export function _resetAgentState() { mem.clear(); cache.clear(); visitorSeen.clear(); tablesReady.clear(); }

export function ipBucket(ip) { // IPv4 as is; IPv6 → its /64. Same output as workdayapi's.
  const s = String(ip || 'unknown').trim().toLowerCase();
  if (!s.includes(':')) return s;
  if (s.includes('.')) return s.slice(s.lastIndexOf(':') + 1);
  const [h, t] = s.split('::'), head = h ? h.split(':') : [], tail = t ? t.split(':') : [];
  const parts = t === undefined ? head : [...head, ...Array(Math.max(0, 8 - head.length - tail.length)).fill('0'), ...tail];
  return parts.slice(0, 4).map((x) => x.replace(/^0+(?=.)/, '') || '0').join(':') + '::/64';
}
export const clientIp = (request) => request.headers.get('cf-connecting-ip') || 'unknown';

async function sha256hex(s) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
const isDev = (env) => String(env.ENVIRONMENT || 'development').toLowerCase() !== 'production';

/** No API keys exist (waitlist-only). Kept so /api and /mcp share one gate. Never echoes a key. */
export async function authenticate(_request, _env) {
  return { ok: true, tier: 'anonymous' };
}

// ---------- product_info ----------
const priceRow = () => LANDING_CONTENT.plans.rows.find((r) => r[0] === 'Price') || [];
const usd = (cell) => { const m = /^\$(\d+)/.exec(String(cell || '')); return m ? Number(m[1]) : null; };
export function productInfo(origin) {
  const headers = LANDING_CONTENT.plans.headers; // ["", "Free", "Starter", "Pro"]
  const prices = priceRow();
  const plans = ['free', 'starter', 'pro'].map((id, i) => {
    const p = PLAN_LIMITS[id];
    return { id, name: headers[i + 1], price_usd_per_month: usd(prices[i + 1]), pages: p.pages, intervals: [...p.intervals], email_alerts: true, slack_webhook: p.slack, history_days: p.retentionDays };
  });
  return {
    name: BRAND_NAME,
    status: 'waitlist',
    available_now: 'Waitlist signup only. Monitoring, sign-in and checkout are not live yet.',
    summary: LANDING_CONTENT.subhead,
    pricing: { heading: LANDING_CONTENT.pricingHeading, note: LANDING_CONTENT.pricingNoteWaitlist || LANDING_CONTENT.pricingNote, currency: 'USD', early_pricing_subject_to_change: true, plans },
    crawler: { user_agent: BOT_UA, robots_token: BOT_TOKEN, respects_robots_txt: true, info_url: `${origin}/bot` },
    links: { homepage: `${origin}/`, waitlist: `${origin}/#waitlist`, privacy: `${origin}/privacy`, terms: `${origin}/terms` },
    contact: CONTACT,
    version: VERSION,
  };
}

// ---------- robots_check ----------
const IPV4_RE = /^\d{1,3}(\.\d{1,3}){3}$/;
/** Validate a public http(s) URL. Returns { ok, url } or { ok:false, message }. Same rules for REST and MCP. */
export function validateTargetUrl(raw) {
  if (typeof raw !== 'string' || !raw.trim()) return { ok: false, message: 'url must be a non-empty string (an http or https URL).' };
  const s = raw.trim();
  if (s.length > MAX_URL_LEN) return { ok: false, message: `url is longer than ${MAX_URL_LEN} characters.` };
  let u;
  try { u = new URL(s); } catch { return { ok: false, message: 'url is not a valid absolute URL.' }; }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return { ok: false, message: 'Only http and https URLs are supported.' };
  if (u.username || u.password) return { ok: false, message: 'URLs with credentials are not supported.' };
  if (u.port) return { ok: false, message: 'URLs with an explicit port are not supported.' };
  const host = u.hostname.toLowerCase().replace(/\.+$/, ''); // 'localhost.' / 'foo.internal.' (FQDN trailing dot)
  if (host.startsWith('[') || host.includes(':') || IPV4_RE.test(host)) return { ok: false, message: 'Use a domain name, not an IP address.' };
  if (!host.includes('.') || host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) return { ok: false, message: 'Use a public domain name.' };
  if ((u.pathname + u.search).length > ROBOTS_MAX_PATH_LEN) return { ok: false, message: `URL path + query is longer than ${ROBOTS_MAX_PATH_LEN} characters.` };
  u.hash = '';
  return { ok: true, url: u };
}

let tablesReady = new Set();
async function ensureRateTable(env) {
  if (tablesReady.has('rate')) return;
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS waitlist_rate (
      ip_hash TEXT NOT NULL, window_id TEXT NOT NULL, hit_count INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL,
      PRIMARY KEY (ip_hash, window_id))`).run();
  tablesReady.add('rate');
}
/** Hourly per-IP cap in D1 (shared across isolates). Salted hash only; pruned by the existing ~24 h cron/waitlist prune. */
async function hourlyAllowed(env, bucket) {
  await ensureRateTable(env);
  const ipHash = await sha256hex(`${env.SESSION_SECRET || 'local-dev'}:rb:${bucket}`);
  const windowId = new Date().toISOString().slice(0, 13);
  const row = await env.DB.prepare('SELECT hit_count AS c FROM waitlist_rate WHERE ip_hash = ? AND window_id = ?').bind(ipHash, windowId).first();
  if ((row?.c ?? 0) >= ROBOTS_PER_HOUR) return false;
  await env.DB.prepare(`INSERT INTO waitlist_rate (ip_hash, window_id, hit_count, updated_at) VALUES (?, ?, 1, ?)
     ON CONFLICT(ip_hash, window_id) DO UPDATE SET hit_count = hit_count + 1, updated_at = excluded.updated_at`).bind(ipHash, windowId, new Date().toISOString()).run();
  return true;
}
const secsToNextHour = (now = Date.now()) => Math.max(1, Math.ceil((3600000 - (now % 3600000)) / 1000));
const fail = (status, code, message, headers = {}) => ({ ok: false, status, code, message, headers });

/**
 * Shared engine for GET /api/{product,robots-check} and MCP tools/call.
 * { ok:true, body, headers, cached } | { ok:false, status, code, message, headers }
 */
export async function runCheck({ tool, input, env, ctx, ip, origin, request, doFetch }) {
  if (tool === 'product_info') {
    if (request) countVisitor(request, env, ctx, ip);
    return { ok: true, body: productInfo(origin), headers: {}, cached: false };
  }
  if (tool !== 'robots_check') return fail(404, 'not_found', 'Unknown tool.');
  const v = validateTargetUrl(input && input.url);
  if (!v.ok) return fail(400, 'invalid_url', v.message);
  const u = v.url;
  const key = `${u.origin}${u.pathname}${u.search}`;
  const now = Date.now();
  const hit = cache.get(key);
  if (hit && now - hit.t < ROBOTS_CACHE_MS) { // 1) cache HIT: no limiter, no fetch
    if (request) countVisitor(request, env, ctx, ip);
    return { ok: true, body: { ...hit.body, cached: true }, headers: { 'x-cache': 'HIT' }, cached: true };
  }
  if (!env.SESSION_SECRET && !isDev(env)) return fail(503, 'temporarily_unavailable', 'Robots check is temporarily unavailable.');
  const bucket = ipBucket(ip);
  if (!memLimit(`rb:${bucket}`, ROBOTS_PER_MIN, 60_000)) return fail(429, 'rate_limited', `Too many robots checks from your network (about ${ROBOTS_PER_MIN} per minute).`, { 'retry-after': '60' });
  if (!memLimit('rb:*', ROBOTS_GLOBAL_PER_MIN, 60_000)) return fail(429, 'busy', 'Robots checks are busy right now.', { 'retry-after': '60' });
  try {
    if (!(await hourlyAllowed(env, bucket))) return fail(429, 'rate_limited', `Too many robots checks from your network (at most ${ROBOTS_PER_HOUR} per hour).`, { 'retry-after': String(secsToNextHour()) });
  } catch {
    return fail(503, 'temporarily_unavailable', 'Robots check is temporarily unavailable.');
  }
  const r = await robotsAllowed(u.toString(), { timeoutMs: ROBOTS_TIMEOUT_MS, ...(doFetch ? { fetchImpl: doFetch } : {}) });
  const body = {
    url: key.length > 600 ? `${key.slice(0, 599)}…` : key,
    robots_url: `${u.origin}/robots.txt`,
    user_agent: BOT_UA,
    verdict: r.kind,
    allowed: r.kind === 'allowed',
    note: r.note,
    checked_at: new Date(now).toISOString(),
    cached: false,
    version: VERSION,
  };
  if (cache.size > 500) cache.clear();
  cache.set(key, { t: now, body });
  if (request) countVisitor(request, env, ctx, ip);
  return { ok: true, body, headers: { 'x-cache': 'MISS' }, cached: false };
}

// daily unique visitors
export const VISITOR_RETENTION_DAYS = 9; // long enough for Monday weekly reports
const DEFAULT_MARKERS = 'fleet-bot,pricemoved-qc,smitherybot,cloudflare-healthchecks,pricemovedbot';
const visitorSeen = new Set();
export const utcDay = (now = Date.now()) => new Date(now).toISOString().slice(0, 10);

export function isExcludedTraffic(request, env) {
  if (request.headers.get('x-fleet-traffic')) return true;
  const ua = (request.headers.get('user-agent') || '').toLowerCase();
  const markers = String(env.FLEET_UA_MARKERS || DEFAULT_MARKERS).toLowerCase().split(',').map((s) => s.trim()).filter(Boolean);
  return markers.some((m) => ua.includes(m));
}

/**
 * Hash(VISITOR_SALT | UTC day | IP bucket) → D1 visitor_daily(day, h). No IP, UA, path or content is stored.
 * Skipped entirely unless the VISITOR_SALT secret is set. Fire-and-forget via ctx.waitUntil.
 */
export function countVisitor(request, env, ctx, ip, now = Date.now()) {
  if (!env.DB || !env.VISITOR_SALT || isExcludedTraffic(request, env)) return undefined;
  const day = utcDay(now);
  const p = (async () => {
    const h = (await sha256hex(`${env.VISITOR_SALT}|${day}|${ipBucket(ip)}`)).slice(0, 16);
    const k = `${day}:${h}`;
    if (visitorSeen.has(k)) return;
    if (visitorSeen.size > 20000) visitorSeen.clear();
    visitorSeen.add(k);
    if (!tablesReady.has('uv')) {
      await env.DB.prepare('CREATE TABLE IF NOT EXISTS visitor_daily (day TEXT NOT NULL, h TEXT NOT NULL, PRIMARY KEY (day, h))').run();
      tablesReady.add('uv');
    }
    await env.DB.prepare('INSERT OR IGNORE INTO visitor_daily (day, h) VALUES (?, ?)').bind(day, h).run();
  })().catch(() => {});
  if (ctx && ctx.waitUntil) ctx.waitUntil(p);
  return p;
}

/** Cron: delete visitor hashes older than VISITOR_RETENTION_DAYS (no-op if the table doesn't exist yet). */
export async function pruneVisitors(env, now = Date.now()) {
  const cutoff = utcDay(now - VISITOR_RETENTION_DAYS * 86400000);
  try { await env.DB.prepare('DELETE FROM visitor_daily WHERE day < ?').bind(cutoff).run(); } catch { /* table not created yet */ }
}
