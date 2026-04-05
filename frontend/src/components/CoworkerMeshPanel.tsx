"use client";

import { motion } from "framer-motion";
import { coworkerPossessiveName } from "@/lib/agents";
import type {
  Agent,
  AgentMessage,
  CoworkerContextExchange,
  IncidentResult,
  MemoryUpdate,
  SSEEvent,
  SharedMemoryHit,
} from "@/lib/types";

function text(value: unknown, fallback = "pending"): string {
  return typeof value === "string" && value.trim() ? value : fallback;
}

function normalizedIdentity(value: string): string {
  return value
    .toLowerCase()
    .replace(/@/g, "")
    .replace(/['’]s\b/g, "")
    .replace(/\baubi\b/g, "")
    .replace(/\bcoworker\b/g, "")
    .replace(/[_\s-]+agent$/g, "")
    .replace(/[_\s-]+/g, "")
    .replace(/[^a-z0-9]/g, "");
}

function shortHumanName(agent: Agent): string {
  const source = agent.name || agent.github_username || "Developer";
  return source.split(/[\s-]+/).find(Boolean) ?? source;
}

function identityValues(agent: Agent): string[] {
  return [
    agent.id,
    agent.github_username,
    agent.name,
    shortHumanName(agent),
    `${agent.name}_aubi`,
    `${agent.github_username}_aubi`,
  ].filter(Boolean);
}

function findAgentByValue(value: unknown, agents: Agent[], excludeIds: string[] = []): Agent | undefined {
  if (typeof value !== "string" || !value.trim()) return undefined;
  const raw = normalizedIdentity(value);
  if (!raw) return undefined;
  return agents.find((agent) => {
    if (excludeIds.includes(agent.id)) return false;
    return identityValues(agent).some((candidate) => {
      const normalized = normalizedIdentity(candidate);
      return normalized.length > 1 && (raw === normalized || raw.includes(normalized) || normalized.includes(raw));
    });
  });
}

function inferAgentFromText(value: unknown, agents: Agent[], excludeIds: string[] = []): Agent | undefined {
  if (typeof value !== "string" || !value.trim()) return undefined;
  const haystack = normalizedIdentity(value);
  if (!haystack) return undefined;
  return agents
    .filter((agent) => !excludeIds.includes(agent.id))
    .sort((a, b) => (b.name || b.github_username).length - (a.name || a.github_username).length)
    .find((agent) => identityValues(agent).some((candidate) => {
      const needle = normalizedIdentity(candidate);
      return needle.length > 2 && haystack.includes(needle);
    }));
}

function firstAgentFromValues(values: unknown[], agents: Agent[], excludeIds: string[] = []): Agent | undefined {
  for (const value of values) {
    if (Array.isArray(value)) {
      const match = firstAgentFromValues(value, agents, excludeIds);
      if (match) return match;
      continue;
    }
    const direct = findAgentByValue(value, agents, excludeIds);
    if (direct) return direct;
  }
  return undefined;
}

function meshMessages(result: IncidentResult | null): AgentMessage[] {
  return (result?.agent_messages ?? []).filter((message) => {
    const sender = message.sender.toLowerCase();
    const recipient = message.recipient.toLowerCase();
    return sender !== "orchestrator" && recipient !== "orchestrator";
  });
}

function exchangeMessage(result: IncidentResult | null, index: number): AgentMessage | undefined {
  const messages = meshMessages(result);
  return messages[index * 2] ?? messages[index];
}

function sourceAgent(exchange: CoworkerContextExchange, result: IncidentResult | null, agents: Agent[], index: number): Agent | undefined {
  const message = exchangeMessage(result, index);
  const ownerId = result?.owners?.[0];
  return firstAgentFromValues([
    exchange.requester_agent_id,
    exchange.requester_agent_name,
    exchange.requester_agent_ids,
    exchange.requester_agent_names,
    exchange.requester_aubi,
    exchange.source_aubi,
    exchange.sender,
    exchange.from,
    message?.sender,
    ownerId,
  ], agents);
}

function targetAgent(exchange: CoworkerContextExchange, result: IncidentResult | null, agents: Agent[], index: number, source?: Agent): Agent | undefined {
  const excludeIds = source ? [source.id] : [];
  const message = exchangeMessage(result, index);
  const direct = firstAgentFromValues([
    exchange.responder_agent_id,
    exchange.responder_agent_name,
    exchange.responder_aubi,
    exchange.target_aubi,
    exchange.recipient,
    exchange.to,
    message?.recipient,
  ], agents, excludeIds);
  if (direct) return direct;

  const evidenceText = [
    exchange.request,
    exchange.context_shared,
    exchange.shared_context,
    exchange.context,
    exchange.summary,
    exchange.message,
    exchange.reason,
    exchange.why,
    exchange.why_it_matters,
    ...(exchange.evidence_facts ?? []).map((fact) => JSON.stringify(fact)),
  ].join(" ");
  return inferAgentFromText(evidenceText, agents, excludeIds);
}

function coworkerLabel(agent: Agent | undefined, fallback: unknown): string {
  if (agent) return coworkerPossessiveName(agent);
  const raw = text(fallback, "");
  const cleaned = raw
    .replace(/[_-]?aubi$/i, "")
    .replace(/[_-]+/g, " ")
    .trim();
  if (!cleaned || /^(aubi\s*)?coworker$/i.test(cleaned)) return "AUBI mesh";
  const base = cleaned.split(/\s+/).find(Boolean) ?? cleaned;
  return `${base}${base.toLowerCase().endsWith("s") ? "'" : "'s"} AUBI`;
}

function contextText(exchange: CoworkerContextExchange): string {
  return text(exchange.context_shared ?? exchange.shared_context ?? exchange.context ?? exchange.summary ?? exchange.message, "Waiting for shared context...");
}

function sourceName(exchange: CoworkerContextExchange, agents: Agent[], result: IncidentResult | null, index: number): string {
  return coworkerLabel(
    sourceAgent(exchange, result, agents, index),
    exchange.requester_agent_name ?? exchange.requester_aubi ?? exchange.source_aubi ?? exchange.sender ?? exchange.from
  );
}

function targetName(exchange: CoworkerContextExchange, agents: Agent[], result: IncidentResult | null, index: number): string {
  const source = sourceAgent(exchange, result, agents, index);
  return coworkerLabel(
    targetAgent(exchange, result, agents, index, source),
    exchange.responder_agent_name ?? exchange.responder_aubi ?? exchange.target_aubi ?? exchange.recipient ?? exchange.to
  );
}

function memorySummary(memory: SharedMemoryHit): string {
  const fact = Array.isArray(memory.evidence_facts) ? memory.evidence_facts[0] : undefined;
  if (fact) {
    return text(fact.object ?? fact.summary ?? fact.content, "Team memory matched");
  }
  return text(memory.object ?? memory.memory ?? memory.content ?? memory.summary ?? memory.title, "Team memory matched");
}

function memorySource(memory: SharedMemoryHit, agents: Agent[]): string {
  const agent = firstAgentFromValues([memory.agent_id, memory.agent_name, memory.source, memory.subject], agents);
  return agent ? coworkerPossessiveName(agent) : text(memory.agent_name ?? memory.source ?? memory.agent_id ?? memory._collection, "Shared team memory");
}

function updateText(update: MemoryUpdate): string {
  return text(update.update ?? update.episode ?? update.memory ?? update.fact ?? update.object, "Memory written after incident");
}

function updateOwner(update: MemoryUpdate, agents: Agent[]): string {
  const agent = firstAgentFromValues([update.agent_id, update.agent_name, update.coworker_aubi, update.subject], agents);
  return coworkerLabel(agent, update.coworker_aubi ?? update.agent_name ?? update.agent_id ?? update.subject);
}

function isExchangePayload(exchange: CoworkerContextExchange): boolean {
  const hasRequester = Boolean(
    exchange.requester_agent_id ||
    exchange.requester_agent_name ||
    exchange.requester_agent_ids?.length ||
    exchange.requester_agent_names?.length ||
    exchange.requester_aubi ||
    exchange.source_aubi ||
    exchange.sender ||
    exchange.from
  );
  const hasResponder = Boolean(
    exchange.responder_agent_id ||
    exchange.responder_agent_name ||
    exchange.responder_aubi ||
    exchange.target_aubi ||
    exchange.recipient ||
    exchange.to
  );
  return hasRequester || hasResponder;
}

function derivedExchange(result: IncidentResult | null): CoworkerContextExchange[] {
  const exchanges = (result?.coworker_exchanges ?? []).filter(isExchangePayload);
  if (exchanges.length > 0) return exchanges;
  return (result?.coworker_contexts ?? []).filter(isExchangePayload);
}

function derivedSharedMemory(result: IncidentResult | null): SharedMemoryHit[] {
  if (result?.shared_memory_hits?.length) return result.shared_memory_hits;
  if (result?.shared_memory?.length) return result.shared_memory;
  return [];
}

function derivedUpdates(result: IncidentResult | null): MemoryUpdate[] {
  if (result?.memory_writes?.length) return result.memory_writes;
  if (result?.memory_updates?.length) return result.memory_updates;
  return (result?.learned_facts ?? []).map((fact) => fact as MemoryUpdate);
}

function eventCount(events: SSEEvent[], type: string): number {
  return events.filter((event) => event.eventType === type).length;
}

export function CoworkerMeshPanel({
  result,
  agents,
  events,
}: {
  result: IncidentResult | null;
  agents: Agent[];
  events: SSEEvent[];
}) {
  const exchanges = derivedExchange(result);
  const memories = derivedSharedMemory(result).slice(0, 3);
  const updates = derivedUpdates(result).slice(0, 3);
  const hasSignal = exchanges.length > 0 || memories.length > 0 || updates.length > 0;

  return (
    <section className="border border-[#1e2d45] bg-[#0a0e1a] p-4">
      <div className="mb-4 flex items-start justify-between gap-4">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[3px] text-[#5d7194]">{"// COWORKER MESH"}</p>
          <p className="mt-2 max-w-md text-[13px] leading-5 text-[#9db0cf]">
            AUBI coworkers exchange context and learn from the incident.
          </p>
        </div>
        <div className="flex shrink-0 gap-1.5">
          {[
            ["CTX", "coworker_exchange"],
            ["MEM", "shared_memory_hit"],
            ["WRITE", "memory_write"],
          ].map(([label, type]) => (
            <span
              key={type}
              className="border border-[#223554] px-2.5 py-1 font-mono text-[10px] text-[#6f86aa]"
            >
              {label} {eventCount(events, type)}
            </span>
          ))}
        </div>
      </div>

      {!hasSignal && (
        <div className="border border-dashed border-[#1e2d45] px-4 py-4 font-mono text-[11px] leading-5 text-[#5d7194]">
          Waiting for coworker context, shared memory, and memory writes.
        </div>
      )}

      {exchanges.length > 0 && (
        <div className="space-y-3">
          {exchanges.slice(0, 3).map((exchange, index) => {
            const from = sourceName(exchange, agents, result, index);
            const to = targetName(exchange, agents, result, index);
            return (
              <motion.div
                key={`${from}-${to}-${index}`}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                className="border border-violet-500/25 bg-violet-500/5 p-4"
              >
                <p className="font-mono text-[11px] tracking-[1.5px] text-violet-300">
                  {from} asked {to}
                </p>
                <p className="mt-2 text-[12px] leading-5 text-[#8ea3c3]">
                  Why: {text(exchange.reason ?? exchange.why ?? exchange.why_it_matters, "relevant ownership context")}
                </p>
                <p className="mt-3 text-[13px] leading-6 text-[#d5dfef]">{contextText(exchange)}</p>
              </motion.div>
            );
          })}
        </div>
      )}

      {memories.length > 0 && (
        <div className="mt-4">
          <p className="mb-2 font-mono text-[10px] uppercase tracking-[3px] text-[#5d7194]">{"// SHARED TEAM MEMORY USED"}</p>
          <div className="space-y-2">
            {memories.map((memory, index) => (
              <div key={`${memorySource(memory, agents)}-${index}`} className="border border-cyan-500/20 bg-cyan-500/5 px-3 py-3">
                <p className="font-mono text-[11px] text-cyan-300">{memorySource(memory, agents)}</p>
                <p className="mt-2 line-clamp-3 text-[12px] leading-5 text-[#8ea3c3]">{memorySummary(memory)}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {updates.length > 0 && (
        <div className="mt-4">
          <p className="mb-2 font-mono text-[10px] uppercase tracking-[3px] text-[#5d7194]">{"// MEMORY WRITTEN"}</p>
          <div className="space-y-2">
            {updates.map((update, index) => (
              <div key={`${updateOwner(update, agents)}-${index}`} className="border border-emerald-500/20 bg-emerald-500/5 px-3 py-3">
                <p className="font-mono text-[11px] text-emerald-300">{updateOwner(update, agents)}</p>
                <p className="mt-2 line-clamp-3 text-[12px] leading-5 text-[#8ea3c3]">{updateText(update)}</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
