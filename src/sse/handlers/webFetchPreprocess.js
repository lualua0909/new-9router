import * as log from "../utils/logger.js";

const URL_REGEX = /https?:\/\/[^\s<>"'`)]+/g;
const MAX_FETCH_BYTES = 2_000_000;
const MAX_CONTENT_CHARS = 8000;
const FETCH_TIMEOUT_MS = 15_000;
const MAX_URLS_PER_REQUEST = 3;

function hasWebFetchTool(body) {
  const tools = body?.tools;
  if (!Array.isArray(tools)) return false;
  return tools.some((t) =>
    t?.type === "web_fetch" ||
    t?.function?.name === "web_fetch" ||
    t?.name === "web_fetch"
  );
}

function stripWebFetchTool(body) {
  if (!Array.isArray(body.tools)) return;
  body.tools = body.tools.filter((t) =>
    t?.type !== "web_fetch" &&
    t?.function?.name !== "web_fetch" &&
    t?.name !== "web_fetch"
  );
  if (body.tools.length === 0) delete body.tools;
}

function getLastUserMessage(body) {
  const msgs = body?.messages;
  if (!Array.isArray(msgs)) return null;
  for (let i = msgs.length - 1; i >= 0; i--) {
    if (msgs[i]?.role === "user") return msgs[i];
  }
  return null;
}

function extractTextFromContent(content) {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((p) => (typeof p === "string" ? p : (p?.text || "")))
      .join("\n");
  }
  return "";
}

function extractUrls(text) {
  if (!text) return [];
  const matches = text.match(URL_REGEX) || [];
  const cleaned = matches.map((u) => u.replace(/[.,;:!?)]+$/, ""));
  return [...new Set(cleaned)].slice(0, MAX_URLS_PER_REQUEST);
}

const ENTITIES = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'", "&apos;": "'", "&nbsp;": " " };

function htmlToText(html) {
  let s = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(?:br|\/p|\/div|\/li|\/h[1-6])\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ");
  s = s.replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
  s = s.replace(/&[a-z]+;/gi, (m) => ENTITIES[m.toLowerCase()] || " ");
  s = s.replace(/[ \t]+/g, " ").replace(/\n\s*\n\s*\n+/g, "\n\n").trim();
  return s;
}

async function fetchUrl(url) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      redirect: "follow",
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; 9router-WebFetch/1.0)",
        "Accept": "text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.5",
        "Accept-Language": "en,vi;q=0.8",
      },
    });
    if (!res.ok) return { error: `HTTP ${res.status}` };
    const ct = res.headers.get("content-type") || "";
    const reader = res.body?.getReader();
    if (!reader) {
      const text = await res.text();
      return { content: ct.includes("html") ? htmlToText(text) : text };
    }
    const chunks = [];
    let total = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      total += value.length;
      if (total >= MAX_FETCH_BYTES) { try { await reader.cancel(); } catch {} break; }
    }
    const buf = Buffer.concat(chunks.map((c) => Buffer.from(c)));
    const raw = buf.toString("utf8");
    const text = ct.includes("html") || /<html[\s>]/i.test(raw) ? htmlToText(raw) : raw;
    return { content: text };
  } catch (e) {
    return { error: e?.name === "AbortError" ? "timeout" : (e?.message || "fetch failed") };
  } finally {
    clearTimeout(timer);
  }
}

function injectFetchedContent(message, fetched) {
  const blocks = fetched.map(({ url, content, error }) => {
    if (error) return `[web_fetch] ${url}\nError: ${error}`;
    const clipped = content.length > MAX_CONTENT_CHARS
      ? content.slice(0, MAX_CONTENT_CHARS) + `\n... [truncated, ${content.length - MAX_CONTENT_CHARS} more chars]`
      : content;
    return `[web_fetch] ${url}\n---\n${clipped}`;
  });
  const prefix = `Fetched web content (use this to answer):\n\n${blocks.join("\n\n")}\n\n---\nOriginal user message:\n`;

  if (typeof message.content === "string") {
    message.content = prefix + message.content;
  } else if (Array.isArray(message.content)) {
    const idx = message.content.findIndex((p) => typeof p?.text === "string");
    if (idx >= 0) {
      message.content[idx] = { ...message.content[idx], text: prefix + message.content[idx].text };
    } else {
      message.content.unshift({ type: "text", text: prefix });
    }
  } else {
    message.content = prefix;
  }
}

/**
 * If body has a `web_fetch` tool and the last user message has URL(s),
 * fetch them server-side and inject content into the message before forwarding.
 * Mutates `body` in place. Removes the web_fetch tool from body.tools after handling.
 */
export async function preprocessWebFetch(body) {
  if (!hasWebFetchTool(body)) return;

  const userMsg = getLastUserMessage(body);
  if (!userMsg) { stripWebFetchTool(body); return; }

  const text = extractTextFromContent(userMsg.content);
  const urls = extractUrls(text);

  if (urls.length === 0) { stripWebFetchTool(body); return; }

  log.info("WEB_FETCH", `Fetching ${urls.length} URL(s) for prompt`);
  const results = await Promise.all(urls.map(async (url) => ({ url, ...(await fetchUrl(url)) })));
  for (const r of results) {
    if (r.error) log.warn("WEB_FETCH", `${r.url} → ${r.error}`);
    else log.info("WEB_FETCH", `${r.url} → ${r.content?.length || 0} chars`);
  }

  injectFetchedContent(userMsg, results);
  stripWebFetchTool(body);
}
