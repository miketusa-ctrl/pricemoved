import type { Env, PlanId } from "../env";
import { PLAN_LIMITS, intervalMs, nowIso, uid } from "../env";
import { robotsAllowed as robotsAllowed } from "./robots";
import { extractMainText, fetchHtml, fingerprint } from "./extract";
import { changeStats, excerpt, isMeaningful, unifiedDiff } from "./diff";
import { summarizeChange } from "./summary";
import { sendAlertEmail } from "../notify/email";
import { sendSlackAlert } from "../notify/slack";

export interface WatchRow {
  id: string;
  user_id: string;
  url: string;
  css_selector: string | null;
  interval: string;
  muted: number;
  last_checked_at: string | null;
  last_changed_at: string | null;
  last_hash: string | null;
}

const hostLocks = new Map<string, Promise<unknown>>();
const hostLastFetch = new Map<string, number>();
export const HOST_MIN_GAP_MS = 5_000;
export const MAX_CHECKS_PER_HOST_PER_RUN = 2;


async function withHostLock<T>(host: string, fn: () => Promise<T>): Promise<T> {
  const prev = hostLocks.get(host) || Promise.resolve();
  let release!: () => void;
  const gate = new Promise<void>((r) => {
    release = r;
  });
  const chained = prev.then(() => gate);
  hostLocks.set(host, chained);
  await prev;
  try {
    return await fn();
  } finally {
    release();
  }
}

function isDue(watch: WatchRow, now = Date.now()): boolean {
  if (watch.muted) return false;
  if (!watch.last_checked_at) return true;
  return now - Date.parse(watch.last_checked_at) >= intervalMs(watch.interval);
}

async function retainSnapshots(env: Env, watchId: string, plan: PlanId): Promise<void> {
  const limits = PLAN_LIMITS[plan];
  const cutoff = new Date(Date.now() - limits.retentionDays * 86400_000).toISOString();
  await env.DB.prepare("DELETE FROM snapshots WHERE watch_id = ? AND created_at < ?")
    .bind(watchId, cutoff)
    .run();
  const rows = await env.DB.prepare(
    "SELECT id FROM snapshots WHERE watch_id = ? ORDER BY created_at DESC"
  )
    .bind(watchId)
    .all<{ id: string }>();
  for (const r of (rows.results || []).slice(limits.maxSnapshots)) {
    await env.DB.prepare("DELETE FROM snapshots WHERE id = ?").bind(r.id).run();
  }
}

