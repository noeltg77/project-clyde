"use client";

import Image from "next/image";

type AgentAvatarProps = {
  src?: string;
  name: string;
  size?: number;
  modelTier?: "opus" | "sonnet" | "haiku";
};

const borderColors = {
  opus: "border-agent-opus",
  sonnet: "border-agent-sonnet",
  haiku: "border-agent-haiku",
};

export function AgentAvatar({
  src,
  name,
  size = 40,
  modelTier = "opus",
}: AgentAvatarProps) {
  return (
    <div
      className={`relative rounded-full overflow-hidden border-2 ${borderColors[modelTier]} flex-shrink-0`}
      style={{ width: size, height: size }}
    >
      {/* Initials fallback — rendered behind the image, visible when image fails */}
      <div className="absolute inset-0 z-0 flex items-center justify-center bg-bg-primary">
        <span
          className="font-mono font-bold text-accent-primary"
          style={{ fontSize: size * 0.35 }}
        >
          {name.charAt(0).toUpperCase()}
        </span>
      </div>
      {src && (
        <Image
          src={src}
          alt={name}
          fill
          sizes={`${size}px`}
          className="object-cover z-10"
          onError={(e) => {
            // Hide image on error to reveal initials underneath
            const target = e.target as HTMLImageElement;
            target.style.display = "none";
          }}
        />
      )}
    </div>
  );
}
