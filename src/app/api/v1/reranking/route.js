import { getProviderCredentials, extractApiKey, isValidApiKey } from "@/sse/services/auth.js";
import { getModelInfo } from "@/sse/services/model.js";
import { getSettings } from "@/lib/localDb";
import { AI_PROVIDERS } from "@/shared/constants/providers";
import { resolveLmStudioHost } from "open-sse/config/providers.js";

export async function OPTIONS() {
  return new Response(null, {
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "*",
    },
  });
}

function jsonError(status, message) {
  return new Response(JSON.stringify({ error: { message, type: "reranking_error" } }), {
    status,
    headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
  });
}

function buildAuthHeader(authHeader, token) {
  if (!token) return {};
  switch (authHeader) {
    case "bearer": return { "Authorization": `Bearer ${token}` };
    case "token":  return { "Authorization": `Token ${token}` };
    case "key":    return { "Authorization": `Key ${token}` };
    case "x-api-key": return { "x-api-key": token };
    default: return { "Authorization": `Bearer ${token}` };
  }
}

export async function POST(request) {
  let body;
  try { body = await request.json(); } catch { return jsonError(400, "Invalid JSON body"); }

  const settings = await getSettings();
  if (settings.requireApiKey) {
    const k = extractApiKey(request);
    if (!k || !(await isValidApiKey(k))) return jsonError(401, "Missing or invalid API key");
  }

  const { model: modelStr, query, documents, top_n, top_k, return_documents } = body || {};
  if (!modelStr) return jsonError(400, "Missing model");
  if (!query || typeof query !== "string") return jsonError(400, "Missing or invalid query");
  if (!Array.isArray(documents) || documents.length === 0) return jsonError(400, "documents must be a non-empty array");

  const info = await getModelInfo(modelStr);
  if (!info.provider) return jsonError(400, "Invalid model format");
  const { provider, model } = info;

  const cfg = AI_PROVIDERS[provider]?.rerankerConfig;
  if (!cfg) return jsonError(400, `Provider '${provider}' does not support reranking`);

  const credentials = cfg.authType === "none"
    ? null
    : await getProviderCredentials(provider, new Set(), model);
  if (cfg.authType !== "none" && (!credentials || credentials.allRateLimited)) {
    return jsonError(401, `No credentials for provider: ${provider}`);
  }
  const token = credentials?.apiKey || credentials?.accessToken;

  // Resolve baseUrl (LM Studio host is per-connection)
  let url = cfg.baseUrl;
  if (provider === "lm-studio") url = `${resolveLmStudioHost(credentials)}/v1/reranking`;

  // Build provider-specific request body
  const docs = documents.map((d) => (typeof d === "string" ? d : d?.text || "")).filter(Boolean);
  const topN = Number.isFinite(Number(top_n)) ? Number(top_n) : (Number.isFinite(Number(top_k)) ? Number(top_k) : undefined);
  let upstreamBody;
  if (cfg.format === "voyage") {
    upstreamBody = { query, documents: docs, model, ...(topN ? { top_k: topN } : {}), ...(return_documents !== undefined ? { return_documents } : {}) };
  } else {
    // cohere / jina (and LM Studio jina-compatible)
    upstreamBody = { model, query, documents: docs, ...(topN ? { top_n: topN } : {}), ...(return_documents !== undefined ? { return_documents } : {}) };
  }

  const headers = { "Content-Type": "application/json", ...buildAuthHeader(cfg.authHeader, token) };

  let upstream;
  try {
    upstream = await fetch(url, { method: "POST", headers, body: JSON.stringify(upstreamBody) });
  } catch (e) {
    return jsonError(502, e.message || "Upstream fetch failed");
  }

  const text = await upstream.text();
  let data;
  try { data = JSON.parse(text); } catch { data = { raw: text }; }

  if (!upstream.ok) {
    const msg = data?.error?.message || data?.message || data?.detail || text || `Upstream ${upstream.status}`;
    return jsonError(upstream.status, typeof msg === "string" ? msg : JSON.stringify(msg));
  }

  // Normalize to { model, results: [{ index, relevance_score, document? }], usage? }
  const rawResults = Array.isArray(data.results) ? data.results
    : Array.isArray(data.data) ? data.data
    : [];
  const results = rawResults.map((r) => ({
    index: r.index,
    relevance_score: r.relevance_score ?? r.score,
    ...(r.document ? { document: typeof r.document === "string" ? { text: r.document } : r.document } : {}),
  }));
  const normalized = { model: `${provider}/${model}`, results, usage: data.usage || data.meta?.billed_units || undefined };

  return new Response(JSON.stringify(normalized), {
    headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
  });
}
