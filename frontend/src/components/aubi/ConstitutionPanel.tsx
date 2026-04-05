"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { AnimatePresence, motion } from "framer-motion";
import { api } from "@/lib/api";
import type { Agent } from "@/lib/types";
import { CONSTITUTION_CATEGORIES, coworkerName, factsFor, humanSourceLabel } from "@/lib/agents";

export function ConstitutionPanel({
  agent,
  onClose
}: {
  agent: Agent | null;
  onClose: () => void;
}) {
  const [fullAgent, setFullAgent] = useState<Agent | null>(agent);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setFullAgent(agent);
    if (!agent) return;

    setLoading(true);
    api.getAgent(agent.id)
      .then((nextAgent) => {
        if (!cancelled) setFullAgent(nextAgent);
      })
      .catch(() => {
        if (!cancelled) setFullAgent(agent);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [agent]);

  const visible = fullAgent ?? agent;

  return (
    <AnimatePresence>
      {visible && (
        <motion.aside
          key={visible.id}
          initial={{ x: 420, opacity: 0 }}
          animate={{ x: 0, opacity: 1 }}
          exit={{ x: 420, opacity: 0 }}
          transition={{ type: "spring", stiffness: 260, damping: 30 }}
          className="fixed right-0 top-[52px] z-40 flex h-[calc(100vh-52px)] w-[424px] flex-col border-l border-[#1f1f1f] bg-[#080808]"
        >
          <header className="border-b border-[#1f1f1f] p-6">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="font-mono text-[10px] uppercase tracking-[3px] text-[#e8e4dc99]">{"// CONTEXT CONSTITUTION"}</p>
                <div className="mt-4 flex items-center gap-4">
                  <Image
                    src={`https://github.com/${visible.github_username}.png?size=96`}
                    alt={coworkerName(visible)}
                    width={48}
                    height={48}
                    className="border border-[#e8e4dc33]"
                  />
                  <div>
                    <h2 className="font-syne text-4xl font-normal leading-none text-[#e8e4dc]">{coworkerName(visible)}</h2>
                    <p className="font-mono text-[10px] uppercase tracking-[2px] text-[#e8e4dc66]">{humanSourceLabel(visible)}</p>
                    <p className="font-mono text-[11px] uppercase tracking-[2px] text-[#e8e4dc99]">{visible.role}</p>
                  </div>
                </div>
              </div>
              <button onClick={onClose} className="text-2xl leading-none text-[#e8e4dc99] transition hover:text-[#e8e4dc]">
                ×
              </button>
            </div>
            {loading && <p className="mt-4 font-mono text-[10px] uppercase tracking-[2px] text-[#39ff14]">Syncing full constitution...</p>}
          </header>

          <div className="aubi-scrollbar flex-1 overflow-y-auto p-6">
            {CONSTITUTION_CATEGORIES.map((category) => {
              const facts = factsFor(visible, category.key);
              const activeCategory = category.key === "current_focus";
              return (
                <section key={category.key} className="mb-8">
                  <div className="mb-4 flex items-center gap-4">
                    <span className="h-6 w-px bg-[#e8e4dc]" />
                    <h3 className="font-mono text-[10px] uppercase tracking-[3px] text-[#e8e4dc]">{category.label}</h3>
                  </div>
                  <div className="space-y-4">
                    {facts.length === 0 && <div className="border border-[#e8e4dc33] bg-[#080808] p-4 font-mono text-[11px] uppercase tracking-[2px] text-[#e8e4dc66]">[ No data ]</div>}
                    {facts.map((fact, index) => (
                      <motion.div
                        key={`${category.key}-${index}`}
                        initial={{ opacity: 0, x: -8 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ delay: index * 0.04 }}
                        className="border border-[#e8e4dc33] bg-[#080808] p-4"
                      >
                        <div className="flex flex-col gap-1.5">
                          <span className="font-mono text-[9px] uppercase tracking-[2px] text-[#e8e4dc55] truncate">{fact.predicate}</span>
                          <span className="text-[13px] leading-relaxed text-[#e8e4dc]">{fact.object}</span>
                        </div>
                        <div className="mt-4 flex items-center gap-2">
                          <div className="h-px flex-1 overflow-hidden bg-[#1f1f1f]">
                            <motion.div
                              initial={{ width: 0 }}
                              animate={{ width: `${Math.round(fact.confidence * 100)}%` }}
                              transition={{ duration: 0.45, delay: 0.05 }}
                              className="h-full"
                              style={{ backgroundColor: activeCategory ? "#39ff14" : "#e8e4dc" }}
                            />
                          </div>
                          <span className="w-10 text-right font-mono text-[9px] uppercase tracking-[2px] text-[#e8e4dc99]">{Math.round(fact.confidence * 100)}%</span>
                        </div>
                      </motion.div>
                    ))}
                  </div>
                </section>
              );
            })}
          </div>
        </motion.aside>
      )}
    </AnimatePresence>
  );
}
