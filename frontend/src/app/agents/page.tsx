"use client";

import { useState, useMemo, useRef, useEffect, useCallback } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useAgents } from "@/hooks/useAgents";
import { DossierPanel } from "@/components/DossierPanel";
import { api } from "@/lib/api";
import { coworkerName } from "@/lib/agents";
import { ShimmerButton } from "@/components/ui/shimmer-button";
import { BorderBeam } from "@/components/ui/border-beam";
import type { Agent } from "@/lib/types";

// ── Constitution category colours ──────────────────────────────────────────
const CAT_COLORS: Record<string, string> = {
  code_ownership: "#39ff14",
  expertise:      "#e8e4dc",
  collaboration:  "#8b5cf6",
  current_focus:  "#f59e0b",
  known_issues:   "#ff3366",
};

// ── Connection logic ───────────────────────────────────────────────────────
type MeshConnection = {
  a: number; b: number;
  score: number; label: string;
  evidence: string[];
  category: keyof typeof CAT_COLORS;
};

const STOP_WORDS = new Set([
  "and","the","with","from","this","that","there","their","repo","repos",
  "directory","directories","file","files","active","recent","contributions",
  "significant","working","focus","based","provided","activity","data",
]);

function topDirectory(path: string): string {
  const clean = path.trim().replace(/^\/+/, "");
  if (!clean) return "";
  if (!clean.includes("/")) return clean.toLowerCase();
  return `${clean.split("/")[0].toLowerCase()}/`;
}
function unique(values: string[]): string[] {
  return Array.from(new Set(values.map((v) => v.trim()).filter(Boolean)));
}
function overlap(left: string[], right: string[]): string[] {
  const rs = new Set(right.map((v) => v.toLowerCase()));
  return unique(left.filter((v) => rs.has(v.toLowerCase())));
}
function factObjects(agent: Agent, category: string): string[] {
  return (agent.constitution_facts ?? []).filter((f) => f.category === category).map((f) => f.object).filter(Boolean);
}
function ownershipPaths(agent: Agent): string[] {
  const fromFacts = factObjects(agent, "code_ownership").flatMap((o) =>
    (o.match(/[A-Za-z0-9_.-]+\/[A-Za-z0-9_./-]*/g) ?? []).map(topDirectory)
  );
  const fromSummary = (agent.github_data_summary?.top_files ?? []).map(topDirectory);
  return unique([...fromFacts, ...fromSummary]).filter((v) => v.length > 1);
}
function languages(agent: Agent): string[] {
  return unique(agent.github_data_summary?.languages ?? []).slice(0, 8);
}
function repos(agent: Agent): string[] {
  return unique([...(agent.github_data_summary?.target_repos ?? []), ...(agent.github_data_summary?.repos_considered ?? [])]);
}
function tokensFromFacts(agent: Agent, categories: string[]): string[] {
  return unique(
    categories.flatMap((c) => factObjects(agent, c))
      .flatMap((o) => o.toLowerCase().split(/[^a-z0-9_.-]+/))
      .filter((t) => t.length > 3 && !STOP_WORDS.has(t))
  );
}
function readableList(values: string[], max = 2): string {
  return values.slice(0, max).join(", ");
}
function connectionKey(conn: MeshConnection, agents: Agent[]): string {
  return `${agents[conn.a]?.id ?? conn.a}-${agents[conn.b]?.id ?? conn.b}-${conn.category}-${conn.label}`;
}
function buildConnection(a: Agent, b: Agent, ai: number, bi: number): MeshConnection | null {
  const sharedDirs  = overlap(ownershipPaths(a), ownershipPaths(b));
  const sharedLangs = overlap(languages(a), languages(b));
  const sharedRepos = overlap(repos(a), repos(b));
  const sharedFocus = overlap(tokensFromFacts(a, ["current_focus","known_issues"]), tokensFromFacts(b, ["current_focus","known_issues"]));
  const evidence: string[] = [];
  if (sharedDirs.length)  evidence.push(`both touch ${readableList(sharedDirs, 3)}`);
  if (sharedFocus.length) evidence.push(`related focus: ${readableList(sharedFocus, 3)}`);
  if (sharedLangs.length) evidence.push(`shared stack: ${readableList(sharedLangs, 3)}`);
  if (sharedRepos.length) evidence.push(`same repo: ${readableList(sharedRepos, 2)}`);
  const score = sharedDirs.length * 5 + sharedFocus.length * 3 + sharedLangs.length * 1.25 + sharedRepos.length;
  if (score < 3.5 || !evidence.length) return null;
  const category = sharedDirs.length ? "code_ownership" : sharedFocus.length ? "current_focus" : sharedLangs.length ? "expertise" : "collaboration";
  return { a: ai, b: bi, score, label: sharedDirs[0] ?? sharedFocus[0] ?? sharedLangs[0] ?? "repo", evidence, category };
}
function meshConnections(agents: Agent[]): MeshConnection[] {
  const links: MeshConnection[] = [];
  for (let i = 0; i < agents.length; i++)
    for (let j = i + 1; j < agents.length; j++) {
      const link = buildConnection(agents[i], agents[j], i, j);
      if (link) links.push(link);
    }
  return links.sort((l, r) => r.score - l.score).slice(0, Math.max(agents.length, 4));
}

