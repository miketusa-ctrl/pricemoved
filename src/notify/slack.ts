import type { Env } from "../env";
import { nowIso, uid } from "../env";
import { saveDryRun } from "../dryrun";

export async function sendSlackAlert(
  env: Env,
  opts: {
    webhookUrl: string | null;
    watchUrl: string;
    summary: string;
    changeId: string;
    planAllows: boolean;
  }
): Promise<{ id: string; status: string } | null> {
  if (!opts.planAllows || !opts.webhookUrl) return null;
  const deliveryId = uid("del");
  const payload = { text: `PriceMoved: change on ${opts.watchUrl}\n${opts.summary}` };
  if (env.SLACK_MODE !== "live") {
    await saveDryRun(
      env,
      "slack",
      { webhook: opts.webhookUrl, payload, change_id: opts.changeId, created_at: nowIso() },
      opts.changeId
    );
    await env.DB.prepare(
      "INSERT INTO deliveries (id, change_id, channel, status, detail, created_at) VALUES (?, ?, 'slack', 'dry_run', ?, ?)"
    )
      .bind(deliveryId, opts.changeId, JSON.stringify(payload), nowIso())
      .run();
    return { id: deliveryId, status: "dry_run" };
  }
  const res = await fetch(opts.webhookUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  const status = res.ok ? "sent" : `error_${res.status}`;
  await env.DB.prepare(
    "INSERT INTO deliveries (id, change_id, channel, status, detail, created_at) VALUES (?, ?, 'slack', ?, ?, ?)"
  )
    .bind(deliveryId, opts.changeId, status, await res.text(), nowIso())
    .run();
  return { id: deliveryId, status };
}
