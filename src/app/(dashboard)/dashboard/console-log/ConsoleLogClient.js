"use client";

import { useState, useEffect, useRef } from "react";
import { Card, Button } from "@/shared/components";
import { CONSOLE_LOG_CONFIG } from "@/shared/constants/config";

const LOG_LEVEL_COLORS = {
  LOG: "text-green-400",
  INFO: "text-blue-400",
  WARN: "text-yellow-400",
  ERROR: "text-red-400",
  DEBUG: "text-purple-400",
  PROMPT: "text-white",
};

function colorLine(line) {
  const match = line.match(/\[(\w+)\]/g);
  const levelTag = match?.find((tag) => LOG_LEVEL_COLORS[tag.replace(/\[|\]/g, "")])?.replace(/\[|\]/g, "") || null;
  const color = LOG_LEVEL_COLORS[levelTag] || "text-green-400";

  // Highlight "Model: model-name" or "Model: provider/model-name"
  const modelMatch = line.match(/(Model:\s+)([a-zA-Z0-9.\-_/]+)/);
  if (modelMatch) {
    const [fullMatch, prefix, modelName] = modelMatch;
    const parts = line.split(fullMatch);
    return (
      <span className={color}>
        {parts[0]}
        {prefix}
        <span className="text-yellow-400">{modelName}</span>
        {parts.slice(1).join(fullMatch)}
      </span>
    );
  }

  return <span className={color}>{line}</span>;
}

export default function ConsoleLogClient() {
  const [logs, setLogs] = useState([]);
  const [connected, setConnected] = useState(false);
  const logRef = useRef(null);

  const handleClear = async () => {
    try {
      await fetch("/api/translator/console-logs", { method: "DELETE" });
      // UI cleared via SSE "clear" event
    } catch (err) {
      console.error("Failed to clear console logs:", err);
    }
  };

  useEffect(() => {
    const es = new EventSource("/api/translator/console-logs/stream");

    es.onopen = () => setConnected(true);

    es.onmessage = (e) => {
      const msg = JSON.parse(e.data);
      if (msg.type === "init") {
        setLogs(msg.logs.slice(-CONSOLE_LOG_CONFIG.maxLines));
      } else if (msg.type === "line") {
        setLogs((prev) => {
          const next = [...prev, msg.line];
          return next.length > CONSOLE_LOG_CONFIG.maxLines ? next.slice(-CONSOLE_LOG_CONFIG.maxLines) : next;
        });
      } else if (msg.type === "clear") {
        setLogs([]);
      }
    };

    es.onerror = () => setConnected(false);

    return () => es.close();
  }, []);

  // Auto-scroll to bottom on new logs
  useEffect(() => {
    if (!logRef.current) return;
    logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [logs]);

  return (
    <div className="">
      <Card>
        <div className="flex items-center justify-end px-4 pt-3 pb-2">
          <Button size="sm" variant="outline" icon="delete" onClick={handleClear}>
            Clear
          </Button>
        </div>
        <div
          ref={logRef}
          className="bg-black rounded-b-lg p-4 text-xs font-mono h-[calc(100vh-220px)] overflow-y-auto"
        >
          {logs.length === 0 ? (
            <span className="text-text-muted">No console logs yet.</span>
          ) : (
            <div className="space-y-0.5">
              {logs.map((line, i) => (
                <div key={i}>{colorLine(line)}</div>
              ))}
            </div>
          )}
        </div>
      </Card>
    </div>
  );
}
