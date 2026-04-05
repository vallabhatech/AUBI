"use client";

import { useEffect, useMemo, useState } from "react";
import { useIncidentStream } from "@/hooks/useIncidentStream";
import { useAgents } from "@/hooks/useAgents";
import { IncidentTerminal } from "@/components/IncidentTerminal";
import { NeuralTrace } from "@/components/NeuralTrace";
import { HexGrid, type MeshCommunicationLink } from "@/components/HexGrid";
import { CoworkerMeshPanel } from "@/components/CoworkerMeshPanel";
import { LiveExchangeFeed } from "@/components/aubi/LiveExchangeFeed";
import { ConsiderationsPanel } from "@/components/aubi/ConsiderationsPanel";
import { IssuePicker } from "@/components/aubi/IssuePicker";
import { api } from "@/lib/api";
import { coworkerName } from "@/lib/agents";
import { issueUrlFor } from "@/lib/githubIssues";
import { loadWarRoomSnapshot, WAR_ROOM_SNAPSHOT_KEY } from "@/lib/warRoomState";
import type { Agent, AgentMessage, CoworkerContextExchange, GitHubIssue } from "@/lib/types";

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
    coworkerName(agent),
  ].filter(Boolean);
}

function findAgentBySignal(value: unknown, agents: Agent[]): Agent | undefined {
  if (typeof value !== "string" || !value.trim()) return undefined;
  const raw = normalizedIdentity(value);
  if (!raw || raw === "orchestrator") return undefined;
  return agents.find((agent) =>
    identityValues(agent).some((candidate) => {
      const normalized = normalizedIdentity(candidate);
      return normalized.length > 1 && (raw === normalized || raw.includes(normalized) || normalized.includes(raw));
    })
  );
}

function firstAgentFromSignals(values: unknown[], agents: Agent[]): Agent | undefined {
  for (const value of values) {
    if (Array.isArray(value)) {
      const match = firstAgentFromSignals(value, agents);
      if (match) return match;
      continue;
    }
    const match = findAgentBySignal(value, agents);
    if (match) return match;
  }
  return undefined;
}

function linkFromMessage(message: AgentMessage, agents: Agent[], index: number): MeshCommunicationLink | null {
  if (normalizedIdentity(message.sender) === "orchestrator" || normalizedIdentity(message.recipient) === "orchestrator") {
    return null;
  }
  const from = findAgentBySignal(message.sender, agents);
  const to = findAgentBySignal(message.recipient, agents);
  if (!from || !to || from.id === to.id) return null;
  return {
    id: `msg-${index}-${from.id}-${to.id}`,
    fromId: from.id,
    toId: to.id,
    label: message.message,
  };
}

function linkFromExchange(exchange: CoworkerContextExchange, agents: Agent[], index: number): MeshCommunicationLink | null {
  const from = firstAgentFromSignals([
    exchange.requester_agent_id,
    exchange.requester_agent_name,
    exchange.requester_agent_ids,
    exchange.requester_agent_names,
    exchange.requester_aubi,
    exchange.source_aubi,
    exchange.sender,
    exchange.from,
  ], agents);
  const to = firstAgentFromSignals([
    exchange.responder_agent_id,
    exchange.responder_agent_name,
    exchange.responder_aubi,
    exchange.target_aubi,
    exchange.recipient,
    exchange.to,
  ], agents);
  if (!from || !to || from.id === to.id) return null;
  return {
    id: `exchange-${index}-${from.id}-${to.id}`,
    fromId: from.id,
    toId: to.id,
    label: exchange.request ?? exchange.context_shared ?? exchange.message,
  };
}

