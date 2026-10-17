/**
 * Agent-ready routes. Called by src/index.ts BEFORE the waitlist gate; returns null for any other path. /mcp, /llms.txt,
 * /openapi.json, /.well-known/mcp/server-card.json, /.well-known/mcp-registry-auth, /.well-known/glama.json,
 * /.well-known/oauth-protected-resource[/mcp] (always 404), /api/product, /api/robots-check.
 */
import { handleMcp, MCP_CORS } from './mcp.js';
import { llmsTxt, openApiSpec, serverCard, GLAMA_CLAIM_JSON } from './agentdocs.js';
import { authenticate, runCheck, memLimit, ipBucket, clientIp, countVisitor } from './core.js';

export const AGENT_PATHS = ['/mcp', '/llms.txt', '/openapi.json', '/.well-known/mcp/server-card.json', '/.well-known/mcp-registry-auth', '/.well-known/glama.json', '/api/product', '/api/robots-check'];
const API_CORS = { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET, HEAD, OPTIONS', 'access-control-allow-headers': 'content-type, accept', 'access-control-expose-headers': 'retry-after, x-cache', 'access-control-max-age': '86400' };
const REGISTRY_PROOF_RE = /^v=MCPv1; k=(ed25519|ecdsap384); p=[A-Za-z0-9+/=]{20,120}$/;

const json = (body, status = 200, extra = {}) => new Response(JSON.stringify(body, null, 2), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-robots-tag': 'noindex', ...extra } });
const apiError = (status, code, message, extra = {}) => json({ error: { code, message } }, status, { ...API_CORS, ...extra });
const doc = (body, type, extra = {}) => new Response(body, { headers: { 'content-type': type, 'cache-control': 'public, max-age=3600', ...extra } });
const onlyGet = (request, allowHeaders = {}) => (request.method === 'GET' ? null
  : request.method === 'OPTIONS' ? new Response(null, { status: 204, headers: { allow: 'GET, HEAD, OPTIONS', ...allowHeaders } })
    : apiError(405, 'method_not_allowed', 'Use GET.', { allow: 'GET, HEAD, OPTIONS' }));

/** @returns {Promise<Response|null>} (HEAD arrives here already converted to GET by src/index.ts) */
export async function handleAgent(request, env, ctx, opts = {}) {
  const url = new URL(request.url);
  const path = url.pathname;
  const ip = clientIp(request);
  const origin = url.origin;
  const counted = opts.isHead ? null : request;

  if (path === '/.well-known/oauth-protected-resource' || path === '/.well-known/oauth-protected-resource/mcp') {
    return json({ error: { code: 'not_found', message: 'No OAuth: this MCP server needs no authorization.' } }, 404);
  }
  if (path === '/mcp') {
    if (request.method === 'POST' && !opts.isHead) countVisitor(request, env, ctx, ip);
    const res = await handleMcp(request, env, ctx, {
      authenticate, runCheck, ip: ipBucket(ip), request, origin, memLimit, security: {}, cors: MCP_CORS, allowedOrigins: env.MCP_ALLOWED_ORIGINS,
    });
    res.headers.set('x-robots-tag', 'noindex');
    return res;
  }
  if (path === '/llms.txt') {
    const m = onlyGet(request); if (m) return m;
    if (counted) countVisitor(counted, env, ctx, ip);
    return doc(llmsTxt(origin), 'text/plain; charset=utf-8');
  }
  if (path === '/openapi.json') {
    const m = onlyGet(request, API_CORS); if (m) return m;
    if (counted) countVisitor(counted, env, ctx, ip);
    return doc(JSON.stringify(openApiSpec(origin), null, 2), 'application/json; charset=utf-8', { 'access-control-allow-origin': '*' });
  }
  if (path === '/.well-known/mcp/server-card.json') {
    const m = onlyGet(request, API_CORS); if (m) return m;
    return doc(JSON.stringify(serverCard(origin), null, 2), 'application/json; charset=utf-8', { 'access-control-allow-origin': '*' });
  }
  if (path === '/.well-known/mcp-registry-auth') {
    // Official MCP Registry HTTP-domain proof. PUBLIC key record only; 404 unless well-formed. Never a redirect.
    const m = onlyGet(request); if (m) return m;
    const proof = String(env.MCP_REGISTRY_AUTH || '').trim();
    if (REGISTRY_PROOF_RE.test(proof)) return new Response(`${proof}\n`, { headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' } });
    return new Response('Not found', { status: 404, headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' } });
  }
  if (path === '/.well-known/glama.json') {
    // Glama connector ownership claim. never a redirect. Not counted as a visitor.
    const m = onlyGet(request); if (m) return m;
    return new Response(GLAMA_CLAIM_JSON, { headers: { 'content-type': 'application/json', 'cache-control': 'public, max-age=3600' } });
  }
  if (path === '/api/product' || path === '/api/robots-check') {
    const m = onlyGet(request, API_CORS); if (m) return m;
    const auth = await authenticate(request, env);
    if (!auth.ok) return apiError(auth.status, auth.code, auth.message, auth.headers);
    const tool = path === '/api/product' ? 'product_info' : 'robots_check';
    const input = tool === 'robots_check' ? { url: url.searchParams.get('url') ?? '' } : {};
    const r = await runCheck({ tool, input, auth, env, ctx, ip, origin, request: counted });
    if (!r.ok) return apiError(r.status, r.code, r.message, r.headers);
    return json(r.body, 200, { ...API_CORS, ...r.headers });
  }
  return null;
}
