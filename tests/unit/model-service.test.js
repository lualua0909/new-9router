import { describe, expect, it } from "vitest";

import { parseModel } from "../../open-sse/services/model.js";

describe("parseModel", () => {
  it("resolves HuggingFace provider alias for nested model ids", () => {
    expect(parseModel("hf/openai/whisper-large-v3")).toEqual({
      provider: "huggingface",
      model: "openai/whisper-large-v3",
      isAlias: false,
      providerAlias: "hf",
    });
  });
});
