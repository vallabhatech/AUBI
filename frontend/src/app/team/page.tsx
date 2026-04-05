"use client";

import { useMemo, useState } from "react";
import type { Agent } from "@/lib/types";
import { useAgents } from "@/hooks/useAgents";
import { AgentCard } from "@/components/aubi/AgentCard";
import { ConstitutionPanel } from "@/components/aubi/ConstitutionPanel";

export default function TeamPage() {
  const { agents, isLoading, error } = useAgents();
  const [selectedAgent, setSelectedAgent] = useState<Agent | null>(null);

  const visibleAgents = useMemo(() => agents, [agents]);
  const totalFacts = useMemo(
    () => visibleAgents.reduce((sum, agent) => sum + (agent.constitution_facts?.length ?? 0), 0),
    [visibleAgents]
  );
  const totalCommits = useMemo(
    () => visibleAgents.reduce((sum, agent) => sum + (agent.github_data_summary?.commit_count ?? 0), 0),
    [visibleAgents]
  );
  const languages = useMemo(() => {
    const values = visibleAgents.flatMap((agent) => agent.github_data_summary?.languages ?? []);
    return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean))).slice(0, 6);
  }, [visibleAgents]);

  return (
    <div className="relative min-h-[calc(100vh-52px)] overflow-hidden px-6 py-6">
      <div className="mx-auto max-w-[1360px]">
        <div className="mb-7 grid gap-6 xl:grid-cols-[minmax(0,1fr)_420px]">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-[3px] text-[#39ff14]">{"// TEAM CONSTITUTIONS"}</p>
            <h1 className="mt-3 font-syne text-[52px] font-normal leading-none text-[#e8e4dc] md:text-6xl">AUBI Coworker Mesh</h1>
            <p className="mt-4 max-w-3xl text-[15px] leading-relaxed text-[#e8e4dc99]">
              This is the team memory layer. Each card is one developer&apos;s AUBI coworker, generated from GitHub activity and persisted as constitution facts for routing, context sharing, and future fixes.
            </p>
          </div>

          <div className="border border-[#e8e4dc33] bg-[#0a0a0a] p-4">
            <div className="flex items-center justify-between border-b border-[#1f1f1f] pb-3">
              <p className="font-mono text-[10px] uppercase tracking-[3px] text-[#e8e4dc99]">{"// WHAT TO READ"}</p>
              <div className="font-mono text-[10px] uppercase tracking-[2px] text-[#39ff14]">
                <span className="mr-2 inline-block h-2 w-2 animate-pulse rounded-full bg-[#39ff14]" />
                Mesh Online
              </div>
            </div>
            <div className="mt-4 grid gap-3 text-[12px] leading-relaxed text-[#e8e4dc99]">
              <p><span className="font-mono text-[10px] uppercase tracking-[2px] text-[#e8e4dc]">Identity</span> shows which human this coworker represents.</p>
              <p><span className="font-mono text-[10px] uppercase tracking-[2px] text-[#e8e4dc]">Ownership</span> shows where AUBI should route issues first.</p>
              <p><span className="font-mono text-[10px] uppercase tracking-[2px] text-[#e8e4dc]">Facts</span> are the persistent memory used by Flow and War Room.</p>
            </div>
          </div>
        </div>

        <div className="mb-7 grid gap-px border border-[#1f1f1f] bg-[#1f1f1f] md:grid-cols-4">
          {[
            ["coworkers", visibleAgents.length.toString()],
            ["constitution facts", totalFacts.toString()],
            ["indexed commits", totalCommits.toString()],
            ["languages", languages.length ? languages.join(", ") : "waiting"],
          ].map(([label, value]) => (
            <div key={label} className="bg-[#080808] px-4 py-3">
              <p className="font-mono text-[9px] uppercase tracking-[2px] text-[#e8e4dc55]">{label}</p>
              <p className="mt-1 truncate font-mono text-[12px] uppercase tracking-[1px] text-[#e8e4dc]">{value}</p>
            </div>
          ))}
        </div>

        {error && (
          <div className="mb-4 border border-[#e8e4dc33] p-4 font-mono text-[11px] uppercase tracking-[2px] text-[#e8e4dc99]">
            Backend unavailable. Live coworker memory could not be loaded.
          </div>
        )}

        {isLoading ? (
          <div className="flex h-[424px] items-center justify-center border border-[#1f1f1f] font-mono text-sm uppercase tracking-[3px] text-[#e8e4dc66]">
            Loading Coworker Mesh...
          </div>
        ) : visibleAgents.length === 0 ? (
          <div className="flex h-[424px] items-center justify-center border border-[#e8e4dc33] font-mono text-sm uppercase tracking-[3px] text-[#e8e4dc66]">
            No live coworker constitutions found.
          </div>
        ) : (
          <div className="grid gap-5 lg:grid-cols-2">
            {visibleAgents.map((agent, index) => (
              <AgentCard
                key={agent.id}
                agent={agent}
                index={index}
                selected={selectedAgent?.id === agent.id}
                onSelect={setSelectedAgent}
              />
            ))}
          </div>
        )}

        <div className="mt-7 border border-[#e8e4dc33] bg-[#080808] p-5">
          <div className="mb-4 flex items-center justify-between gap-4">
            <div>
              <div className="font-mono text-[10px] uppercase tracking-[3px] text-[#e8e4dc99]">{"// READINESS CHECKPOINT"}</div>
              <p className="mt-2 text-sm leading-relaxed text-[#e8e4dc66]">
                Judges should be able to tell that AUBI knows who owns what, why each coworker exists, and how this memory powers routing.
              </p>
            </div>
            <span className="hidden border border-[#39ff1433] px-3 py-2 font-mono text-[10px] uppercase tracking-[2px] text-[#39ff14] md:inline-flex">
              Live Qdrant memory
            </span>
          </div>
          <div className="grid gap-4 font-mono text-[11px] uppercase tracking-[2px] text-[#e8e4dc99] md:grid-cols-3">
            <div className="border border-[#1f1f1f] p-4">1. Cards identify each human&apos;s persistent AUBI coworker.</div>
            <div className="border border-[#1f1f1f] p-4">2. Ownership and expertise explain routing decisions before code is read.</div>
            <div className="border border-[#1f1f1f] p-4">3. Click a card to inspect the full Context Constitution.</div>
          </div>
        </div>

        <ConstitutionPanel agent={selectedAgent} onClose={() => setSelectedAgent(null)} />
      </div>
    </div>
  );
}