// ── Feature 4: Fact ticker text ────────────────────────────────────────────
function tickerFact(agent: Agent, tick: number): string {
  const facts = (agent.constitution_facts ?? []).filter((f) =>
    ["current_focus","expertise","known_issues","code_ownership"].includes(f.category)
  );
  if (!facts.length) return `${agent.github_data_summary?.commit_count ?? 0} commits`;
  return facts[tick % facts.length].object.slice(0, 30);
}

// ── SVG arc helper ─────────────────────────────────────────────────────────
function arcPath(cx: number, cy: number, r: number, startDeg: number, endDeg: number) {
  const s = (startDeg * Math.PI) / 180;
  const e = (endDeg   * Math.PI) / 180;
  const x1 = cx + r * Math.cos(s); const y1 = cy + r * Math.sin(s);
  const x2 = cx + r * Math.cos(e); const y2 = cy + r * Math.sin(e);
  const large = endDeg - startDeg > 180 ? 1 : 0;
  return `M ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2}`;
}

// ── Feature 2: Particles (subtle, single-color) ───────────────────────────
function ConnectionParticles({ ax, ay, bx, by, connIdx, color }: {
  ax: number; ay: number; bx: number; by: number; connIdx: number; color: string;
}) {
  return (
    <>
      {[0, 1].map((p) => (
        <motion.circle
          key={p}
          r={2.2}
          fill={color}
          animate={{ cx: [ax, bx], cy: [ay, by], opacity: [0, 0.9, 0.9, 0] }}
          transition={{
            duration: 3.0 + connIdx * 0.4,
            repeat: Infinity,
            delay: connIdx * 0.3 + p * 1.4,
            ease: "linear",
            times: [0, 0.08, 0.92, 1],
          }}
        />
      ))}
    </>
  );
}

