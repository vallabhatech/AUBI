"use client";
import { useState, useEffect, useRef } from "react";
import { motion } from "framer-motion";
import { ArrowRight, Link, Zap } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

// ─── Ring config (mirrors HexNode) ───────────────────────────────────────────
const RING_R    = 40;
const CIRC      = 2 * Math.PI * RING_R;
const SEG_DEG   = (360 - 5 * 4) / 5; // 68° per segment
const SEG_UNITS = (SEG_DEG / 360) * CIRC;
const MAX_FACTS = 3;

export const RING_CATEGORIES = [
  { key: "code_ownership", color: "#3b82f6", startDeg: -90,        label: "Code Ownership" },
  { key: "expertise",      color: "#f59e0b", startDeg: -90 + 72,   label: "Expertise"      },
  { key: "collaboration",  color: "#8b5cf6", startDeg: -90 + 144,  label: "Collaboration"  },
  { key: "current_focus",  color: "#00f0ff", startDeg: -90 + 216,  label: "Current Focus"  },
  { key: "known_issues",   color: "#ff3366", startDeg: -90 + 288,  label: "Known Issues"   },
] as const;

// ─── Types ────────────────────────────────────────────────────────────────────
interface TimelineItem {
  id: number;
  agentId?: string;
  title: string;
  date: string;
  content: string;
  category: string;
  icon: React.ElementType;
  relatedIds: number[];
  status: "completed" | "in-progress" | "pending";
  energy: number;
  avatarUrl?: string;
  constitutionCounts?: Record<string, number>;
}

interface RadialOrbitalTimelineProps {
  timelineData: TimelineItem[];
  centerLabel?: string;
  centerSublabel?: string;
  onSelect?: (agentId: string | null) => void;
}

