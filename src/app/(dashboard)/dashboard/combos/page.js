"use client";

import { useState, useEffect, useMemo } from "react";
import { Card, Button, Modal, Input, CardSkeleton, ModelSelectModal, Toggle , Icon, ExampleFeatureToggles, applyExampleFeatures } from "@/shared/components";
import { useCopyToClipboard } from "@/shared/hooks/useCopyToClipboard";
import { marked } from "marked";

marked.setOptions({ gfm: true, breaks: true });

function extractContentFromJson(data) {
  if (!data) return "";
  const choice = data.choices?.[0];
  if (choice?.message?.content) {
    const c = choice.message.content;
    if (typeof c === "string") return c;
    if (Array.isArray(c)) return c.map((p) => (typeof p === "string" ? p : p?.text || "")).join("");
  }
  if (choice?.delta?.content) return choice.delta.content;
  if (typeof data.content === "string") return data.content;
  return "";
}

function extractContentFromSSE(sseText) {
  let out = "";
  for (const line of sseText.split("\n")) {
    const t = line.trim();
    if (!t.startsWith("data:")) continue;
    const payload = t.slice(5).trim();
    if (!payload || payload === "[DONE]") continue;
    try {
      const obj = JSON.parse(payload);
      const delta = obj.choices?.[0]?.delta?.content;
      if (typeof delta === "string") out += delta;
      else if (Array.isArray(delta)) out += delta.map((p) => p?.text || "").join("");
      else if (obj.choices?.[0]?.message?.content) out += obj.choices[0].message.content;
    } catch {}
  }
  return out;
}
import { isOpenAICompatibleProvider, isAnthropicCompatibleProvider } from "@/shared/constants/providers";

// Validate combo name: only a-z, A-Z, 0-9, -, _
const VALID_NAME_REGEX = /^[a-zA-Z0-9_.\-]+$/;

function Row({ label, children }) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5 sm:flex-row sm:items-center sm:gap-3">
      <span className="w-full text-xs font-medium text-text-muted sm:w-20 sm:shrink-0">{label}</span>
      <div className="w-full min-w-0 flex-1">{children}</div>
    </div>
  );
}

const DEFAULT_CHAT_RESPONSE_EXAMPLE = `{
  "id": "chatcmpl-...",
  "object": "chat.completion",
  "choices": [{
    "index": 0,
    "message": { "role": "assistant", "content": "..." },
    "finish_reason": "stop"
  }],
  "usage": { "prompt_tokens": 9, "completion_tokens": 12, "total_tokens": 21 }
}`;

