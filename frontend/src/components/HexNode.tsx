"use client";

import { motion } from "framer-motion";
import { coworkerName } from "@/lib/agents";
import type { Agent } from "@/lib/types";

const RING_R = 58;
const CIRC = 2 * Math.PI * RING_R;
const SEG_DEG = (360 - 5 * 4) / 5;
const SEG_UNITS = (SEG_DEG / 360) * CIRC;
const MAX_FACTS = 3;

const RING_CATEGORIES = ["code_ownership", "expertise", "collaboration", "current_focus", "known_issues"] as const;

const CATEGORY_META: Record<(typeof RING_CATEGORIES)[number], { color: string; startDeg: number }> = {
  code_ownership: { color: "#3b82f6", startDeg: -90 },
  expertise:      { color: "#f59e0b", startDeg: -90 + 72 },
  collaboration:  { color: "#8b5cf6", startDeg: -90 + 144 },
  current_focus:  { color: "#00f0ff", startDeg: -90 + 216 },
  known_issues:   { color: "#ff3366", startDeg: -90 + 288 },
};

function hexPoints(size: number): string {
  return Array.from({ length: 6 }, (_, i) => {
    const angle = (Math.PI / 180) * (60 * i - 30);
    return `${size * Math.cos(angle)},${size * Math.sin(angle)}`;
  }).join(" ");
}

function compactLabel(value: string, maxLength: number): string {
  return value.length > maxLength ? `${value.slice(0, maxLength - 3)}...` : value;
}

function roleParts(agent: Agent): string[] {
  const languageParts = agent.github_data_summary.languages;
  if (languageParts.length > 0) return languageParts;

  return agent.role
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
}

function roleSummary(agent: Agent): string {
  const parts = roleParts(agent);
  if (parts.length === 0) return "Profile indexing";
  if (parts.length === 1) return compactLabel(parts[0], 28);

  const visible = parts.slice(0, 3);
  const suffix = parts.length > visible.length ? ` +${parts.length - visible.length}` : "";
  return compactLabel(`${visible.join(" / ")}${suffix}`, 34);
}

interface Props {
  agent: Agent;
  cx: number;
  cy: number;
  isSelected: boolean;
  breathDuration: number;
  compact?: boolean;
  pulsing?: boolean;
  onHover?: () => void;
  onLeave?: () => void;
  onPointerDown?: (e: React.PointerEvent<SVGGElement>) => void;
  onPointerUp?: () => void;
}

export function HexNode({
  agent, cx, cy, isSelected, breathDuration,
  compact = false, pulsing = false,
  onHover, onLeave, onPointerDown, onPointerUp,
}: Props) {
  const hexSize = compact ? 32 : 56;
  const ringR = compact ? 28 : RING_R;
  const avatarSize = compact ? 18 : 38;

  const categories = RING_CATEGORIES;
  const displayName = compactLabel(coworkerName(agent), 18);
  const displayRole = roleSummary(agent);

  return (
    <g
      transform={`translate(${cx},${cy})`}
      style={{ cursor: compact ? "default" : "grab" }}
      onMouseEnter={onHover}
      onMouseLeave={onLeave}
      onPointerDown={onPointerDown}
      onPointerUp={onPointerUp}
    >
      {/* Breathing + hover scale */}
      <motion.g
        animate={{ scale: pulsing ? [1, 1.25, 1] : [1, 1.02, 1] }}
        whileHover={compact ? undefined : { scale: 1.08 }}
        transition={{
          duration: pulsing ? 0.6 : breathDuration,
          repeat: Infinity,
          ease: "easeInOut",
        }}
      >
        {/* Rotating constitution rings */}
        {!compact && categories.map((cat, catIdx) => {
          const meta = CATEGORY_META[cat];
          const count = agent.constitution_facts.filter((f) => f.category === cat).length;
          const filled = (Math.min(count, MAX_FACTS) / MAX_FACTS) * SEG_UNITS;
          const rotDuration = 9 + catIdx * 2.2;

          return (
            <motion.g
              key={cat}
              animate={{ rotate: 360 }}
              transition={{ duration: rotDuration, repeat: Infinity, ease: "linear" }}
            >
              <circle
                cx={0} cy={0} r={ringR}
                fill="none"
                stroke={meta.color}
                strokeWidth={3.5}
                strokeDasharray={`${filled} ${CIRC}`}
                strokeDashoffset={0}
                transform={`rotate(${meta.startDeg})`}
                strokeLinecap="round"
                opacity={filled > 0 ? 0.9 : 0.15}
                style={{
                  filter: filled > 0 ? `drop-shadow(0 0 6px ${meta.color}cc)` : undefined,
                }}
              />
            </motion.g>
          );
        })}

        {/* Static compact rings */}
        {compact && categories.map((cat) => {
          const meta = CATEGORY_META[cat];
          const count = agent.constitution_facts.filter((f) => f.category === cat).length;
          const filled = (Math.min(count, MAX_FACTS) / MAX_FACTS) * ((SEG_DEG / 360) * 2 * Math.PI * ringR);
          const circ = 2 * Math.PI * ringR;
          return (
            <circle
              key={cat}
              cx={0} cy={0} r={ringR}
              fill="none"
              stroke={meta.color}
              strokeWidth={2.5}
              strokeDasharray={`${filled} ${circ}`}
              transform={`rotate(${meta.startDeg})`}
              strokeLinecap="round"
              opacity={filled > 0 ? 0.8 : 0.1}
            />
          );
        })}

        {/* Selected glow ring */}
        {isSelected && (
          <circle
            cx={0} cy={0} r={hexSize + 4}
            fill="none" stroke="#00f0ff" strokeWidth={2}
            style={{ filter: "drop-shadow(0 0 10px #00f0ff)" }}
          />
        )}

        {/* Hex body */}
        <polygon
          points={hexPoints(hexSize)}
          fill={isSelected ? "#111827" : "#0d1224"}
          stroke={isSelected ? "#00f0ff" : "#1e2d45"}
          strokeWidth={isSelected ? 2 : 1.5}
        />

        {/* Avatar */}
        <defs>
          <clipPath id={`clip-${agent.id}`}>
            <circle cx={0} cy={0} r={avatarSize / 2} />
          </clipPath>
        </defs>
        <circle cx={0} cy={0} r={avatarSize / 2 + 2} fill="#0d1224" />
        <image
          href={`https://github.com/${agent.github_username}.png?size=80`}
          x={-avatarSize / 2} y={-avatarSize / 2}
          width={avatarSize} height={avatarSize}
          clipPath={`url(#clip-${agent.id})`}
        />

        {/* Name + role labels */}
        {!compact && (
          <>
            <text
              textAnchor="middle" y={hexSize + 14}
              fontSize={11} fill="#e2e8f0"
              fontFamily="JetBrains Mono, monospace"
              fontWeight={500}
            >
              {displayName}
            </text>
            <text
              textAnchor="middle" y={hexSize + 26}
              fontSize={9} fill="#4a6080"
              fontFamily="JetBrains Mono, monospace"
            >
              {displayRole}
            </text>
          </>
        )}
      </motion.g>

      {/* Pulse ring for incident animation */}
      {pulsing && (
        <motion.circle
          cx={0} cy={0} r={hexSize}
          fill="none" stroke="#8b5cf6" strokeWidth={2}
          animate={{ r: [hexSize, hexSize + 30], opacity: [0.8, 0] }}
          transition={{ duration: 1, repeat: Infinity, ease: "easeOut" }}
        />
      )}
    </g>
  );
}
