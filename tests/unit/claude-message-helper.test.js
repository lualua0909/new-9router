import { describe, it, expect } from "vitest";
import {
  openAIChatCompletionToClaudeMessage,
  claudeMessageToOpenAIChatCompletion,
  normalizeClaudeMessage,
  isClaudeMessageResponse,
} from "../../open-sse/translator/helpers/claudeMessageHelper.js";

describe("claudeMessageHelper", () => {
  const openAIResponse = {
    id: "chatcmpl-ii0axweotvc4hvn59islnx",
    object: "chat.completion",
    created: 1780650393,
    model: "crow-4b-opus-4.6-distill-heretic_qwen3.5",
    choices: [{
      index: 0,
      message: {
        role: "assistant",
        content: "Hello. I am ready to proceed.",
        tool_calls: [],
      },
      finish_reason: "stop",
    }],
    usage: { prompt_tokens: 10, completion_tokens: 6, total_tokens: 16 },
  };

  it("converts OpenAI chat.completion to Anthropic message shape", () => {
    const result = openAIChatCompletionToClaudeMessage(openAIResponse, "fallback-model");

    expect(result).toEqual({
      id: "msg_ii0axweotvc4hvn59islnx",
      type: "message",
      role: "assistant",
      model: "crow-4b-opus-4.6-distill-heretic_qwen3.5",
      content: [{ type: "text", text: "Hello. I am ready to proceed." }],
      stop_reason: "end_turn",
      stop_sequence: null,
      usage: { input_tokens: 10, output_tokens: 6 },
    });
    expect(result.choices).toBeUndefined();
    expect(result.object).toBeUndefined();
  });

  it("maps tool_calls finish_reason to tool_use stop_reason", () => {
    const result = openAIChatCompletionToClaudeMessage({
      ...openAIResponse,
      choices: [{
        index: 0,
        message: {
          role: "assistant",
          content: "",
          tool_calls: [{
            id: "call_1",
            type: "function",
            function: { name: "get_weather", arguments: "{\"city\":\"Paris\"}" },
          }],
        },
        finish_reason: "tool_calls",
      }],
    }, "model");

    expect(result.stop_reason).toBe("tool_use");
    expect(result.content).toEqual([
      { type: "tool_use", id: "call_1", name: "get_weather", input: { city: "Paris" } },
    ]);
  });

  it("converts Anthropic message back to OpenAI chat.completion", () => {
    const claude = {
      id: "msg_01ABC",
      type: "message",
      role: "assistant",
      model: "claude-opus-4-20250514",
      content: [{ type: "text", text: "Hello. I am ready to proceed." }],
      stop_reason: "end_turn",
      usage: { input_tokens: 10, output_tokens: 6 },
    };

    const result = claudeMessageToOpenAIChatCompletion(claude);

    expect(result.id).toBe("chatcmpl-msg_01ABC");
    expect(result.object).toBe("chat.completion");
    expect(result.choices[0].message.content).toBe("Hello. I am ready to proceed.");
    expect(result.choices[0].finish_reason).toBe("stop");
    expect(result.usage).toEqual({
      prompt_tokens: 10,
      completion_tokens: 6,
      total_tokens: 16,
    });
  });

  it("normalizes native Anthropic responses", () => {
    const result = normalizeClaudeMessage({
      id: "msg_native",
      type: "message",
      role: "assistant",
      model: "claude-sonnet",
      content: [{ type: "text", text: "Hi" }],
      stop_reason: "end_turn",
      usage: { input_tokens: 3, output_tokens: 1 },
    }, "fallback");

    expect(isClaudeMessageResponse(result)).toBe(true);
    expect(result.id).toBe("msg_native");
    expect(result.stop_sequence).toBeNull();
  });

  it("round-trips OpenAI → Anthropic → OpenAI", () => {
    const anthropic = openAIChatCompletionToClaudeMessage(openAIResponse, "model");
    const openai = claudeMessageToOpenAIChatCompletion(anthropic);

    expect(openai.choices[0].message.content).toBe("Hello. I am ready to proceed.");
    expect(openai.choices[0].finish_reason).toBe("stop");
  });
});
