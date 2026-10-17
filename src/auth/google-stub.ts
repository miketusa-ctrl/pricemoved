import type { Env } from "../env";
import { html, json } from "../util";
import type { AuthProvider } from "./types";

export const googleAuthStub: AuthProvider = {
  name: "google_oauth_stub",
  async begin(env) {
    const configured = !!(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET);
    if (!configured) {
      return html(`<!DOCTYPE html><html><head><meta charset="utf-8"/><title>Google OAuth stub</title>
<style>body{font-family:system-ui;max-width:560px;margin:48px auto;padding:0 16px;background:#0b1020;color:#e8ecf7}
a{color:#6ee7b7}</style></head><body>
<h1>Google OAuth (stub)</h1>
<p>Not configured. Optional later: <code>GOOGLE_CLIENT_ID</code> + <code>GOOGLE_CLIENT_SECRET</code>.</p>
<p>Redirect URI: <code>${env.BASE_URL}/auth/google/callback</code></p>
<p><strong>Launch fallback:</strong> magic-link needs no Google setup.</p>
<p><a href="/auth/login">← Magic link</a></p></body></html>`);
    }
    return json({ error: "google_oauth_not_implemented", message: "Use magic link." }, 501);
  },
  async complete() {
    return json({ error: "google_oauth_stub" }, 501);
  },
};
