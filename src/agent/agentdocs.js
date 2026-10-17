/** llms.txt, OpenAPI 3.1 and the MCP server card, generated from code constants. */
import { TOOLS, SUPPORTED_VERSIONS, DISCOVERY_PER_MIN, SERVER_INFO, MAX_BODY_BYTES } from './mcp.js';
import { VERSION, CONTACT } from './version.js';
import { ROBOTS_PER_MIN, ROBOTS_PER_HOUR, ROBOTS_TIMEOUT_MS, MAX_URL_LEN } from './core.js';

export const mcpClientConfig = (origin) => ({ mcpServers: { PriceMoved: { type: 'http', url: `${origin}/mcp` } } });

export const llmsTxt = (origin) => `# PriceMoved

> PriceMoved will watch public competitor pricing pages and send a readable diff plus a short summary when something meaningful changes. It is waitlist-only today: monitoring, sign-in and checkout are not live yet. Small public JSON API plus a remote MCP server for AI agents.

## For AI agents

- [MCP server](${origin}/mcp): remote MCP over Streamable HTTP (POST only, stateless, JSON responses). Protocol versions: ${SUPPORTED_VERSIONS.join(', ')}. Tools: ${TOOLS.map((t) => `\`${t.name}\``).join(', ')} (product_info: no arguments; robots_check: url). Read-only; this server never fetches or diffs pages and cannot join the waitlist for anyone. Client config (most MCP clients accept this; some use a different format, for example VS Code uses a \`servers\` key): \`${JSON.stringify(mcpClientConfig(origin))}\`
- [OpenAPI 3.1 spec](${origin}/openapi.json): machine-readable description of the JSON API

## JSON API

- \`GET ${origin}/api/product\`: product status, planned plans with early USD prices (subject to change), crawler user agent, links. No network calls.
- \`GET ${origin}/api/robots-check?url=https://example.com/pricing\`: fetches that site's robots.txt (at most 500 KiB, ${ROBOTS_TIMEOUT_MS / 1000} s timeout) and reports whether PriceMovedBot may fetch the URL: { url, robots_url, user_agent, verdict: allowed | disallowed | skipped, allowed, note, checked_at, cached, version }. url: http(s), domain names only (no IP addresses or ports), max ${MAX_URL_LEN} characters. Errors: { "error": { "code", "message" } } with 400 invalid_url, 405 method_not_allowed, 429 rate_limited / busy (Retry-After), 503 temporarily_unavailable.
- \`GET ${origin}/health\`: { ok, app, version, deployed_version, deployed_at, launch_mode, time }.

## Limits, keys and pricing

- No key needed. robots_check: about ${ROBOTS_PER_MIN} per minute and ${ROBOTS_PER_HOUR} per hour per network; results are cached for 10 minutes and a cached answer doesn't count. product_info has no per-call limit. The MCP endpoint uses the same engine and counters: each \`tools/call\` is one call. Non-tool MCP messages are capped at about ${DISCOVERY_PER_MIN}/min per IP (HTTP 429 + Retry-After).
- Product pricing (Free / Starter / Pro) is early pricing, subject to change; checkout opens when early access launches. See product_info.

## Optional

- [Privacy](${origin}/privacy)
- [Terms](${origin}/terms)
- [Our crawler (PriceMovedBot)](${origin}/bot)
- Contact: ${CONTACT}
`;

const err = (desc) => ({ description: desc, content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } });
const rpc = (desc) => ({ description: desc, content: { 'application/json': { schema: { type: 'object', description: 'JSON-RPC 2.0 response (or batch array)' } } } });
const notAllowed = (id) => ({ operationId: id, summary: 'Not supported', responses: { 405: { ...err('method_not_allowed'), headers: { Allow: { schema: { type: 'string', const: 'GET, HEAD, OPTIONS' } } } } } });

