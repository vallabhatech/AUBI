"use client";

import { motion } from "framer-motion";
import type { AUBIEvent, AgentMessage } from "@/lib/types";

type Position = { x: number; y: number; label: string; description: string; role: "orchestrator" | "coworker" };

function endpointKey(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "aubi";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function stringValue(value: unknown): string {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

function stripAUBISuffix(value: string) {
  return value
    .replace(/[_-]?aubi$/i, "")
    .replace(/\s+aubi$/i, "")
    .replace(/[_-]+/g, " ")
    .trim();
}

function isCrypticId(value: string) {
  const compact = value.replace(/[^a-z0-9]/gi, "");
  return /^[a-f0-9]{7,}$/i.test(compact) || /^[a-z0-9]{12,}$/i.test(compact);
}

function titleName(value: string) {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function coworkerLabel(baseName: string) {
  const name = titleName(stripAUBISuffix(baseName));
  if (!name || isCrypticId(name)) return "Selected Coworker's AUBI";
  return `${name}${name.toLowerCase().endsWith("s") ? "'" : "'s"} AUBI`;
}

function addAlias(directory: Map<string, string>, raw: unknown, displayName: unknown) {
  const rawValue = stringValue(raw);
  const displayValue = stringValue(displayName);
  if (!rawValue || !displayValue) return;
  const baseName = stripAUBISuffix(displayValue);
  if (!baseName || isCrypticId(baseName)) return;
  [rawValue, stripAUBISuffix(rawValue), `${rawValue}_aubi`, `${rawValue}-aubi`, displayValue, `${baseName}_aubi`, `${baseName}-aubi`]
    .filter(Boolean)
    .forEach((alias) => directory.set(endpointKey(alias), baseName));
}

function addAgentPairsFromRecord(directory: Map<string, string>, record: Record<string, unknown>) {
  addAlias(directory, record.agent_id, record.agent_name);
  addAlias(directory, record.requester_agent_id, record.requester_agent_name);
  addAlias(directory, record.responder_agent_id, record.responder_agent_name);
  addAlias(directory, record.source_aubi, record.requester_agent_name ?? record.agent_name);
  addAlias(directory, record.target_aubi, record.responder_agent_name ?? record.agent_name);

  const requesterIds = Array.isArray(record.requester_agent_ids) ? record.requester_agent_ids : [];
  const requesterNames = Array.isArray(record.requester_agent_names) ? record.requester_agent_names : [];
  requesterIds.forEach((id, index) => addAlias(directory, id, requesterNames[index]));

  const ownerIds = Array.isArray(record.owner_ids) ? record.owner_ids : [];
  const ownerNames = Array.isArray(record.owner_names) ? record.owner_names : [];
  ownerIds.forEach((id, index) => addAlias(directory, id, ownerNames[index]));
}

function addNestedRecords(directory: Map<string, string>, value: unknown, keys: string[]) {
  if (!isRecord(value)) return;
  keys.forEach((key) => {
    const nested = value[key];
    if (Array.isArray(nested)) {
      nested.filter(isRecord).forEach((record) => addAgentPairsFromRecord(directory, record));
    }
  });
}

function inferAliasesFromMessages(directory: Map<string, string>, messages: AgentMessage[]) {
  messages.forEach((message, index) => {
    const next = messages[index + 1];
    if (!next) return;

    const sentToCoworker = endpointKey(message.sender) === "orchestrator" && endpointKey(next.recipient) === "orchestrator";
    if (sentToCoworker) {
      addAlias(directory, message.recipient, next.sender);
    }

    const repliedToCoworker = endpointKey(message.recipient) === "orchestrator" && endpointKey(next.sender) === "orchestrator";
    if (repliedToCoworker) {
      addAlias(directory, message.sender, next.recipient);
    }
  });
}

function endpointDirectory(events: AUBIEvent[], messages: AgentMessage[]) {
  const directory = new Map<string, string>();

  events.forEach((event) => {
    if (!isRecord(event.data)) return;
    addAgentPairsFromRecord(directory, event.data);
    addNestedRecords(directory, event.data, [
      "agent_contexts",
      "routing_evidence",
      "coworker_exchanges",
      "coworker_contexts",
      "shared_memory_hits",
      "shared_memory",
      "memory_writes",
      "memory_updates",
    ]);
  });

  inferAliasesFromMessages(directory, messages);
  return directory;
}

function canonicalKey(value: string, directory: Map<string, string>) {
  const key = endpointKey(value);
  if (key === "orchestrator") return key;
  const displayName = directory.get(key);
  return displayName ? endpointKey(`${displayName}_aubi`) : key;
}

function endpointLabel(value: string, directory: Map<string, string>) {
  const key = endpointKey(value);
  if (key === "orchestrator") return "AUBI Orchestrator";
  const displayName = directory.get(key);
  if (displayName) return coworkerLabel(displayName);

  const cleaned = stripAUBISuffix(value);
  if (!cleaned || isCrypticId(cleaned)) return "AUBI Coworker";
  return coworkerLabel(cleaned);
}

function uniqueEndpoints(messages: AgentMessage[], activeMessage: AgentMessage | null | undefined, directory: Map<string, string>): Array<{ key: string; label: string }> {
  const values = [
    ...messages.flatMap((message) => [message.sender, message.recipient]),
    ...(activeMessage ? [activeMessage.sender, activeMessage.recipient] : []),
  ];
  const byKey = new Map<string, { key: string; label: string }>();
  values.forEach((value) => {
    const key = canonicalKey(value, directory);
    byKey.set(key, { key, label: endpointLabel(value, directory) });
  });
  let genericIndex = 0;
  return Array.from(byKey.values()).map((endpoint) => {
    if (endpoint.key === "orchestrator" || endpoint.label !== "AUBI Coworker") return endpoint;
    const genericLabels = ["Source AUBI", "Peer AUBI", "Context AUBI", "Memory AUBI"];
    const label = genericLabels[genericIndex] ?? `Coworker ${genericIndex + 1} AUBI`;
    genericIndex += 1;
    return { ...endpoint, label };
  });
}

function positionsFor(endpoints: Array<{ key: string; label: string }>): Record<string, Position> {
  const positions: Record<string, Position> = {};
  const orchestrator = endpoints.find((endpoint) => endpoint.key === "orchestrator");
  const coworkers = endpoints.filter((endpoint) => endpoint.key !== "orchestrator");

  if (orchestrator) {
    positions.orchestrator = {
      x: 50,
      y: 58,
      label: orchestrator.label,
      description: "Routes the issue and coordinates context",
      role: "orchestrator",
    };
  }

  const layouts: Record<number, Array<{ x: number; y: number }>> = {
    1: [{ x: 50, y: 28 }],
    2: [{ x: 26, y: 36 }, { x: 74, y: 36 }],
    3: [{ x: 50, y: 24 }, { x: 24, y: 70 }, { x: 76, y: 70 }],
    4: [{ x: 50, y: 22 }, { x: 23, y: 48 }, { x: 77, y: 48 }, { x: 50, y: 82 }],
  };

  coworkers.forEach((endpoint, index) => {
    const count = Math.max(coworkers.length, 1);
    const fixed = layouts[Math.min(count, 4)]?.[index];
    const angle = -Math.PI / 2 + (index / count) * Math.PI * 2;
    positions[endpoint.key] = {
      x: fixed?.x ?? 50 + Math.cos(angle) * 34,
      y: fixed?.y ?? 52 + Math.sin(angle) * 32,
      label: endpoint.label,
      description: "Context memory node",
      role: "coworker",
    };
  });

  return positions;
}

function edgesFor(messages: AgentMessage[], directory: Map<string, string>): Array<[string, string]> {
  const seen = new Set<string>();
  return messages.flatMap((message) => {
    const from = canonicalKey(message.sender, directory);
    const to = canonicalKey(message.recipient, directory);
    const key = [from, to].sort().join("-");
    if (from === to || seen.has(key)) return [];
    seen.add(key);
    return [[from, to] as [string, string]];
  });
}

function routePath(a: Position, b: Position) {
  const midX = (a.x + b.x) / 2;
  const lift = Math.abs(a.y - b.y) > 18 ? 0 : a.y < 50 ? -10 : 10;
  return `M ${a.x} ${a.y} C ${midX} ${a.y + lift}, ${midX} ${b.y - lift}, ${b.x} ${b.y}`;
}

function compactMessage(message: string | undefined) {
  const trimmed = message?.replace(/\s+/g, " ").trim() ?? "";
  if (!trimmed) return "Waiting for the next coworker context packet.";
  return trimmed.length > 130 ? `${trimmed.slice(0, 127)}...` : trimmed;
}

export function AgentMeshLines({
  messages = [],
  activeMessage,
  events = [],
  className = "h-[224px]",
}: {
  messages?: AgentMessage[];
  activeMessage?: AgentMessage | null;
  events?: AUBIEvent[];
  className?: string;
}) {
  const directory = endpointDirectory(events, messages);
  const endpoints = uniqueEndpoints(messages, activeMessage, directory);
  const positions = positionsFor(endpoints);
  const edges = edgesFor(messages, directory);
  const senderKey = activeMessage ? canonicalKey(activeMessage.sender, directory) : "";
  const recipientKey = activeMessage ? canonicalKey(activeMessage.recipient, directory) : "";
  const sender = senderKey ? positions[senderKey] : null;
  const recipient = recipientKey ? positions[recipientKey] : null;
  const activeRoute =
    activeMessage && sender && recipient
      ? `${sender.label} -> ${recipient.label}`
      : endpoints.length > 0
        ? `${Math.max(endpoints.length - 1, 0)} coworker${endpoints.length === 2 ? "" : "s"} mapped`
        : "No message paths";

  if (endpoints.length === 0) {
    return (
      <div className={`relative flex items-center justify-center overflow-hidden border border-[#e8e4dc33] bg-[#080808] ${className}`}>
        <div className="absolute left-4 top-4">
          <p className="font-mono text-[10px] uppercase tracking-[3px] text-[#e8e4dc99]">{"// COWORKER MESSAGE MESH"}</p>
          <p className="mt-1 font-mono text-[9px] uppercase tracking-[2px] text-[#e8e4dc55]">Issue route {"->"} owner AUBI {"->"} peer context</p>
        </div>
        <div className="border border-dashed border-[#1f1f1f] px-8 py-6 text-center">
          <p className="font-mono text-[10px] uppercase tracking-[3px] text-[#e8e4dc66]">Awaiting coworker exchange</p>
          <p className="mt-2 font-mono text-[9px] uppercase tracking-[2px] text-[#e8e4dc44]">Run AUBI to stream message paths</p>
        </div>
      </div>
    );
  }

  return (
    <div className={`relative overflow-hidden border border-[#e8e4dc33] bg-[#080808] ${className}`}>
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(57,255,20,0.08),transparent_48%)]" />
      <div className="absolute left-4 right-4 top-4 z-10 flex items-start justify-between gap-4">
        <div className="min-w-0">
        <p className="font-mono text-[10px] uppercase tracking-[3px] text-[#e8e4dc99]">{"// COWORKER MESSAGE MESH"}</p>
          <p className="mt-1 truncate font-mono text-[9px] uppercase tracking-[2px] text-[#e8e4dc66]">{activeRoute}</p>
        </div>
        <div className="shrink-0 border border-[#1f1f1f] px-3 py-1.5 text-right">
          <p className="font-mono text-[8px] uppercase tracking-[2px] text-[#39ff14]">{Math.max(endpoints.length - 1, 0)} coworkers</p>
          <p className="mt-0.5 font-mono text-[8px] uppercase tracking-[2px] text-[#e8e4dc44]">{edges.length} paths</p>
        </div>
      </div>

      <svg className="absolute inset-0 h-full w-full" viewBox="0 0 100 100" preserveAspectRatio="none">
        <defs>
          <marker id="mesh-arrow" markerHeight="6" markerWidth="6" orient="auto" refX="5" refY="3">
            <path d="M 0 0 L 6 3 L 0 6 z" fill="#39ff14" opacity="0.9" />
          </marker>
        </defs>
        {edges.map(([from, to]) => {
          const a = positions[from];
          const b = positions[to];
          if (!a || !b) return null;
          const active =
            (sender === a && recipient === b) ||
            (sender === b && recipient === a);

          return (
            <g key={`${from}-${to}`}>
              <path
                d={routePath(a, b)}
                fill="none"
                stroke={active ? "#39ff14" : "#1f1f1f"}
                strokeWidth={active ? 1.8 : 1}
                strokeDasharray={active ? "none" : "4 5"}
                markerEnd={active ? "url(#mesh-arrow)" : undefined}
                vectorEffect="non-scaling-stroke"
              />
              {active && (
                <motion.circle
                  r={1.1}
                  fill="#39ff14"
                  initial={{ opacity: 0 }}
                  animate={{ cx: [a.x, b.x], cy: [a.y, b.y], opacity: [0, 1, 0] }}
                  transition={{ duration: 0.9, repeat: Infinity, ease: "easeInOut" }}
                />
              )}
            </g>
          );
        })}
      </svg>

      {Object.entries(positions).map(([key, node]) => {
        const isSender = key === senderKey;
        const isRecipient = key === recipientKey;
        const active = isSender || isRecipient;
        return (
          <motion.div
            key={key}
            animate={active ? { scale: [1, 1.08, 1] } : { scale: 1 }}
            transition={{ duration: 0.8, repeat: active ? Infinity : 0, repeatDelay: 0.4 }}
            className={[
              "absolute flex w-36 -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-2 border px-3 py-3 text-center",
              active ? "border-[#39ff14]/70 bg-[#081108] shadow-[0_0_24px_rgba(57,255,20,0.14)]" : "border-[#1f1f1f] bg-[#080808]/88",
            ].join(" ")}
            style={{ left: `${node.x}%`, top: `${node.y}%` }}
          >
            <span
              className={[
                "h-3 w-3 rounded-full border",
                node.role === "orchestrator" ? "h-4 w-4" : "",
                active ? "border-[#39ff14] bg-[#39ff14]" : "border-[#e8e4dc33] bg-[#080808]",
              ].join(" ")}
            />
            <span className={`font-mono text-[9px] uppercase leading-4 tracking-[1.5px] ${active ? "text-[#39ff14]" : "text-[#e8e4dc99]"}`}>
              {node.label}
            </span>
            <span className="font-mono text-[7px] uppercase tracking-[1.5px] text-[#e8e4dc55]">
              {isSender ? "sending" : isRecipient ? "receiving" : node.description}
            </span>
          </motion.div>
        );
      })}

      <div className="absolute bottom-4 left-4 right-4 z-10 grid gap-3 md:grid-cols-[minmax(0,1fr)_180px]">
        <div className="min-h-[72px] border border-[#1f1f1f] bg-[#050505]/85 p-3">
          <p className="font-mono text-[8px] uppercase tracking-[2px] text-[#e8e4dc55]">Active context packet</p>
          <p className="mt-2 line-clamp-2 text-xs leading-5 text-[#e8e4dcbb]">{compactMessage(activeMessage?.message)}</p>
        </div>
        <div className="border border-[#1f1f1f] bg-[#050505]/85 p-3">
          <p className="font-mono text-[8px] uppercase tracking-[2px] text-[#e8e4dc55]">Route state</p>
          <p className="mt-2 font-mono text-[10px] uppercase tracking-[2px] text-[#39ff14]">
            {activeMessage ? "Exchanging" : "Mapped"}
          </p>
        </div>
      </div>
    </div>
  );
}
