import { BOT_UA } from "../brand";

export const UA = BOT_UA;

/** Product tokens we answer to in robots.txt (RFC 9309 §2.2.1, case-insensitive). Only our own tokens; no pre-rebrand name. */
export const ROBOTS_TOKENS = ["pricemovedbot", "pricemoved"];
/** RFC 9309 §2.5: parse at least the first 500 KiB. this is also the number of body BYTES read; the rest is cancelled. */
export const ROBOTS_MAX_BYTES = 500 * 1024;
/** Exceeding any of them = "too complex" = skip the URL for this run (fail safe, never fetch). */
export const ROBOTS_MAX_RULES = 1000; // rules that apply to us (after group selection)
export const ROBOTS_MAX_PATTERN_LEN = 2048; // chars per Allow/Disallow pattern
export const ROBOTS_MAX_PATH_LEN = 2048; // chars of the URL path + query being checked
// Total work units for one URL: parsing + normalizing + matching. Was 250_000, sized for the Workers free plan's 10 ms
// CPU. Workers Paid (2026-10-03): 1_000_000 so a full 500 KiB robots.txt with realistic line lengths always parses (RFC
// 9309 §2.5) instead of being skipped as "too complex". Still a hard cap: hostile files stay bounded.
export const ROBOTS_MAX_STEPS = 1_000_000;
/** Parsing is charged to the same budget: a fixed cost per line plus 1 step per ROBOTS_PARSE_CHARS_PER_STEP chars. */
export const ROBOTS_PARSE_LINE_COST = 12;
export const ROBOTS_PARSE_CHARS_PER_STEP = 8;
/** Normalizing a pattern costs 1 step per this many chars (charged before matching it). */
export const ROBOTS_NORMALIZE_CHARS_PER_STEP = 4;

export type RobotsRule = { allow: boolean; pattern: string };
export type RobotsGroup = { agents: string[]; rules: RobotsRule[] };

/**
 * RFC 9309 robots.txt check, fetched fresh before every page fetch.
 * - 2xx: parse and evaluate. 4xx: no usable rules, so the URL is allowed.
 * - 5xx or network error: treated as unreachable, so the URL is skipped (full disallow).
 * Redirects are followed.
 */
export type RobotsOutcome = { ok: boolean; note: string; kind: "allowed" | "disallowed" | "skipped" };
/**
 * opts (agent-ready v0.2.0, additive; the monitoring runner passes none, so its behavior is unchanged):
 *  - timeoutMs: abort the robots.txt fetch AND the capped body read after this many ms (→ "skipped").
 *  - fetchImpl: injectable fetch for tests.
 */
export async function robotsAllowed(
  url: string,
  opts: { timeoutMs?: number; fetchImpl?: typeof fetch } = {}
): Promise<RobotsOutcome> {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return { ok: false, kind: "skipped", note: "invalid URL; skipped" };
  }
  const robotsUrl = `${u.origin}/robots.txt`;
  const doFetch = opts.fetchImpl || fetch;
  const signal = opts.timeoutMs ? AbortSignal.timeout(opts.timeoutMs) : undefined;
  let res: Response;
  try {
    res = await doFetch(robotsUrl, { headers: { "User-Agent": UA }, redirect: "follow", ...(signal ? { signal } : {}) });
  } catch (e) {
    return { ok: false, kind: "skipped", note: `robots.txt unreachable (${(e as Error).name}); skipped` };
  }
  // 5xx and 429 (Too Many Requests) = back off: skip this URL for the run.
  if (res.status >= 500 || res.status === 429) return { ok: false, kind: "skipped", note: `robots.txt unreachable (HTTP ${res.status}); skipped` };
  if (res.status >= 400) return { ok: true, kind: "allowed", note: `robots.txt HTTP ${res.status} (unavailable); allowed` };
  if (!res.ok) return { ok: false, kind: "skipped", note: `robots.txt unexpected HTTP ${res.status}; skipped` };
  let body: string;
  try {
    body = await readCapped(res, ROBOTS_MAX_BYTES);
  } catch (e) {
    return { ok: false, kind: "skipped", note: `robots.txt read failed (${(e as Error).name}); skipped` };
  }
  const verdict = evaluateRobots(body, u.pathname + u.search);
  if (verdict.tooComplex) return { ok: false, kind: "skipped", note: `robots.txt too complex (${verdict.tooComplex}); skipped` };
  return { ok: verdict.allowed, kind: verdict.allowed ? "allowed" : "disallowed", note: `robots.txt ok; allowed=${verdict.allowed}` };
}

/**
 * Read at most `maxBytes` of the body (bytes actually read off the stream, not chars after decoding), then
 * cancel the rest. A multi-byte character split at the cap decodes as U+FFFD (harmless for rules).
 */
