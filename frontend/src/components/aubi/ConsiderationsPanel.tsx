"use client";

import { useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import type { Agent, CoworkerContextExchange, IncidentResult } from "@/lib/types";
import { resolveTargetAgent, resolveSourceAgent } from "@/lib/agentLookup";
import { coworkerName } from "@/lib/agents";

function safeName(agent: Agent | undefined): string {
  return agent ? coworkerName(agent) : "mesh coworker";
}

interface CheckItem {
  text: string;
  agentName: string;
  resolved: boolean;
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[\s\W]+/)
    .filter((t) => t.length > 3);
}

function isResolved(item: string, fixText: string): boolean {
  const needleTokens = tokenize(item);
  if (!needleTokens.length) return false;
  const haystackTokens = new Set(tokenize(fixText));
  // Resolved if ≥40% of the item's meaningful tokens appear in the fix
  const matched = needleTokens.filter((t) => haystackTokens.has(t)).length;
  return matched / needleTokens.length >= 0.4;
}

interface Props {
  exchanges: CoworkerContextExchange[];
  agents: Agent[];
  result: IncidentResult | null;
}

export function ConsiderationsPanel({ exchanges, agents, result }: Props) {
  const fixText = `${result?.patch_diff ?? ""} ${result?.fix_explanation ?? ""}`;
  const hasfix = !!(result?.patch_diff || result?.fix_explanation);

  const items = useMemo<CheckItem[]>(() => {
    const seen = new Set<string>();
    const out: CheckItem[] = [];

    exchanges.forEach((exchange, i) => {
      const checks = exchange.should_check ?? [];
      const responder = resolveTargetAgent(exchange, result, agents, i, resolveSourceAgent(exchange, result, agents, i));
      const name = safeName(responder);

      checks.forEach((text) => {
        const key = text.toLowerCase().trim();
        if (seen.has(key)) return;
        seen.add(key);
        out.push({ text, agentName: name, resolved: hasfix && isResolved(text, fixText) });
      });
    });

    return out;
  }, [exchanges, agents, result, fixText, hasfix]);

  if (!items.length) return null;

  const resolvedCount = items.filter((i) => i.resolved).length;

  return (
    <div className="self-start border border-[#1e2d45] bg-[#0a0e1a] p-4">
      <div className="mb-3 flex items-start justify-between gap-4">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[3px] text-[#5d7194]">{"// CONSIDERATIONS"}</p>
          <p className="mt-2 max-w-2xl text-[12px] leading-5 text-[#8ea3c3]">
            Coworker checks verified against the generated fix.
          </p>
        </div>
        {hasfix && (
          <span className={[
            "shrink-0 border px-2.5 py-1 font-mono text-[10px]",
            resolvedCount === items.length
              ? "text-emerald-300 border-emerald-500/30 bg-emerald-500/10"
              : "text-amber-300 border-amber-500/30 bg-amber-500/10",
          ].join(" ")}>
            {resolvedCount}/{items.length} addressed
          </span>
        )}
      </div>

      <div className="max-h-[560px] space-y-2 overflow-y-auto pr-1 aubi-scrollbar">
        <AnimatePresence initial={false}>
          {items.map((item, i) => (
            <motion.div
              key={item.text}
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: i * 0.06, duration: 0.3 }}
              className={[
                "grid grid-cols-[22px_minmax(0,1fr)_76px] items-start gap-3 border px-3 py-3 transition-colors duration-500",
                item.resolved && hasfix
                  ? "border-emerald-500/25 bg-emerald-500/5"
                  : hasfix
                  ? "border-amber-500/20 bg-amber-500/5"
                  : "border-[#1e2d45] bg-[#050912]",
              ].join(" ")}
            >
              {/* Status icon */}
              <span className={[
                "mt-0.5 font-mono text-[11px]",
                item.resolved && hasfix ? "text-emerald-300" : hasfix ? "text-amber-300" : "text-[#8ea3c3]",
              ].join(" ")}>
                {hasfix ? (item.resolved ? "✓" : "?") : "⚑"}
              </span>

              <div className="flex-1 min-w-0">
                <p className={[
                  "text-[12px] leading-5 transition-colors duration-500",
                  item.resolved && hasfix
                    ? "text-emerald-200"
                    : hasfix
                    ? "text-amber-300"
                    : "text-[#c8d6e8]",
                ].join(" ")}>
                  {item.text}
                </p>
                <p className="mt-1 font-mono text-[9px] text-[#5d7194]">flagged by {item.agentName}</p>
              </div>

              <span className={[
                "mt-0.5 justify-self-end border px-2 py-0.5 font-mono text-[9px] uppercase tracking-[1.5px]",
                item.resolved && hasfix
                  ? "border-emerald-500/25 text-emerald-300"
                  : hasfix
                  ? "border-amber-500/25 text-amber-300"
                  : "border-[#1e2d45] text-[#4a6080]",
              ].join(" ")}>
                {hasfix ? (item.resolved ? "done" : "review") : "queued"}
              </span>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </div>
  );
}
