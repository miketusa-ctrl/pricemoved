import type { Env, PlanId } from "../env";
import { json } from "../util";
import type { User } from "../auth/types";

export function productIdForPlan(env: Env, plan: "starter" | "pro"): string {
  return plan === "pro" ? (env.POLAR_PRO_PRODUCT_ID || "") : (env.POLAR_STARTER_PRODUCT_ID || "");
}

export async function createCheckout(env: Env, user: User, plan: "starter" | "pro"): Promise<Response> {
  const productId = productIdForPlan(env, plan);
  if (env.POLAR_MODE === "mock") {
    const url = `${env.BASE_URL}/billing/mock-checkout?plan=${plan}&user=${user.id}&product=${productId}`;
    return json({
      ok: true,
      mode: "mock",
      checkout_url: url,
      product_id: productId,
      message: "Polar mock checkout — complete via signed webhook fixture.",
    });
  }
  const res = await fetch("https://api.polar.sh/v1/checkouts/custom/", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.POLAR_ACCESS_TOKEN}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      product_id: productId,
      success_url: `${env.BASE_URL}/app?checkout=success`,
      customer_email: user.email,
      metadata: { user_id: user.id, plan },
    }),
  });
  if (!res.ok) return json({ error: "polar_checkout_failed", detail: await res.text() }, 502);
  const data = (await res.json()) as { url?: string; id?: string };
  return json({ ok: true, mode: "live", checkout_url: data.url, checkout_id: data.id });
}

export function planFromProductId(env: Env, productId: string | null | undefined): PlanId {
  if (!productId) return "free";
  if (productId === env.POLAR_PRO_PRODUCT_ID || productId.includes("pro")) return "pro";
  if (productId === env.POLAR_STARTER_PRODUCT_ID || productId.includes("starter")) return "starter";
  return "free";
}
