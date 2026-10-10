import { HttpError } from "@/lib/api/http";

export interface AiConfig {
  provider: "openai" | "anthropic";
  apiKey: string;
  model: string;
}

export function loadAiConfig(env: NodeJS.ProcessEnv = process.env): AiConfig {
  const provider = (env.AI_PROVIDER?.trim() || "openai").toLowerCase();
  if (provider !== "openai" && provider !== "anthropic") throw new HttpError("AI_PROVIDER_ERROR", "Unsupported AI provider");
  const apiKey = (provider === "anthropic" ? env.ANTHROPIC_API_KEY : env.OPENAI_API_KEY)?.trim() ?? "";
  if (!apiKey) throw new HttpError("AI_NOT_CONFIGURED", "AI is not configured");
  return {
    provider,
    apiKey,
    model: env.AI_MODEL?.trim() || (provider === "anthropic" ? "claude-3-5-sonnet-latest" : "gpt-4o-mini"),
  };
}
