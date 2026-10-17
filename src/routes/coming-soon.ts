import { html, json } from "../util";
import { BRAND_NAME, FAVICON_LINK } from "../brand";

/** Real (future) app routes: friendly page with 200. Everything else unknown: same page with 404. */
export function isAppRoute(path: string): boolean {
  return (
    path === "/app" ||
    path.startsWith("/app/") ||
    path === "/login" ||
    path === "/dashboard" ||
    path === "/checkout"
  );
}

/** API / JSON surfaces never get the HTML page. */
function isApiPath(path: string): boolean {
  return path.startsWith("/api/") || path === "/api" || path.startsWith("/webhooks/") || path === "/webhooks";
}

export function comingSoonPage(feature = "This feature", status = 200): Response {
  const heading = status === 200 ? "Coming soon" : "Page not found";
  const text =
    status === 200
      ? `${feature} isn’t available yet — ${BRAND_NAME} is on a waitlist-only launch.`
      : `There’s nothing here. ${BRAND_NAME} is on a waitlist-only launch.`;
  return html(
    `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<meta name="robots" content="noindex"/>
${FAVICON_LINK}
<title>${heading} — ${BRAND_NAME}</title>
<style>body{font-family:system-ui;background:#0b1020;color:#e8ecf7;margin:0}
.wrap{max-width:560px;margin:0 auto;padding:64px 20px}a{color:#6ee7b7}.note{color:#9aa3b8}</style>
</head><body><div class="wrap">
<h1>${heading}</h1>
<p>${text}</p>
<p class="note"><a href="/#waitlist">Join the waitlist</a> · <a href="/">Home</a></p>
</div></body></html>`,
    status,
    { "X-Robots-Tag": "noindex" }
  );
}

export function waitlistBlocked(request: Request, featureLabel: string): Response {
  const path = new URL(request.url).pathname;
  const accept = request.headers.get("accept") || "";
  const m = request.method.toUpperCase();
  const wantsHtml = (m === "GET" || m === "HEAD") && accept.includes("text/html") && !isApiPath(path);
  if (wantsHtml) return comingSoonPage(featureLabel, isAppRoute(path) ? 200 : 404);
  return json({ error: "not_found", launch_mode: "waitlist" }, 404);
}
