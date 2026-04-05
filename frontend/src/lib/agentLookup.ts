import type { Agent, CoworkerContextExchange, IncidentResult, AgentMessage } from "@/lib/types";

function normalizedIdentity(value: string): string {
  return value
    .toLowerCase()
    .replace(/@/g, "")
    .replace(/['']s\b/g, "")
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
    .find((agent) =>
      identityValues(agent).some((candidate) => {
        const needle = normalizedIdentity(candidate);
        return needle.length > 2 && haystack.includes(needle);
      })
    );
}

export function firstAgentFromValues(values: unknown[], agents: Agent[], excludeIds: string[] = []): Agent | undefined {
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

function exchangeMessage(result: IncidentResult | null, index: number): AgentMessage | undefined {
  const messages = (result?.agent_messages ?? []).filter((m) => {
    const s = m.sender.toLowerCase();
    const r = m.recipient.toLowerCase();
    return s !== "orchestrator" && r !== "orchestrator";
  });
  return messages[index * 2] ?? messages[index];
}

export function resolveSourceAgent(
  exchange: CoworkerContextExchange,
  result: IncidentResult | null,
  agents: Agent[],
  index: number
): Agent | undefined {
  const message = exchangeMessage(result, index);
  const ownerId = result?.owners?.[0];
  return firstAgentFromValues(
    [
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
    ],
    agents
  );
}

export function resolveTargetAgent(
  exchange: CoworkerContextExchange,
  result: IncidentResult | null,
  agents: Agent[],
  index: number,
  source?: Agent
): Agent | undefined {
  const excludeIds = source ? [source.id] : [];
  const message = exchangeMessage(result, index);
  const direct = firstAgentFromValues(
    [
      exchange.responder_agent_id,
      exchange.responder_agent_name,
      exchange.responder_aubi,
      exchange.target_aubi,
      exchange.recipient,
      exchange.to,
      message?.recipient,
    ],
    agents,
    excludeIds
  );
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
