import type { Env } from "../env";
import { PLAN_LIMITS } from "../env";
import type { User } from "../auth/types";
import { escapeHtml, html } from "../util";

export async function dashboardPage(env: Env, user: User): Promise<Response> {
  const watches = await env.DB.prepare(
    "SELECT * FROM watches WHERE user_id = ? ORDER BY created_at DESC"
  )
    .bind(user.id)
    .all<{
      id: string;
      url: string;
      interval: string;
      muted: number;
      last_checked_at: string | null;
      last_changed_at: string | null;
    }>();

  const rows = (watches.results || [])
    .map((w) => {
      return `<tr>
<td><a href="${escapeHtml(w.url)}" style="color:#6ee7b7">${escapeHtml(w.url)}</a></td>
<td>${escapeHtml(w.interval)}</td>
<td>${w.muted ? "muted" : "active"}</td>
<td class="note">${escapeHtml(w.last_checked_at || "—")}</td>
<td class="note">${escapeHtml(w.last_changed_at || "—")}</td>
<td>
<form style="display:inline" method="POST" action="/api/watches/${w.id}/mute"><button name="muted" value="${w.muted ? "0" : "1"}">${w.muted ? "Unmute" : "Mute"}</button></form>
<a href="/app/watches/${w.id}">History</a>
<form style="display:inline" method="POST" action="/api/watches/${w.id}/delete" onsubmit="return confirm('Delete?')"><button>Delete</button></form>
</td></tr>`;
    })
    .join("");

  const limits = PLAN_LIMITS[user.plan];
  return html(`<!DOCTYPE html><html><head><meta charset="utf-8"/><title>Dashboard — PriceMoved</title>
<style>
body{font-family:system-ui;background:#0b1020;color:#e8ecf7;margin:0;padding:24px}
a{color:#6ee7b7}.note{color:#9aa3b8;font-size:.85rem}
table{width:100%;border-collapse:collapse;margin-top:16px}th,td{border:1px solid #243049;padding:8px;text-align:left;vertical-align:top}
button,input,select{padding:8px;border-radius:8px;border:1px solid #243049;background:#141a2f;color:#e8ecf7}
button{background:#6ee7b7;color:#062016;font-weight:700;border:0;cursor:pointer}
.card{background:#141a2f;border:1px solid #243049;border-radius:12px;padding:16px;margin:16px 0;max-width:720px}
</style></head><body>
<header style="display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap">
<div><h1 style="margin:0">PriceMoved</h1>
<p class="note">${escapeHtml(user.email)} · plan <strong>${escapeHtml(user.plan)}</strong> · ${limits.pages} pages max · intervals: ${limits.intervals.join(", ")}</p></div>
<div><a href="/">Home</a> · <a href="/auth/logout">Log out</a></div>
</header>

<div class="card">
<h2 style="margin-top:0">Add watch</h2>
<form method="POST" action="/api/watches" style="display:grid;gap:8px">
<label>URL <input name="url" type="url" required placeholder="https://example.com/pricing" style="width:100%"/></label>
<label>Interval
<select name="interval">${limits.intervals.map((i) => `<option value="${i}">${i}</option>`).join("")}</select>
</label>
<label>CSS selector (optional) <input name="css_selector" placeholder="main"/></label>
<button type="submit">Add</button>
</form>
</div>

<div class="card">
<h2 style="margin-top:0">Billing</h2>
<p class="note">Polar mock mode locally. Starter $15 / Pro $39 hypotheses.</p>
<p>
<form style="display:inline" method="POST" action="/api/billing/checkout"><input type="hidden" name="plan" value="starter"/><button>Upgrade Starter (mock)</button></form>
<form style="display:inline" method="POST" action="/api/billing/checkout"><input type="hidden" name="plan" value="pro"/><button>Upgrade Pro (mock)</button></form>
</p>
</div>

${
  user.plan === "pro"
    ? `<div class="card"><h2 style="margin-top:0">Slack webhook (Pro)</h2>
<form method="POST" action="/api/settings/slack"><input name="slack_webhook_url" placeholder="https://hooks.slack.com/..." style="width:70%" value="${escapeHtml(user.slack_webhook_url || "")}"/>
<button>Save</button></form><p class="note">Deliveries dry-run locally.</p></div>`
    : ""
}

<h2>Watched pages</h2>
<table><thead><tr><th>URL</th><th>Interval</th><th>Status</th><th>Last check</th><th>Last change</th><th></th></tr></thead>
<tbody>${rows || `<tr><td colspan="6" class="note">No watches yet.</td></tr>`}</tbody></table>
</body></html>`);
}

export async function historyPage(env: Env, user: User, watchId: string): Promise<Response> {
  const watch = await env.DB.prepare("SELECT * FROM watches WHERE id = ? AND user_id = ?")
    .bind(watchId, user.id)
    .first<{ id: string; url: string }>();
  if (!watch) return html("<h1>Not found</h1>", 404);
  const changes = await env.DB.prepare(
    "SELECT id, summary, created_at, diff_text FROM changes WHERE watch_id = ? ORDER BY created_at DESC LIMIT 50"
  )
    .bind(watchId)
    .all<{ id: string; summary: string | null; created_at: string; diff_text: string | null }>();
  const items = (changes.results || [])
    .map(
      (c) => `<article style="border:1px solid #243049;border-radius:10px;padding:12px;margin:12px 0">
<p class="note">${escapeHtml(c.created_at)} · ${escapeHtml(c.id)}</p>
<p>${escapeHtml(c.summary || "")}</p>
<pre style="background:#0d1117;padding:10px;overflow:auto;font-size:12px">${escapeHtml((c.diff_text || "").slice(0, 4000))}</pre>
</article>`
    )
    .join("");
  return html(`<!DOCTYPE html><html><head><meta charset="utf-8"/><title>History</title>
<style>body{font-family:system-ui;background:#0b1020;color:#e8ecf7;padding:24px}.note{color:#9aa3b8}a{color:#6ee7b7}</style></head>
<body><p><a href="/app">← Dashboard</a></p>
<h1>History</h1><p><a href="${escapeHtml(watch.url)}">${escapeHtml(watch.url)}</a></p>
${items || "<p class=note>No changes yet.</p>"}
</body></html>`);
}
