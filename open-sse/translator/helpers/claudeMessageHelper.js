/**
 * Non-streaming Anthropic Messages API ↔ OpenAI Chat Completions conversion.
 */

export function isClaudeMessageResponse(responseBody) {
  if (!responseBody || typeof responseBody !== "object") return false;
  if (responseBody.type === "message" && Array.isArray(responseBody.content)) return true;
  if (Array.isArray(responseBody.content) && !responseBody.choices) return true;
  return false;
}

export function isOpenAIChatCompletionResponse(responseBody) {
  return Array.isArray(responseBody?.choices) && responseBody.choices.length > 0;
}

export function toClaudeMessageId(id) {
  const raw = String(id || `msg_${Date.now()}`);
  if (raw.startsWith("msg_")) return raw;
  return raw.replace(/^chatcmpl-/, "msg_");
}

export function openAIFinishReasonToStopReason(finishReason, hasToolCalls = false) {
  if (hasToolCalls) return "tool_use";
  switch (finishReason) {
    case "tool_calls":
      return "tool_use";
    case "length":
    case "max_tokens":
      return "max_tokens";
    case "content_filter":
    case "stop_sequence":
      return "stop_sequence";
    case "end_turn":
      return "end_turn";
    default:
      return "end_turn";
  }
}

export function claudeStopReasonToFinishReason(stopReason, hasToolCalls = false) {
  if (hasToolCalls) return "tool_calls";
  switch (stopReason) {
    case "tool_use":
      return "tool_calls";
    case "max_tokens":
      return "length";
    case "stop_sequence":
      return "stop";
    case "end_turn":
    case "pause_turn":
      return "stop";
    default:
      return "stop";
  }
}

function buildClaudeContentBlocks(message = {}) {
  const content = [];

  if (message.reasoning_content || message.reasoning) {
    content.push({ type: "thinking", thinking: message.reasoning_content || message.reasoning });
  }

  const text = message.content;
  if (typeof text === "string" && text.length > 0) {
    content.push({ type: "text", text });
  } else if (Array.isArray(text)) {
    for (const part of text) {
      if (typeof part === "string") content.push({ type: "text", text: part });
      else if (part?.type === "text" && typeof part.text === "string") content.push({ type: "text", text: part.text });
      else if (part?.type === "thinking" && typeof part.thinking === "string") content.push({ type: "thinking", thinking: part.thinking });
      else if (part?.type === "tool_use") content.push(part);
    }
  }

  if (Array.isArray(message.tool_calls)) {
    for (const toolCall of message.tool_calls) {
      if (toolCall?.type !== "function") continue;
      let input = {};
      try {
        input = toolCall.function?.arguments ? JSON.parse(toolCall.function.arguments) : {};
      } catch {
        input = { arguments: toolCall.function?.arguments || "" };
      }
      content.push({
        type: "tool_use",
        id: toolCall.id,
        name: toolCall.function?.name || "tool",
        input,
      });
    }
  }

  if (content.length === 0) content.push({ type: "text", text: "" });
  return content;
}

function buildClaudeUsage(usage = {}) {
  const inputTokens = usage.input_tokens ?? usage.prompt_tokens ?? 0;
  const outputTokens = usage.output_tokens ?? usage.completion_tokens ?? 0;
  const result = { input_tokens: inputTokens, output_tokens: outputTokens };

  const cacheRead = usage.cache_read_input_tokens ?? usage.prompt_tokens_details?.cached_tokens;
  const cacheCreate = usage.cache_creation_input_tokens ?? usage.prompt_tokens_details?.cache_creation_tokens;
  if (cacheRead) result.cache_read_input_tokens = cacheRead;
  if (cacheCreate) result.cache_creation_input_tokens = cacheCreate;

  return result;
}

/**
 * OpenAI chat.completion (or Gemini-normalized equivalent) → Anthropic message.
 */
export function openAIChatCompletionToClaudeMessage(responseBody, fallbackModel) {
  if (isClaudeMessageResponse(responseBody)) {
    return normalizeClaudeMessage(responseBody, fallbackModel);
  }

  const choice = responseBody?.choices?.[0] || {};
  const message = choice.message || {};
  const content = buildClaudeContentBlocks(message);
  const hasToolCalls = content.some((block) => block.type === "tool_use");

  return {
    id: toClaudeMessageId(responseBody?.id),
    type: "message",
    role: "assistant",
    model: responseBody?.model || fallbackModel || "unknown",
    content,
    stop_reason: openAIFinishReasonToStopReason(choice.finish_reason, hasToolCalls),
    stop_sequence: null,
    usage: buildClaudeUsage(responseBody?.usage),
  };
}

/**
 * Anthropic message → OpenAI chat.completion.
 */
export function claudeMessageToOpenAIChatCompletion(responseBody) {
  if (isOpenAIChatCompletionResponse(responseBody)) return responseBody;
  if (!responseBody?.content) return responseBody;

  let textContent = "";
  let thinkingContent = "";
  const toolCalls = [];

  for (const block of responseBody.content) {
    if (block.type === "text") {
      const raw = block.text ?? "";
      const text = raw.replace(/^\s*```\s*json\s*\n?/i, "").replace(/\n?\s*```\s*$/i, "");
      textContent += text;
    } else if (block.type === "thinking") {
      thinkingContent += block.thinking || "";
    } else if (block.type === "tool_use") {
      toolCalls.push({
        id: block.id,
        type: "function",
        function: { name: block.name, arguments: JSON.stringify(block.input || {}) },
      });
    }
  }

  const message = { role: "assistant" };
  if (textContent) message.content = textContent;
  if (thinkingContent) message.reasoning_content = thinkingContent;
  if (toolCalls.length > 0) message.tool_calls = toolCalls;
  if (!message.content && !message.tool_calls) message.content = "";

  let finishReason = responseBody.stop_reason || "stop";
  if (finishReason === "end_turn") finishReason = "stop";
  if (finishReason === "tool_use") finishReason = "tool_calls";

  const result = {
    id: `chatcmpl-${responseBody.id || Date.now()}`,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model: responseBody.model || "claude",
    choices: [{
      index: 0,
      message,
      finish_reason: finishReason,
    }],
  };

  if (responseBody.usage) {
    result.usage = {
      prompt_tokens: responseBody.usage.input_tokens || 0,
      completion_tokens: responseBody.usage.output_tokens || 0,
      total_tokens: (responseBody.usage.input_tokens || 0) + (responseBody.usage.output_tokens || 0),
    };
  }

  return result;
}

/**
 * Normalize native Anthropic message responses for client output.
 */
export function normalizeClaudeMessage(responseBody, model) {
  const content = Array.isArray(responseBody.content)
    ? responseBody.content
    : [{ type: "text", text: String(responseBody.content || "") }];

  const hasToolUse = content.some((block) => block.type === "tool_use");
  let stopReason = responseBody.stop_reason || null;
  if (!stopReason) {
    stopReason = hasToolUse ? "tool_use" : "end_turn";
  }

  return {
    id: toClaudeMessageId(responseBody.id),
    type: "message",
    role: responseBody.role || "assistant",
    model: responseBody.model || model || "unknown",
    content,
    stop_reason: stopReason,
    stop_sequence: responseBody.stop_sequence ?? null,
    usage: buildClaudeUsage(responseBody.usage),
  };
}