export async function readCapped(res: Response, maxBytes: number = ROBOTS_MAX_BYTES): Promise<string> {
  if (!res.body) return "";
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (total < maxBytes) {
      const { done, value } = await reader.read();
      if (done || !value) break;
      const take = Math.min(value.byteLength, maxBytes - total);
      chunks.push(take === value.byteLength ? value : value.subarray(0, take));
      total += take;
    }
  } finally {
    try { await reader.cancel(); } catch { /* already closed */ }
  }
  const buf = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) { buf.set(c, off); off += c.byteLength; }
  return new TextDecoder().decode(buf);
}

class StepBudgetExceeded extends Error {}
type Budget = { steps: number };
function charge(budget: Budget, n: number): void {
  budget.steps -= n;
  if (budget.steps < 0) throw new StepBudgetExceeded();
}
const UNBOUNDED = (): Budget => ({ steps: Number.POSITIVE_INFINITY });

type RecordKey = "user-agent" | "allow" | "disallow";
/**
 * One pass over robots.txt, no per-line RegExp. Calls `cb` for User-agent / Allow / Disallow records only
 * (other records such as Sitemap or Crawl-delay are ignored and don't affect grouping, RFC 9309 §2.2.4).
 * Every line is charged to `budget`.
 */
function forEachRecord(txt: string, budget: Budget, cb: (key: RecordKey, val: string) => void): void {
  const handle = (line: string) => {
    const hash = line.indexOf("#");
    if (hash >= 0) line = line.slice(0, hash);
    line = line.trim();
    if (!line) return;
    const colon = line.indexOf(":");
    if (colon <= 0) return;
    const key = line.slice(0, colon).trim().toLowerCase();
    if (key !== "user-agent" && key !== "allow" && key !== "disallow") return;
    cb(key, line.slice(colon + 1).trim());
  };
  const n = txt.length;
  let i = 0;
  while (i < n) {
    let j = txt.indexOf("\n", i);
    if (j < 0) j = n;
    const line = txt.slice(i, j);
    i = j + 1;
    charge(budget, ROBOTS_PARSE_LINE_COST + Math.floor(line.length / ROBOTS_PARSE_CHARS_PER_STEP));
    let cr = line.indexOf("\r");
    if (cr < 0) { handle(line); continue; }
    // CRLF or bare CR line endings: walk the parts lazily, charging each one before it is sliced
    let from = 0;
    for (;;) {
      handle(line.slice(from, cr < 0 ? line.length : cr));
      if (cr < 0) break;
      from = cr + 1;
      cr = line.indexOf("\r", from);
      charge(budget, ROBOTS_PARSE_LINE_COST);
    }
  }
}

/** Group consecutive User-agent lines; rules apply to every agent in the group (RFC 9309 §2.1). */
export function parseRobots(robotsTxt: string, budget: Budget = UNBOUNDED()): RobotsGroup[] {
  const groups: RobotsGroup[] = [];
  let cur: RobotsGroup | null = null;
  let lastWasAgent = false;
  forEachRecord(robotsTxt, budget, (key, val) => {
    if (key === "user-agent") {
      if (!cur || !lastWasAgent) {
        cur = { agents: [], rules: [] };
        groups.push(cur);
      }
      cur.agents.push(val.toLowerCase());
      lastWasAgent = true;
      return;
    }
    lastWasAgent = false;
    if (!cur) return; // rules before any User-agent line are ignored
    if (val === "") return; // empty path matches nothing
    cur.rules.push({ allow: key === "allow", pattern: val });
  });
  return groups;
}

class TooComplex extends Error {}

/**
 * Streaming version of parseRobots + rulesForUs for evaluation: rules of groups that can't apply to us are never
 * stored, "our" rules over the cap stop parsing immediately (our groups always win over "*"), and "*" rules stop
 * being stored once over the cap (only fatal if no group names us).
 */
function collectRulesForUs(robotsTxt: string, budget: Budget): RobotsRule[] {
  const ours: RobotsRule[] = [];
  let star: RobotsRule[] = [];
  let sawOurs = false, starOverflow = false;
  let curOurs = false, curStar = false, lastWasAgent = false;
  forEachRecord(robotsTxt, budget, (key, val) => {
    if (key === "user-agent") {
      if (!lastWasAgent) { curOurs = false; curStar = false; }
      const agent = val.toLowerCase();
      if (agentMatchesUs(agent)) { curOurs = true; sawOurs = true; star = []; }
      if (agent === "*") curStar = true;
      lastWasAgent = true;
      return;
    }
    lastWasAgent = false;
    if (val === "" || (!curOurs && !curStar)) return;
    const rule = { allow: key === "allow", pattern: val };
    if (curOurs) {
      if (ours.length >= ROBOTS_MAX_RULES) throw new TooComplex(`more than ${ROBOTS_MAX_RULES} rules`);
      ours.push(rule);
    } else if (!sawOurs && !starOverflow) {
      if (star.length >= ROBOTS_MAX_RULES) { starOverflow = true; star = []; }
      else star.push(rule);
    }
  });
  if (sawOurs) return ours;
  if (starOverflow) throw new TooComplex(`more than ${ROBOTS_MAX_RULES} rules`);
  return star;
}

