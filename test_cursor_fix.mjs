import { FORMATS } from './open-sse/translator/formats.js';
import { translateRequest } from './open-sse/translator/index.js';

// Test: Cursor translator should remove tools
const openaiBody = {
  model: "cursor/default",
  messages: [
    { role: "user", content: "Analyze this URL: https://example.com" }
  ],
  tools: [
    { type: "web_search" },
    { type: "function", function: { name: "web_fetch", description: "Fetch a URL", parameters: { type: "object", properties: { url: { type: "string" } } } } }
  ],
  max_tokens: 128
};

try {
  const cursorRequest = translateRequest(
    FORMATS.OPENAI,
    FORMATS.CURSOR,
    "default",
    openaiBody,
    false,
    null,
    "cursor"
  );

  console.log("Test: Cursor translator removes tools");
  console.log("  Has 'tools' field:", "tools" in cursorRequest);
  if ("tools" in cursorRequest) {
    console.log("  ❌ FAIL");
    process.exit(1);
  } else {
    console.log("  ✅ PASS");
  }
} catch (e) {
  console.error("❌ Test failed:", e.message);
  process.exit(1);
}
