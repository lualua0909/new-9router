"use client";

import Toggle from "./Toggle";

// Effort levels accepted on `options.thinking`:
//   false / "off"      → no thinking
//   true               → enabled, default effort "medium" (legacy boolean)
//   "low"|"medium"|"high"|"ultra"  → enabled with reasoning_effort
// "ultra" is mapped to backend code "xhigh".
const EFFORT_BUDGETS = { low: 2048, medium: 4096, high: 8192, ultra: 16384 };
const EFFORT_TO_BACKEND = { low: "low", medium: "medium", high: "high", ultra: "xhigh" };

function normalizeThinking(value) {
  if (value === true) return "medium";
  if (!value || value === "off") return null;
  if (typeof value === "string" && EFFORT_BUDGETS[value]) return value;
  return null;
}

export function applyExampleFeatures(body, options = {}) {
  const next = { ...body };

  if (options.stream !== undefined) {
    next.stream = options.stream === true;
  }

  const effort = normalizeThinking(options.thinking);
  if (effort) {
    next.thinking = { type: "enabled", budget_tokens: EFFORT_BUDGETS[effort] };
    next.reasoning_effort = next.reasoning_effort || EFFORT_TO_BACKEND[effort];
  } else {
    delete next.thinking;
    delete next.reasoning_effort;
  }

  const tools = Array.isArray(next.tools) ? [...next.tools] : [];
  if (options.webSearch && !tools.some((tool) => tool.type === "web_search")) {
    tools.push({ type: "web_search" });
  }
  if (options.webFetch && !tools.some((tool) => tool.function?.name === "web_fetch")) {
    tools.push({
      type: "function",
      function: {
        name: "web_fetch",
        description: "Fetch a URL and return its readable page content.",
        parameters: {
          type: "object",
          properties: {
            url: { type: "string", description: "The URL to fetch." },
          },
          required: ["url"],
        },
      },
    });
  }
  if (tools.length > 0) next.tools = tools;
  else delete next.tools;

  return next;
}

const EFFORT_OPTIONS = [
  { value: "off",    label: "Off" },
  { value: "low",    label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high",   label: "High" },
  { value: "ultra",  label: "Ultra" },
];

export default function ExampleFeatureToggles({
  stream,
  onStreamChange,
  thinking,
  onThinkingChange,
  webFetch,
  onWebFetchChange,
  webSearch,
  onWebSearchChange,
  streamDisabled = false,
}) {
  // Coerce legacy boolean → "medium"/"off" so existing callers still work.
  const effortValue = thinking === true ? "medium" : (thinking === false || thinking == null ? "off" : thinking);

  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      <label
        className={`flex items-center justify-between gap-2 rounded-lg border border-border bg-sidebar px-3 py-2 text-xs font-medium ${
          streamDisabled ? "opacity-50" : ""
        }`}
      >
        <span className="text-text-muted">Stream</span>
        <Toggle size="sm" checked={stream} onChange={onStreamChange} disabled={streamDisabled} />
      </label>

      <label className="flex items-center justify-between gap-2 rounded-lg border border-border bg-sidebar px-3 py-2 text-xs font-medium">
        <span className="text-text-muted">Thinking</span>
        <select
          value={effortValue}
          onChange={(e) => onThinkingChange?.(e.target.value)}
          className="bg-transparent border-0 text-xs font-medium text-text-main focus:outline-none cursor-pointer"
        >
          {EFFORT_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      </label>

      <label className="flex items-center justify-between gap-2 rounded-lg border border-border bg-sidebar px-3 py-2 text-xs font-medium">
        <span className="text-text-muted">Web Fetch</span>
        <Toggle size="sm" checked={webFetch} onChange={onWebFetchChange} />
      </label>

      <label className="flex items-center justify-between gap-2 rounded-lg border border-border bg-sidebar px-3 py-2 text-xs font-medium">
        <span className="text-text-muted">Web Search</span>
        <Toggle size="sm" checked={webSearch} onChange={onWebSearchChange} />
      </label>
    </div>
  );
}
