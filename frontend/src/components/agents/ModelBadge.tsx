type ModelBadgeProps = {
  model: "opus" | "sonnet" | "haiku";
  role?: string;
};

const styles = {
  opus: "bg-agent-opus/15 text-agent-opus border-agent-opus/30",
  sonnet: "bg-agent-sonnet/15 text-agent-sonnet border-agent-sonnet/30",
  haiku: "bg-agent-haiku/15 text-agent-haiku border-agent-haiku/30",
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