function ExampleCard({ combos }) {
  const availableCombos = useMemo(
    () => combos.filter((combo) => (combo.models || []).length > 0),
    [combos]
  );
  const [selectedCombo, setSelectedCombo] = useState("");
  const [prompt, setPrompt] = useState("Reply with a short hello from this combo.");
  const [maxTokens, setMaxTokens] = useState("128");
  const [streamMode, setStreamMode] = useState(false);
  const [thinkingMode, setThinkingMode] = useState(false);
  const [webFetchMode, setWebFetchMode] = useState(false);
  const [webSearchMode, setWebSearchMode] = useState(false);
  const [apiKey, setApiKey] = useState("");
  const [useTunnel, setUseTunnel] = useState(false);
  const [localEndpoint, setLocalEndpoint] = useState("");
  const [tunnelEndpoint, setTunnelEndpoint] = useState("");
  const [result, setResult] = useState(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState("");
  const [collapsed, setCollapsed] = useState(false);
  const { copied: copiedCurl, copy: copyCurl } = useCopyToClipboard();
  const { copied: copiedRes, copy: copyRes } = useCopyToClipboard();
  const { copied: copiedMd, copy: copyMd } = useCopyToClipboard();

  useEffect(() => {
    setLocalEndpoint(window.location.origin);
    fetch("/api/keys")
      .then((res) => res.json())
      .then((data) => {
        setApiKey((data.keys || []).find((key) => key.isActive !== false)?.key || "");
      })
      .catch(() => {});
    fetch("/api/tunnel/status")
      .then((res) => res.json())
      .then((data) => {
        if (data.publicUrl) setTunnelEndpoint(data.publicUrl);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (availableCombos.length === 0) {
      setSelectedCombo("");
      return;
    }
    if (!availableCombos.some((combo) => combo.name === selectedCombo)) {
      setSelectedCombo(availableCombos[0].name);
    }
  }, [availableCombos, selectedCombo]);

  const endpoint = useTunnel ? tunnelEndpoint : localEndpoint;
  const normalizedMaxTokens = Number(maxTokens);
  const requestBody = applyExampleFeatures({
    model: selectedCombo || "combo-name",
    max_tokens: Number.isFinite(normalizedMaxTokens) && normalizedMaxTokens > 0 ? normalizedMaxTokens : 128,
    messages: [{ role: "user", content: prompt.trim() || "Hello" }],
  }, {
    stream: streamMode,
    thinking: thinkingMode,
    webFetch: webFetchMode,
    webSearch: webSearchMode,
  });
  const curlSnippet = `curl -X POST ${endpoint || "http://localhost:20128"}/v1/chat/completions \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer ${apiKey || "YOUR_KEY"}"${streamMode ? ` \\\n  -H "Accept: text/event-stream"` : ""} \\
  -d '${JSON.stringify(requestBody)}'`;
  const resultJson = result ? (result.raw ?? JSON.stringify(result.data, null, 2)) : "";
  const resultContent = result?.content ?? "";
  const resultHtml = resultContent ? marked.parse(resultContent) : "";

  const handleRun = async () => {
    if (!selectedCombo || !prompt.trim()) return;
    setRunning(true);
    setError("");
    setResult(null);
    const start = Date.now();
    try {
      const headers = { "Content-Type": "application/json" };
      if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
      if (streamMode) headers.Accept = "text/event-stream";
      const res = await fetch("/api/v1/chat/completions", {
        method: "POST",
        headers,
        body: JSON.stringify(requestBody),
      });

      if (streamMode && res.ok && res.body) {
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let content = "";
        let raw = "";
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          const chunk = decoder.decode(value, { stream: true });
          raw += chunk;
          buffer += chunk;
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";
          for (const line of lines) {
            const t = line.trim();
            if (!t.startsWith("data:")) continue;
            const payload = t.slice(5).trim();
            if (!payload || payload === "[DONE]") continue;
            try {
              const obj = JSON.parse(payload);
              const delta = obj.choices?.[0]?.delta?.content;
              if (typeof delta === "string") content += delta;
              else if (Array.isArray(delta)) content += delta.map((p) => p?.text || "").join("");
              else if (obj.choices?.[0]?.message?.content) content += obj.choices[0].message.content;
            } catch {}
          }
          setResult({ data: null, raw, content, latencyMs: Date.now() - start, streaming: true });
        }
        setResult({ data: null, raw, content, latencyMs: Date.now() - start, streaming: false });
        return;
      }

      const latencyMs = Date.now() - start;
      const text = await res.text();
      let data = null;
      try {
        data = text ? JSON.parse(text) : null;
      } catch {
        data = { raw: text };
      }
      if (!res.ok) {
        const detail = data?.error?.message || data?.error || data?.message || text || `HTTP ${res.status}`;
        setError(String(detail));
        return;
      }
      const content = data?.raw ? extractContentFromSSE(data.raw) : extractContentFromJson(data);
      setResult({ data, content, latencyMs });
    } catch (err) {
      setError(err.message || "Network error");
    } finally {
      setRunning(false);
    }
  };

  return (
    <Card>
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-lg font-semibold">Example</h2>
        <button
          type="button"
          onClick={() => setCollapsed(!collapsed)}
          className="inline-flex items-center gap-1 text-xs text-text-muted transition-colors hover:text-primary"
        >
          <Icon name={collapsed ? "expand_more" : "expand_less"} className="text-[18px]" />
        </button>
      </div>
      {!collapsed && (
      <div className="flex flex-col gap-2.5 mt-4">
        <Row label="Combo">
          <select
            value={selectedCombo}
            onChange={(e) => setSelectedCombo(e.target.value)}
            disabled={availableCombos.length === 0}
            className="w-full rounded-lg border border-border bg-surface px-3 py-1.5 text-sm focus:border-primary focus:outline-none disabled:opacity-60"
          >
            {availableCombos.length === 0 ? (
              <option value="">No combos with models available</option>
            ) : (
              availableCombos.map((combo) => (
                <option key={combo.id} value={combo.name}>
                  {combo.name} ({combo.models.length} models)
                </option>
              ))
            )}
          </select>
        </Row>

        <Row label="Endpoint">
          <div className="flex w-full flex-col gap-2 sm:flex-row sm:items-center">
            <input
              value={endpoint}
              onChange={(e) => useTunnel ? setTunnelEndpoint(e.target.value) : setLocalEndpoint(e.target.value)}
              className="w-full min-w-0 flex-1 rounded-lg border border-border bg-surface px-3 py-1.5 font-mono text-sm focus:border-primary focus:outline-none"
              placeholder="http://localhost:20128"
            />
            {tunnelEndpoint && (
              <button
                type="button"
                onClick={() => setUseTunnel((prev) => !prev)}
                className={`flex shrink-0 items-center gap-1 rounded-lg border px-2 py-1.5 text-xs transition-colors ${
                  useTunnel ? "border-primary/40 bg-primary/10 text-primary" : "border-border text-text-muted hover:text-primary"
                }`}
              >
                <Icon name="wifi_tethering" className="text-[14px]" />
                Tunnel
              </button>
            )}
          </div>
        </Row>

        <Row label="API Key">
          <input
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder="sk-..."
            className="w-full rounded-lg border border-border bg-surface px-3 py-1.5 font-mono text-sm focus:border-primary focus:outline-none"
          />
        </Row>

        <Row label="Max tokens">
          <input
            type="number"
            min="1"
            max="4096"
            value={maxTokens}
            onChange={(e) => setMaxTokens(e.target.value)}
            className="w-full rounded-lg border border-border bg-surface px-3 py-1.5 text-sm focus:border-primary focus:outline-none"
          />
        </Row>

        <Row label="Options">
          <ExampleFeatureToggles
            stream={streamMode}
            onStreamChange={setStreamMode}
            thinking={thinkingMode}
            onThinkingChange={setThinkingMode}
            webFetch={webFetchMode}
            onWebFetchChange={setWebFetchMode}
            webSearch={webSearchMode}
            onWebSearchChange={setWebSearchMode}
          />
        </Row>

        <Row label="Prompt">
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            rows={3}
            className="w-full resize-y rounded-lg border border-border bg-surface px-3 py-2 text-sm focus:border-primary focus:outline-none"
          />
        </Row>

        <div className="mt-1">
          <div className="mb-1.5 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-text-muted">Request</span>
            <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center">
              <button
                type="button"
                onClick={() => copyCurl(curlSnippet)}
                className="inline-flex items-center gap-1 text-xs text-text-muted transition-colors hover:text-primary"
              >
                <Icon name={copiedCurl ? "check" : "content_copy"} className="text-[14px]" />
                {copiedCurl ? "Copied" : "Copy"}
              </button>
              <button
                type="button"
                onClick={handleRun}
                disabled={running || !selectedCombo || !prompt.trim()}
                className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-primary px-3 py-1 text-xs font-medium text-white transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto"
              >
                <Icon name="play_arrow" className="text-[14px]" style={running ? { animation: "spin 1s linear infinite" } : undefined} />
                {running ? "Running..." : "Run"}
              </button>
            </div>
          </div>
          <pre className="overflow-x-auto whitespace-pre-wrap break-all rounded-lg bg-sidebar px-3 py-2.5 font-mono text-xs text-text-main">{curlSnippet}</pre>
        </div>

        {error && <p className="break-words text-xs text-red-500">{error}</p>}

        <div>
          <div className="mb-1.5 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-text-muted">
              Response {result && <span className="font-normal normal-case">&#9889; {result.latencyMs}ms</span>}
            </span>
            {result && (
              <button
                type="button"
                onClick={() => copyRes(resultJson)}
                className="inline-flex items-center gap-1 text-xs text-text-muted transition-colors hover:text-primary"
              >
                <Icon name={copiedRes ? "check" : "content_copy"} className="text-[14px]" />
                {copiedRes ? "Copied" : "Copy"}
              </button>
            )}
          </div>
          <pre className="overflow-x-auto whitespace-pre-wrap break-all rounded-lg bg-sidebar px-3 py-2.5 font-mono text-xs text-text-main opacity-70">
            {result ? resultJson : DEFAULT_CHAT_RESPONSE_EXAMPLE}
          </pre>
        </div>

        <div>
          <div className="mb-1.5 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-text-muted">
              Content {result?.streaming && <span className="font-normal normal-case text-primary">· streaming…</span>}
            </span>
            {resultContent && (
              <button
                type="button"
                onClick={() => copyMd(resultContent)}
                className="inline-flex items-center gap-1 text-xs text-text-muted transition-colors hover:text-primary"
              >
                <Icon name={copiedMd ? "check" : "content_copy"} className="text-[14px]" />
                {copiedMd ? "Copied" : "Copy"}
              </button>
            )}
          </div>
          {resultContent ? (
            <div
              className="changelog-body overflow-x-auto rounded-lg bg-sidebar px-3 py-2.5 text-sm text-text-main"
              dangerouslySetInnerHTML={{ __html: resultHtml }}
            />
          ) : (
            <div className="rounded-lg bg-sidebar px-3 py-2.5 text-xs text-text-muted opacity-70">
              Content sẽ hiển thị ở đây (markdown, GitHub style) sau khi chạy.
            </div>
          )}
        </div>
      </div>
      )}
    </Card>
  );
}

export default function CombosPage() {
  const [combos, setCombos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [editingCombo, setEditingCombo] = useState(null);
  const [activeProviders, setActiveProviders] = useState([]);
  const [comboStrategies, setComboStrategies] = useState({});
  const { copied, copy } = useCopyToClipboard();

  useEffect(() => {
    fetchData();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const fetchData = async () => {
    try {
      const [combosRes, providersRes, settingsRes] = await Promise.all([
        fetch("/api/combos"),
        fetch("/api/providers"),
        fetch("/api/settings"),
      ]);
      const combosData = await combosRes.json();
      const providersData = await providersRes.json();
      const settingsData = settingsRes.ok ? await settingsRes.json() : {};
      
      // Only LLM combos here — webSearch/webFetch combos belong to media-providers/web
      if (combosRes.ok) setCombos((combosData.combos || []).filter(c => !c.kind));
      if (providersRes.ok) {
        setActiveProviders(providersData.connections || []);
      }
      setComboStrategies(settingsData.comboStrategies || {});
    } catch (error) {
      console.log("Error fetching data:", error);
    } finally {
      setLoading(false);
    }
  };

  const handleCreate = async (data) => {
    try {
      const res = await fetch("/api/combos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (res.ok) {
        await fetchData();
        setShowCreateModal(false);
      } else {
        const err = await res.json();
        alert(err.error || "Failed to create combo");
      }
    } catch (error) {
      console.log("Error creating combo:", error);
    }
  };

  const handleUpdate = async (id, data) => {
    try {
      const res = await fetch(`/api/combos/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (res.ok) {
        await fetchData();
        setEditingCombo(null);
      } else {
        const err = await res.json();
        alert(err.error || "Failed to update combo");
      }
    } catch (error) {
      console.log("Error updating combo:", error);
    }
  };

  const handleDelete = async (id) => {
    if (!confirm("Delete this combo?")) return;
    try {
      const res = await fetch(`/api/combos/${id}`, { method: "DELETE" });
      if (res.ok) {
        setCombos(combos.filter(c => c.id !== id));
      }
    } catch (error) {
      console.log("Error deleting combo:", error);
    }
  };

  const handleToggleRoundRobin = async (comboName, enabled) => {
    try {
      const updated = { ...comboStrategies };
      if (enabled) {
        updated[comboName] = { fallbackStrategy: "round-robin" };
      } else {
        delete updated[comboName];
      }
      
      await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ comboStrategies: updated }),
      });
      
      setComboStrategies(updated);
    } catch (error) {
      console.log("Error updating combo strategy:", error);
    }
  };

  if (loading) {
    return (
      <div className="flex flex-col gap-6">
        <CardSkeleton />
        <CardSkeleton />
      </div>
    );
  }

  return (
    <div className="flex min-w-0 flex-col gap-6 px-1 sm:px-0">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold">Combos</h1>
          <p className="text-sm text-text-muted mt-1">
            Create model combos with fallback support
          </p>
        </div>
        <Button icon="add" onClick={() => setShowCreateModal(true)} className="w-full sm:w-auto">
          Create Combo
        </Button>
      </div>

      <ExampleCard combos={combos} />

      {/* Combos List */}
      {combos.length === 0 ? (
        <Card>
          <div className="text-center py-12">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-primary/10 text-primary mb-4">
              <Icon name="layers" className="text-[32px]" />
            </div>
            <p className="text-text-main font-medium mb-1">No combos yet</p>
            <p className="text-sm text-text-muted mb-4">Create model combos with fallback support</p>
            <Button icon="add" onClick={() => setShowCreateModal(true)} className="w-full sm:w-auto">
              Create Combo
            </Button>
          </div>
        </Card>
      ) : (
        <div className="flex flex-col gap-4">
          {combos.map((combo) => (
            <ComboCard
              key={combo.id}
              combo={combo}
              copied={copied}
              onCopy={copy}
              onEdit={() => setEditingCombo(combo)}
              onDelete={() => handleDelete(combo.id)}
              roundRobinEnabled={comboStrategies[combo.name]?.fallbackStrategy === "round-robin"}
              onToggleRoundRobin={(enabled) => handleToggleRoundRobin(combo.name, enabled)}
            />
          ))}
        </div>
      )}

      {/* Create Modal - Use key to force remount and reset state */}
      <ComboFormModal
        key="create"
        isOpen={showCreateModal}
        onClose={() => setShowCreateModal(false)}
        onSave={handleCreate}
        activeProviders={activeProviders}
      />

      {/* Edit Modal - Use key to force remount and reset state */}
      <ComboFormModal
        key={editingCombo?.id || "new"}
        isOpen={!!editingCombo}
        combo={editingCombo}
        onClose={() => setEditingCombo(null)}
        onSave={(data) => handleUpdate(editingCombo.id, data)}
        activeProviders={activeProviders}
      />
    </div>
  );
}

function ComboCard({ combo, copied, onCopy, onEdit, onDelete, roundRobinEnabled, onToggleRoundRobin }) {
  return (
    <Card padding="sm" className="group">
      <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 flex-1 items-start gap-3 sm:items-center">
          <div className="size-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
            <Icon name="layers" className="text-primary text-[18px]" />
          </div>
          <div className="min-w-0 flex-1">
            <code className="block truncate font-mono text-sm font-medium">{combo.name}</code>
            <div className="mt-1 flex min-w-0 flex-wrap items-center gap-1">
              {combo.models.length === 0 ? (
                <span className="text-xs text-text-muted italic">No models</span>
              ) : (
                combo.models.slice(0, 3).map((model, index) => (
                  <code key={index} className="max-w-full truncate rounded bg-black/5 px-1.5 py-0.5 font-mono text-[10px] text-text-muted dark:bg-white/5 sm:max-w-[220px]">
                    {model}
                  </code>
                ))
              )}
              {combo.models.length > 3 && (
                <span className="text-[10px] text-text-muted">+{combo.models.length - 3} more</span>
              )}
            </div>
          </div>
        </div>

        {/* Actions */}
        <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center sm:gap-3 sm:shrink-0">
          {/* Round Robin Toggle — always visible */}
          <div className="flex items-center justify-between gap-1.5 rounded-lg bg-black/[0.02] px-2 py-1.5 dark:bg-white/[0.02] sm:justify-start sm:bg-transparent sm:px-0 sm:py-0 sm:dark:bg-transparent">
            <span className="text-xs text-text-muted font-medium">Round Robin</span>
            <Toggle
              size="sm"
              checked={roundRobinEnabled}
              onChange={onToggleRoundRobin}
            />
          </div>

          <div className="grid grid-cols-3 gap-1 sm:flex">
            <button
              onClick={(e) => { e.stopPropagation(); onCopy(combo.name, `combo-${combo.id}`); }}
              className="flex flex-col items-center rounded px-2 py-1 text-text-muted transition-colors hover:bg-black/5 hover:text-primary dark:hover:bg-white/5"
              title="Copy combo name"
            >
              <Icon name={copied === `combo-${combo.id}` ? "check" : "content_copy"} className="text-[18px]" />
              <span className="text-[10px] leading-tight">Copy</span>
            </button>
            <button
              onClick={onEdit}
              className="flex flex-col items-center rounded px-2 py-1 text-text-muted transition-colors hover:bg-black/5 hover:text-primary dark:hover:bg-white/5"
              title="Edit"
            >
              <Icon name="edit" className="text-[18px]" />
              <span className="text-[10px] leading-tight">Edit</span>
            </button>
            <button
              onClick={onDelete}
              className="flex flex-col items-center rounded px-2 py-1 text-red-500 transition-colors hover:bg-red-500/10"
              title="Delete"
            >
              <Icon name="delete" className="text-[18px]" />
              <span className="text-[10px] leading-tight">Delete</span>
            </button>
          </div>
        </div>
      </div>
    </Card>
  );
}

// Inline editable model item
function ModelItem({ index, model, isFirst, isLast, onEdit, onMoveUp, onMoveDown, onRemove }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(model);

  const commit = () => {
    const trimmed = draft.trim();
    if (trimmed && trimmed !== model) onEdit(trimmed);
    else setDraft(model); // revert if empty or unchanged
    setEditing(false);
  };

  const handleKeyDown = (e) => {
    if (e.key === "Enter") commit();
    if (e.key === "Escape") { setDraft(model); setEditing(false); }
  };

  return (
    <div className="group flex min-w-0 items-center gap-1.5 rounded-md bg-black/[0.02] px-2 py-1 transition-colors hover:bg-black/[0.04] dark:bg-white/[0.02] dark:hover:bg-white/[0.04]">
      {/* Index badge */}
      <span className="text-[10px] font-medium text-text-muted w-3 text-center shrink-0">{index + 1}</span>

      {/* Inline editable model value */}
      {editing ? (
        <input
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={handleKeyDown}
          className="min-w-0 flex-1 rounded border border-primary/40 bg-white px-1.5 py-0.5 font-mono text-xs text-text-main outline-none dark:bg-black/20"
        />
      ) : (
        <div
          className="min-w-0 flex-1 cursor-text truncate rounded px-1.5 py-0.5 font-mono text-xs text-text-main hover:bg-black/5 dark:hover:bg-white/5"
          onClick={() => setEditing(true)}
          title="Click to edit"
        >
          {model}
        </div>
      )}

      {/* Priority arrows */}
      <div className="flex shrink-0 items-center gap-0.5">
        <button
          onClick={onMoveUp}
          disabled={isFirst}
          className={`p-0.5 rounded ${isFirst ? "text-text-muted/20 cursor-not-allowed" : "text-text-muted hover:text-primary hover:bg-black/5 dark:hover:bg-white/5"}`}
          title="Move up"
        >
          <Icon name="arrow_upward" className="text-[12px]" />
        </button>
        <button
          onClick={onMoveDown}
          disabled={isLast}
          className={`p-0.5 rounded ${isLast ? "text-text-muted/20 cursor-not-allowed" : "text-text-muted hover:text-primary hover:bg-black/5 dark:hover:bg-white/5"}`}
          title="Move down"
        >
          <Icon name="arrow_downward" className="text-[12px]" />
        </button>
      </div>

      {/* Remove */}
      <button
        onClick={onRemove}
        className="p-0.5 hover:bg-red-500/10 rounded text-text-muted hover:text-red-500 transition-all"
        title="Remove"
      >
        <Icon name="close" className="text-[12px]" />
      </button>
    </div>
  );
}

function ComboFormModal({ isOpen, combo, onClose, onSave, activeProviders, kindFilter = null }) {
  // Initialize state with combo values - key prop on parent handles reset on remount
  const [name, setName] = useState(combo?.name || "");
  const [models, setModels] = useState(combo?.models || []);
  const [showModelSelect, setShowModelSelect] = useState(false);
  const [saving, setSaving] = useState(false);
  const [nameError, setNameError] = useState("");
  const [modelAliases, setModelAliases] = useState({});

  const fetchModalData = async () => {
    try {
      const aliasesRes = await fetch("/api/models/alias");
      if (!aliasesRes.ok) return;
      const aliasesData = await aliasesRes.json();
      setModelAliases(aliasesData.aliases || {});
    } catch (error) {
      console.error("Error fetching modal data:", error);
    }
  };

  useEffect(() => {
    if (isOpen) fetchModalData();
  }, [isOpen]);

  const validateName = (value) => {
    if (!value.trim()) {
      setNameError("Name is required");
      return false;
    }
    if (!VALID_NAME_REGEX.test(value)) {
      setNameError("Only letters, numbers, -, _ and . allowed");
      return false;
    }
    setNameError("");
    return true;
  };

  const handleNameChange = (e) => {
    const value = e.target.value;
    setName(value);
    if (value) validateName(value);
    else setNameError("");
  };

  const handleAddModel = (model) => {
    if (!models.includes(model.value)) {
      setModels([...models, model.value]);
    }
  };

  const handleRemoveModel = (index) => {
    setModels(models.filter((_, i) => i !== index));
  };

  const handleMoveUp = (index) => {
    if (index === 0) return;
    const newModels = [...models];
    [newModels[index - 1], newModels[index]] = [newModels[index], newModels[index - 1]];
    setModels(newModels);
  };

  const handleMoveDown = (index) => {
    if (index === models.length - 1) return;
    const newModels = [...models];
    [newModels[index], newModels[index + 1]] = [newModels[index + 1], newModels[index]];
    setModels(newModels);
  };

  const handleSave = async () => {
    if (!validateName(name)) return;
    setSaving(true);
    await onSave({ name: name.trim(), models });
    setSaving(false);
  };

  const isEdit = !!combo;

  return (
    <>
      <Modal
        isOpen={isOpen}
        onClose={onClose}
        title={isEdit ? "Edit Combo" : "Create Combo"}
      >
        <div className="flex flex-col gap-3">
          {/* Name */}
          <div>
            <Input
              label="Combo Name"
              value={name}
              onChange={handleNameChange}
              placeholder="my-combo"
              error={nameError}
            />
            <p className="text-[10px] text-text-muted mt-0.5">
              Only letters, numbers, -, _ and . allowed
            </p>
          </div>

          {/* Models */}
          <div>
            <label className="text-sm font-medium mb-1.5 block">Models</label>

            {models.length === 0 ? (
              <div className="text-center py-4 border border-dashed border-black/10 dark:border-white/10 rounded-lg bg-black/[0.01] dark:bg-white/[0.01]">
                <Icon name="layers" className="text-text-muted text-xl mb-1" />
                <p className="text-xs text-text-muted">No models added yet</p>
              </div>
            ) : (
            <div className="flex max-h-[55vh] min-w-0 flex-col gap-1 overflow-y-auto sm:max-h-[350px]">
                {models.map((model, index) => (
                  <ModelItem
                    key={index}
                    index={index}
                    model={model}
                    isFirst={index === 0}
                    isLast={index === models.length - 1}
                    onEdit={(newVal) => {
                      const updated = [...models];
                      updated[index] = newVal;
                      setModels(updated);
                    }}
                    onMoveUp={() => handleMoveUp(index)}
                    onMoveDown={() => handleMoveDown(index)}
                    onRemove={() => handleRemoveModel(index)}
                  />
                ))}
              </div>
            )}

            {/* Add Model button */}
            <button
              onClick={() => setShowModelSelect(true)}
              className="w-full mt-2 py-2 border border-dashed border-black/10 dark:border-white/10 rounded-lg text-xs text-primary font-medium hover:text-primary hover:border-primary/50 transition-colors flex items-center justify-center gap-1"
            >
              <Icon name="add" className="text-[16px]" />
              Add Model
            </button>
          </div>

          {/* Actions */}
          <div className="flex flex-col gap-2 pt-1 sm:flex-row">
            <Button onClick={onClose} variant="ghost" fullWidth size="sm">
              Cancel
            </Button>
            <Button
              onClick={handleSave}
              fullWidth
              size="sm"
              disabled={!name.trim() || !!nameError || saving}
            >
              {saving ? "Saving..." : isEdit ? "Save" : "Create"}
            </Button>
          </div>
        </div>
      </Modal>

      {/* Model Select Modal */}
      <ModelSelectModal
        isOpen={showModelSelect}
        onClose={() => setShowModelSelect(false)}
        onSelect={handleAddModel}
        activeProviders={activeProviders}
        modelAliases={modelAliases}
        title="Add Model to Combo"
        kindFilter={kindFilter}
      />
    </>
  );
}
