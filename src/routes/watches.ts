import type { Env } from "../env";
import { PLAN_LIMITS, nowIso, uid, type PlanId } from "../env";
import type { User } from "../auth/types";
import { json } from "../util";

export async function listWatches(env: Env, user: User): Promise<Response> {
  const rows = await env.DB.prepare(
    "SELECT * FROM watches WHERE user_id = ? ORDER BY created_at DESC"
  )
    .bind(user.id)
    .all();
  return json({ ok: true, plan: user.plan, limits: PLAN_LIMITS[user.plan], watches: rows.results || [] });
}

export async function createWatch(env: Env, user: User, request: Request): Promise<Response> {
  const body = (await request.json()) as { url?: string; interval?: string; css_selector?: string };
  const url = (body.url || "").trim();
  const interval = (body.interval || "daily").trim();
  const css = body.css_selector?.trim() || null;
  if (!url.startsWith("http://") && !url.startsWith("https://")) {
    return json({ error: "url must be http(s)" }, 400);
  }
  const limits = PLAN_LIMITS[user.plan as PlanId];
  if (!limits.intervals.includes(interval)) {
    return json({ error: "interval_not_allowed", allowed: limits.intervals, plan: user.plan }, 403);
  }
  const count = await env.DB.prepare("SELECT COUNT(*) as c FROM watches WHERE user_id = ?")
    .bind(user.id)
    .first<{ c: number }>();
  if ((count?.c || 0) >= limits.pages) {
    return json({ error: "page_limit", limit: limits.pages, plan: user.plan }, 403);
  }
  const id = uid("watch");
  await env.DB.prepare(
    `INSERT INTO watches (id, user_id, url, css_selector, interval, muted, created_at)
     VALUES (?, ?, ?, ?, ?, 0, ?)`
  )
    .bind(id, user.id, url, css, interval, nowIso())
    .run();
  return json({ ok: true, watch: { id, url, interval, css_selector: css, muted: 0 } }, 201);
}

export async function muteWatch(env: Env, user: User, watchId: string, muted: boolean): Promise<Response> {
  const r = await env.DB.prepare("UPDATE watches SET muted = ? WHERE id = ? AND user_id = ?")
    .bind(muted ? 1 : 0, watchId, user.id)
    .run();
  if (!r.meta.changes) return json({ error: "not_found" }, 404);
  return json({ ok: true, id: watchId, muted });
}

export async function deleteWatch(env: Env, user: User, watchId: string): Promise<Response> {
  const owned = await env.DB.prepare("SELECT id FROM watches WHERE id = ? AND user_id = ?")
    .bind(watchId, user.id)
    .first<{ id: string }>();
  if (!owned) return json({ error: "not_found" }, 404);
  // Child tables reference watches(id) without ON DELETE CASCADE — clear them first.
  const changeIds = await env.DB.prepare("SELECT id FROM changes WHERE watch_id = ?")
    .bind(watchId)
    .all<{ id: string }>();
  for (const c of changeIds.results || []) {
    await env.DB.prepare("DELETE FROM deliveries WHERE change_id = ?").bind(c.id).run();
  }
  await env.DB.prepare("DELETE FROM changes WHERE watch_id = ?").bind(watchId).run();
  await env.DB.prepare("DELETE FROM snapshots WHERE watch_id = ?").bind(watchId).run();
  await env.DB.prepare("DELETE FROM watches WHERE id = ? AND user_id = ?").bind(watchId, user.id).run();
  return json({ ok: true, deleted: watchId });
}

export async function watchHistory(env: Env, user: User, watchId: string): Promise<Response> {
  const watch = await env.DB.prepare("SELECT * FROM watches WHERE id = ? AND user_id = ?")
    .bind(watchId, user.id)
    .first();
  if (!watch) return json({ error: "not_found" }, 404);
  const changes = await env.DB.prepare(
    "SELECT id, prev_hash, new_hash, summary, created_at FROM changes WHERE watch_id = ? ORDER BY created_at DESC LIMIT 50"
  )
    .bind(watchId)
    .all();
  return json({ ok: true, watch, changes: changes.results || [] });
}
