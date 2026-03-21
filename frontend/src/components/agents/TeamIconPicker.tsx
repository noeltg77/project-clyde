"use client";

import { useState, useMemo, useRef, useEffect } from "react";
import { icons, type LucideIcon } from "lucide-react";

/**
 * Curated icons shown by default before the user searches.
 * Covers common team functions: engineering, design, content, marketing,
 * testing, analytics, ops, security, support, research, finance, HR, etc.
 */
const FEATURED_ICONS = [
  "Code", "Palette", "PenTool", "FlaskConical", "Megaphone",
  "BarChart3", "Shield", "Rocket", "Users", "Lightbulb",
  "Wrench", "Globe", "BookOpen", "Camera", "HeartPulse",
  "Cpu", "Database", "Layers", "Target", "Zap",
  "Briefcase", "Building2", "GraduationCap", "Headphones", "Mail",
  "MessageSquare", "Music", "Newspaper", "Phone", "Search",
  "ShoppingCart", "Star", "TrendingUp", "Video", "Wand2",
];

type TeamIconPickerProps = {
  value: string;
  teamColor: string;
  onSelect: (iconName: string) => void;
  onClose: () => void;
};

export function TeamIconPicker({ value, teamColor, onSelect, onClose }: TeamIconPickerProps) {
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const pickerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Close on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [onClose]);

  // Filter icons based on search query
  const filteredIcons = useMemo(() => {
    const allNames = Object.keys(icons);

    if (!query.trim()) {
      // Show featured icons when no search
      return FEATURED_ICONS.filter((name) => name in icons);
    }

    const q = query.toLowerCase();
    return allNames
      .filter((name) => name.toLowerCase().includes(q))
      .slice(0, 60); // Cap results for performance
  }, [query]);

  return (
    <div
      ref={pickerRef}
      className="absolute top-8 left-1/2 -translate-x-1/2 z-50 bg-bg-secondary border border-border rounded-[4px] shadow-xl"
      style={{ width: 280 }}
    >
      {/* Search input */}
      <div className="p-3 pb-2">
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") onClose();
          }}
          placeholder="Search icons..."
          className="w-full px-2.5 py-1.5 text-sm bg-bg-tertiary border border-border rounded-[2px] text-text-primary placeholder:text-text-secondary/30 outline-none focus:border-accent-primary/50"
        />
      </div>

      {/* Icon grid */}
      <div className="px-3 pb-3 max-h-[240px] overflow-y-auto">
        {filteredIcons.length === 0 ? (
          <p className="text-[11px] text-text-secondary/40 text-center py-6">
            No icons found
          </p>
        ) : (
          <div className="grid grid-cols-7 gap-1">
            {filteredIcons.map((name) => {
              const IconComponent = icons[name as keyof typeof icons] as LucideIcon;
              if (!IconComponent) return null;
              const isSelected = name === value;

              return (
                <button
                  key={name}
                  onClick={() => onSelect(name)}
                  className={`
                    w-[34px] h-[34px] flex items-center justify-center rounded-[3px]
                    transition-colors cursor-pointer
                    ${isSelected
                      ? "ring-1 ring-accent-primary"
                      : "hover:bg-white/[0.06]"
                    }
                  `}
                  style={isSelected ? { backgroundColor: `${teamColor}26` } : undefined}
                  title={name}
                >
                  <IconComponent
                    size={16}
                    strokeWidth={1.75}
                    color={isSelected ? teamColor : "rgba(255,255,255,0.5)"}
                  />
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Footer with selected icon name */}
      {value && (
        <div className="px-3 py-2 border-t border-border">
          <p className="text-[10px] text-text-secondary/40 font-mono truncate">
            {value}
          </p>
        </div>
      )}
    </div>
  );
}

/**
 * Renders a Lucide icon by name. Falls back to Users icon.
 */
export function DynamicIcon({
  name,
  size = 18,
  color,
  strokeWidth = 1.75,
}: {
  name: string;
  size?: number;
  color?: string;
  strokeWidth?: number;
}) {
  const IconComponent = icons[name as keyof typeof icons] as LucideIcon | undefined;
  const Fallback = icons.Users as LucideIcon;
  const Icon = IconComponent || Fallback;
  return <Icon size={size} strokeWidth={strokeWidth} color={color} />;
}

/**
 * Exported curated list for backend reference.
 * These are the icon names Clyde can choose from by default.
 */
export const CURATED_ICON_NAMES = FEATURED_ICONS;
