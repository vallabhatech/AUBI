"use client";

import { motion } from "framer-motion";
import { useEffect, useState } from "react";
import type { SSEEvent } from "@/lib/types";

const NODE_META: Record<string, { label: string; bg: string; text: string; border: string }> = {
  thread:             { label: "THREAD",      bg: "bg-slate-500/10",   text: "text-slate-300",  border: "border-slate-500/20" },
  issue_reader:       { label: "ISSUE",       bg: "bg-red-500/10",     text: "text-red-400",    border: "border-red-500/20" },
  incident_analyzer: { label: "ANALYZER",    bg: "bg-red-500/10",     text: "text-red-400",    border: "border-red-500/20" },
  ownership_router:  { label: "ROUTER",      bg: "bg-amber-500/10",   text: "text-amber-400",  border: "border-amber-500/20" },
  query_single_agent:{ label: "AGENT QUERY", bg: "bg-violet-500/10",  text: "text-violet-400", border: "border-violet-500/20" },
  agent_querier:     { label: "AGENT QUERY", bg: "bg-violet-500/10",  text: "text-violet-400", border: "border-violet-500/20" },
  coworker_mesh_exchange: { label: "MESH",   bg: "bg-violet-500/10",  text: "text-violet-300", border: "border-violet-500/20" },
  code_reader:        { label: "CODE READ",   bg: "bg-sky-500/10",     text: "text-sky-400",    border: "border-sky-500/20" },
  fix_generator:      { label: "FIX GEN",     bg: "bg-cyan-500/10",    text: "text-cyan-400",   border: "border-cyan-500/20" },
  test_runner:        { label: "TESTS",       bg: "bg-emerald-500/10", text: "text-emerald-400",border: "border-emerald-500/20" },
  approval_gate:      { label: "APPROVAL",    bg: "bg-fuchsia-500/10", text: "text-fuchsia-400",border: "border-fuchsia-500/20" },
  pr_pusher:          { label: "PR",          bg: "bg-emerald-500/10", text: "text-emerald-400",border: "border-emerald-500/20" },
  response_drafter:  { label: "DRAFTER",     bg: "bg-cyan-500/10",    text: "text-cyan-400",   border: "border-cyan-500/20" },
  memory_updater:    { label: "MEMORY",      bg: "bg-emerald-500/10", text: "text-emerald-400",border: "border-emerald-500/20" },
  complete:          { label: "COMPLETE",    bg: "bg-emerald-500/10", text: "text-emerald-400",border: "border-emerald-500/20" },
  error:             { label: "ERROR",       bg: "bg-red-500/10",     text: "text-red-400",    border: "border-red-500/20" },
};

const DOT_COLORS: Record<string, string> = {
  thread: "#94a3b8",
  issue_reader: "#ff3366",
  incident_analyzer: "#ff3366",
  ownership_router:  "#ffaa00",
  query_single_agent:"#8b5cf6",
  agent_querier:     "#8b5cf6",
  coworker_mesh_exchange: "#a78bfa",
  code_reader:       "#38bdf8",
  fix_generator:     "#00f0ff",
  test_runner:       "#10b981",
  approval_gate:     "#e879f9",
  pr_pusher:         "#10b981",
  response_drafter:  "#00f0ff",
  memory_updater:    "#10b981",
  complete:          "#10b981",
  error:             "#ff3366",
};

function RadarAnimation() {
  return (
    <svg width={60} height={60} viewBox="-30 -30 60 60">
      {[0.3, 0.6, 0.9].map((delay, i) => (
        <motion.circle
          key={i} cx={0} cy={0} r={8}
          fill="none" stroke="#ff3366" strokeWidth={1.5}
          animate={{ scale: [0.8, 3], opacity: [0.7, 0] }}
          transition={{ duration: 1.6, repeat: Infinity, delay, ease: "easeOut" }}
        />
      ))}
      <circle cx={0} cy={0} r={5} fill="#ff3366" opacity={0.8} />
    </svg>
  );
}

function RouterAnimation() {
  const endpoints: [number, number][] = [[-36, -18], [36, -18], [0, 40]];
  return (
    <svg width={80} height={70} viewBox="-40 -30 80 70">
      {endpoints.map(([dx, dy], i) => (
        <motion.line
          key={i} x1={0} y1={0} x2={0} y2={0} stroke="#ffaa00" strokeWidth={1.5}
          animate={{ x2: dx, y2: dy, opacity: [1, 0] }}
          transition={{ duration: 0.7, repeat: Infinity, delay: i * 0.18, ease: "easeOut" }}
        />
      ))}
      {endpoints.map(([dx, dy], i) => (
        <motion.circle
          key={`dot-${i}`} cx={dx} cy={dy} r={3} fill="#ffaa00"
          animate={{ opacity: [0, 0.9, 0] }}
          transition={{ duration: 0.7, repeat: Infinity, delay: i * 0.18 }}
        />
      ))}
      <circle cx={0} cy={0} r={4} fill="#ffaa00" />
    </svg>
  );
}

