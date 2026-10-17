import type { AIProvider, AIRequestOptions } from "./types";
import { rateLimitError, extractApiErrorMessage } from "./types";

export const NVIDIA_MODELS = [
  // All 3 of this list's previous IDs had reached end of life and were pulled from
  // NVIDIA's catalog entirely: nemotron-super-49b-v1.5 and llama-3.3-70b-instruct both
  // EOL'd 2026-08-26, mixtral-8x7b-instruct-v0.1 EOL'd 2026-07-27 — confirmed directly
  // against the live endpoint (POST .../v1/chat/completions returns HTTP 410 "has
  // reached its end of life" for each), not just the catalog's product pages, since
  // those kept showing the old IDs as if nothing had changed. Every NVIDIA call had
  // been failing for every user since the first of those EOL dates. Replaced with 3
  // IDs individually confirmed live the same way (a bad key gets HTTP 403 "Authorization
  // failed", not 410/404 — proof the model itself resolves) as of 2026-10-17.
  { id: "nvidia/llama-3.1-nemotron-70b-instruct", name: "Llama 3.1 Nemotron 70B Instruct" },
  { id: "mistralai/mixtral-8x22b-v0.1", name: "Mixtral 8x22B" },
  { id: "deepseek-ai/deepseek-v4.1-flash", name: "DeepSeek V4.1 Flash" },
];

export class NvidiaProvider implements AIProvider {
  name = "NVIDIA";

  async *streamSolution(options: AIRequestOptions): AsyncGenerator<string> {
    let { prompt, messages = [], model, apiKey, base64Image, maxTokens = 4096 } = options;

    // Clean model name
    model = model.trim().replace(/\s+/g, "");

    try {
      let finalPrompt = prompt;
      if (base64Image) {
        finalPrompt = `[Note: User shared a screenshot but this model doesn't support images. Please ask them to describe what they see.]\n\n${prompt}`;
      }

      const body = {
        model,
        messages: [
          ...messages.map((m) => ({ role: m.role, content: m.content })),
          { role: "user", content: finalPrompt },
        ],
        temperature: 0.7,
        top_p: 0.9,
        max_tokens: maxTokens,
        stream: false,
      };

      console.log("[NVIDIA] Calling via Electron proxy");
      console.log("[NVIDIA] Model:", model);

      const result = await window.ghostly.nvidiaApiCall(apiKey, body);

      console.log("[NVIDIA] Response status:", result.status);

      if (!result.ok) {
        console.error("[NVIDIA] API error:", result.data);
        const message = extractApiErrorMessage(result.data, "NVIDIA", result.status);
        if (result.status === 429) throw rateLimitError(message);
        throw new Error(message);
      }

      const response = JSON.parse(result.data);
      const content = response.choices?.[0]?.message?.content;
      
      if (content) {
        yield content;
      } else {
        throw new Error("No content in NVIDIA response");
      }
    } catch (error) {
      console.error("[NVIDIA] Provider error:", error);
      throw error;
    }
  }

  listModels(): string[] {
    return NVIDIA_MODELS.map((m) => m.id);
  }
}