function agentMatchesUs(agent: string): boolean {
  const slash = agent.indexOf("/");
  const token = slash < 0 ? agent : agent.slice(0, slash).trimEnd();
  return token === ROBOTS_TOKENS[0] || token === ROBOTS_TOKENS[1];
}

/** Rules that apply to us: all groups naming our token (merged); otherwise all "*" groups (merged). */
export function rulesForUs(groups: RobotsGroup[]): { source: "ours" | "star" | "none"; rules: RobotsRule[] } {
  const ours = groups.filter((g) => g.agents.some(agentMatchesUs));
  if (ours.length) return { source: "ours", rules: ours.flatMap((g) => g.rules) };
  const star = groups.filter((g) => g.agents.includes("*"));
  if (star.length) return { source: "star", rules: star.flatMap((g) => g.rules) };
  return { source: "none", rules: [] };
}

/** True when normalizePath has real work to do (percent-escapes or non-printable/non-ASCII chars). */
const NEEDS_NORMALIZE = /[%\x00-\x20\x7f-\uffff]/;
/** Budget cost of normalizing `p`: cheap scan normally, 1 step per char when escapes must be rewritten. */
function normalizeCost(p: string): number {
  return NEEDS_NORMALIZE.test(p) ? p.length : Math.floor(p.length / ROBOTS_NORMALIZE_CHARS_PER_STEP);
}

const HEX = "0123456789ABCDEF";
const PCT: string[] = Array.from({ length: 256 }, (_, b) => "%" + HEX[b >> 4] + HEX[b & 15]);
/** Budget cost per percent-encoded code point / uppercased escape. */
export const ROBOTS_ENCODE_COST = 6;
function isHexCode(c: number): boolean {
  return (c >= 48 && c <= 57) || (c >= 65 && c <= 70) || (c >= 97 && c <= 102);
}
function pctByte(b: number): string {
  return PCT[b];
}
/** UTF-8 percent-encoding of one code point (same output as encodeURIComponent for chars outside 0x21–0x7E). */
function pctCodePoint(cp: number): string {
  if (cp < 0x80) return pctByte(cp);
  if (cp < 0x800) return pctByte(0xc0 | (cp >> 6)) + pctByte(0x80 | (cp & 63));
  if (cp < 0x10000) return pctByte(0xe0 | (cp >> 12)) + pctByte(0x80 | ((cp >> 6) & 63)) + pctByte(0x80 | (cp & 63));
  return pctByte(0xf0 | (cp >> 18)) + pctByte(0x80 | ((cp >> 12) & 63)) + pctByte(0x80 | ((cp >> 6) & 63)) + pctByte(0x80 | (cp & 63));
}

/**
 * Compare in a consistent percent-encoded form (RFC 9309 §2.2.2); leave reserved characters alone.
 * - "%xx" escapes: hex uppercased.
 * chars outside 0x21–0x7E: UTF-8 percent-encoded (lone surrogates become U+FFFD instead of throwing). one
 * manual pass, no RegExp callbacks, so the cost per char is flat and matches the budget charge.
 */
function normalizePath(p: string, budget?: Budget): string {
  if (!NEEDS_NORMALIZE.test(p)) return p;
  let out = "";
  let run = 0; // start of the current copy-through run
  const n = p.length;
  for (let i = 0; i < n; i++) {
    const c = p.charCodeAt(i);
    if (c === 37 && i + 2 < n && isHexCode(p.charCodeAt(i + 1)) && isHexCode(p.charCodeAt(i + 2))) {
      const a = p.charCodeAt(i + 1), b = p.charCodeAt(i + 2);
      if ((a >= 97 && a <= 102) || (b >= 97 && b <= 102)) {
        if (budget) charge(budget, ROBOTS_ENCODE_COST);
        out += p.slice(run, i) + "%" + p[i + 1].toUpperCase() + p[i + 2].toUpperCase();
        run = i + 3;
      }
      i += 2;
      continue;
    }
    if (c >= 0x21 && c <= 0x7e) continue;
    if (budget) charge(budget, ROBOTS_ENCODE_COST);
    let cp = c, width = 1;
    if (c >= 0xd800 && c <= 0xdbff) {
      const d = i + 1 < n ? p.charCodeAt(i + 1) : 0;
      if (d >= 0xdc00 && d <= 0xdfff) { cp = ((c - 0xd800) << 10) + (d - 0xdc00) + 0x10000; width = 2; }
      else cp = 0xfffd;
    } else if (c >= 0xdc00 && c <= 0xdfff) cp = 0xfffd;
    out += p.slice(run, i) + pctCodePoint(cp);
    i += width - 1;
    run = i + 1;
  }
  return run === 0 ? p : out + p.slice(run);
}

