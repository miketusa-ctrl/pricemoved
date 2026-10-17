import type { Env } from "./env";
import { json, redirect } from "./util";
import { legacyHostRedirect } from "./host-redirect";
import { magicLinkAuth } from "./auth/magic-link";
import { googleAuthStub } from "./auth/google-stub";
import {
  clearSessionCookieHeader,
  destroySession,
  getUserFromRequest,
  setUserPlan,
} from "./auth/session";
import { landingPage, handleWaitlist } from "./routes/landing";
import { dashboardPage, historyPage } from "./routes/dashboard";
import {
  createWatch,
  deleteWatch,
  listWatches,
  muteWatch,
  watchHistory,
} from "./routes/watches";
import { createCheckout } from "./polar/checkout";
import { handlePolarWebhook } from "./polar/webhook";
import { forceCheckWatch, runDueChecks, simulateSnapshotEdit } from "./check/runner";
import { latestDryRun } from "./dryrun";
import { isDevEnvironment, isWaitlistMode, launchMode, nowIso } from "./env";
import { privacyPage, termsPage } from "./legal/pages";
import { contentSecurityPolicy } from "./analytics";
import { handleMuteAction, handleUnsubscribeAction } from "./routes/actions";
import { waitlistBlocked } from "./routes/coming-soon";
import { botPage } from "./routes/bot";
import { robotsTxt, sitemapXml } from "./routes/seo";
import { FAVICON_SVG } from "./brand";
import { handleAgent } from "./agent/router.js";
import { countVisitor, pruneVisitors, clientIp } from "./agent/core.js";

/** Daily-unique-visitor counter: public HTML pages only here (agent routes count in src/agent). Never /health. */
const VISITOR_PAGES = new Set(["/", "/privacy", "/terms", "/bot"]);

async function requireUser(env: Env, request: Request) {
  const user = await getUserFromRequest(env, request);
  if (!user) return null;
  return user;
}

/** /bot/, /privacy/, /terms/ → 301 to the path without the slash (query kept). */
const TRAILING_SLASH_PAGES = new Set(["/bot/", "/privacy/", "/terms/"]);

function isWaitlistAllowed(path: string, method: string): boolean {
  if (path === "/health") return true;
  if (path === "/" && method === "GET") return true;
  if (path === "/privacy" && method === "GET") return true;
  if (path === "/terms" && method === "GET") return true;
  if (path === "/bot" && method === "GET") return true;
  if (path === "/favicon.svg" && method === "GET") return true;
  if (path === "/favicon.ico" && method === "GET") return true; // HEAD is served as GET
  if ((path === "/robots.txt" || path === "/sitemap.xml") && method === "GET") return true;
  if (TRAILING_SLASH_PAGES.has(path) && method === "GET") return true;
  if (path === "/api/waitlist" && method === "POST") return true;
  if (path === "/actions/mute" && (method === "GET" || method === "POST")) return true;
  if (path === "/actions/unsubscribe" && (method === "GET" || method === "POST")) return true;
  return false;
}

const SECURITY_HEADERS: Record<string, string> = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
};

function finalize(res: Response, isHead: boolean, env?: Env): Response {
  const headers = new Headers(res.headers);
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) headers.set(k, v);
  // Inline <style>/<script> are used by the landing + legal pages; everything else is same-origin only,
  // plus the two Cloudflare Insights hosts only when WEB_ANALYTICS_TOKEN is set (see src/analytics.ts).
  headers.set("Content-Security-Policy", contentSecurityPolicy(env));
  return new Response(isHead ? null : res.body, { status: res.status, statusText: res.statusText, headers });
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    // HEAD is served exactly like GET (same status + headers), minus the body.
    const isHead = request.method.toUpperCase() === "HEAD";
    const req = isHead ? new Request(request.url, { method: "GET", headers: request.headers }) : request;
    const res = await handle(req, env, ctx, isHead);
    if (!isHead && req.method.toUpperCase() === "GET" && res.status === 200 && VISITOR_PAGES.has(new URL(req.url).pathname)) {
      countVisitor(req, env, ctx, clientIp(req));
    }
    return finalize(res, isHead, env);
  },

  async scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    return scheduledHandler(controller, env, ctx);
  },
};