function AgentQueryAnimation({ agentName }: { agentName?: string }) {
  return (
    <div className="flex items-center gap-3">
      <svg width={52} height={52} viewBox="-26 -26 52 52">
        <motion.circle
          cx={0} cy={0} r={20}
          fill="none" stroke="#8b5cf6" strokeWidth={2}
          animate={{ r: [18, 34], opacity: [0.9, 0] }}
          transition={{ duration: 1, repeat: Infinity, ease: "easeOut" }}
        />
        <circle cx={0} cy={0} r={16} fill="#0d1224" stroke="#8b5cf6" strokeWidth={1} />
        <text textAnchor="middle" y={4} fontSize={10} fill="#8b5cf6" fontFamily="JetBrains Mono">
          AI
        </text>
      </svg>
      {agentName && (
        <span className="font-mono text-[10px] text-[#8b5cf6]">
          querying {agentName}...
        </span>
      )}
    </div>
  );
}

function TypewriterAnimation({ text }: { text: string }) {
  const [displayed, setDisplayed] = useState("");
  const full = "DRAFTING RESPONSE...";

  useEffect(() => {
    let i = 0;
    setDisplayed("");
    const iv = setInterval(() => {
      setDisplayed(full.slice(0, ++i));
      if (i >= full.length) clearInterval(iv);
    }, 45);
    return () => clearInterval(iv);
  }, []);

  return (
    <div className="font-mono text-[11px] text-[#00f0ff]">
      <span>{displayed}</span>
      <motion.span animate={{ opacity: [1, 0] }} transition={{ duration: 0.5, repeat: Infinity }}>
        ▊
      </motion.span>
      {text && (
        <p className="mt-1 text-[#4a6080] text-[10px] leading-relaxed max-w-[280px] truncate">
          {text.slice(0, 80)}…
        </p>
      )}
    </div>
  );
}

function ConstellationAnimation() {
  const dots: [number, number][] = [[-28, -14], [28, -14], [0, 24], [-16, 8], [16, 8]];
  return (
    <svg width={70} height={55} viewBox="-35 -24 70 55">
      {dots.slice(1).map(([x2, y2], i) => (
        <motion.line
          key={`line-${i}`}
          x1={dots[i][0]} y1={dots[i][1]} x2={x2} y2={y2}
          stroke="#10b981" strokeWidth={0.8} opacity={0.5}
          initial={{ pathLength: 0 }}
          animate={{ pathLength: 1 }}
          transition={{ delay: i * 0.18 + 0.15, duration: 0.3 }}
        />
      ))}
      {dots.map(([cx, cy], i) => (
        <motion.circle
          key={`dot-${i}`} cx={cx} cy={cy} r={3} fill="#10b981"
          initial={{ opacity: 0, scale: 0 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: i * 0.18, duration: 0.25 }}
          style={{ filter: "drop-shadow(0 0 3px #10b981)" }}
        />
      ))}
    </svg>
  );
}

