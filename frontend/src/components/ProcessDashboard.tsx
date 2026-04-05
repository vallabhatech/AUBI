"use client";

import { motion } from "framer-motion";
import { coworkerPossessiveName } from "@/lib/agents";
import type {
  Agent,
  AgentMessage,
  CoworkerContextExchange,
  GitHubIssue,
  IncidentResult,
  MemoryUpdate,
  SSEEvent,
  SharedMemoryHit,
} from "@/lib/types";

type BoardMessage = {
  from: string;
  to: string;
  body: string;
  tone: "human" | "agent" | "memory";
};

type FlowStep = {
  label: string;
  detail: string;
  state: "idle" | "active" | "done";
};

function text(value: unknown, fallback = ""): string {
  return typeof value === "string" && value.trim() ? value : fallback;
}

function normalized(value: string): string {
  return value
    .toLowerCase()
    .replace(/@/g, "")
    .replace(/['’]s\b/g, "")
    .replace(/\baubi\b/g, "")
    .replace(/\bcoworker\b/g, "")
    .replace(/[_\s-]+/g, "")
    .replace(/[^a-z0-9]/g, "");
}

function findAgent(value: unknown, agents: Agent[]): Agent | undefined {
  if (typeof value !== "string") return undefined;
  const raw = normalized(value);
  if (!raw) return undefined;
  return agents.find((agent) => {
    const candidates = [agent.id, agent.github_username, agent.name, `${agent.github_username}_aubi`, `${agent.name}_aubi`];
    return candidates.some((candidate) => {
      const key = normalized(candidate ?? "");
      return key && (raw === key || raw.includes(key) || key.includes(raw));
    });
  });
}

function label(value: unknown, agents: Agent[]): string {
  if (typeof value !== "string" || !value.trim()) return "AUBI";
  if (value.toLowerCase() === "orchestrator") return "AUBI Orchestrator";
  const agent = findAgent(value, agents);
  if (agent) return coworkerPossessiveName(agent);
  return value.replace(/[_-]?aubi$/i, "'s AUBI").replace(/[_-]+/g, " ");
}

function eventMessages(events: SSEEvent[]): AgentMessage[] {
  return events
    .filter((event) => event.eventType === "agent_message" && event.output)
    .map((event) => event.output as unknown as AgentMessage);
}

function dedupeMessages(messages: AgentMessage[]): AgentMessage[] {
  const seen = new Set<string>();
  return messages.filter((message) => {
    const key = `${message.sender}|${message.recipient}|${message.message}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function exchangeMessages(exchanges: CoworkerContextExchange[], agents: Agent[]): BoardMessage[] {
  return exchanges.slice(0, 4).map((exchange) => {
    const from = label(
      exchange.requester_agent_id ??
        exchange.requester_agent_name ??
        exchange.requester_aubi ??
        exchange.source_aubi ??
        exchange.sender ??
        exchange.from,
      agents
    );
    const to = label(
      exchange.responder_agent_id ??
        exchange.responder_agent_name ??
        exchange.responder_aubi ??
        exchange.target_aubi ??
        exchange.recipient ??
        exchange.to,
      agents
    );
    return {
      from,
      to,
      body: text(
        exchange.context_shared ?? exchange.shared_context ?? exchange.context ?? exchange.summary ?? exchange.message,
        text(exchange.reason ?? exchange.why ?? exchange.why_it_matters, "Context requested from coworker memory.")
      ),
      tone: "memory",
    };
  });
}

function buildBoardMessages(
  result: IncidentResult | null,
  events: SSEEvent[],
  agents: Agent[],
  issue: GitHubIssue | null
): BoardMessage[] {
  const board: BoardMessage[] = [];
  if (issue) {
    board.push({
      from: text(issue.author ?? issue.user, "Human"),
      to: "AUBI Orchestrator",
      body: `${issue.repo_name}#${issue.issue_number}: ${issue.title}`,
      tone: "human",
    });
  }

  dedupeMessages([...(result?.agent_messages ?? []), ...eventMessages(events)]).forEach((message) => {
    board.push({
      from: label(message.sender, agents),
      to: label(message.recipient, agents),
      body: text(message.message, "Shared incident context"),
      tone: message.sender.toLowerCase() === "orchestrator" || message.recipient.toLowerCase() === "orchestrator" ? "agent" : "memory",
    });
  });

  board.push(...exchangeMessages(result?.coworker_exchanges ?? result?.coworker_contexts ?? [], agents));

  if (result?.awaiting_approval) {
    board.push({
      from: "AUBI Orchestrator",
      to: "Human reviewer",
      body: "Patch is ready for approval before AUBI pushes the PR.",
      tone: "human",
    });
  }

  return board;
}

function memoryText(memory: SharedMemoryHit): string {
  const evidence = Array.isArray(memory.evidence_facts) ? memory.evidence_facts[0] : undefined;
  return text(
    memory.object ?? memory.memory ?? memory.content ?? memory.summary ?? evidence?.object,
    "Shared team memory matched this incident."
  );
}

function writeText(update: MemoryUpdate): string {
  return text(update.update ?? update.episode ?? update.memory ?? update.fact ?? update.object, "AUBI wrote a new memory after the incident.");
}

function eventDone(events: SSEEvent[], node: string): boolean {
  return events.some((event) => event.node === node && event.status === "done");
}

function eventActive(events: SSEEvent[], node: string): boolean {
  return events.some((event) => event.node === node && event.status === "running");
}

function state(done: boolean, active: boolean): FlowStep["state"] {
  if (done) return "done";
  if (active) return "active";
  return "idle";
}

function ownerLabels(result: IncidentResult | null, agents: Agent[]): string {
  const owners = result?.owners ?? [];
  if (owners.length === 0) return "waiting";
  return owners
    .slice(0, 2)
    .map((owner) => {
      const agent = findAgent(owner, agents);
      return agent ? coworkerPossessiveName(agent) : owner;
    })
    .join(", ");
}

function buildFlow(
  result: IncidentResult | null,
  events: SSEEvent[],
  issue: GitHubIssue | null,
  agents: Agent[],
  memories: SharedMemoryHit[],
  writes: MemoryUpdate[],
  messages: BoardMessage[]
): FlowStep[] {
  const ownerFound = Boolean(result?.owners?.length) || eventDone(events, "ownership_router");
  const meshUsed = messages.some((message) => message.tone !== "human") || Boolean(result?.coworker_exchanges?.length);
  const memoryUsed = memories.length > 0 || writes.length > 0;
  const fixReady = Boolean(result?.patch_diff || result?.fix_explanation);
  const approvalOrPr = Boolean(result?.awaiting_approval || result?.pr_url);

  return [
    {
      label: "Human Signal",
      detail: issue ? `${issue.repo_name}#${issue.issue_number}` : "waiting for issue",
      state: state(Boolean(issue) || eventDone(events, "issue_reader"), eventActive(events, "issue_reader")),
    },
    {
      label: "Owner Routing",
      detail: ownerLabels(result, agents),
      state: state(ownerFound, eventActive(events, "ownership_router")),
    },
    {
      label: "Coworker Exchange",
      detail: meshUsed ? `${messages.filter((message) => message.tone !== "human").length} messages` : "no exchange yet",
      state: state(meshUsed, eventActive(events, "coworker_mesh_exchange") || eventActive(events, "query_single_agent")),
    },
    {
      label: "Memory Impact",
      detail: memoryUsed ? `${memories.length} hits · ${writes.length} writes` : "memory pending",
      state: state(memoryUsed, eventActive(events, "memory_updater")),
    },
    {
      label: "Fix Outcome",
      detail: result?.pr_url ? "PR ready" : result?.awaiting_approval ? "approval gate" : fixReady ? "patch generated" : "waiting",
      state: state(approvalOrPr || fixReady, eventActive(events, "fix_generator") || eventActive(events, "test_runner")),
    },
  ];
}

function metric(label: string, value: number | string) {
  return { label, value };
}

export function ProcessDashboard({
  result,
  events,
  agents,
  latestIssue,
  isStreaming,
}: {
  result: IncidentResult | null;
  events: SSEEvent[];
  agents: Agent[];
  latestIssue: GitHubIssue | null;
  isStreaming: boolean;
}) {
  const memories = (result?.shared_memory_hits ?? result?.shared_memory ?? []).slice(0, 4);
  const writes = (result?.memory_writes ?? result?.memory_updates ?? []).slice(0, 4);
  const messages = buildBoardMessages(result, events, agents, latestIssue);
  const visibleMessages = messages.slice(-7);
  const flow = buildFlow(result, events, latestIssue, agents, memories, writes, messages);
  const metrics = [
    metric("messages", messages.length),
    metric("memory hits", memories.length),
    metric("writes", writes.length),
    metric("status", result?.pr_url ? "PR" : result?.awaiting_approval ? "approval" : isStreaming ? "running" : "idle"),
  ];

  return (
    <section className="flex h-full min-h-0 flex-col overflow-hidden border border-[#1e2d45] bg-[#0a0e1a]">
      <header className="flex shrink-0 items-start justify-between gap-4 border-b border-[#1e2d45] px-4 py-3">
        <div>
          <p className="font-mono text-[9px] uppercase tracking-[3px] text-[#4a6080]">{"// CONTEXT WAR ROOM"}</p>
          <h2 className="mt-1 font-syne text-xl leading-none text-white">AUBI Context Dashboard</h2>
          <p className="mt-1 text-xs text-[#8aa0c0]">Human signal, coworker exchange, shared memory, and outcome in one live trace.</p>
        </div>
        <div className="grid shrink-0 grid-cols-4 gap-1.5">
          {metrics.map((item) => (
            <div key={item.label} className="min-w-16 border border-[#1e2d45] bg-[#111827] px-2 py-1 text-right">
              <p className="font-mono text-[11px] text-[#c8d6e8]">{item.value}</p>
              <p className="font-mono text-[8px] uppercase tracking-[1.5px] text-[#4a6080]">{item.label}</p>
            </div>
          ))}
        </div>
      </header>

      <div className="grid shrink-0 grid-cols-5 border-b border-[#1e2d45]">
        {flow.map((step, index) => (
          <div key={step.label} className="relative min-w-0 border-r border-[#1e2d45] px-3 py-3 last:border-r-0">
            {index > 0 && <span className="absolute left-0 top-5 h-px w-3 bg-[#1e2d45]" />}
            <div className="flex items-center gap-2">
              <span
                className={[
                  "h-2.5 w-2.5 shrink-0 rounded-full",
                  step.state === "done" ? "bg-[#39ff14]" : step.state === "active" ? "bg-[#00f0ff]" : "bg-[#1e2d45]",
                ].join(" ")}
              />
              <p className="truncate font-mono text-[9px] uppercase tracking-[2px] text-[#c8d6e8]">{step.label}</p>
            </div>
            <p className="mt-2 truncate font-mono text-[9px] uppercase tracking-[1.5px] text-[#4a6080]">{step.detail}</p>
          </div>
        ))}
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-[1.3fr_0.9fr] gap-3 overflow-hidden p-3">
        <div className="min-h-0 overflow-hidden border border-[#1e2d45] bg-[#050912]">
          <div className="flex h-9 items-center justify-between border-b border-[#1e2d45] px-3">
            <p className="font-mono text-[9px] uppercase tracking-[3px] text-[#4a6080]">{"// MESSAGE BOARD"}</p>
            <p className="font-mono text-[9px] uppercase tracking-[2px] text-[#4a6080]">{visibleMessages.length} visible</p>
          </div>
          <div className="aubi-scrollbar h-[calc(100%-36px)] space-y-2 overflow-y-auto p-3">
            {visibleMessages.length === 0 ? (
              <div className="flex h-full items-center justify-center px-6 text-center font-mono text-[10px] uppercase tracking-[2px] text-[#4a6080]">
                Start an incident to populate human and coworker context messages.
              </div>
            ) : (
              visibleMessages.map((message, index) => (
                <motion.div
                  key={`${message.from}-${message.to}-${index}`}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  className={[
                    "border px-3 py-2",
                    message.tone === "human"
                      ? "border-emerald-500/25 bg-emerald-500/5"
                      : message.tone === "memory"
                        ? "border-cyan-500/25 bg-cyan-500/5"
                        : "border-violet-500/25 bg-violet-500/5",
                  ].join(" ")}
                >
                  <p className="font-mono text-[10px] text-[#8aa0c0]">
                    {message.from} <span className="text-[#4a6080]">→</span> {message.to}
                  </p>
                  <p className="mt-1 line-clamp-3 text-[11px] leading-relaxed text-[#c8d6e8]">{message.body}</p>
                </motion.div>
              ))
            )}
          </div>
        </div>

        <div className="grid min-h-0 grid-rows-2 gap-3 overflow-hidden">
          <div className="min-h-0 overflow-hidden border border-[#1e2d45] bg-[#050912]">
            <div className="flex h-9 items-center justify-between border-b border-[#1e2d45] px-3">
              <p className="font-mono text-[9px] uppercase tracking-[3px] text-[#4a6080]">{"// MEMORY USED"}</p>
              <p className="font-mono text-[9px] uppercase tracking-[2px] text-[#4a6080]">{memories.length} hits</p>
            </div>
            <div className="aubi-scrollbar h-[calc(100%-36px)] space-y-2 overflow-y-auto p-3">
              {memories.length === 0 ? (
                <p className="font-mono text-[10px] uppercase tracking-[2px] text-[#4a6080]">Waiting for shared memory retrieval.</p>
              ) : (
                memories.map((memory, index) => (
                  <div key={`${memory.scope_id ?? memory.subject ?? "memory"}-${index}`} className="border border-cyan-500/20 bg-cyan-500/5 px-3 py-2">
                    <p className="font-mono text-[10px] text-cyan-300">{text(memory.subject ?? memory.source ?? memory.agent_name, "Shared team memory")}</p>
                    <p className="mt-1 line-clamp-2 text-[11px] leading-relaxed text-[#8aa0c0]">{memoryText(memory)}</p>
                  </div>
                ))
              )}
            </div>
          </div>

          <div className="min-h-0 overflow-hidden border border-[#1e2d45] bg-[#050912]">
            <div className="flex h-9 items-center justify-between border-b border-[#1e2d45] px-3">
              <p className="font-mono text-[9px] uppercase tracking-[3px] text-[#4a6080]">{"// MEMORY WRITTEN"}</p>
              <p className="font-mono text-[9px] uppercase tracking-[2px] text-[#4a6080]">{writes.length} writes</p>
            </div>
            <div className="aubi-scrollbar h-[calc(100%-36px)] space-y-2 overflow-y-auto p-3">
              {writes.length === 0 ? (
                <p className="font-mono text-[10px] uppercase tracking-[2px] text-[#4a6080]">No new incident memory written yet.</p>
              ) : (
                writes.map((write, index) => (
                  <div key={`${write.agent_id ?? write.subject ?? "write"}-${index}`} className="border border-emerald-500/20 bg-emerald-500/5 px-3 py-2">
                    <p className="font-mono text-[10px] text-emerald-300">{text(write.agent_name ?? write.coworker_aubi ?? write.subject, "AUBI memory")}</p>
                    <p className="mt-1 line-clamp-2 text-[11px] leading-relaxed text-[#8aa0c0]">{writeText(write)}</p>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