/**
 * Linear-time wildcard match: "*" = any sequence, trailing "$" = end anchor (RFC 9309 §2.2.3). Greedy scan
 * with single backtrack point (classic glob matching): O(path × pattern) worst case, no exponential
 * backtracking. `budget.steps` is decremented per loop iteration; throws when exhausted.
 */
export function patternMatches(pattern: string, path: string, budget: { steps: number } = { steps: ROBOTS_MAX_STEPS }): boolean {
  return matchNormalized(normalizePath(pattern), normalizePath(path), budget);
}

function matchNormalized(normPattern: string, p: string, budget: { steps: number }): boolean {
  // No RegExp and no pre-pass: consecutive "*" are handled by the loop itself (each just moves the backtrack point).
  const STAR = 42; // "*"
  const anchored = normPattern.charCodeAt(normPattern.length - 1) === 36; // trailing "$"
  const plen = anchored ? normPattern.length - 1 : normPattern.length;
  let i = 0, j = 0, star = -1, mark = 0;
  while (i < p.length) {
    if (--budget.steps < 0) throw new StepBudgetExceeded();
    if (j >= plen) {
      if (!anchored) return true; // unanchored = prefix match: pattern consumed
      if (star < 0) return false;
      j = star + 1; i = ++mark;
      continue;
    }
    const c = normPattern.charCodeAt(j);
    if (c === STAR) { star = j++; mark = i; }
    else if (c === p.charCodeAt(i)) { i++; j++; }
    else if (star >= 0) { j = star + 1; i = ++mark; }
    else return false;
  }
  while (j < plen && normPattern.charCodeAt(j) === STAR) j++;
  return j === plen;
}

export type RobotsVerdict = { allowed: boolean; tooComplex?: string };

/**
 * Longest matching pattern wins; on a tie, Allow wins. No matching rule = allowed. /robots.txt is always allowed.
 * Limits (rules / pattern length / path length / step budget) make it fail safe: tooComplex => caller skips the URL.
 */
export function evaluateRobots(robotsTxt: string, path: string): RobotsVerdict {
  if (path === "/robots.txt") return { allowed: true };
  if (path.length > ROBOTS_MAX_PATH_LEN) return { allowed: false, tooComplex: `path longer than ${ROBOTS_MAX_PATH_LEN}` };
  // String callers: same cap in chars (robotsAllowed already capped the bytes read).
  if (robotsTxt.length > ROBOTS_MAX_BYTES) robotsTxt = robotsTxt.slice(0, ROBOTS_MAX_BYTES);
  const budget: Budget = { steps: ROBOTS_MAX_STEPS }; // Parse + normalize + match share one budget
  try {
    const rules = collectRulesForUs(robotsTxt, budget);
    if (rules.some((r) => r.pattern.length > ROBOTS_MAX_PATTERN_LEN)) return { allowed: false, tooComplex: `pattern longer than ${ROBOTS_MAX_PATTERN_LEN}` };
    charge(budget, normalizeCost(path));
    const normPath = normalizePath(path, budget); // once per URL, not per rule
    let best: RobotsRule | null = null;
    let bestLen = -1;
    for (const r of rules) {
      charge(budget, 1 + normalizeCost(r.pattern));
      if (!matchNormalized(normalizePath(r.pattern, budget), normPath, budget)) continue;
      const len = r.pattern.length;
      if (len > bestLen || (len === bestLen && r.allow && best && !best.allow)) {
        best = r;
        bestLen = len;
      }
    }
    return { allowed: best ? best.allow : true };
  } catch (e) {
    if (e instanceof TooComplex) return { allowed: false, tooComplex: e.message };
    if (e instanceof StepBudgetExceeded) return { allowed: false, tooComplex: `parsing + matching exceeded ${ROBOTS_MAX_STEPS} steps` };
    throw e;
  }
}

/** Boolean form: too-complex robots.txt counts as not allowed. */
export function isAllowed(robotsTxt: string, path: string): boolean {
  return evaluateRobots(robotsTxt, path).allowed;
}
