import type { AgentPlatform } from "@/stores/agent-store";
import Image from "next/image";

type PlatformLogoProps = {
  platform: AgentPlatform;
  size?: number;
};

const logoMap: Record<AgentPlatform, string> = {
  claude: "/platforms/anthropic.svg",
  gemini: "/platforms/gemini.svg",
  openai: "/platforms/openai.svg",
};

const altMap: Record<AgentPlatform, string> = {
  claude: "Anthropic",
  gemini: "Gemini",
  openai: "OpenAI",
};

export function PlatformLogo({ platform, size = 18 }: PlatformLogoProps) {
  return (
    <Image
      src={logoMap[platform]}
      alt={altMap[platform]}
      width={size}
      height={size}
      className="shrink-0"
    />
  );
}
