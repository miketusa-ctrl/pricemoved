import type { Env } from "../env";
import { nowIso, operatorName, requireMailingAddressForEmail, uid } from "../env";
import { saveDryRun } from "../dryrun";
import { escapeHtml } from "../util";
import { makeActionToken } from "../tokens/signed";

export async function sendAlertEmail(
  env: Env,
  alert: {
    to: string;
    userId: string;
    watchId: string;
    watchUrl: string;
    summary: string;
    diffExcerpt: string;
    changeId: string;
  }
): Promise<{ id: string; status: string }> {
  let host = alert.watchUrl;
  try {
    host = new URL(alert.watchUrl).host;
  } catch {
    /* keep */
  }

  const muteTok = await makeActionToken(env, "mute", { userId: alert.userId, watchId: alert.watchId });
  const unsubTok = await makeActionToken(env, "unsubscribe", { userId: alert.userId });
  const muteUrl = `${env.BASE_URL}/actions/mute?token=${muteTok}`;
  const unsubUrl = `${env.BASE_URL}/actions/unsubscribe?token=${unsubTok}`;
  const unsubOneClick = `${env.BASE_URL}/actions/unsubscribe?token=${unsubTok}&one_click=1`;

  const addr = requireMailingAddressForEmail(env);
  const subject = `[PriceMoved] Change detected on ${host}`;
  const text = `PriceMoved alert

Change detected on: ${alert.watchUrl}
Checked at: ${nowIso()}

Summary
-------
${alert.summary}

Diff excerpt
------------
${alert.diffExcerpt}

Open page: ${alert.watchUrl}
Dashboard: ${env.BASE_URL}/app
Mute this watch: ${muteUrl}
Unsubscribe from alerts: ${unsubUrl}

${operatorName(env)}${addr ? `\n${addr}` : ""}

— PriceMoved
`;

  const htmlBody = `<!DOCTYPE html><html><body style="font-family:system-ui;max-width:680px;margin:0 auto;padding:24px;color:#111">
<h1 style="font-size:20px">PriceMoved — change detected</h1>
<p><a href="${escapeHtml(alert.watchUrl)}">${escapeHtml(alert.watchUrl)}</a></p>
<h2 style="font-size:16px">Summary</h2>
<p style="background:#f6f8fa;padding:12px;border-radius:8px">${escapeHtml(alert.summary)}</p>
<h2 style="font-size:16px">Diff excerpt</h2>
<pre style="background:#0d1117;color:#e6edf3;padding:14px;border-radius:8px;overflow:auto;font-size:12px;white-space:pre-wrap">${escapeHtml(alert.diffExcerpt)}</pre>
<p>
<a href="${escapeHtml(env.BASE_URL)}/app">Dashboard</a> ·
<a href="${escapeHtml(muteUrl)}">Mute this watch</a> ·
<a href="${escapeHtml(unsubUrl)}">Unsubscribe</a>
</p>
<p style="font-size:12px;color:#666">${escapeHtml(operatorName(env))}${addr ? `<br/>${escapeHtml(addr)}` : ""}</p>
</body></html>`;

  const deliveryId = uid("del");
  const headersExtra = {
    "List-Unsubscribe": `<${unsubOneClick}>`,
    "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
  };

  // Log mode for operators; never put EMAIL_MODE in customer-visible body.
  console.log("pagewatch email", { mode: env.EMAIL_MODE, to: alert.to, changeId: alert.changeId });

  if (env.EMAIL_MODE !== "live" || !env.RESEND_API_KEY) {
    await saveDryRun(
      env,
      "emails",
      {
        to: alert.to,
        subject,
        text,
        html: htmlBody,
        headers: headersExtra,
        change_id: alert.changeId,
        mute_url: muteUrl,
        unsubscribe_url: unsubUrl,
        created_at: nowIso(),
      },
      alert.changeId
    );
    await env.DB.prepare(
      "INSERT INTO deliveries (id, change_id, channel, status, detail, created_at) VALUES (?, ?, 'email', 'dry_run', ?, ?)"
    )
      .bind(deliveryId, alert.changeId, subject, nowIso())
      .run();
    return { id: deliveryId, status: "dry_run" };
  }

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, "content-type": "application/json" },
    body: JSON.stringify({
      from: "PriceMoved <onboarding@resend.dev>",
      to: [alert.to],
      subject,
      text,
      html: htmlBody,
      headers: headersExtra,
    }),
  });
  const status = res.ok ? "sent" : `error_${res.status}`;
  await env.DB.prepare(
    "INSERT INTO deliveries (id, change_id, channel, status, detail, created_at) VALUES (?, ?, 'email', ?, ?, ?)"
  )
    .bind(deliveryId, alert.changeId, status, await res.text(), nowIso())
    .run();
  return { id: deliveryId, status };
}
