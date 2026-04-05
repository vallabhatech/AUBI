"use client";

import { motion, AnimatePresence } from "framer-motion";
import type { Agent, CoworkerContextExchange, IncidentResult } from "@/lib/types";
import { coworkerName } from "@/lib/agents";
import { resolveSourceAgent, resolveTargetAgent } from "@/lib/agentLookup";
import type { Agent as AgentType } from "@/lib/types";

function safeName(agent: AgentType | undefined): string {
  return agent ? coworkerName(agent) : "AUBI coworker";
}

function avatarUrl(agent: Agent | undefined): string {
  const username = agent?.github_username || agent?.name || "ghost";
  return `https://github.com/${username}.png?size=48`;
}

function contextText(exchange: CoworkerContextExchange): string {
  const raw =
    exchange.context_shared ??
    exchange.shared_context ??
    exchange.context ??
    exchange.summary ??
    exchange.message ??
    "";
  return typeof raw === "string" && raw.trim() ? raw : "Sharing context...";
}

interface Props {
  exchanges: CoworkerContextExchange[];
  agents: Agent[];
  result: IncidentResult | null;
}

export function LiveExchangeFeed({ exchanges, agents, result }: Props) {
  if (!exchanges.length) return null;

  return (
    <div className="space-y-5">
      <div className="flex items-end justify-between gap-4">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[3px] text-[#6f89b3]">{"// LIVE CONTEXT EXCHANGE"}</p>
          <p className="mt-2 max-w-3xl text-sm leading-relaxed text-[#8aa0c0]">
            Coworker AUBIs exchange ownership, adjacent memory, and review risks before the fix is generated.
          </p>
        </div>
        <div className="border border-[#1e2d45] bg-[#050912] px-3 py-2 text-right">
          <p className="font-mono text-[12px] text-[#c8d6e8]">{exchanges.length}</p>
          <p className="font-mono text-[8px] uppercase tracking-[2px] text-[#6f89b3]">exchanges</p>
        </div>
      </div>

      <AnimatePresence initial={false}>
        {exchanges.slice(0, 3).map((exchange, i) => {
          const src = resolveSourceAgent(exchange, result, agents, i);
          const tgt = resolveTargetAgent(exchange, result, agents, i, src);
          const checks = exchange.should_check ?? [];
          const why =
            typeof exchange.why_it_matters === "string"
              ? exchange.why_it_matters
              : typeof exchange.reason === "string"
              ? exchange.reason
              : typeof exchange.why === "string"
              ? exchange.why
              : null;
          const confidence = exchange.confidence ?? null;

          return (
            <motion.div
              key={`exchange-${i}`}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.12, duration: 0.35, ease: "easeOut" }}
              className="overflow-hidden border border-violet-500/25 bg-violet-500/5 shadow-[0_0_32px_rgba(139,92,246,0.06)]"
            >
              {/* Header: sender → recipient */}
              <div className="flex items-center gap-3 border-b border-violet-500/10 px-5 py-3">
                <img
                  src={avatarUrl(src)}
                  alt={safeName(src)}
                  className="h-7 w-7 flex-shrink-0 rounded-full border border-violet-500/30"
                  onError={(e) => { (e.target as HTMLImageElement).src = "https://github.com/ghost.png?size=48"; }}
                />
                <span className="truncate font-mono text-[13px] text-violet-200">{safeName(src)}</span>
                <motion.span
                  className="font-mono text-[11px] text-violet-400/60"
                  animate={{ opacity: [0.4, 1, 0.4] }}
                  transition={{ duration: 1.4, repeat: Infinity }}
                >
                  →
                </motion.span>
                <img
                  src={avatarUrl(tgt)}
                  alt={safeName(tgt)}
                  className="h-7 w-7 flex-shrink-0 rounded-full border border-violet-500/30"
                  onError={(e) => { (e.target as HTMLImageElement).src = "https://github.com/ghost.png?size=48"; }}
                />
                <span className="truncate font-mono text-[13px] text-violet-200">{safeName(tgt)}</span>

                {confidence !== null && (
                  <span className="ml-auto flex-shrink-0 font-mono text-[12px] text-[#6f89b3]">
                    {Math.round(confidence * 100)}%
                  </span>
                )}
              </div>

              {/* Context shared */}
              <div className="px-5 py-4">
                <p className="max-w-6xl text-[16px] leading-8 text-[#d7e3f4]">{contextText(exchange)}</p>
              </div>

              {/* Why it matters */}
              {why && (
                <div className="px-5 pb-4">
                  <p className="text-[13px] leading-6 text-amber-300/90">
                    <span className="mr-2 font-mono text-[10px] uppercase tracking-[2px] text-amber-500/70">Why</span>
                    {why}
                  </p>
                </div>
              )}

              {/* Should-check chips */}
              {checks.length > 0 && (
                <div className="flex flex-wrap gap-2 px-5 pb-5">
                  {checks.map((item, j) => (
                    <motion.span
                      key={j}
                      initial={{ opacity: 0, scale: 0.85 }}
                      animate={{ opacity: 1, scale: 1 }}
                      transition={{ delay: i * 0.12 + j * 0.06 }}
                      className="border border-rose-500/25 bg-rose-500/8 px-2.5 py-1 font-mono text-[11px] leading-5 text-rose-200"
                    >
                      Check {item}
                    </motion.span>
                  ))}
                </div>
              )}
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}