export function openApiSpec(origin) {
  const [prod, robots] = TOOLS;
  return {
    openapi: '3.1.0',
    info: {
      title: 'PriceMoved', version: VERSION,
      description: `PriceMoved is waitlist-only: monitoring, sign-in and checkout are not live yet. This API returns product facts and checks whether a site's robots.txt allows PriceMovedBot. No key. robots-check: about ${ROBOTS_PER_MIN}/min and ${ROBOTS_PER_HOUR}/hour per network.`,
      contact: { email: CONTACT },
    },
    servers: [{ url: origin }],
    paths: {
      '/api/product': {
        get: { operationId: 'getProduct', summary: 'Product status, early pricing and links', responses: { 200: { description: 'Product info', content: { 'application/json': { schema: prod.outputSchema } } } } },
        post: notAllowed('productPostNotAllowed'),
      },
      '/api/robots-check': {
        get: {
          operationId: 'robotsCheck', summary: 'Does the site\'s robots.txt allow PriceMovedBot to fetch this URL?',
          parameters: [{ name: 'url', in: 'query', required: true, schema: { type: 'string', maxLength: MAX_URL_LEN, pattern: '^https?://' }, description: 'Public http(s) URL (domain names only, no IP addresses or ports)' }],
          responses: {
            200: { description: 'Verdict', headers: { 'X-Cache': { schema: { type: 'string', enum: ['HIT', 'MISS'] } } }, content: { 'application/json': { schema: robots.outputSchema } } },
            400: err('invalid_url'),
            429: { ...err('rate_limited or busy'), headers: { 'Retry-After': { schema: { type: 'string' } } } },
            503: err('temporarily_unavailable'),
          },
        },
        post: notAllowed('robotsCheckPostNotAllowed'),
      },
      '/health': { get: { operationId: 'health', summary: 'Health and version', responses: { 200: { description: 'OK', content: { 'application/json': { schema: { type: 'object', properties: { ok: { type: 'boolean' }, app: { type: 'string' }, version: { type: 'string' }, deployed_version: { type: ['string', 'null'] }, deployed_at: { type: ['string', 'null'] }, launch_mode: { type: 'string' }, time: { type: 'string' } } } } } } } } },
      '/mcp': {
        post: {
          operationId: 'mcp', summary: 'Remote MCP server (JSON-RPC 2.0 over Streamable HTTP, stateless)',
          requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', description: `JSON-RPC 2.0 request, notification or batch (max 10, at most one tools/call; body max ${MAX_BODY_BYTES} bytes)` } } } },
          responses: { 200: rpc('JSON-RPC result'), 202: { description: 'Notification or client response accepted (empty body)' }, 400: rpc('Parse error, invalid request or protocol/header mismatch'), 401: rpc('Reserved (no keys exist today)'), 403: rpc('Origin not allowed'), 404: rpc('Method not found (2026-07-28 requests)'), 413: rpc('Body too large'), 429: rpc('Too many MCP requests (Retry-After)'), 500: { description: 'Internal error' }, 503: { description: 'Temporarily unavailable' } },
        },
        get: { operationId: 'mcpGet', summary: 'Not supported (no SSE stream)', responses: { 405: { description: 'Method not allowed', headers: { Allow: { schema: { type: 'string', const: 'POST, OPTIONS' } } } } } },
        delete: { operationId: 'mcpDelete', summary: 'Not supported (no sessions)', responses: { 405: { description: 'Method not allowed', headers: { Allow: { schema: { type: 'string', const: 'POST, OPTIONS' } } } } } },
      },
    },
    components: {
      schemas: {
        Error: { type: 'object', properties: { error: { type: 'object', properties: { code: { type: 'string', enum: ['invalid_url', 'rate_limited', 'busy', 'method_not_allowed', 'temporarily_unavailable', 'not_found', 'internal_error'] }, message: { type: 'string' } }, required: ['code', 'message'] } }, required: ['error'] },
      },
    },
  };
}

/** SEP-1649-style static server card (Smithery fallback). Tools come from the same TOOLS as tools/list. */
export function serverCard(origin) {
  return {
    serverInfo: { name: SERVER_INFO.name, title: SERVER_INFO.title, version: SERVER_INFO.version },
    description: 'Product facts and early pricing for PriceMoved (waitlist-only pricing-page monitor), plus a robots.txt check for PriceMovedBot.',
    websiteUrl: `${origin}/`,
    transport: { type: 'streamable-http', url: `${origin}/mcp` },
    protocolVersions: SUPPORTED_VERSIONS,
    authentication: { required: false },
    tools: TOOLS.map(({ name, title, description, inputSchema, annotations }) => ({ name, title, description, inputSchema, annotations })),
    resources: [],
    prompts: [],
  };
}

// Glama connector ownership claim, served at /.well-known/glama.json. Replace the placeholder with your own claim token from glama.ai.
export const GLAMA_CLAIM_JSON = '{"$schema":"https://glama.ai/mcp/schemas/connector.json","claim":"<GLAMA_CLAIM_TOKEN>"}';