// ── Mesh graph ─────────────────────────────────────────────────────────────
function MeshGraph({
  agents, connections, selectedId, onSelect,
  onConnectionClick,
  activeConnectionKey,
  entered, tick,
}: {
  agents: Agent[];
  connections: MeshConnection[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onConnectionClick: (c: MeshConnection, svgMx: number, svgMy: number) => void;
  activeConnectionKey: string | null;
  entered: boolean;
  tick: number;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [dash, setDash] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setDash((d) => (d + 1) % 40), 40);
    return () => clearInterval(id);
  }, []);

  if (!agents.length) return null;

  const W = 1160; const H = 760; const CX = W / 2; const CY = H / 2;
  const RADIUS = Math.min(230, Math.max(175, 64 * agents.length));
  const NODE_R  = 38;
  const ARC_R   = NODE_R + 16;

  const positions = agents.map((_, i) => {
    const angle = ((i / agents.length) * 360 - 90) * (Math.PI / 180);
    return { x: CX + RADIUS * Math.cos(angle), y: CY + RADIUS * Math.sin(angle) };
  });

  return (
    <svg
      ref={svgRef}
      viewBox={`0 0 ${W} ${H}`}
      className="w-full h-full"
      style={{ overflow: "visible" }}
      onClick={() => onSelect(null)}
    >
      <defs>
        {agents.map((a, i) => (
          <clipPath key={a.id} id={`av-${a.id}`}>
            <circle cx={positions[i].x} cy={positions[i].y} r={NODE_R - 2} />
          </clipPath>
        ))}
        <radialGradient id="center-glow" cx="50%" cy="50%" r="50%">
          <stop offset="0%"   stopColor="#39ff14" stopOpacity="0.1" />
          <stop offset="100%" stopColor="#39ff14" stopOpacity="0" />
        </radialGradient>
      </defs>

      <circle cx={CX} cy={CY} r={RADIUS + 82} fill="url(#center-glow)" />

      {/* Orbit ring */}
      <motion.circle
        cx={CX} cy={CY} r={RADIUS}
        fill="none" stroke="#39ff14" strokeWidth={0.8} strokeOpacity={0.16} strokeDasharray="6 14"
        initial={{ opacity: 0 }} animate={{ opacity: entered ? 1 : 0 }}
        transition={{ duration: 0.8, delay: 0.2 }}
      />

      {/* ── Connections ── */}
      {connections.map((conn, ci) => {
        const a = positions[conn.a]; const b = positions[conn.b];
        if (!a || !b) return null;
        const key = connectionKey(conn, agents);
        const isActive =
          activeConnectionKey === key ||
          selectedId === agents[conn.a]?.id ||
          selectedId === agents[conn.b]?.id;
        const mx = (a.x + b.x) / 2; const my = (a.y + b.y) / 2;
        const centerDistance = Math.hypot(mx - CX, my - CY);
        const lineLength = Math.hypot(b.x - a.x, b.y - a.y) || 1;
        const labelOffset = centerDistance < 118 ? 82 : 0;
        const labelX = mx + (-(b.y - a.y) / lineLength) * labelOffset;
        const labelY = my + ((b.x - a.x) / lineLength) * labelOffset;
        const color = CAT_COLORS[conn.category] ?? "#e8e4dc";
        const labelKey = `${conn.category}:${conn.label.toLowerCase()}`;
        const firstLabelIndex = connections.findIndex((candidate) => `${candidate.category}:${candidate.label.toLowerCase()}` === labelKey);
        const showLabel = isActive || firstLabelIndex === ci;

        return (
          <motion.g
            key={`${agents[conn.a]?.id}-${agents[conn.b]?.id}`}
            initial={{ opacity: 0 }}
            animate={{ opacity: entered ? 1 : 0 }}
            transition={{ duration: 0.7, delay: 0.5 + ci * 0.1 }}
            style={{ cursor: "pointer" }}
            onClick={(e) => { e.stopPropagation(); onConnectionClick(conn, mx, my); }}
          >
            {/* Relationship line */}
            <line x1={a.x} y1={a.y} x2={b.x} y2={b.y}
              stroke={color}
              strokeWidth={isActive ? 3.4 : 2}
              strokeOpacity={isActive ? 0.9 : 0.45}
              strokeDasharray={isActive ? "none" : "8 10"}
              strokeDashoffset={-dash} />
            <line x1={a.x} y1={a.y} x2={b.x} y2={b.y}
              stroke={color}
              strokeWidth={isActive ? 10 : 7}
              strokeOpacity={isActive ? 0.11 : 0.055}
            />
            {/* Wide hit area */}
            <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="transparent" strokeWidth={18} />
            {/* Midpoint label */}
            {showLabel && (
              <g opacity={isActive ? 1 : 0.34}>
                <rect
                  x={labelX - 50}
                  y={labelY - 16}
                  width={100}
                  height={20}
                  fill="#080808"
                  stroke={color}
                  strokeOpacity={isActive ? 0.75 : 0.16}
                />
                <text x={labelX} y={labelY - 2} textAnchor="middle" fill={isActive ? color : "#e8e4dc"}
                  fontSize={8} fontFamily="'Space Mono', monospace" letterSpacing="0.1em"
                  opacity={isActive ? 0.95 : 0.62} style={{ textTransform: "uppercase", userSelect: "none" }}>
                  {conn.label.slice(0, 14)}
                </text>
              </g>
            )}
            {/* Visible particles */}
            <ConnectionParticles ax={a.x} ay={a.y} bx={b.x} by={b.y} connIdx={ci} color={color} />
          </motion.g>
        );
      })}

      {/* Spoke lines */}
      {positions.map((p, i) => {
        const isActive = selectedId === agents[i].id;
        return (
          <motion.line
            key={agents[i].id}
            x1={CX} y1={CY} x2={p.x} y2={p.y}
            stroke="#e8e4dc" strokeWidth={0.5}
            strokeOpacity={isActive ? 0.2 : 0.06}
            strokeDasharray="3 12" strokeDashoffset={-dash * 0.5}
            initial={{ opacity: 0 }}
            animate={{ opacity: entered ? 1 : 0 }}
            transition={{ duration: 0.6, delay: 0.4 + i * 0.08 }}
          />
        );
      })}

      {/* ── Agent nodes (Feature 3 entrance + Feature 1 dimming + Feature 4 ticker) ── */}
      {agents.map((agent, i) => {
        const { x, y } = positions[i];
        const isSelected  = selectedId === agent.id;
        const facts  = agent.constitution_facts ?? [];

        return (
          <motion.g
            key={agent.id}
            style={{ cursor: "pointer", transformOrigin: `${x}px ${y}px` } as React.CSSProperties}
            onClick={(e) => { e.stopPropagation(); onSelect(isSelected ? null : agent.id); }}
            initial={{ opacity: 0, scale: 0.4 }}
            animate={{
              opacity: entered ? 1 : 0,
              scale:   entered ? 1 : 0.4,
            }}
            transition={{ duration: 0.5, delay: 0.3 + i * 0.12, ease: "backOut" }}
          >
            {/* Selection glow */}
            {isSelected && (
              <circle cx={x} cy={y} r={ARC_R + 12} fill="none"
                stroke="#39ff14" strokeWidth={1} strokeOpacity={0.6}
                style={{ filter: "drop-shadow(0 0 10px #39ff14)" }} />
            )}

            {/* Constitution progress ring — single clean arc */}
            {facts.length > 0 && (() => {
              const fill = Math.min(facts.length / 12, 1);
              const deg  = fill * 330;
              return (
                <motion.path
                  d={arcPath(x, y, ARC_R, -100, -100 + deg)}
                  fill="none"
                  stroke={isSelected ? "#39ff14" : "#e8e4dc"}
                  strokeWidth={1.5}
                  strokeLinecap="round"
                  strokeOpacity={isSelected ? 0.7 : 0.2}
                  initial={{ pathLength: 0 }}
                  animate={{ pathLength: 1 }}
                  transition={{ duration: 0.8, delay: 0.7 + i * 0.1, ease: "easeOut" }}
                />
              );
            })()}

            {/* Avatar */}
            <circle cx={x} cy={y} r={NODE_R} fill="#0d0d0d"
              stroke={isSelected ? "#39ff14" : "#2a2a2a"} strokeWidth={isSelected ? 2 : 1} />
            <image
              href={`https://github.com/${agent.github_username || agent.name}.png?size=96`}
              x={x - (NODE_R - 2)} y={y - (NODE_R - 2)}
              width={(NODE_R - 2) * 2} height={(NODE_R - 2) * 2}
              clipPath={`url(#av-${agent.id})`}
              preserveAspectRatio="xMidYMid slice"
            />

            {/* Name */}
            <text x={x} y={y + NODE_R + 18}
              textAnchor="middle"
              fill={isSelected ? "#39ff14" : "#e8e4dc"}
              fontSize={11} fontFamily="'Space Mono', monospace"
              letterSpacing="0.15em"
              style={{ textTransform: "uppercase", userSelect: "none" }}>
              {coworkerName(agent)}
            </text>

            {/* Feature 4: Rotating fact ticker */}
            <AnimatePresence mode="wait">
              <motion.text
                key={`${agent.id}-${tick}`}
                x={x} y={y + NODE_R + 32}
                textAnchor="middle"
                fill="#e8e4dc"
                fontSize={8}
                fontFamily="'Space Mono', monospace"
                letterSpacing="0.05em"
                style={{ userSelect: "none" }}
                initial={{ opacity: 0 }}
                animate={{ opacity: 0.45 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.5 }}
              >
                {tickerFact(agent, tick).slice(0, 30)}
              </motion.text>
            </AnimatePresence>
          </motion.g>
        );
      })}

      {/* Center node */}
      <motion.g
        initial={{ opacity: 0, scale: 0 }}
        animate={{ opacity: entered ? 1 : 0, scale: entered ? 1 : 0 }}
        transition={{ duration: 0.5, delay: 0.15 }}
        style={{ transformOrigin: `${CX}px ${CY}px` } as React.CSSProperties}
      >
        <circle cx={CX} cy={CY} r={22} fill="#080808" stroke="#39ff14" strokeWidth={1} strokeOpacity={0.5} />
        <motion.circle cx={CX} cy={CY} r={6} fill="#39ff14"
          animate={{ r: [5, 7, 5], opacity: [0.8, 1, 0.8] }}
          transition={{ duration: 2, repeat: Infinity }} />
        <text x={CX} y={CY + 36} textAnchor="middle" fill="#39ff14" fontSize={9}
          fontFamily="'Space Mono', monospace" letterSpacing="0.25em" opacity={0.7}
          style={{ textTransform: "uppercase", userSelect: "none" }}>
          COWORKER MESH
        </text>
      </motion.g>
    </svg>
  );
}

