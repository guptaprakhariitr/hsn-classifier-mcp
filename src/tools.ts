import { Tool } from "./mcp-server";
import { lookupHsn, searchHsn, classifyProduct } from "./upstream";

export function buildTools(): Tool[] {
  return [
    {
      name: "lookup_hsn",
      description:
        "Look up an HSN code (Harmonized System Nomenclature, used by Indian GST). Accepts 4-digit, 6-digit, or 8-digit codes (8-digit gets truncated to 6 then 4). Returns {code, description, gst_rate?}. Throws if no match.",
      inputSchema: {
        type: "object",
        properties: {
          code: { type: "string", description: "HSN code, e.g. '1006' (rice) or '300490' (other formulated medicaments)." },
        },
        required: ["code"],
      },
      handler: async (args) => lookupHsn(String(args.code)),
    },

    {
      name: "search_hsn",
      description:
        "Free-text keyword search across HSN descriptions. Returns up to `limit` ranked matches (default 10, max 50). Use this when you have a product name but not a code.",
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string", description: "Free-text query, e.g. 'basmati rice' or 'cement bricks'." },
          limit: { type: "integer", description: "Max matches to return (1-50, default 10).", minimum: 1, maximum: 50 },
        },
        required: ["query"],
      },
      handler: async (args) => searchHsn(String(args.query), args.limit ?? 10),
    },

    {
      name: "classify_product",
      description:
        "Classify a product name into the most likely HSN code via keyword scoring. Returns {best, alternatives[], query, matched_tokens[]}. Best-effort: always returns a result (best may be null if nothing matched).",
      inputSchema: {
        type: "object",
        properties: {
          name: { type: "string", description: "Product / service name, e.g. 'cotton t-shirt' or 'pre-paid SIM card'." },
        },
        required: ["name"],
      },
      handler: async (args) => classifyProduct(String(args.name)),
    },
  ];
}