export async function checkOneWatch(
  env: Env,
  watch: WatchRow,
  user: { email: string; plan: PlanId; slack_webhook_url: string | null }
): Promise<Record<string, unknown>> {
  let host = "unknown";
  try {
    host = new URL(watch.url).host;
  } catch {
    return { watch_id: watch.id, error: "invalid_url" };
  }

  return withHostLock(host, async () => {
    const last = hostLastFetch.get(host) || 0;
    const wait = Math.max(0, HOST_MIN_GAP_MS - (Date.now() - last));
    await new Promise((r) => setTimeout(r, wait + 250 + Math.floor(Math.random() * 250)));
    hostLastFetch.set(host, Date.now());

    const robots = await robotsAllowed(watch.url);
    if (!robots.ok) {
      await env.DB.prepare("UPDATE watches SET last_checked_at = ? WHERE id = ?")
        .bind(nowIso(), watch.id)
        .run();
      return { watch_id: watch.id, skipped: "robots", note: robots.note };
    }

    const htmlDoc = await fetchHtml(watch.url);
    const text = extractMainText(htmlDoc, watch.css_selector);
    const hash = await fingerprint(text);
    const checkedAt = nowIso();

    const prev = await env.DB.prepare(
      "SELECT hash, text_body FROM snapshots WHERE watch_id = ? ORDER BY created_at DESC LIMIT 1"
    )
      .bind(watch.id)
      .first<{ hash: string; text_body: string | null }>();

    await env.DB.prepare(
      "INSERT INTO snapshots (id, watch_id, hash, text_body, created_at) VALUES (?, ?, ?, ?, ?)"
    )
      .bind(uid("snap"), watch.id, hash, text, checkedAt)
      .run();
    await env.DB.prepare("UPDATE watches SET last_checked_at = ?, last_hash = ? WHERE id = ?")
      .bind(checkedAt, hash, watch.id)
      .run();
    await retainSnapshots(env, watch.id, user.plan);

    if (!prev) return { watch_id: watch.id, baseline: true, hash, robots: robots.note };
    if (prev.hash === hash) return { watch_id: watch.id, changed: false, hash };

    const prevText = prev.text_body || "";
    const diff = unifiedDiff(prevText, text, "previous", "current");
    const stats = changeStats(prevText, text);
    if (!isMeaningful(stats)) {
      return { watch_id: watch.id, changed: true, meaningful: false, stats };
    }

    const { summary, provider } = await summarizeChange(env, watch.url, diff, stats);
    const changeId = uid("chg");
    await env.DB.prepare(
      `INSERT INTO changes (id, watch_id, prev_hash, new_hash, diff_text, summary, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(changeId, watch.id, prev.hash, hash, excerpt(diff, 120), summary, checkedAt)
      .run();
    await env.DB.prepare("UPDATE watches SET last_changed_at = ? WHERE id = ?")
      .bind(checkedAt, watch.id)
      .run();

    const emailRes = await sendAlertEmail(env, {
      to: user.email,
      userId: watch.user_id,
      watchId: watch.id,
      watchUrl: watch.url,
      summary,
      diffExcerpt: excerpt(diff, 60),
      changeId,
    });
    const slackRes = await sendSlackAlert(env, {
      webhookUrl: user.slack_webhook_url,
      watchUrl: watch.url,
      summary,
      changeId,
      planAllows: PLAN_LIMITS[user.plan].slack,
    });

    return {
      watch_id: watch.id,
      changed: true,
      meaningful: true,
      change_id: changeId,
      stats,
      summary_provider: provider,
      email: emailRes,
      slack: slackRes,
    };
  });
}

export async function runDueChecks(env: Env, limit = 20): Promise<Record<string, unknown>> {
  const watches = await env.DB.prepare(
    `SELECT w.*, u.email as user_email, u.plan as user_plan, u.slack_webhook_url as user_slack
     FROM watches w JOIN users u ON u.id = w.user_id
     WHERE w.muted = 0
     ORDER BY w.last_checked_at IS NOT NULL, w.last_checked_at ASC
     LIMIT ?`
  )
    .bind(limit * 3)
    .all<WatchRow & { user_email: string; user_plan: PlanId; user_slack: string | null }>();

  const due = (watches.results || []).filter(isDue);
  const perHost = new Map<string, number>();
  const selected: typeof due = [];
  for (const w of due) {
    let host = "unknown";
    try { host = new URL(w.url).host; } catch { /* */ }
    const n = perHost.get(host) || 0;
    if (n >= MAX_CHECKS_PER_HOST_PER_RUN) continue;
    perHost.set(host, n + 1);
    selected.push(w);
    if (selected.length >= limit) break;
  }
  const results = [];
  for (const w of selected) {
    try {
      results.push(
        await checkOneWatch(env, w, {
          email: w.user_email,
          plan: w.user_plan,
          slack_webhook_url: w.user_slack,
        })
      );
    } catch (e) {
      results.push({ watch_id: w.id, error: String(e) });
      await env.DB.prepare("UPDATE watches SET last_checked_at = ? WHERE id = ?")
        .bind(nowIso(), w.id)
        .run();
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  return { checked: results.length, results };
}

export async function forceCheckWatch(env: Env, watchId: string): Promise<Record<string, unknown>> {
  const row = await env.DB.prepare(
    `SELECT w.*, u.email as user_email, u.plan as user_plan, u.slack_webhook_url as user_slack
     FROM watches w JOIN users u ON u.id = w.user_id WHERE w.id = ?`
  )
    .bind(watchId)
    .first<WatchRow & { user_email: string; user_plan: PlanId; user_slack: string | null }>();
  if (!row) return { error: "not_found" };
  return checkOneWatch(env, row, {
    email: row.user_email,
    plan: row.user_plan,
    slack_webhook_url: row.user_slack,
  });
}

export async function simulateSnapshotEdit(
  env: Env,
  watchId: string,
  injectLine: string
): Promise<boolean> {
  const snap = await env.DB.prepare(
    "SELECT id, text_body FROM snapshots WHERE watch_id = ? ORDER BY created_at DESC LIMIT 1"
  )
    .bind(watchId)
    .first<{ id: string; text_body: string | null }>();
  if (!snap?.text_body) return false;
  const lines = snap.text_body.split("\n");
  // Inject several distinct lines so isMeaningful() treats this as a real change
  // (char_similarity alone can stay high on short pages like example.com).
  const block = [
    injectLine,
    "SIMULATED PLAN TIER: Pro now $49/mo (was $39).",
    "SIMULATED FEATURE FLAG: Slack alerts enabled for all paid seats.",
    "SIMULATED CTA COPY: Start free trial — no credit card required.",
  ];
  lines.splice(Math.min(5, lines.length), 0, ...block);
  await env.DB.prepare("UPDATE snapshots SET text_body = ?, hash = ? WHERE id = ?")
    .bind(lines.join("\n"), "SIMULATED_INVALID_HASH", snap.id)
    .run();
  await env.DB.prepare("UPDATE watches SET last_hash = ? WHERE id = ?")
    .bind("SIMULATED_INVALID_HASH", watchId)
    .run();
  return true;
}