export default function IncidentPage() {
  const [issueUrl, setIssueUrl] = useState("");
  const [issues, setIssues] = useState<GitHubIssue[]>([]);
  const [latestIssue, setLatestIssue] = useState<GitHubIssue | null>(null);
  const [isLoadingIssue, setIsLoadingIssue] = useState(false);
  const [issueError, setIssueError] = useState<string | null>(null);
  const { events, isStreaming, result, error, start, reset, hydrate } = useIncidentStream();
  const { agents } = useAgents();

  const communicationLinks = useMemo(() => {
    const messageLinks = [
      ...(result?.agent_messages ?? []),
      ...events
        .filter((event) => event.eventType === "agent_message" && event.output)
        .map((event) => event.output as unknown as AgentMessage),
    ]
      .map((message, index) => linkFromMessage(message, agents, index))
      .filter((link): link is MeshCommunicationLink => Boolean(link));

    const exchangeLinks = [
      ...(result?.coworker_exchanges ?? []),
      ...(result?.coworker_contexts ?? []),
      ...events
        .filter((event) => (
          (event.eventType === "coworker_exchange" || event.eventType === "coworker_context") &&
          event.output
        ))
        .map((event) => event.output as unknown as CoworkerContextExchange),
    ]
      .map((exchange, index) => linkFromExchange(exchange, agents, index))
      .filter((link): link is MeshCommunicationLink => Boolean(link));

    const seen = new Set<string>();
    return [...messageLinks, ...exchangeLinks]
      .filter((link) => {
        const key = `${link.fromId}->${link.toId}:${link.label ?? ""}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .slice(-10)
      .map((link, index, links) => ({
        ...link,
        active: index >= Math.max(0, links.length - 4),
      }));
  }, [agents, events, result?.agent_messages, result?.coworker_contexts, result?.coworker_exchanges]);

  const hasEvents = events.length > 0;
  const coworkerExchanges = result?.coworker_exchanges ?? result?.coworker_contexts ?? [];
  const sharedMemoryHits = result?.shared_memory_hits ?? result?.shared_memory ?? [];
  const memoryWrites = result?.memory_writes ?? result?.memory_updates ?? result?.learned_facts ?? [];
  const pulsingAgentId = communicationLinks.at(-1)?.toId ?? null;
  const activeOwner = result?.owners?.[0]
    ? agents.find((agent) => agent.id === result.owners?.[0] || agent.name === result.owners?.[0])
    : null;
  const selectedIssue = issues.find((issue) => issueUrlFor(issue) === issueUrl) ?? (latestIssue && issueUrlFor(latestIssue) === issueUrl ? latestIssue : null);

  function handleSubmit() {
    if (!issueUrl.trim() || isStreaming) return;
    start(issueUrl.trim());
  }

  async function loadLatestIssue() {
    setIsLoadingIssue(true);
    setIssueError(null);
    try {
      const [latest, list] = await Promise.all([
        api.pollGitHub(),
        api.listGitHubIssues(),
      ]);
      const nextIssues = list.issues.length ? list.issues : latest.issue ? [latest.issue] : [];
      setIssues(nextIssues);
      setLatestIssue(latest.issue ?? nextIssues[0] ?? null);
      const firstUrl = nextIssues[0] ? issueUrlFor(nextIssues[0]) : latest.issue?.url;
      if (firstUrl) {
        setIssueUrl((current) => current.trim() ? current : firstUrl);
      }
    } catch (err) {
      setIssueError(err instanceof Error ? err.message : "Failed to load GitHub issue");
    } finally {
      setIsLoadingIssue(false);
    }
  }

  function handleReset() {
    reset();
    setIssueUrl(latestIssue?.url ?? "");
  }

  useEffect(() => {
    void loadLatestIssue();
    // Run once on page load; manual refresh uses the button below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const applySnapshot = () => {
      const snapshot = loadWarRoomSnapshot();
      if (!snapshot) return;
      setIssueUrl(snapshot.issueUrl);
      hydrate(snapshot);
    };

    applySnapshot();
    const onStorage = (event: StorageEvent) => {
      if (event.key === WAR_ROOM_SNAPSHOT_KEY) applySnapshot();
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [hydrate]);

  return (
    <div className="grid h-[calc(100vh-52px)] grid-cols-[390px_minmax(0,1fr)] overflow-hidden">
      <div className="flex min-h-0 flex-col gap-4 overflow-y-auto border-r border-[#1e2d45] p-5 aubi-scrollbar">
        <div className="flex items-center justify-between">
          <div>
            <p className="font-syne text-xl text-white">War Room</p>
            <p className="mt-0.5 font-mono text-[10px] text-[#4a6080]">Why and how the coworker mesh handled the run</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => void loadLatestIssue()}
              disabled={isLoadingIssue || isStreaming}
              className="border border-[#1e2d45] px-3 py-1.5 font-mono text-[10px] text-[#4a6080] transition-colors hover:border-[#2a3f5f] hover:text-[#e2e8f0] disabled:cursor-not-allowed disabled:opacity-40"
            >
              {isLoadingIssue ? "SYNCING" : "SYNC ISSUES"}
            </button>
            {hasEvents && (
              <button
                onClick={handleReset}
                className="border border-[#1e2d45] px-3 py-1.5 font-mono text-[10px] text-[#4a6080] transition-colors hover:border-[#2a3f5f] hover:text-[#e2e8f0]"
              >
                RESET
              </button>
            )}
          </div>
        </div>

        {issues.length > 0 && (
          <div className="border border-[#1e2d45] bg-[#0a0e1a] px-3 py-2">
            <p className="font-mono text-[9px] tracking-widest text-[#4a6080]">{"// SELECT GITHUB ISSUE"}</p>
            <IssuePicker
              className="mt-2"
              issues={issues}
              value={issueUrl}
              onChange={setIssueUrl}
              disabled={isStreaming}
            />
          </div>
        )}

        <div className="border border-[#1e2d45] bg-[#0a0e1a] px-3 py-2">
          <p className="font-mono text-[9px] tracking-widest text-[#4a6080]">{"// ACTIVE RUN"}</p>
          <p className="mt-1 truncate text-xs text-[#c8d6e8]">
            {selectedIssue ? `${selectedIssue.repo_name}#${selectedIssue.issue_number} - ${selectedIssue.title}` : issueUrl || "No issue selected"}
          </p>
        </div>

        {issueError && (
          <div className="border border-amber-500/30 bg-amber-500/10 px-3 py-2 font-mono text-[11px] text-amber-300">
            {issueError}
          </div>
        )}

        <IncidentTerminal
          value={issueUrl}
          onChange={setIssueUrl}
          onSubmit={handleSubmit}
          isStreaming={isStreaming}
        />

        {error && (
          <div className="border border-red-500/30 bg-red-500/10 px-3 py-2 font-mono text-[11px] text-red-300">
            {error}
          </div>
        )}

        <section className="border border-[#1e2d45] bg-[#0a0e1a] p-4">
          <p className="font-mono text-[9px] uppercase tracking-[3px] text-[#4a6080]">{"// RUN SIGNAL"}</p>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <div className="border border-[#1e2d45] bg-[#050912] px-3 py-2">
              <p className="font-mono text-[9px] uppercase tracking-[2px] text-[#4a6080]">Owner</p>
              <p className="mt-1 truncate font-mono text-[11px] text-[#c8d6e8]">{activeOwner?.name ?? result?.owners?.[0] ?? "waiting"}</p>
            </div>
            <div className="border border-[#1e2d45] bg-[#050912] px-3 py-2">
              <p className="font-mono text-[9px] uppercase tracking-[2px] text-[#4a6080]">Messages</p>
              <p className="mt-1 font-mono text-[11px] text-[#c8d6e8]">{result?.agent_messages?.length ?? 0}</p>
            </div>
            <div className="border border-[#1e2d45] bg-[#050912] px-3 py-2">
              <p className="font-mono text-[9px] uppercase tracking-[2px] text-[#4a6080]">Memory Hits</p>
              <p className="mt-1 font-mono text-[11px] text-[#c8d6e8]">{sharedMemoryHits.length}</p>
            </div>
            <div className="border border-[#1e2d45] bg-[#050912] px-3 py-2">
              <p className="font-mono text-[9px] uppercase tracking-[2px] text-[#4a6080]">Writes</p>
              <p className="mt-1 font-mono text-[11px] text-[#c8d6e8]">{memoryWrites.length}</p>
            </div>
          </div>
        </section>
      </div>

      <div className="min-h-0 overflow-y-auto p-5 aubi-scrollbar">
        <div className="flex min-h-full flex-col gap-4">
          <section className="border border-violet-500/30 bg-[#0a0e1a] p-5 shadow-[0_0_36px_rgba(139,92,246,0.08)]">
              {coworkerExchanges.length > 0 ? (
                <LiveExchangeFeed
                  exchanges={coworkerExchanges}
                  agents={agents}
                  result={result}
                />
              ) : (
                <div className="flex h-full min-h-[360px] flex-col justify-center">
                  <p className="font-mono text-[9px] tracking-widest text-[#4a6080]">{"// LIVE CONTEXT EXCHANGE"}</p>
                  <p className="mt-4 max-w-xl font-syne text-3xl leading-tight text-white">Waiting for coworker context.</p>
                  <p className="mt-3 max-w-xl text-sm leading-relaxed text-[#8aa0c0]">
                    Run AUBI in Flow, then open War Room to see the same run explained through coworker messages, memory hits, and routing decisions.
                  </p>
                </div>
              )}
            </section>

          <div className="grid gap-4 xl:grid-cols-[minmax(320px,0.85fr)_minmax(0,1.15fr)]">
            <div className="flex min-h-0 flex-col gap-4">
              <CoworkerMeshPanel result={result} agents={agents} events={events} />
            </div>

            <div className="flex min-h-0 flex-col gap-4">
              {coworkerExchanges.length > 0 ? (
                <ConsiderationsPanel
                  exchanges={coworkerExchanges}
                  agents={agents}
                  result={result}
                />
              ) : (
                <section className="border border-[#1e2d45] bg-[#0a0e1a] p-4">
                  <p className="font-mono text-[9px] uppercase tracking-[3px] text-[#4a6080]">{"// CONTEXT NOTES"}</p>
                  <p className="mt-3 text-xs leading-relaxed text-[#8aa0c0]">
                    Coworker considerations will appear after the mesh shares context for the selected issue.
                  </p>
                </section>
              )}
              {agents.length > 0 && (
                <section className="min-h-[230px] overflow-hidden border border-[#1e2d45] bg-[#0a0e1a]">
                  <div className="flex h-10 items-center justify-between border-b border-[#1e2d45] px-4">
                    <p className="font-mono text-[9px] uppercase tracking-[3px] text-[#4a6080]">{"// COWORKER MAP"}</p>
                    <p className="font-mono text-[9px] uppercase tracking-[2px] text-[#4a6080]">
                      {communicationLinks.length} active path{communicationLinks.length === 1 ? "" : "s"}
                    </p>
                  </div>
                  <div className="h-[230px]">
                    <HexGrid
                      agents={agents}
                      selectedId={null}
                      onSelect={() => {}}
                      compact
                      pulsingAgentId={pulsingAgentId}
                      communicationLinks={communicationLinks}
                    />
                  </div>
                </section>
              )}
            </div>
          </div>

          <section className="min-h-[300px] overflow-hidden border border-[#1e2d45] bg-[#0a0e1a]">
            <div className="flex h-11 items-center justify-between border-b border-[#1e2d45] px-4">
              <p className="font-mono text-[9px] uppercase tracking-[3px] text-[#4a6080]">{"// LIVE REASONING TRACE"}</p>
              <p className={["font-mono text-[9px] uppercase tracking-[2px]", isStreaming ? "text-[#00f0ff]" : "text-[#4a6080]"].join(" ")}>
                {isStreaming ? "streaming" : hasEvents ? "captured" : "idle"}
              </p>
            </div>
            <div className="h-[calc(100%-44px)] p-4">
              <NeuralTrace events={events} isStreaming={isStreaming} autoScroll={false} />
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