// ── Feature 5: Connection evidence card ───────────────────────────────────
function ConnectionCard({
  connection, agents, svgMx, svgMy, onClose,
}: {
  connection: MeshConnection;
  agents: Agent[];
  svgMx: number; svgMy: number;
  onClose: () => void;
}) {
  const left  = agents[connection.a];
  const right = agents[connection.b];
  const label: Record<string, string> = {
    code_ownership: "Shared code area",
    current_focus:  "Related focus",
    expertise:      "Shared expertise",
    collaboration:  "Shared context",
  };

  // Convert SVG coords (0-1160, 0-760) to percentages.
  const leftPct = (svgMx / 1160) * 100;
  const topPct  = (svgMy / 760) * 100;

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.9, y: 6 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.9, y: 6 }}
      transition={{ duration: 0.18 }}
      className="pointer-events-auto absolute z-30 w-64"
      style={{
        left: `${Math.min(Math.max(leftPct, 8), 72)}%`,
        top:  `${Math.min(Math.max(topPct - 26, 8), 70)}%`,
        transform: "translate(-50%, -100%)",
      }}
    >
      <div className="border border-[#1f1f1f] bg-[#080808]/95 backdrop-blur-sm">
        {/* Header */}
        <div className="flex items-center justify-between px-3 py-2 border-b border-[#1f1f1f]">
          <span className="font-mono text-[9px] uppercase tracking-[2px] text-[#e8e4dc55]">
            {label[connection.category] ?? "Connection"}
          </span>
          <button onClick={onClose} className="text-[#e8e4dc33] hover:text-[#e8e4dc] text-sm leading-none ml-2">×</button>
        </div>

        {/* Agents */}
        <div className="flex items-center gap-2 px-3 py-2 border-b border-[#1f1f1f]">
          <img src={`https://github.com/${left?.github_username || left?.name || "ghost"}.png?size=48`}
            className="w-6 h-6 rounded-full border border-[#2a2a2a]" alt="" />
          <span className="font-mono text-[9px] text-[#e8e4dc]">{left?.github_username ?? "?"}</span>
          <span className="font-mono text-[9px] text-[#e8e4dc33]">↔</span>
          <img src={`https://github.com/${right?.github_username || right?.name || "ghost"}.png?size=48`}
            className="w-6 h-6 rounded-full border border-[#2a2a2a]" alt="" />
          <span className="font-mono text-[9px] text-[#e8e4dc]">{right?.github_username ?? "?"}</span>
        </div>

        {/* Evidence */}
        <div className="px-3 py-2.5 space-y-1.5">
          {connection.evidence.map((e, i) => (
            <div key={i} className="flex items-start gap-2">
              <span className="font-mono text-[9px] mt-0.5 text-[#39ff1488]">›</span>
              <p className="font-mono text-[10px] leading-relaxed text-[#e8e4dc66]">{e}</p>
            </div>
          ))}
        </div>

        {/* Score bar */}
        <div className="px-3 pb-2.5">
          <div className="flex items-center justify-between mb-1">
            <span className="font-mono text-[8px] uppercase tracking-[2px] text-[#e8e4dc33]">Strength</span>
            <span className="font-mono text-[8px] text-[#39ff1488]">{Math.round(Math.min(connection.score / 20, 1) * 100)}%</span>
          </div>
          <div className="h-px bg-[#1f1f1f] overflow-hidden">
            <motion.div
              className="h-full bg-[#39ff1455]"
              initial={{ width: 0 }}
              animate={{ width: `${Math.min(connection.score / 20, 1) * 100}%` }}
              transition={{ duration: 0.4, delay: 0.1 }}
            />
          </div>
        </div>
      </div>
    </motion.div>
  );
}