async function handle(request: Request, env: Env, ctx: ExecutionContext, isHead = false): Promise<Response> {
  {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method.toUpperCase();

    try {
      // Custom-domain cutover: 301 workers.dev (and www) → BASE_URL, keep path+query.
      // No-op while BASE_URL is still *.workers.dev or local.
      const hostRedirect = legacyHostRedirect(request, env);
      if (hostRedirect) return hostRedirect;

      // Agent-ready (v0.2.0): /mcp, /llms.txt, /openapi.json, MCP well-knowns, /api/product, /api/robots-check.
      // Read-only; none of them fetches or diffs pages. Runs before the waitlist gate on purpose.
      const agent = await handleAgent(request, env, ctx, { isHead });
      if (agent) return agent;

      if (TRAILING_SLASH_PAGES.has(path) && method === "GET") {
        return redirect(path.slice(0, -1) + url.search, 301);
      }

      if (path === "/health") {
        return json({
          ok: true,
          app: env.APP_NAME,
          version: env.VERSION,
          deployed_version: env.CF_VERSION_METADATA?.id || null,
          deployed_at: env.CF_VERSION_METADATA?.timestamp || null,
          launch_mode: launchMode(env),
          time: nowIso(),
        });
      }

      // Waitlist mode: only public marketing + waitlist + signed email actions
      if (isWaitlistMode(env) && !isWaitlistAllowed(path, method)) {
        const label =
          path.startsWith("/auth")
            ? "Sign-in"
            : path.startsWith("/app")
              ? "The dashboard"
              : path.includes("checkout") || path.includes("billing")
                ? "Checkout"
                : path.includes("webhook")
                  ? "Billing webhooks"
                  : "This feature";
        return waitlistBlocked(request, label);
      }

      // Legal
      if (path === "/privacy" && method === "GET") return privacyPage(env);
      if (path === "/terms" && method === "GET") return termsPage(env);
      if (path === "/bot" && method === "GET") return botPage(env);
      if (path === "/favicon.ico" && method === "GET") {
        return redirect("/favicon.svg", 301, { "cache-control": "public, max-age=86400" });
      }
      // robots.txt + sitemap.xml built from BASE_URL
      if (path === "/robots.txt" && method === "GET") return robotsTxt(env);
      if (path === "/sitemap.xml" && method === "GET") {
        const sm = sitemapXml(env);
        if (sm) return sm;
      }
      if (path === "/favicon.svg" && method === "GET") {
        return new Response(FAVICON_SVG, { headers: { "content-type": "image/svg+xml; charset=utf-8", "cache-control": "public, max-age=86400" } });
      }

      // Email action links (signed)
      if (path === "/actions/mute" && (method === "GET" || method === "POST")) {
        return handleMuteAction(env, request);
      }
      if (path === "/actions/unsubscribe" && (method === "GET" || method === "POST")) {
        return handleUnsubscribeAction(env, request);
      }

      // Landing + waitlist
      if (path === "/" && method === "GET") return landingPage(env);
      if (path === "/api/waitlist" && method === "POST") return handleWaitlist(env, request);

      // Auth
      if (path === "/auth/login" && method === "GET") return magicLinkAuth.begin(env, request);
      if (path === "/auth/magic/start") return magicLinkAuth.begin(env, request);
      if (path === "/auth/magic/callback") return magicLinkAuth.complete(env, request);
      if (path === "/auth/google") return googleAuthStub.begin(env, request);
      if (path === "/auth/google/callback") return googleAuthStub.complete(env, request);
      if (path === "/auth/logout") {
        await destroySession(env, request);
        return redirect("/", 302, { "Set-Cookie": clearSessionCookieHeader() });
      }

      // Polar webhook (no session)
      if (path === "/webhooks/polar" && method === "POST") {
        return handlePolarWebhook(env, request);
      }

      // Dev/e2e helpers — development only
      if (path.startsWith("/api/dev")) {
        if (!isDevEnvironment(env)) {
          return json({ error: "not_found" }, 404);
        }
      }
      if (path === "/api/dev/dry-run/latest" && method === "GET") {
        const kind = url.searchParams.get("kind") || "emails";
        return json({ ok: true, kind, latest: await latestDryRun(env, kind) });
      }
      if (path === "/api/dev/simulate-change" && method === "POST") {
        const user = await requireUser(env, request);
        if (!user) return json({ error: "unauthorized" }, 401);
        const body = (await request.json()) as { watch_id?: string; line?: string };
        if (!body.watch_id) return json({ error: "watch_id required" }, 400);
        const ok = await simulateSnapshotEdit(
          env,
          body.watch_id,
          body.line || "SIMULATED PRICE CHANGE: Starter now $19/mo (was $15)."
        );
        return json({ ok, watch_id: body.watch_id });
      }
      if (path === "/api/dev/force-check" && method === "POST") {
        const user = await requireUser(env, request);
        if (!user) return json({ error: "unauthorized" }, 401);
        const body = (await request.json()) as { watch_id?: string };
        if (!body.watch_id) return json({ error: "watch_id required" }, 400);
        const result = await forceCheckWatch(env, body.watch_id);
        return json({ ok: true, result });
      }
      if (path === "/api/dev/set-plan" && method === "POST") {
        const user = await requireUser(env, request);
        if (!user) return json({ error: "unauthorized" }, 401);
        const body = (await request.json()) as { plan?: string };
        if (body.plan !== "free" && body.plan !== "starter" && body.plan !== "pro") {
          return json({ error: "invalid plan" }, 400);
        }
        await setUserPlan(env, user.id, body.plan);
        return json({ ok: true, plan: body.plan });
      }

      // App pages
      if (path === "/app" && method === "GET") {
        const user = await requireUser(env, request);
        if (!user) return redirect("/auth/login");
        return dashboardPage(env, user);
      }
      if (path.startsWith("/app/watches/") && method === "GET") {
        const user = await requireUser(env, request);
        if (!user) return redirect("/auth/login");
        const id = path.split("/")[3];
        return historyPage(env, user, id);
      }

      // API watches
      if (path === "/api/watches" && method === "GET") {
        const user = await requireUser(env, request);
        if (!user) return json({ error: "unauthorized" }, 401);
        return listWatches(env, user);
      }
      if (path === "/api/watches" && method === "POST") {
        const user = await requireUser(env, request);
        if (!user) return json({ error: "unauthorized" }, 401);
        const ct = request.headers.get("content-type") || "";
        if (ct.includes("application/x-www-form-urlencoded") || ct.includes("multipart/form-data")) {
          const form = await request.formData();
          const fake = new Request(request.url, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              url: String(form.get("url") || ""),
              interval: String(form.get("interval") || "daily"),
              css_selector: String(form.get("css_selector") || "") || undefined,
            }),
          });
          const res = await createWatch(env, user, fake);
          if (res.status < 300) return redirect("/app");
          return res;
        }
        return createWatch(env, user, request);
      }
      if (path.match(/^\/api\/watches\/[^/]+\/mute$/) && method === "POST") {
        const user = await requireUser(env, request);
        if (!user) return json({ error: "unauthorized" }, 401);
        const id = path.split("/")[3];
        const form = await request.formData();
        const muted = String(form.get("muted") || "1") === "1";
        await muteWatch(env, user, id, muted);
        return redirect("/app");
      }
      if (path.match(/^\/api\/watches\/[^/]+\/delete$/) && method === "POST") {
        const user = await requireUser(env, request);
        if (!user) return json({ error: "unauthorized" }, 401);
        const id = path.split("/")[3];
        await deleteWatch(env, user, id);
        return redirect("/app");
      }
      if (path.match(/^\/api\/watches\/[^/]+\/history$/) && method === "GET") {
        const user = await requireUser(env, request);
        if (!user) return json({ error: "unauthorized" }, 401);
        return watchHistory(env, user, path.split("/")[3]);
      }
      if (path.match(/^\/api\/watches\/[^/]+$/) && method === "DELETE") {
        const user = await requireUser(env, request);
        if (!user) return json({ error: "unauthorized" }, 401);
        return deleteWatch(env, user, path.split("/")[3]);
      }

      // Billing
      if (path === "/api/billing/checkout" && method === "POST") {
        const user = await requireUser(env, request);
        if (!user) return json({ error: "unauthorized" }, 401);
        const ct = request.headers.get("content-type") || "";
        let plan: "starter" | "pro" = "starter";
        if (ct.includes("json")) {
          const body = (await request.json()) as { plan?: string };
          plan = body.plan === "pro" ? "pro" : "starter";
        } else {
          const form = await request.formData();
          plan = String(form.get("plan") || "starter") === "pro" ? "pro" : "starter";
        }
        return createCheckout(env, user, plan);
      }
      if (path === "/api/settings/slack" && method === "POST") {
        const user = await requireUser(env, request);
        if (!user) return json({ error: "unauthorized" }, 401);
        const form = await request.formData();
        const hook = String(form.get("slack_webhook_url") || "").trim() || null;
        await env.DB.prepare("UPDATE users SET slack_webhook_url = ? WHERE id = ?")
          .bind(hook, user.id)
          .run();
        return redirect("/app");
      }

      return json({ error: "not_found", path }, 404);
    } catch (e) {
      return json({ error: "internal", detail: String(e) }, 500);
    }
  }
}


async function scheduledHandler(controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
  {
    if (isWaitlistMode(env)) {
      // Waitlist mode: no page checks, no fetches, no email. Only prune rate-limit hashes older than 24h
      // so the privacy-policy retention statement holds even with no form traffic.
      const cutoff = new Date(Date.now() - 23 * 60 * 60 * 1000).toISOString().slice(0, 13);
      ctx.waitUntil(
        env.DB.prepare("DELETE FROM waitlist_rate WHERE window_id < ?")
          .bind(cutoff)
          .run()
          .then(() => console.log("pagewatch scheduled (waitlist): pruned rate-limit hashes", controller.cron))
          .catch((e) => console.log("pagewatch scheduled (waitlist): prune skipped", String(e)))
      );
      ctx.waitUntil(pruneVisitors(env)); // daily-visitor hashes older than 9 days
      return;
    }
    ctx.waitUntil(
      runDueChecks(env, 20).then((r) => {
        console.log("pagewatch scheduled", controller.cron, JSON.stringify(r));
      })
    );
  }
}