// ─── Agent node (avatar + rotating rings) ────────────────────────────────────
function AgentNode({
  item, isExpanded, isRelated,
}: {
  item: TimelineItem;
  isExpanded: boolean;
  isRelated: boolean;
}) {
  const AVG = 28; // avatar diameter

  return (
    <svg
      width={100} height={100}
      viewBox="-50 -50 100 100"
      style={{ overflow: "visible" }}
    >
      {/* Rotating constitution rings */}
      {RING_CATEGORIES.map((cat, i) => {
        const count  = item.constitutionCounts?.[cat.key] ?? 0;
        const filled = (Math.min(count, MAX_FACTS) / MAX_FACTS) * SEG_UNITS;
        return (
          <motion.g
            key={cat.key}
            animate={{ rotate: 360 }}
            transition={{ duration: 9 + i * 2.2, repeat: Infinity, ease: "linear" }}
          >
            <circle
              cx={0} cy={0} r={RING_R}
              fill="none"
              stroke={cat.color}
              strokeWidth={3.5}
              strokeDasharray={`${filled} ${CIRC}`}
              transform={`rotate(${cat.startDeg})`}
              strokeLinecap="round"
              opacity={filled > 0 ? 0.9 : 0.12}
              style={{ filter: filled > 0 ? `drop-shadow(0 0 5px ${cat.color}cc)` : undefined }}
            />
          </motion.g>
        );
      })}

      {/* Selection / related glow ring */}
      {(isExpanded || isRelated) && (
        <circle
          cx={0} cy={0}
          r={RING_R + 6}
          fill="none"
          stroke={isExpanded ? "#00f0ff" : "#00f0ff66"}
          strokeWidth={isExpanded ? 1.5 : 1}
          style={{ filter: isExpanded ? "drop-shadow(0 0 8px #00f0ff)" : undefined }}
        />
      )}

      {/* Avatar background */}
      <circle cx={0} cy={0} r={AVG / 2 + 2} fill="#0d1224" />

      {/* Avatar clip + image */}
      <defs>
        <clipPath id={`oc-${item.id}`}>
          <circle cx={0} cy={0} r={AVG / 2} />
        </clipPath>
      </defs>
      <image
        href={item.avatarUrl}
        x={-AVG / 2} y={-AVG / 2}
        width={AVG} height={AVG}
        clipPath={`url(#oc-${item.id})`}
      />

      {/* Border ring */}
      <circle
        cx={0} cy={0} r={AVG / 2 + 2}
        fill="none"
        stroke={isExpanded ? "#00f0ff" : "#1e2d45"}
        strokeWidth={isExpanded ? 2 : 1.5}
      />
    </svg>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────
export default function RadialOrbitalTimeline({
  timelineData,
  centerLabel = "MESH",
  centerSublabel,
  onSelect,
}: RadialOrbitalTimelineProps) {
  const items = Array.isArray(timelineData) ? timelineData : [];
  const [expandedItems, setExpandedItems] = useState<Record<number, boolean>>({});
  const [rotationAngle, setRotationAngle] = useState<number>(0);
  const [autoRotate, setAutoRotate] = useState<boolean>(true);
  const [pulseEffect, setPulseEffect] = useState<Record<number, boolean>>({});
  const [activeNodeId, setActiveNodeId] = useState<number | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const orbitRef     = useRef<HTMLDivElement>(null);
  const nodeRefs     = useRef<Record<number, HTMLDivElement | null>>({});

  const handleContainerClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target === containerRef.current || e.target === orbitRef.current) {
      setExpandedItems({});
      setActiveNodeId(null);
      setPulseEffect({});
      setAutoRotate(true);
      onSelect?.(null);
    }
  };

  const toggleItem = (id: number) => {
    setExpandedItems((prev) => {
      const next: Record<number, boolean> = {};
      Object.keys(prev).forEach((k) => { next[+k] = false; });
      next[id] = !prev[id];

      if (!prev[id]) {
        setActiveNodeId(id);
        setAutoRotate(false);
        const pulse: Record<number, boolean> = {};
        const item = items.find((d) => d.id === id);
        (item?.relatedIds ?? []).forEach((r) => { pulse[r] = true; });
        setPulseEffect(pulse);
        const idx = items.findIndex((d) => d.id === id);
        setRotationAngle(270 - (idx / Math.max(items.length, 1)) * 360);
        onSelect?.(item?.agentId ?? null);
      } else {
        setActiveNodeId(null);
        setAutoRotate(true);
        setPulseEffect({});
        onSelect?.(null);
      }
      return next;
    });
  };

  useEffect(() => {
    if (!autoRotate) return;
    const t = setInterval(() => {
      setRotationAngle((p) => Number(((p + 0.3) % 360).toFixed(3)));
    }, 50);
    return () => clearInterval(t);
  }, [autoRotate]);

  const calcPos = (index: number, total: number) => {
    const angle  = ((index / total) * 360 + rotationAngle) % 360;
    const radian = (angle * Math.PI) / 180;
    const radius = 260;
    return {
      x:       radius * Math.cos(radian),
      y:       radius * Math.sin(radian),
      zIndex:  Math.round(100 + 50 * Math.cos(radian)),
      opacity: Math.max(0.7, Math.min(1, 0.7 + 0.3 * ((1 + Math.sin(radian)) / 2))),
    };
  };

  const relationshipPairs = timelineData.flatMap((item) =>
    item.relatedIds
      .filter((relatedId) => item.id < relatedId)
      .map((relatedId) => ({ sourceId: item.id, targetId: relatedId }))
  );

  const getStatusStyles = (s: TimelineItem["status"]) =>
    s === "completed"  ? "text-white bg-black border-white" :
    s === "in-progress" ? "text-black bg-white border-black" :
                          "text-white bg-black/40 border-white/50";

  const getStatusLabel = (s: TimelineItem["status"]) =>
    s === "completed" ? "ACTIVE" : s === "in-progress" ? "IN FOCUS" : "STANDBY";

  return (
    <div
      className="w-full h-full flex items-center justify-center overflow-hidden"
      ref={containerRef}
      onClick={handleContainerClick}
    >
      <div className="relative w-full max-w-4xl h-full flex items-center justify-center">
        <div
          className="absolute w-full h-full flex items-center justify-center"
          ref={orbitRef}
          style={{ perspective: "1000px" }}
        >
          {/* Center orb */}
          <div className="absolute flex flex-col items-center justify-center z-10 pointer-events-none select-none">
            <div className="relative w-16 h-16 rounded-full bg-gradient-to-br from-[#00f0ff] via-[#3b82f6] to-[#8b5cf6] animate-pulse flex items-center justify-center">
              <div className="absolute w-20 h-20 rounded-full border border-[#00f0ff]/30 animate-ping opacity-70" />
              <div className="absolute w-28 h-28 rounded-full border border-[#3b82f6]/20 animate-ping opacity-40" style={{ animationDelay: "0.5s" }} />
              <div className="w-8 h-8 rounded-full bg-white/90 backdrop-blur-md" />
            </div>
            <span className="mt-2 font-mono text-[9px] text-[#00f0ff] tracking-[0.2em]">{centerLabel}</span>
            {centerSublabel && <span className="font-mono text-[8px] text-[#4a6080] mt-0.5">{centerSublabel}</span>}
          </div>

          {/* Radial glow backdrop */}
          <div className="absolute w-[560px] h-[560px] rounded-full pointer-events-none" style={{ background: "radial-gradient(circle, #00f0ff08 0%, #3b82f610 35%, transparent 70%)" }} />

          {/* Orbit rings */}
          <div className="absolute w-[520px] h-[520px] rounded-full border border-[#00f0ff]/30 pointer-events-none" style={{ boxShadow: "0 0 18px #00f0ff12 inset" }} />
          <div className="absolute w-[500px] h-[500px] rounded-full border border-[#8b5cf6]/20 pointer-events-none" />
          <div className="absolute w-[200px] h-[200px] rounded-full border border-[#00f0ff]/15 pointer-events-none" />

          {/* Persistent coworker mesh links */}
          <svg
            className="absolute pointer-events-none"
            style={{ left: "50%", top: "50%", transform: "translate(-50%, -50%)", overflow: "visible" }}
            width={0}
            height={0}
          >
            {relationshipPairs.map(({ sourceId, targetId }) => {
              const sourceIndex = timelineData.findIndex((item) => item.id === sourceId);
              const targetIndex = timelineData.findIndex((item) => item.id === targetId);
              if (sourceIndex < 0 || targetIndex < 0) return null;
              const source = calcPos(sourceIndex, timelineData.length);
              const target = calcPos(targetIndex, timelineData.length);
              const active = activeNodeId === sourceId || activeNodeId === targetId;
              return (
                <motion.line
                  key={`${sourceId}-${targetId}`}
                  x1={source.x}
                  y1={source.y}
                  x2={target.x}
                  y2={target.y}
                  stroke={active ? "#00f0ff" : "#8b5cf6"}
                  strokeWidth={active ? 1.5 : 1}
                  strokeOpacity={active ? 0.85 : 0.5}
                  strokeDasharray="4 10"
                  animate={{ strokeDashoffset: [0, -28] }}
                  transition={{ duration: active ? 1 : 2.4, repeat: Infinity, ease: "linear" }}
                  style={{ filter: active ? "drop-shadow(0 0 6px #00f0ff)" : "drop-shadow(0 0 4px #8b5cf6aa)" }}
                />
              );
            })}
          </svg>

          {/* Animated spoke lines from center to each agent */}
          <svg
            className="absolute pointer-events-none"
            style={{ left: "50%", top: "50%", transform: "translate(-50%, -50%)", overflow: "visible" }}
            width={0}
            height={0}
          >
            {items.map((item, index) => {
              const pos        = calcPos(index, Math.max(items.length, 1));
              const isExpanded = !!expandedItems[item.id];
              const lineLen    = Math.sqrt(pos.x * pos.x + pos.y * pos.y);
              return (
                <motion.line
                  key={item.id}
                  x1={0} y1={0}
                  x2={pos.x} y2={pos.y}
                  stroke="#00f0ff"
                  strokeWidth={isExpanded ? 1.5 : 0.8}
                  strokeOpacity={isExpanded ? 0.75 : 0.35}
                  strokeDasharray={`3 ${Math.max(6, lineLen / 8)}`}
                  animate={{ strokeDashoffset: [0, -12] }}
                  transition={{ duration: 1.5, repeat: Infinity, ease: "linear" }}
                  style={{ filter: isExpanded ? "drop-shadow(0 0 5px #00f0ff)" : "drop-shadow(0 0 2px #00f0ff44)" }}
                />
              );
            })}
          </svg>

          {/* Nodes */}
          {items.map((item, index) => {
            const pos        = calcPos(index, Math.max(items.length, 1));
            const isExpanded = !!expandedItems[item.id];
            const isRelated  = !!(activeNodeId && (items.find(d => d.id === activeNodeId)?.relatedIds ?? []).includes(item.id));
            const isPulsing  = !!pulseEffect[item.id];
            const hasAvatar  = !!item.avatarUrl;

            return (
              <div
                key={item.id}
                ref={(el) => { nodeRefs.current[item.id] = el; }}
                className="absolute transition-all duration-700 cursor-pointer"
                style={{
                  transform: `translate(${pos.x}px, ${pos.y}px)`,
                  zIndex:    isExpanded ? 200 : pos.zIndex,
                  opacity:   isExpanded ? 1 : pos.opacity,
                }}
                onClick={(e) => { e.stopPropagation(); toggleItem(item.id); }}
              >
                {/* Zero-size anchor — everything is positioned relative to the orbit point */}
                <div style={{ position: "relative", width: 0, height: 0 }}>

                  {/* Avatar + rings node */}
                  {hasAvatar ? (
                    <div
                      className={`absolute ${isPulsing ? "animate-pulse" : ""}`}
                      style={{ left: -50, top: -50 }}
                    >
                      <AgentNode
                        item={item}
                        isExpanded={isExpanded}
                        isRelated={isRelated}
                      />
                    </div>
                  ) : (
                    /* Fallback icon node */
                    <div
                      className={`absolute flex items-center justify-center w-10 h-10 rounded-full border-2 transition-all duration-300
                        ${isExpanded ? "bg-[#00f0ff] text-[#0a0e1a] border-[#00f0ff] scale-150" :
                          isRelated  ? "bg-[#00f0ff]/20 text-[#00f0ff] border-[#00f0ff] animate-pulse" :
                                       "bg-[#0d1224] text-white border-[#1e2d45]"}`}
                      style={{ left: -20, top: -20 }}
                    >
                      <item.icon size={16} />
                    </div>
                  )}

                  {/* Name label */}
                  <div
                    className={`absolute whitespace-nowrap text-xs font-semibold tracking-wider font-mono transition-all duration-300
                      ${isExpanded ? "text-[#00f0ff]" : "text-white/70"}`}
                    style={{
                      top: hasAvatar ? 56 : 28,
                      left: "50%",
                      transform: "translateX(-50%)",
                    }}
                  >
                    {item.title}
                  </div>

                  {/* Expanded card */}
                  {isExpanded && (
                    <Card
                      className="absolute w-64 bg-[#0d1224]/95 backdrop-blur-lg border-[#1e2d45] shadow-xl shadow-[#00f0ff]/10 overflow-visible"
                      style={{ top: hasAvatar ? 80 : 44, left: "50%", transform: "translateX(-50%)" }}
                    >
                      <div className="absolute -top-3 left-1/2 -translate-x-1/2 w-px h-3 bg-[#00f0ff]/50" />
                      <CardHeader className="pb-2 px-4 pt-4">
                        <div className="flex justify-between items-center">
                          <Badge className={`px-2 text-[9px] ${getStatusStyles(item.status)}`}>
                            {getStatusLabel(item.status)}
                          </Badge>
                          <span className="text-[9px] font-mono text-[#4a6080]">{item.date}</span>
                        </div>
                        <CardTitle className="text-sm mt-2 text-white font-mono">{item.title}</CardTitle>
                      </CardHeader>
                      <CardContent className="text-xs text-[#8aa0c0] px-4 pb-4">
                        <p className="leading-relaxed">{item.content}</p>

                        <div className="mt-3 pt-3 border-t border-[#1e2d45]">
                          <div className="flex justify-between items-center text-[10px] mb-1">
                            <span className="flex items-center gap-1 text-[#4a6080]"><Zap size={9} /> Constitution</span>
                            <span className="font-mono text-[#00f0ff]">{item.energy}%</span>
                          </div>
                          <div className="w-full h-0.5 bg-[#1e2d45] rounded-full overflow-hidden">
                            <div className="h-full bg-gradient-to-r from-[#00f0ff] to-[#8b5cf6]" style={{ width: `${item.energy}%` }} />
                          </div>
                        </div>

                        {(item.relatedIds ?? []).length > 0 && (
                          <div className="mt-3 pt-3 border-t border-[#1e2d45]">
                            <div className="flex items-center mb-2 gap-1">
                              <Link size={9} className="text-[#4a6080]" />
                              <span className="text-[9px] uppercase tracking-wider font-mono text-[#4a6080]">Collaborates with</span>
                            </div>
                            <div className="flex flex-wrap gap-1">
                              {(item.relatedIds ?? []).map((rid) => {
                                const rel = items.find((d) => d.id === rid);
                                return (
                                  <Button
                                    key={rid}
                                    variant="outline"
                                    size="sm"
                                    className="h-6 px-2 py-0 text-[10px] rounded-sm border-[#1e2d45] bg-transparent hover:bg-[#00f0ff]/10 hover:border-[#00f0ff]/40 text-[#8aa0c0] hover:text-[#00f0ff] transition-all font-mono"
                                    onClick={(e) => { e.stopPropagation(); toggleItem(rid); }}
                                  >
                                    {rel?.title}<ArrowRight size={8} className="ml-1 opacity-60" />
                                  </Button>
                                );
                              })}
                            </div>
                          </div>
                        )}
                      </CardContent>
                    </Card>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
