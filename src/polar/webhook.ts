import type { Env, PlanId } from "../env";
import { nowIso } from "../env";
import { setUserPlan } from "../auth/session";
import { hmacSha256Hex, json, timingSafeEqual } from "../util";
import { planFromProductId } from "./checkout";

export async function verifyPolarSignature(
  env: Env,
  rawBody: string,
  header: string | null
): Promise<boolean> {
  if (!header) return false;
  const provided = header.replace(/^sha256=/i, "").trim();
  const expected = await hmacSha256Hex(env.POLAR_WEBHOOK_SECRET || "", rawBody);
  return timingSafeEqual(provided, expected);
}

interface PolarEvent {
  type?: string;
  data?: {
    id?: string;
    status?: string;
    current_period_end?: string | null;
    product_id?: string;
    customer?: { id?: string; email?: string };
    metadata?: { user_id?: string; plan?: string };
  };
}

export async function handlePolarWebhook(env: Env, request: Request): Promise<Response> {
  const raw = await request.text();
  const sig =
    request.headers.get("webhook-signature") ||
    request.headers.get("x-polar-signature") ||
    request.headers.get("polar-signature");
  const mock = request.headers.get("x-pagewatch-mock") === "1";
  const ok = await verifyPolarSignature(env, raw, sig);

  if (env.POLAR_MODE === "mock") {
    if (!ok && !mock) return json({ error: "invalid_signature" }, 401);
  } else if (!ok) {
    return json({ error: "invalid_signature" }, 401);
  }

  let event: PolarEvent;
  try {
    event = JSON.parse(raw) as PolarEvent;
  } catch {
    return json({ error: "invalid_json" }, 400);
  }

  const type = event.type || "";
  const data = event.data || {};
  let plan: PlanId = "free";
  if (type.includes("canceled") || type.includes("revoked") || data.status === "canceled") {
    plan = "free";
  } else if (data.metadata?.plan === "pro" || data.metadata?.plan === "starter") {
    plan = data.metadata.plan;
  } else {
    plan = planFromProductId(env, data.product_id);
  }

  let uid = data.metadata?.user_id;
  if (!uid && data.customer?.email) {
    const u = await env.DB.prepare("SELECT id FROM users WHERE email = ?")
      .bind(data.customer.email.toLowerCase())
      .first<{ id: string }>();
    uid = u?.id;
  }
  if (!uid) return json({ error: "user_not_found", type }, 404);

  const activeEvent =
    type.includes("subscription.created") ||
    type.includes("subscription.updated") ||
    type.includes("subscription.active") ||
    type === "subscription.created" ||
    type === "subscription.updated";

  const cancelEvent = type.includes("canceled") || type.includes("revoked");

  if (activeEvent) {
    await setUserPlan(env, uid, plan);
    await env.DB.prepare(
      `INSERT INTO subscriptions (user_id, polar_subscription_id, product_id, status, current_period_end)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET
         polar_subscription_id=excluded.polar_subscription_id,
         product_id=excluded.product_id,
         status=excluded.status,
         current_period_end=excluded.current_period_end`
    )
      .bind(uid, data.id || null, data.product_id || null, data.status || "active", data.current_period_end || null)
      .run();
    if (data.customer?.id) {
      await env.DB.prepare("UPDATE users SET polar_customer_id = ? WHERE id = ?")
        .bind(data.customer.id, uid)
        .run();
    }
    return json({ ok: true, user_id: uid, plan, type, handled_at: nowIso() });
  }

  if (cancelEvent) {
    await setUserPlan(env, uid, "free");
    await env.DB.prepare(
      `INSERT INTO subscriptions (user_id, polar_subscription_id, product_id, status, current_period_end)
       VALUES (?, ?, ?, 'canceled', ?)
       ON CONFLICT(user_id) DO UPDATE SET status='canceled', current_period_end=excluded.current_period_end`
    )
      .bind(uid, data.id || null, data.product_id || null, data.current_period_end || null)
      .run();
    return json({ ok: true, user_id: uid, plan: "free", type, handled_at: nowIso() });
  }

  return json({ ok: true, ignored: true, type });
}
