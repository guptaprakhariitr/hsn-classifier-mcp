# hsn-classifier-mcp

> MCP server that looks up Indian **HSN** (Harmonized System Nomenclature) codes for **GST** classification — exact-code lookup, keyword search, and free-text product classification. Embedded ~4,700-entry dataset, no upstream API, microsecond latencies.

For AI agents that touch Indian B2B invoices, e-commerce listings, or anywhere you need to map "what is this product" → "what HSN code goes on the GST invoice".

**Endpoint:** `https://hsn-classifier-mcp.prakhar-cognizance.workers.dev/mcp`

---

## Tools

| Tool | Purpose |
|------|---------|
| `lookup_hsn(code)` | Exact-code lookup. Accepts 4 / 6 / 8-digit (truncates 8 → 6 → 4). |
| `search_hsn(query, limit?)` | Free-text keyword search across descriptions (limit 1-50, default 10). |
| `classify_product(name)` | Best-effort classification: returns `{best, alternatives, matched_tokens}`. |

Example:

```bash
curl -sS -X POST https://hsn-classifier-mcp.prakhar-cognizance.workers.dev/mcp \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <your-key>" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"classify_product","arguments":{"name":"basmati rice"}}}'
```

---

## Install in Cursor / Claude Desktop / Cline

```json
{
  "mcpServers": {
    "hsn-classifier": {
      "url": "https://hsn-classifier-mcp.prakhar-cognizance.workers.dev/mcp",
      "headers": { "Authorization": "Bearer <your-key>" }
    }
  }
}
```

Without a key, you get the **free tier (100 calls/month, 10/min)** keyed off your IP.

---

## Pricing

| Tier  | Price        | Calls/month | Rate     |
|-------|--------------|-------------|----------|
| Free  | $0           | 100         | 10/min   |
| Solo  | $9 / mo      | 2,000       | 60/min   |
| Team  | $29 / mo     | 10,000      | 200/min  |
| Pro   | $79 / mo     | 50,000      | 600/min  |

Subscribe at <https://hsn-classifier-mcp.prakhar-cognizance.workers.dev/upgrade?tier=solo>. Powered by [Dodo Payments](https://dodopayments.com) as merchant of record — Dodo handles GST/VAT remittance worldwide.

---

## Dataset

Embedded ~4,700-entry HSN dataset — the **4-digit headings** and **6-digit subheadings** from the CBIC schedule. 8-digit tariff items are not included (4 / 6-digit HSN is what gets reported on most GST invoices). Source: a clean MIT-licensed snapshot at <https://github.com/QuantumByteStudios/gst-hsn-sac-codes>.

The dataset is baked into the Worker bundle (~73KB gzipped) so lookups are pure local memory access — no external API, no rate limit on the upstream, no flaky network.

If the CBIC GST rates update, the embedded `gst_rate` field may lag the current schedule by some weeks — verify against the latest CBIC notification for high-value transactions.

---

## Self-service

- `GET /account` (with `Authorization: Bearer <key>`) — current tier, usage, portal link.
- `POST /account/rotate` — revoke the current key and mint a new one on the same subscription.
- Customer portal — manage / cancel / update payment method via Dodo.

Lost your key? Email <prakshatechnologies@gmail.com> with your Dodo subscription ID.

---

## License

MIT © 2026 Prakhar Gupta · <prakshatechnologies@gmail.com>. See `LICENSE` for the dataset attribution.
