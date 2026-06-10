import { extractBearer, resolveKey, Tier } from "./auth";
import { checkAndIncrement, quotaErrorResponse } from "./billing";
import { McpServer, ToolContext, isJsonRpcRequest } from "./mcp-server";
import { handleUpgrade, handleAccount, handleAccountRotate, handleWelcome, handleAccountExport, handleAccountDelete, handleSupportPage, handleSupportSubmit, handleFavicon, buildSocialMeta, handleTeamList, handleTeamInvite, handleTeamRevoke, handleTeamAccept } from "./checkout";
import { handleDodoWebhook } from "./webhook";
import { buildTools } from "./tools";
import { DATASET_STATS } from "./upstream";

export interface Env {
  CACHE: KVNamespace; USAGE: KVNamespace;
  UPGRADE_URL: string;
  DODO_API_KEY: string;
  DODO_WEBHOOK_SECRET: string;
  DODO_BASE?: string;
  DODO_PRODUCT_ID_SOLO: string;
  DODO_PRODUCT_ID_TEAM: string;
  DODO_PRODUCT_ID_PRO: string;
  CUSTOMER_PORTAL_RETURN_URL?: string;
  RESEND_API_KEY?: string;
  FROM_EMAIL?: string;
  PRODUCT_NAME?: string;
  PRODUCT_TAGLINE?: string;
  PRODUCT_URL?: string;
}

const SERVER_INFO = { name: "hsn-classifier-mcp", version: "0.1.0" };
const server = new McpServer(SERVER_INFO);
for (const t of buildTools()) server.register(t);

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if ((request.method === "GET" || request.method === "HEAD") && url.pathname === "/health") return json({ ok: true, server: SERVER_INFO, dataset: DATASET_STATS });
    if (request.method === "GET" && url.pathname === "/llms.txt") return new Response(LLMS_TXT, { headers: { "Content-Type": "text/markdown" } });
    if ((request.method === "GET" || request.method === "HEAD") && (url.pathname === "/favicon.ico" || url.pathname === "/favicon.svg")) return handleFavicon();
    if (request.method === "GET" && url.pathname === "/") return new Response(renderLanding(env, url), { headers: { "Content-Type": "text/html" } });
    if (request.method === "GET" && url.pathname === "/upgrade") return handleUpgrade(request, env, new URL(request.url).origin);
    if (request.method === "GET" && url.pathname === "/account") return withCors(await handleAccount(request, env));
    if (request.method === "GET" && url.pathname === "/account/export") return withCors(await handleAccountExport(request, env));
    if (request.method === "DELETE" && url.pathname === "/account") return withCors(await handleAccountDelete(request, env));
    if (request.method === "POST" && url.pathname === "/account/delete") return withCors(await handleAccountDelete(request, env));
    if (request.method === "GET" && url.pathname === "/support") return withCors(handleSupportPage(request, env));
    if (request.method === "POST" && url.pathname === "/support") return withCors(await handleSupportSubmit(request, env));
    if (request.method === "GET" && (url.pathname === "/welcome" || url.pathname === "/welcome.json")) return withCors(await handleWelcome(request, env));
    if (request.method === "POST" && url.pathname === "/account/rotate") return withCors(await handleAccountRotate(request, env));
    if (request.method === "GET" && url.pathname === "/account/team") return withCors(await handleTeamList(request, env));
    if (request.method === "POST" && url.pathname === "/account/team/invite") return withCors(await handleTeamInvite(request, env, new URL(request.url).origin));
    if (request.method === "POST" && url.pathname === "/account/team/revoke") return withCors(await handleTeamRevoke(request, env));
    if (request.method === "GET" && url.pathname === "/team/accept") return withCors(await handleTeamAccept(request, env));
    if (request.method === "POST" && url.pathname === "/webhooks/dodo") return await handleDodoWebhook(request, env);
    if (url.pathname !== "/mcp") return new Response("Not Found", { status: 404 });
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders() });
    if (request.method !== "POST") return new Response("Method Not Allowed", { status: 405 });

    const apiKey = extractBearer(request);
    const resolved = await resolveKey(apiKey, env.USAGE);
    const tier = resolved.tier;
    const quota = await checkAndIncrement(resolved.effectiveKey ?? apiKey, tier, env.USAGE);
    if (!quota.allowed) return withCors(quotaErrorResponse(quota, env.UPGRADE_URL));

    let body: unknown;
    try { body = await request.json(); } catch { return withCors(rpcErr(null, -32700, "Parse error")); }
    if (!isJsonRpcRequest(body)) return withCors(rpcErr((body as any)?.id ?? null, -32600, "Invalid JSON-RPC"));

    const ctx: ToolContext = { env: env as unknown as Record<string, any>, apiKey, tier: tier as Tier, callsRemaining: quota.callsRemaining };
    const r = await server.handle(body, ctx);
    if (r === null) return new Response(null, { status: 204, headers: corsHeaders() });
    return withCors(json(r));
  },
};

function json(body: unknown, init: ResponseInit = {}): Response { return new Response(JSON.stringify(body), { ...init, headers: { ...(init.headers || {}), "Content-Type": "application/json" } }); }
function corsHeaders(): Record<string, string> { return { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type, Authorization, MCP-Session-Id", "Access-Control-Max-Age": "86400" }; }
function withCors(r: Response): Response { const h = new Headers(r.headers); for (const [k, v] of Object.entries(corsHeaders())) h.set(k, v); return new Response(r.body, { status: r.status, statusText: r.statusText, headers: h }); }
function rpcErr(id: any, code: number, message: string): Response { return json({ jsonrpc: "2.0", id, error: { code, message } }, { status: 400 }); }

const LLMS_TXT = `# hsn-classifier-mcp

> Look up Indian HSN (Harmonized System Nomenclature) codes for GST classification — exact code, free-text search, and product-name classification. Embedded ${DATASET_STATS.count}-entry dataset, no upstream API.

## Tools
- lookup_hsn(code) — 4/6/8-digit code lookup
- search_hsn(query, limit?) — keyword search
- classify_product(name) — best-match code for a free-text product name

Endpoint: https://hsn-classifier-mcp.atlasword.workers.dev/mcp
`;

function renderLanding(env: Env, url: URL): string {
  const productName = env.PRODUCT_NAME ?? "hsn-classifier-mcp";
  const tagline = env.PRODUCT_TAGLINE ?? `HSN code lookup + product classification for Indian GST. Embedded ${DATASET_STATS.count}-entry dataset.`;
  const meta = buildSocialMeta(env, {
    title: productName,
    description: tagline,
    url: env.PRODUCT_URL || url.origin,
  });
  return `<!doctype html><html><head><meta charset="utf-8"><title>${productName}</title>
<style>body{font:16px/1.5 system-ui,sans-serif;max-width:720px;margin:4rem auto;padding:0 1rem}code{background:#f3f3f3;padding:.1em .35em;border-radius:3px}</style>${meta}
</head>
<body><h1>${productName}</h1>
<p>${tagline}</p>
<p>Free: 50 lookups/mo. Paid from $9/mo.</p>
<p><code>POST https://hsn-classifier-mcp.atlasword.workers.dev/mcp</code></p>
<p>See <a href="/llms.txt">/llms.txt</a> for the tool manifest, <a href="/upgrade?tier=solo">/upgrade?tier=solo</a> to subscribe.</p>
</body></html>`;
}
