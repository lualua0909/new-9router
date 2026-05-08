import { responseToBase64, throwUpstreamError } from "./_base.js";
import { resolveLmStudioHost } from "../../config/providers.js";

export default {
  async synthesize(text, model, credentials) {
    const host = resolveLmStudioHost(credentials);
    let modelId = model || "";
    let voiceId = "default";
    if (modelId.includes("/")) {
      const idx = modelId.lastIndexOf("/");
      voiceId = modelId.slice(idx + 1) || "default";
      modelId = modelId.slice(0, idx);
    }
    if (!modelId) throw new Error("LM Studio TTS requires a model id (load a TTS model in LM Studio first).");

    const headers = { "Content-Type": "application/json" };
    if (credentials?.apiKey) headers["Authorization"] = `Bearer ${credentials.apiKey}`;

    const res = await fetch(`${host}/v1/audio/speech`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: modelId,
        input: text,
        voice: voiceId,
        response_format: "mp3",
      }),
    });
    if (!res.ok) await throwUpstreamError(res);
    return responseToBase64(res, "mp3");
  },
};
