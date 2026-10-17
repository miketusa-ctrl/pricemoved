import { UA } from "./robots";

const BLOCK =
  /<\/?(script|style|noscript|svg|iframe|canvas|template|nav|footer|header|aside|form)(\s[^>]*)?>[\s\S]*?<\/\1>/gi;
const SELF = /<(script|style|noscript|svg|iframe|canvas|template|nav|footer|header|aside|form)(\s[^>]*)?\/>/gi;
const COMMENTS = /<!--[\s\S]*?-->/g;
const TAGS = /<[^>]+>/g;
const EPHEMERAL = [
  /\b\d{1,2}:\d{2}(:\d{2})?\s*(AM|PM|UTC|GMT)?\b/gi,
  /\b20\d{2}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2}(\.\d+)?Z?)?\b/g,
  /\bcsrf[_-]?token\b[=:]\s*\S+/gi,
  /\bnonce\b[=:]\s*\S+/gi,
  /\bsession[_-]?id\b[=:]\s*\S+/gi,
  /\b[0-9a-f]{32,64}\b/gi,
];

export async function fetchHtml(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: {
      "User-Agent": UA,
      Accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.8",
    },
    redirect: "follow",
  });
  if (!res.ok) throw new Error(`fetch failed HTTP ${res.status}`);
  return await res.text();
}

export function extractMainText(html: string, cssSelector?: string | null): string {
  let h = html.replace(COMMENTS, "");
  for (let i = 0; i < 5; i++) h = h.replace(BLOCK, " ");
  h = h.replace(SELF, " ");
  if (cssSelector) {
    const sel = cssSelector.trim();
    let re: RegExp | null = null;
    if (sel.startsWith("#")) {
      re = new RegExp(`id=["']${esc(sel.slice(1))}["'][^>]*>([\\s\\S]*?)<\\/[a-zA-Z]+>`, "i");
    } else if (sel.startsWith(".")) {
      re = new RegExp(`class=["'][^"']*${esc(sel.slice(1))}[^"']*["'][^>]*>([\\s\\S]*?)<\\/[a-zA-Z]+>`, "i");
    } else {
      re = new RegExp(`<${esc(sel)}(\\s[^>]*)?>([\\s\\S]*?)<\\/${esc(sel)}>`, "i");
    }
    const m = h.match(re);
    if (m) h = m[m.length - 1];
  } else {
    const main = h.match(/<main(\s[^>]*)?>([\s\S]*?)<\/main>/i);
    const article = h.match(/<article(\s[^>]*)?>([\s\S]*?)<\/article>/i);
    const body = h.match(/<body(\s[^>]*)?>([\s\S]*?)<\/body>/i);
    h = (main && main[2]) || (article && article[2]) || (body && body[2]) || h;
  }
  let text = h
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|tr|h[1-6])>/gi, "\n")
    .replace(TAGS, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"');
  return normalizeText(text);
}

function esc(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function normalizeText(text: string): string {
  const lines: string[] = [];
  for (let line of text.split(/\r?\n/)) {
    line = line.replace(/[ \t\u00a0]+/g, " ").trim();
    if (!line) continue;
    for (const pat of EPHEMERAL) line = line.replace(pat, " ");
    line = line.replace(/\s{2,}/g, " ").trim();
    if (line) lines.push(line);
  }
  const out: string[] = [];
  let prev: string | null = null;
  for (const ln of lines) {
    if (ln !== prev) out.push(ln);
    prev = ln;
  }
  return out.join("\n");
}

export async function fingerprint(text: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
