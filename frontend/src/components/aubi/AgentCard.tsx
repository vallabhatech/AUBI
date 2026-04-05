"use client";

import Image from "next/image";
import { motion } from "framer-motion";
import type { Agent } from "@/lib/types";
import { collaborationBlurb, coworkerName, factObjects, humanSourceLabel, shortRole } from "@/lib/agents";

export function AgentCard({
  agent,
  index,
  selected,
  onSelect
}: {
  agent: Agent;
  index: number;
  selected?: boolean;
  onSelect: (agent: Agent) => void;
}) {
  const expertise = factObjects(agent, "expertise", 4)
    .flatMap((item) => item.split(",").map((part) => part.trim()))
    .filter(Boolean)
    .slice(0, 4);
  const ownership = factObjects(agent, "code_ownership", 3);
  const repoCount = new Set([
    ...(agent.github_data_summary.target_repos ?? []),
    ...(agent.github_data_summary.repos_considered ?? []),
  ]).size;

  return (
    <motion.button
      type="button"
      onClick={() => onSelect(agent)}
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.08, duration: 0.32 }}
      className={[
        "group relative flex min-h-[470px] flex-col border bg-[#080808] p-5 text-left transition-colors",
        selected
          ? "border-[#39ff14] text-[#e8e4dc]"
          : "border-[#e8e4dc33] hover:border-[#e8e4dc80]"
      ].join(" ")}
    >
      <div className="absolute right-4 top-4 flex items-center gap-2">
        <span className="h-2 w-2 animate-pulse rounded-full bg-[#39ff14]" />
        <span className="font-mono text-[9px] uppercase tracking-[3px] text-[#39ff14]">Online</span>
      </div>

      <div className="flex items-start gap-4">
        <Image
          src={`https://github.com/${agent.github_username}.png?size=96`}
          alt={coworkerName(agent)}
          width={56}
          height={56}
          className="border border-[#e8e4dc33] bg-[#080808]"
        />
        <div className="min-w-0 pr-20">
          <p className="font-mono text-[8px] uppercase tracking-[2px] text-[#e8e4dc55]">AUBI coworker for</p>
          <h2 className="mt-1 break-words font-syne text-[28px] font-normal leading-[0.95] text-[#e8e4dc]">{coworkerName(agent)}</h2>
          <div className="mt-2 inline-flex border border-[#e8e4dc33] px-2 py-1 font-mono text-[10px] uppercase tracking-[2px] text-[#e8e4dc99]">
            {shortRole(agent.role)}
          </div>
          <p className="mt-2 font-mono text-[10px] uppercase tracking-[2px] text-[#e8e4dc66]">{humanSourceLabel(agent)}</p>
        </div>
      </div>

      <div className="mt-5 grid grid-cols-3 gap-px bg-[#1f1f1f]">
        {[
          ["facts", agent.constitution_facts.length.toString()],
          ["commits", agent.github_data_summary.commit_count.toString()],
          ["repos", repoCount.toString()],
        ].map(([label, value]) => (
          <div key={label} className="bg-[#080808] px-2 py-2">
            <p className="font-mono text-[8px] uppercase tracking-[1.5px] text-[#e8e4dc44]">{label}</p>
            <p className="mt-1 font-mono text-[11px] text-[#e8e4dc]">{value}</p>
          </div>
        ))}
      </div>

      <div className="mt-5">
        <div className="mb-2 flex items-center justify-between">
          <span className="font-mono text-[9px] uppercase tracking-[3px] text-[#e8e4dc99]">Expertise</span>
          <span className="font-mono text-[8px] uppercase tracking-[2px] text-[#e8e4dc44]">route by skill</span>
        </div>
        <div className="flex flex-wrap gap-2">
          {(expertise.length ? expertise : agent.github_data_summary.languages).slice(0, 4).map((item) => (
            <span key={item} className="border border-[#39ff1433] bg-[#39ff1408] px-2 py-1 font-mono text-[10px] uppercase tracking-[1.5px] text-[#e8e4dc]">
              {item}
            </span>
          ))}
        </div>
      </div>

      <div className="mt-4">
        <div className="mb-2 flex items-center justify-between">
          <span className="font-mono text-[9px] uppercase tracking-[3px] text-[#e8e4dc99]">Code Ownership</span>
          <span className="font-mono text-[8px] uppercase tracking-[2px] text-[#e8e4dc44]">route by path</span>
        </div>
        <div className="space-y-2">
          {(ownership.length ? ownership : agent.github_data_summary.top_files).slice(0, 3).map((item) => (
            <span key={item} className="block border border-[#e8e4dc22] px-2 py-2 font-mono text-[10px] uppercase leading-relaxed tracking-[1.6px] text-[#e8e4dc]">
              {item}
            </span>
          ))}
        </div>
      </div>

      <div className="mt-4 border-l border-[#e8e4dc33] pl-3">
        <p className="font-mono text-[9px] uppercase tracking-[2px] text-[#e8e4dc66]">Collaboration signal</p>
        <p className="mt-1 line-clamp-3 text-[13px] leading-relaxed text-[#e8e4dc99]">
          {collaborationBlurb(agent)}
        </p>
      </div>

      <div className="mt-auto flex items-center justify-between border-t border-[#1f1f1f] pt-4">
        <span className="font-mono text-[10px] uppercase tracking-[2px] text-[#e8e4dc66]">Persistent Memory</span>
        <span className="font-mono text-[10px] uppercase tracking-[2px] text-[#e8e4dc99]">{agent.constitution_facts.length} facts</span>
      </div>
    </motion.button>
  );
}
