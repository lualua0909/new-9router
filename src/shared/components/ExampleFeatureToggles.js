"use client";

import Toggle from "./Toggle";

export function applyExampleFeatures(body, options = {}) {
  const next = { ...body };

  if (options.stream !== undefined) {
    next.stream = options.stream === true;
  }

  if (options.thinking) {
    next.thinking = { type: "enabled", budget_tokens: 4096 };
    next.reasoning_effort = next.reasoning_effort || "medium";
  } else {
    delete next.thinking;
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
  const items = [
    { label: "Stream", checked: stream, onChange: onStreamChange, disabled: streamDisabled },
    { label: "Thinking", checked: thinking, onChange: onThinkingChange },
    { label: "Web Fetch", checked: webFetch, onChange: onWebFetchChange },
    { label: "Web Search", checked: webSearch, onChange: onWebSearchChange },
  ];

  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      {items.map((item) => (
        <label
          key={item.label}
          className={`flex items-center justify-between gap-2 rounded-lg border border-border bg-sidebar px-3 py-2 text-xs font-medium ${
            item.disabled ? "opacity-50" : ""
          }`}
        >
          <span className="text-text-muted">{item.label}</span>
          <Toggle size="sm" checked={item.checked} onChange={item.onChange} disabled={item.disabled} />
        </label>
      ))}
    </div>
  );
}
