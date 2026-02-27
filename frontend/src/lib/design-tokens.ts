export const colors = {
  bgPrimary: "#0A0A0A",
  bgSecondary: "#1A1A1A",
  bgTertiary: "#2A2A2A",
  textPrimary: "#F5F5F0",
  textSecondary: "#A0A090",
  accentPrimary: "#C8FF00",
  accentSecondary: "#FF6B35",
  accentTertiary: "#00D4AA",
  border: "#333333",
  error: "#FF3B30",
  agentOpus: "#C8FF00",
  agentSonnet: "#00D4AA",
  agentHaiku: "#A0A090",
} as const;

export const modelColors: Record<string, string> = {
  opus: colors.agentOpus,
  sonnet: colors.agentSonnet,
  haiku: colors.agentHaiku,
};

export const springs = {
  snappy: { type: "spring" as const, stiffness: 500, damping: 30 },
  default: { type: "spring" as const, stiffness: 300, damping: 25 },
  gentle: { type: "spring" as const, stiffness: 200, damping: 20 },
};
