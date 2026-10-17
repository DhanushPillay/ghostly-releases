import type { AIProvider, AIRequestOptions } from "./types";
import { rateLimitError } from "./types";

// Re-checked against OpenRouter's own live catalog (openrouter.ai/api/v1/models, which
// needs no key to list) on 2026-10-17: 2 of the previous 6 entries here
// (nvidia/nemotron-nano-12b-v2-vl:free, nvidia/llama-nemotron-embed-vl-1b-v2:free — the
// second was an embedding model, not even a chat model) no longer exist on OpenRouter at
// all. The "16 FREE" badge on this provider in ApiSetupPage.tsx was also stale leftover
// text from before this list got trimmed down to 6 — OpenRouter genuinely has 16 free
// models live right now, so restored the full set instead of just patching the 2 dead
// ones, with one deliberate exception: nvidia/nemotron-3.5-content-safety:free is a
// moderation/classifier model, not a conversational one, and would have been a second
// instance of the exact "wrong kind of model in a chat-answer picker" mistake the dead
// embedding model above already was. 15 real chat/vision models + Auto.
export const OPENROUTER_FREE_MODELS = [
  { id: "openrouter/auto", name: "Auto (Best Free)", desc: "Automatically selects best free model" },
  { id: "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free", name: "Nemotron 3 Nano Omni 30B", desc: "Reasoning model by NVIDIA" },
  { id: "nvidia/nemotron-3-super-120b-a12b:free", name: "Nemotron 3 Super 120B", desc: "Large general model by NVIDIA" },
  { id: "nvidia/nemotron-3-ultra-550b-a55b:free", name: "Nemotron 3 Ultra 550B", desc: "NVIDIA's largest model, 1M context" },
  { id: "nvidia/nemotron-3.5-lightning:free", name: "Nemotron 3.5 Lightning", desc: "Fast general model by NVIDIA, 1M context" },
  { id: "nvidia/nemotron-3.5-super-vl:free", name: "Nemotron 3.5 Super VL", desc: "Vision-capable model by NVIDIA, 1M context" },
  { id: "google/gemma-4-31b-it:free", name: "Gemma 4 31B IT", desc: "Large instruction model by Google" },
  { id: "google/gemma-4-26b-a4b-it:free", name: "Gemma 4 26B A4B IT", desc: "Fast instruction model by Google" },
  { id: "cohere/north-mini-code:free", name: "North Mini Code", desc: "Code-focused model by Cohere" },
  { id: "dots-studio/dots-3-note-preview:free", name: "Dots3 Note Preview", desc: "512K context model by Dots Studio" },
  { id: "liquid/lfm-2.5-2.6b:free", name: "LFM2.5 2.6B", desc: "Compact fast model by Liquid AI" },
  { id: "poolside/laguna-s-2.1:free", name: "Laguna S 2.1", desc: "General model by Poolside" },
  { id: "poolside/laguna-xs-2.1:free", name: "Laguna XS 2.1", desc: "Compact fast model by Poolside" },
  { id: "thinkingmachines/inkling:free", name: "Inkling", desc: "General model by Thinking Machines, 1M context" },
  { id: "thinkingmachines/inkling-small:free", name: "Inkling Small", desc: "Compact model by Thinking Machines, 1M context" },
  { id: "xingchen-agi/xing4.0-29b-a4b:free", name: "Xing4.0 29B A4B", desc: "General model by XingChen AGI" },
];

export class OpenRouterProvider implements AIProvider {
  name = "openrouter";

  listModels(): string[] {
    return OPENROUTER_FREE_MODELS.map((m) => m.id);
  }

  async *streamSolution(options: AIRequestOptions): AsyncGenerator<string> {
    const { base64Image, prompt, messages = [], model, apiKey, maxTokens = 8192, signal } = options;

    if (!apiKey || !apiKey.trim()) {
      throw new Error("OpenRouter API key missing. Get a free API key at openrouter.ai/keys");
    }

    const requestedModel = model || "openrouter/auto";
    const safeModel = OPENROUTER_FREE_MODELS.some((m) => m.id === requestedModel) ? requestedModel : "openrouter/auto";
    if (safeModel !== requestedModel) {
      // Used to substitute silently — a saved model that no longer matches
      // the current OPENROUTER_FREE_MODELS catalog (this list has already
      // been renamed/replaced between versions once, per nvidia.ts's own
      // history) got rerouted to "auto" with zero indication to the user
      // that their selected model wasn't actually used for this answer.
      console.warn(`[OpenRouter] "${requestedModel}" isn't in the current free-model list — using "openrouter/auto" instead.`);
    }

    const imageUrl = base64Image?.startsWith("data:")
      ? base64Image
      : base64Image
        ? `data:image/png;base64,${base64Image}`
        : undefined;

    // OpenRouter auto model doesn't need vision check - it handles everything
    const apiMessages: any[] = messages.map((m) => ({
      role: m.role,
      content: typeof m.content === "string" ? m.content : String(m.content),
    }));

    if (imageUrl) {
      apiMessages.push({
        role: "user",
        content: [
          { type: "text", text: prompt },
          { type: "image_url", image_url: { url: imageUrl } },
        ],
      });
    } else {
      apiMessages.push({ role: "user", content: prompt });
    }

    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey.trim()}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://ghostly.ai",
        "X-Title": "Ghostly AI",
      },
      body: JSON.stringify({
        model: safeModel,
        messages: apiMessages,
        stream: true,
        max_tokens: maxTokens,
        temperature: 0.7,
      }),
      signal,
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({ error: { message: response.statusText } }));
      if (response.status === 401) {
        throw new Error("Invalid OpenRouter API key. Get a free API key at openrouter.ai/keys");
      }
      const message = `OpenRouter API error: ${err.error?.message || response.statusText}`;
      if (response.status === 429) throw rateLimitError(message);
      throw new Error(message);
    }

    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        if (line.startsWith("data: ") && line !== "data: [DONE]") {
          try {
            const data = JSON.parse(line.slice(6));
            const text = data.choices?.[0]?.delta?.content;
            if (text) yield text;
          } catch {
            /* skip malformed chunks */
          }
        }
      }
    }
  }
}
