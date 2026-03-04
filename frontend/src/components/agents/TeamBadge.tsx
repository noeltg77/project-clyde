type TeamBadgeProps = {
  name: string;
  color: string;
};

export function TeamBadge({ name, color }: TeamBadgeProps) {
  return (
    <span
      className="inline-block px-2 py-0.5 text-[10px] font-semibold uppercase tracking-widest rounded-[2px] border"
      style={{
        backgroundColor: `${color}26`,
        color: color,
        borderColor: `${color}4D`,
      }}
    >
      {name}
    </span>
  );
}
