import type { AgentModel } from "@/stores/agent-store";

type ModelBadgeProps = {
  model: AgentModel;
  role?: string;
};

const knownStyles: Record<string, string> = {
  opus: "bg-agent-opus/15 text-agent-opus border-agent-opus/30",
  sonnet: "bg-agent-sonnet/15 text-agent-sonnet border-agent-sonnet/30",
  haiku: "bg-agent-haiku/15 text-agent-haiku border-agent-haiku/30",
  "gemini-pro": "bg-[#4285F4]/15 text-[#4285F4] border-[#4285F4]/30",
  "gemini-flash": "bg-[#FBBC04]/15 text-[#FBBC04] border-[#FBBC04]/30",
  "gemini-lite": "bg-[#34A853]/15 text-[#34A853] border-[#34A853]/30",
  "gpt-5.4": "bg-[#10A37F]/15 text-[#10A37F] border-[#10A37F]/30",
  "gpt-5.4-mini": "bg-[#10A37F]/15 text-[#10A37F] border-[#10A37F]/30",
  "gpt-5.4-nano": "bg-[#10A37F]/15 text-[#10A37F] border-[#10A37F]/30",
};

// OpenRouter model slug → style (match by provider prefix)
const openrouterProviderStyles: Record<string, string> = {
  anthropic: "bg-[#D97706]/15 text-[#D97706] border-[#D97706]/30",
  openai: "bg-[#10A37F]/15 text-[#10A37F] border-[#10A37F]/30",
  google: "bg-[#4285F4]/15 text-[#4285F4] border-[#4285F4]/30",
  meta: "bg-[#0668E1]/15 text-[#0668E1] border-[#0668E1]/30",
  deepseek: "bg-[#5B6EE1]/15 text-[#5B6EE1] border-[#5B6EE1]/30",
  mistralai: "bg-[#FF7000]/15 text-[#FF7000] border-[#FF7000]/30",
};

const defaultStyle = "bg-[#8B5CF6]/15 text-[#8B5CF6] border-[#8B5CF6]/30";

function getStyle(model: string): string {
  // Check known models first
  if (model in knownStyles) return knownStyles[model];

  // OpenRouter slugs: "provider/model-name"
  if (model.includes("/")) {
    const provider = model.split("/")[0];
    return openrouterProviderStyles[provider] || defaultStyle;
  }

  return defaultStyle;
}

function getDisplayName(model: string): string {
  // OpenRouter slugs: show just the model part
  if (model.includes("/")) {
    return model.split("/").pop() || model;
  }
  return model;
}

export function ModelBadge({ model, role }: ModelBadgeProps) {
  return (
    <span
      className={`inline-block px-2 py-0.5 text-[10px] font-semibold uppercase tracking-widest rounded-[2px] border ${getStyle(model)}`}
    >
      {role || getDisplayName(model)}
    </span>
  );
}
