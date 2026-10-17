# PriceMoved

Waitlist-stage pricing-page monitor: plans and early pricing, plus a PriceMovedBot robots.txt check.

## Live service

- Web app and API: https://pricemoved.com/
- Pricing: https://pricemoved.com/
- Support: digitalpromohub.support@gmail.com

## Use it from an AI assistant (MCP)

PriceMoved is a remote MCP server (Streamable HTTP) at `https://pricemoved.com/mcp`. Tools: `product_info`, `robots_check`.

Cursor, Cline and Windsurf accept this config:

```json
{
  "mcpServers": {
    "pricemoved": {
      "type": "http",
      "url": "https://pricemoved.com/mcp"
    }
  }
}
```

Claude Desktop: open Settings > Connectors, choose "Add custom connector" and paste `https://pricemoved.com/mcp`. Or, for clients that only support local (stdio) servers, use the mcp-remote bridge: `npx mcp-remote https://pricemoved.com/mcp`.

VS Code uses a `servers` key instead of `mcpServers`.

The `server.json` file is the [MCP Registry](https://registry.modelcontextprotocol.io) manifest for this server.

## Run your own copy

Requires Node.js 22+ and a Cloudflare account.

```bash
npm install
npx wrangler@4 dev      # local dev server
```

`wrangler.toml` is a template: create your own KV namespaces / D1 databases / rate-limit namespaces and replace the `<PLACEHOLDER>` values before `npx wrangler@4 deploy`. Any secrets the Worker reads go in `wrangler secret put` (or `.dev.vars` locally), never in the repo.

Copy `.dev.vars.example` to `.dev.vars` for local development.

## License

MIT (c) Digital Promo Hub. See [LICENSE](LICENSE).