// ── Page ───────────────────────────────────────────────────────────────────
export default function AgentsPage() {
  const { agents, isLoading, setAgents } = useAgents();
  const [selectedId, setSelectedId]     = useState<string | null>(null);
  const [showModal,  setShowModal]      = useState(false);
  const [form,       setForm]           = useState({ github_username: "", name: "", role: "" });
  const [creating,   setCreating]       = useState(false);
  const [createError,setCreateError]    = useState<string | null>(null);

  // Feature 3: entrance
  const [entered, setEntered]           = useState(false);

  // Feature 4: ticker
  const [tick, setTick]                 = useState(0);

  // Feature 5: connection card
  const [connCard, setConnCard]         = useState<{ conn: MeshConnection; mx: number; my: number } | null>(null);

  const agentList     = useMemo(() => (Array.isArray(agents) ? agents : []), [agents]);
  const selectedAgent = agentList.find((a) => a.id === selectedId) ?? null;
  const connections   = useMemo(() => meshConnections(agentList), [agentList]);
  const activeConnectionKey = connCard ? connectionKey(connCard.conn, agentList) : null;

  // Feature 3: trigger entrance once agents load
  useEffect(() => {
    if (!isLoading && agentList.length > 0 && !entered) {
      const t = setTimeout(() => setEntered(true), 120);
      return () => clearTimeout(t);
    }
  }, [isLoading, agentList.length, entered]);

  // Feature 4: tick every 3s
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 3000);
    return () => clearInterval(id);
  }, []);

  const handleConnectionClick = useCallback((conn: MeshConnection, mx: number, my: number) => {
    setConnCard((prev) => prev?.conn === conn ? null : { conn, mx, my });
    setSelectedId(null);
  }, []);

  const handleSelect = useCallback((id: string | null) => {
    setSelectedId(id);
    setConnCard(null);
  }, []);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!form.github_username.trim()) return;
    setCreating(true); setCreateError(null);
    try {
      const agent = await api.createAgent({
        github_username: form.github_username.trim(),
        name: form.name.trim() || undefined,
        role: form.role.trim() || undefined,
      });
      setAgents((prev) => [...prev, agent]);
      setShowModal(false);
      setForm({ github_username: "", name: "", role: "" });
      setEntered(false);
      setTimeout(() => setEntered(true), 200);
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : "Failed to create agent");
    } finally {
      setCreating(false);
    }
  }

  async function handleDelete(agent: Agent) {
    await api.deleteAgent(agent.id);
    setAgents((prev) => prev.filter((a) => a.id !== agent.id));
    setSelectedId(null);
    setConnCard(null);
  }

  const totalFacts   = agentList.reduce((s, a) => s + (a.constitution_facts?.length ?? 0), 0);
  const totalCommits = agentList.reduce((s, a) => s + (a.github_data_summary?.commit_count ?? 0), 0);

  return (
    <div className="flex h-[calc(100vh-52px)] bg-[#080808]">

      {/* ── Main canvas ── */}
      <div
        className="flex-1 relative overflow-hidden"
        onClick={() => { setConnCard(null); }}
      >
        {/* Static background grid */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 opacity-25"
          style={{
            backgroundImage:
              "linear-gradient(rgba(57,255,20,0.32) 1px, transparent 1px), linear-gradient(90deg, rgba(57,255,20,0.32) 1px, transparent 1px)",
            backgroundSize: "64px 64px",
          }}
        />
        <div aria-hidden="true" className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_0%,transparent_35%,#080808_82%)]" />

        {/* Top-left header */}
        <div className="absolute top-6 left-6 z-10 pointer-events-none">
          <p className="font-mono text-[9px] uppercase tracking-[4px] text-[#39ff14]">{"// COWORKER MESH"}</p>
          <h1 className="font-syne text-3xl font-normal text-[#e8e4dc] mt-1">AUBI Coworkers</h1>
          <p className="font-mono text-[10px] text-[#e8e4dc44] mt-1">
            {agentList.length} coworker{agentList.length !== 1 ? "s" : ""} · {connections.length} link{connections.length !== 1 ? "s" : ""} · {totalFacts} facts · {totalCommits} commits
          </p>
        </div>

        {/* Status */}
        <div className="system-online-fade absolute top-6 right-6 z-10 flex items-center gap-2 pointer-events-none">
          <span className="w-1.5 h-1.5 rounded-full bg-[#39ff14]" />
          <span className="font-mono text-[9px] uppercase tracking-[3px] text-[#39ff14]">Mesh Online</span>
        </div>

        {/* Graph */}
        {isLoading ? (
          <div className="flex items-center justify-center h-full">
            <p className="font-mono text-[10px] uppercase tracking-[4px] text-[#39ff1466]">Loading coworker mesh...</p>
          </div>
        ) : agentList.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-4">
            <p className="font-mono text-[11px] uppercase tracking-[3px] text-[#e8e4dc44]">No coworkers registered</p>
            <button onClick={() => setShowModal(true)}
              className="font-mono text-[10px] uppercase tracking-[2px] text-[#39ff14] border border-[#39ff1433] px-4 py-2 hover:bg-[#39ff1410] transition-colors">
              + Register first coworker
            </button>
          </div>
        ) : (
          <div className="absolute inset-0 flex items-center justify-center p-8 pointer-events-none">
            <div className="w-full h-full pointer-events-auto relative">
              <MeshGraph
                agents={agentList}
                connections={connections}
                selectedId={selectedId}
                onSelect={handleSelect}
                onConnectionClick={handleConnectionClick}
                activeConnectionKey={activeConnectionKey}
                entered={entered}
                tick={tick}
              />

              {/* Feature 5: Connection evidence card */}
              <AnimatePresence>
                {connCard && (
                  <ConnectionCard
                    key={`${connCard.conn.a}-${connCard.conn.b}`}
                    connection={connCard.conn}
                    agents={agentList}
                    svgMx={connCard.mx}
                    svgMy={connCard.my}
                    onClose={() => setConnCard(null)}
                  />
                )}
              </AnimatePresence>
            </div>
          </div>
        )}

        {/* Register button */}
        {!isLoading && agentList.length > 0 && (
          <div className="absolute bottom-6 left-6 z-10">
            <ShimmerButton onClick={() => setShowModal(true)} className="px-4 py-2 text-[10px]">
              + Register coworker
            </ShimmerButton>
          </div>
        )}

        {/* Mesh stats */}
        {!isLoading && agentList.length > 0 && (
          <div className="absolute bottom-6 right-6 z-10 pointer-events-none">
            <div className="flex flex-col gap-1 text-right">
              <span className="font-mono text-[8px] uppercase tracking-[3px] text-[#e8e4dc22]">{"// mesh"}</span>
              <span className="font-mono text-[9px] text-[#e8e4dc33]">{connections.length} connections</span>
              <span className="font-mono text-[9px] text-[#e8e4dc33]">{totalFacts} facts</span>
            </div>
          </div>
        )}

        {/* Hint strip */}
        {!isLoading && agentList.length > 0 && (
          <p className="absolute bottom-7 left-1/2 -translate-x-1/2 z-10 font-mono text-[9px] text-[#e8e4dc22] tracking-[2px] pointer-events-none">
            click agent · click a relationship line to inspect why coworkers are connected
          </p>
        )}
      </div>

      {/* ── Dossier panel ── */}
      <div className={["flex-shrink-0 transition-all duration-300 overflow-hidden border-l border-[#1f1f1f]", selectedAgent ? "w-[360px]" : "w-0"].join(" ")}>
        <DossierPanel agent={selectedAgent} onClose={() => setSelectedId(null)} onDelete={handleDelete} />
      </div>

      {/* ── Register modal ── */}
      <AnimatePresence>
        {showModal && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/70"
            onClick={(e) => e.target === e.currentTarget && setShowModal(false)}
          >
            <motion.div
              initial={{ y: 16, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 16, opacity: 0 }}
              className="relative bg-[#080808] border border-[#1f1f1f] w-full max-w-sm mx-4 overflow-hidden"
            >
              <BorderBeam size={200} duration={6} colorFrom="#39ff14" colorTo="#00f0ff" />
              <div className="flex items-center justify-between px-5 py-4 border-b border-[#1f1f1f]">
                <span className="font-mono text-[9px] uppercase tracking-[3px] text-[#e8e4dc66]">{"// register coworker"}</span>
                <button onClick={() => setShowModal(false)} className="text-[#e8e4dc44] hover:text-[#e8e4dc] text-xl leading-none">×</button>
              </div>
              <form onSubmit={handleCreate} className="p-5 space-y-4">
                {[
                  { key: "github_username", label: "GitHub username *", placeholder: "e.g. torvalds" },
                  { key: "name",            label: "Display name",       placeholder: "optional" },
                  { key: "role",            label: "Role",               placeholder: "e.g. Backend Engineer" },
                ].map(({ key, label, placeholder }) => (
                  <div key={key}>
                    <label className="block font-mono text-[9px] uppercase tracking-[2px] text-[#e8e4dc55] mb-1.5">{label}</label>
                    <input
                      type="text"
                      value={form[key as keyof typeof form]}
                      onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
                      placeholder={placeholder}
                      className="w-full bg-[#0a0a0a] border border-[#1f1f1f] px-3 py-2 font-mono text-[12px] text-[#e8e4dc] placeholder-[#e8e4dc22] focus:outline-none focus:border-[#39ff1444]"
                    />
                  </div>
                ))}
                {createError && <p className="font-mono text-[10px] text-[#ff3366]">{createError}</p>}
                <ShimmerButton
                  type="submit"
                  disabled={!form.github_username.trim() || creating}
                  className="w-full py-2.5 disabled:opacity-40"
                >
                  {creating ? "Building constitution..." : "Build + Register"}
                </ShimmerButton>
              </form>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