function outputSummary(event: SSEEvent): string {
  if (!event.output) return "";
  const o = event.output;
  const textFrom = (keys: string[]) => {
    for (const key of keys) {
      const value = o[key];
      if (typeof value === "string" && value.trim()) return value.trim();
    }
    return "";
  };

  if (event.eventType === "coworker_exchange" || event.eventType === "coworker_context") {
    const from = o.requester_agent_name ?? o.requester_aubi ?? o.source_aubi ?? o.sender ?? o.from ?? "coworker";
    const to = o.responder_agent_name ?? o.responder_aubi ?? o.target_aubi ?? o.recipient ?? o.to ?? "coworker";
    const context = o.context_shared ?? o.shared_context ?? o.context ?? o.reason ?? o.why ?? "";
    return `${String(from)} -> ${String(to)} · ${String(context).slice(0, 110)}`;
  }
  if (event.eventType === "shared_memory_hit" || event.eventType === "shared_memory") {
    const memory = o.object ?? o.memory ?? o.content ?? o.summary ?? o.title ?? "memory matched";
    return `TEAM MEMORY: ${String(memory).slice(0, 110)}`;
  }
  if (event.eventType === "memory_write" || event.eventType === "memory_update" || event.eventType === "aubi_learned") {
    const update = o.update ?? o.episode ?? o.memory ?? o.object ?? "memory written";
    return `LEARNED: ${String(update).slice(0, 110)}`;
  }
  switch (event.node) {
    case "incident_analyzer":
    case "issue_reader":
      return `SERVICE: ${o.affected_service ?? "?"} · TYPE: ${o.error_type ?? "?"} · ${o.urgency ?? "P?"}`;
    case "ownership_router":
      return `OWNERS: ${Array.isArray(o.owner_ids) ? (o.owner_ids as string[]).join(", ") : o.agent_id ?? "matched"}`;
    case "agent_querier":
    case "query_single_agent":
      {
        const context = textFrom(["context", "response", "answer", "summary", "message", "reason", "why"]);
        const agent = event.agent ?? o.agent_name ?? o.agent_id ?? o.owner_id ?? "coworker";
        return context
          ? `${String(agent)} · ${context.slice(0, 110)}`
          : `Queried ${String(agent)} for ownership and adjacent context`;
      }
    case "coworker_mesh_exchange":
      return `MESH: ${Array.isArray(o.coworker_exchanges) ? o.coworker_exchanges.length : 0} exchanges · ${Array.isArray(o.shared_memory_hits) ? o.shared_memory_hits.length : 0} shared memories`;
    case "code_reader":
      return `FILES: ${
        o.file_contents && typeof o.file_contents === "object"
          ? Object.keys(o.file_contents).length
          : "read"
      }`;
    case "fix_generator":
      return `FIX: ${String(o.fix_explanation ?? "generated patch").slice(0, 110)}`;
    case "test_runner":
      return `${o.tests_passed ? "PASS" : "FAIL"} · ${String(o.test_output ?? "test output attached").slice(0, 110)}`;
    case "approval_gate":
      return `AWAITING APPROVAL · ${o.tests_passed ? "tests passed" : "tests not passing"}`;
    case "pr_pusher":
      return `PR: ${String(o.pr_url ?? "created")}`;
    case "response_drafter":
      return `RESPONSE DRAFTED · ${String(o.slack_message ?? o.slack_msg ?? "").length} chars`;
    case "memory_updater":
      return `UPDATED: ${Array.isArray(o.updated) ? (o.updated as string[]).join(", ") : "none"}`;
    default:
      return "";
  }
}

interface Props {
  event: SSEEvent;
  index: number;
}

export function TraceNode({ event, index }: Props) {
  const meta = NODE_META[event.node] ?? NODE_META.error;
  const dotColor = DOT_COLORS[event.node] ?? "#4a6080";
  const isRunning = event.status === "running";
  const isDone = event.status === "done";
  const summary = outputSummary(event);
  const statusLabel = isRunning ? "Processing" : isDone ? "Complete" : event.status;

  return (
    <motion.div
      initial={{ opacity: 0, x: -12 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.25, delay: index * 0.03 }}
      className="group relative grid grid-cols-[18px_132px_minmax(0,1fr)_72px] gap-3 border border-[#1e2d45] bg-[#050912] px-3 py-3"
    >
      <div className="flex items-center justify-center">
        <div
          className="h-2.5 w-2.5 rounded-full"
          style={{ backgroundColor: dotColor, boxShadow: `0 0 6px ${dotColor}99` }}
        />
      </div>

      <div className="min-w-0">
        <span className={`inline-flex border px-2 py-1 font-mono text-[10px] uppercase tracking-[2px] ${meta.bg} ${meta.text} ${meta.border}`}>
          {meta.label}
        </span>
        <p className={["mt-2 font-mono text-[9px] uppercase tracking-[2px]", isRunning ? "text-[#c8d6e8]" : "text-[#4a6080]"].join(" ")}>
          {statusLabel}
        </p>
      </div>

      <div className="min-w-0 self-center">
        {summary ? (
          <p className="truncate font-mono text-[11px] leading-5 text-[#8aa0c0]">{summary}</p>
        ) : (
          <p className="font-mono text-[11px] uppercase tracking-[2px] text-[#2a3f5f]">
            {isRunning ? "Working on this step..." : "Step recorded"}
          </p>
        )}
      </div>

      <div className="self-center text-right font-mono text-[10px] text-[#4a6080]">
        {event.receivedAt != null ? `+${event.receivedAt}ms` : ""}
      </div>
    </motion.div>
  );
}
