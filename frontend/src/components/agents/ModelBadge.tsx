import type { AgentModel } from "@/stores/agent-store";

type ModelBadgeProps = {
  model: AgentModel;
  role?: string;
};

const styles: Record<AgentModel, string> = {
  opus: "bg-agent-opus/15 text-agent-opus border-agent-opus/30",
  sonnet: "bg-agent-sonnet/15 text-agent-sonnet border-agent-sonnet/30",
  haiku: "bg-agent-haiku/15 text-agent-haiku border-agent-haiku/30",
  "gemini-pro": "bg-[#4285F4]/15 text-[#4285F4] border-[#4285F4]/30",
  "gemini-flash": "bg-[#FBBC04]/15 text-[#FBBC04] border-[#FBBC04]/30",
  "gemini-lite": "bg-[#34A853]/15 text-[#34A853] border-[#34A853]/30",
  "openai-full": "bg-[#10A37F]/15 text-[#10A37F] border-[#10A37F]/30",
  "openai-mini": "bg-[#10A37F]/15 text-[#10A37F] border-[#10A37F]/30",
  "openai-nano": "bg-[#10A37F]/15 text-[#10A37F] border-[#10A37F]/30",
};

export function ModelBadge({ model, role }: ModelBadgeProps) {
  return (
    <span
      className={`inline-block px-2 py-0.5 text-[10px] font-semibold uppercase tracking-widest rounded-[2px] border ${styles[model]}`}
    >
      {role || model}
    </span>
  );
}
