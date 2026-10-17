import type { Env, LaunchMode } from "../env";
import { contactEmail, launchMode, operatorName } from "../env";
import { LANDING_CONTENT, type LandingContent } from "./content-data";
import { BRAND_NAME, FAVICON_LINK, canonicalOrigin, canonicalTags } from "../brand";
import { analyticsTag } from "../analytics";

/** Agent-ready: MCP config shown on the homepage. Must equal llms.txt / README (tests). */
export function mcpConfigJson(origin: string): string {
  return JSON.stringify({ mcpServers: { PriceMoved: { type: "http", url: `${origin}/mcp` } } }, null, 2);
}

function esc(s: string): string {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const DESCRIPTION =
  "Waitlist: watch public competitor pricing pages and get a readable diff and short summary by email (Slack on Pro).";

export type RenderOpts = {
  mode: LaunchMode;
  contactEmail: string;
  operatorName?: string;
  formAction?: string;
  /** Canonical origin source (env.BASE_URL). Empty = no canonical/og:url tags. */
  baseUrl?: string;
  /** Cloudflare Web Analytics site token (public). Empty/invalid = no beacon. */
  analyticsToken?: string;
};

export function renderLandingHtml(c: LandingContent, opts: RenderOpts): string {
  const mode = opts.mode;
  const agentOrigin = canonicalOrigin(opts.baseUrl); // "" → relative /mcp; the inline script fills in location.origin
  const waitlist = mode === "waitlist";
  const formAction = opts.formAction || "/api/waitlist";
  const pricingNote = waitlist
    ? c.pricingNoteWaitlist || c.pricingNote
    : c.pricingNoteFull || c.pricingNote;

  const benefits = c.benefits
    .map((b) => `<div class="card"><h3>${esc(b.title)}</h3><p>${esc(b.body)}</p></div>`)
    .join("\n");
  const how = c.how.map((h) => `<li>${esc(h)}</li>`).join("\n");
  const planRows = c.plans.rows
    .map((r) => `<tr>${r.map((cell) => `<td>${esc(cell)}</td>`).join("")}</tr>`)
    .join("\n");
  const planHead = `<tr>${c.plans.headers.map((h) => `<th>${esc(h)}</th>`).join("")}</tr>`;
  const faq = c.faq
    .map((f) => `<details><summary>${esc(f.q)}</summary><p>${esc(f.a)}</p></details>`)
    .join("\n");

  // Plan CTA row: waitlist → all Join waitlist; full → Sign in / checkout labels
  const planCtas = waitlist
    ? `<tr><td></td><td colspan="3" style="text-align:center"><a class="plan-cta" href="#waitlist">Join the waitlist</a></td></tr>`
    : `<tr><td></td>
<td><a class="plan-cta" href="/auth/login">Start free</a></td>
<td><form method="POST" action="/api/billing/checkout" style="display:inline"><input type="hidden" name="plan" value="starter"/><button type="submit" class="plan-cta-btn">Upgrade — Starter</button></form></td>
<td><form method="POST" action="/api/billing/checkout" style="display:inline"><input type="hidden" name="plan" value="pro"/><button type="submit" class="plan-cta-btn">Upgrade — Pro</button></form></td>
</tr>`;

  const secondaryCta = waitlist
    ? ""
    : `<a class="cta secondary" href="${esc(c.secondaryCta.href)}">${esc(c.secondaryCta.label)}</a>`;

  const form = `<form id="waitlist-form" method="POST" action="${esc(formAction)}" style="display:flex;gap:8px;flex-wrap:wrap;align-items:flex-start;margin-top:12px">
<input type="email" name="email" required placeholder="you@company.com" aria-label="Email" autocomplete="email"/>
<!-- honeypot: leave empty -->
<input type="text" name="website" value="" tabindex="-1" autocomplete="off" aria-hidden="true" style="position:absolute;left:-10000px;top:auto;width:1px;height:1px;overflow:hidden"/>
<input type="hidden" name="src" value=""/>
<button type="submit">${esc(c.primaryCta.label)}</button>
</form>
<p id="waitlist-msg" class="note" role="status" aria-live="polite" style="display:none;margin-top:10px;color:var(--accent)"></p>
<p class="note consent">${esc(c.consent || "").replace(/\{CONTACT_EMAIL\}/g, `<a href="mailto:${esc(opts.contactEmail)}">${esc(opts.contactEmail)}</a>`)} <a href="/privacy">Privacy</a> · <a href="/terms">Terms</a>.</p>
<script>
(function(){
  // MCP config (#agents is rendered after this script): fill it once the document is parsed.
  if(document.addEventListener) document.addEventListener("DOMContentLoaded", function(){
    var mc=document.getElementById("mcp-config");
    if(mc) mc.textContent=JSON.stringify({ mcpServers: { PriceMoved: { type: "http", url: location.origin + "/mcp" } } }, null, 2);
  });
  var form=document.getElementById("waitlist-form");
  var msg=document.getElementById("waitlist-msg");
  if(!form||!msg) return;
  // Campaign tag from ?src= (launch links). Exact allowlist; anything else stays empty and the server stores "direct".
  try {
    var m=/[?&]src=([^&#]*)/.exec(location.search||"");
    var s=m?decodeURIComponent(m[1].split("+").join(" ")):"";
    if(["x","bsky","threads","li","ih"].indexOf(s)>=0 && form.elements["src"]) form.elements["src"].value=s;
  } catch(e) {}
  form.addEventListener("submit", function(ev){
    if(!(window.fetch)) return;
    ev.preventDefault();
    var fd=new FormData(form);
    fetch(form.action, { method:"POST", headers:{ "accept":"application/json" }, body: fd })
      .then(function(r){ return r.json().then(function(j){ return { ok:r.ok, status:r.status, j:j }; }); })
      .then(function(x){
        msg.style.display="block";
        if(x.ok && x.j && x.j.ok){
          msg.textContent = x.j.already ? ("You're already on the list ("+(x.j.email||"")+").") : ("You're on the list — we'll be in touch ("+(x.j.email||"")+"). No confirmation email is sent yet.");
          form.reset();
        } else if(x.status===429){
          msg.textContent = (x.j && x.j.error) || "Too many attempts. Try again later.";
        } else {
          msg.textContent = (x.j && x.j.error) || "Could not join. Check your email and try again.";
        }
      })
      .catch(function(){ msg.style.display="block"; msg.textContent="Network error. Try again."; });
  });
})();
</script>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>${BRAND_NAME} — Know when competitors change pricing</title>
<meta name="description" content="${esc(DESCRIPTION)}"/>
${FAVICON_LINK}
<link rel="alternate" type="text/plain" href="/llms.txt" title="llms.txt"/>
<link rel="service-desc" type="application/json" href="/openapi.json" title="OpenAPI 3.1"/>
${canonicalTags(opts.baseUrl, "/", `${BRAND_NAME} — Know when competitors change pricing`, DESCRIPTION)}
<meta name="launch-mode" content="${esc(mode)}"/>
<style>
:root{--bg:#0b1020;--card:#141a2f;--text:#e8ecf7;--muted:#9aa3b8;--accent:#6ee7b7;--line:#243049}
*{box-sizing:border-box}body{margin:0;font-family:ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:var(--bg);color:var(--text);line-height:1.55}
a{color:var(--accent)}.wrap{max-width:920px;margin:0 auto;padding:48px 20px 80px}
h1{font-size:clamp(1.8rem,4vw,2.6rem);line-height:1.15;margin:0 0 12px}
.sub{font-size:1.15rem;color:var(--muted);max-width:40rem}
.cta{display:inline-block;margin-top:24px;background:var(--accent);color:#062016;font-weight:700;text-decoration:none;padding:12px 18px;border-radius:10px}
.cta.secondary{background:transparent;color:var(--accent);border:1px solid var(--accent);margin-left:10px}
.grid{display:grid;gap:14px;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));margin:40px 0}
.card{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:16px 18px}
.card h3{margin:0 0 8px;font-size:1rem}.card p{margin:0;color:var(--muted);font-size:.95rem}
table{width:100%;border-collapse:collapse;margin:16px 0 8px;font-size:.95rem}
th,td{border:1px solid var(--line);padding:10px 12px;text-align:left}th{background:var(--card)}
.note{color:var(--muted);font-size:.85rem}.consent{max-width:40rem}
a[href^="mailto:"]{overflow-wrap:anywhere}
ol.how{color:var(--muted)}details{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:10px 14px;margin:8px 0}
summary{cursor:pointer;font-weight:600}
input,button{padding:10px;border-radius:8px;border:1px solid var(--line);background:#0f1528;color:var(--text)}
button{background:var(--accent);color:#062016;font-weight:700;border:0;cursor:pointer}
footer{margin-top:48px;color:var(--muted);font-size:.85rem}
.wedge{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:18px;margin:28px 0}
pre{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:12px;overflow-x:auto;font-size:.85rem}
@media (max-width:560px){#mcp-config{white-space:pre-wrap;word-break:break-all}}
a.plan-cta,.plan-cta-btn{display:inline-block;background:var(--accent);color:#062016;font-weight:700;text-decoration:none;padding:8px 12px;border-radius:8px;border:0;cursor:pointer;font-size:.9rem}
</style>
</head>
<body>
<div class="wrap">
${c.badge ? `<p class="note">${esc(c.badge)}</p>
` : ""}<h1>${esc(c.hero)}</h1>
<p class="sub">${esc(c.subhead)}</p>
<p>
<a class="cta" href="${esc(c.primaryCta.href)}">${esc(c.primaryCta.label)}</a>
${secondaryCta}
</p>
<div class="grid" aria-label="Benefits">
${benefits}
</div>
<h2>${esc(waitlist ? c.howHeading || "How it will work" : "How it works")}</h2>
<ol class="how">${how}</ol>
<section class="wedge" id="why-simple">
<h2>${esc(c.wedgeTitle)}</h2>
<p>${esc(c.wedgeBody)}</p>
<p class="note">${esc(c.wedgeNote)}</p>
</section>
<h2 id="pricing">${esc(c.pricingHeading)}</h2>
<p class="note">${esc(pricingNote)}</p>
<table><thead>${planHead}</thead><tbody>${planRows}${planCtas}</tbody></table>
<h2>FAQ</h2>
${faq}
<h2 id="waitlist">${esc(c.waitlistTitle)}</h2>
<p class="sub">${esc(c.waitlistBlurb)}</p>
${form}
<section id="agents"><h2>For agents (MCP)</h2>
<p class="note">${BRAND_NAME} is also a small remote <a href="https://modelcontextprotocol.io/" target="_blank" rel="noopener noreferrer">Model Context Protocol</a> (MCP) server. It can tell an assistant about the plans above and check whether a site’s robots.txt allows PriceMovedBot. It doesn’t monitor pages or join the waitlist for you. Most MCP clients accept this config; some use a different format (for example, VS Code uses a <code>servers</code> key). Clients with a settings screen just need the URL <code>${esc(agentOrigin)}/mcp</code>.</p>
<pre><code id="mcp-config">${esc(mcpConfigJson(agentOrigin))}</code></pre>
<p class="note">Machine-readable docs: <a href="/llms.txt">llms.txt</a> · <a href="/openapi.json">OpenAPI 3.1 spec</a></p></section>
<footer>${c.footer.replace(/\{OPERATOR_NAME\}/g, esc(opts.operatorName || BRAND_NAME))}</footer>
</div>
${analyticsTag({ WEB_ANALYTICS_TOKEN: opts.analyticsToken })}</body>
</html>`;
}

export function landingHtmlForEnv(env: Env): string {
  return renderLandingHtml(LANDING_CONTENT, {
    mode: launchMode(env),
    contactEmail: contactEmail(env),
    operatorName: operatorName(env),
    baseUrl: env.BASE_URL,
    analyticsToken: env.WEB_ANALYTICS_TOKEN,
  });
}
