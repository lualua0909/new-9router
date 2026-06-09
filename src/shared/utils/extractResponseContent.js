function extractTextContent(value) {
  if (!value) return "";
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    return value.map((part) => (typeof part === "string" ? part : part?.text || "")).join("");
  }
  return "";
}

function extractReasoningFromMessage(message) {
  if (!message) return "";
  const reasoning = message.reasoning_content || message.reasoning;
  if (reasoning) return extractTextContent(reasoning);
  if (Array.isArray(message.reasoning_details)) {
    return message.reasoning_details.map((detail) => detail?.text || "").join("");
  }
  return "";
}

export function extractContentFromJson(data) {
  if (!data) return "";
  const choice = data.choices?.[0];
  const message = choice?.message;
  if (message) {
    const content = extractTextContent(message.content);
    if (content) return content;
    const reasoning = extractReasoningFromMessage(message);
    if (reasoning) return reasoning;
  }
  if (choice?.delta) {
    const deltaContent = extractTextContent(choice.delta.content);
    if (deltaContent) return deltaContent;
    const deltaReasoning = choice.delta.reasoning_content || choice.delta.reasoning;
    if (deltaReasoning) return extractTextContent(deltaReasoning);
  }
  if (typeof data.content === "string") return data.content;
  if (Array.isArray(data.content)) {
    return data.content
      .filter((part) => part?.type === "text" || typeof part === "string")
      .map((part) => (typeof part === "string" ? part : part.text || ""))
      .join("");
  }
  return "";
}

export function getStreamDeltaText(obj) {
  const delta = obj.choices?.[0]?.delta;
  if (delta) {
    const content = extractTextContent(delta.content);
    if (content) return content;
    const reasoning = delta.reasoning_content || delta.reasoning;
    if (reasoning) return extractTextContent(reasoning);
  }
  const message = obj.choices?.[0]?.message;
  if (message) {
    const content = extractTextContent(message.content);
    if (content) return content;
    const reasoning = extractReasoningFromMessage(message);
    if (reasoning) return reasoning;
  }
  if (obj.type === "content_block_delta" && obj.delta?.type === "text_delta") return obj.delta.text || "";
  return "";
}

export function extractContentFromSSE(sseText) {
  let out = "";
  for (const line of sseText.split("\n")) {
    const t = line.trim();
    if (!t.startsWith("data:")) continue;
    const payload = t.slice(5).trim();
    if (!payload || payload === "[DONE]") continue;
    try {
      out += getStreamDeltaText(JSON.parse(payload));
    } catch {}
  }
  return out;
}
