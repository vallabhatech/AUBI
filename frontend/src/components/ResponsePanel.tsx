"use client";

import { AnimatePresence, motion } from "framer-motion";
import type { Agent, IncidentResult, SSEEvent } from "@/lib/types";

export function ResponsePanel({
  result,
  agents,
  events
}: {
  result: IncidentResult | null;
  agents: Agent[];
  events: SSEEvent[];
}) {
  const learned = events.filter((event) => (
    event.status === "done" &&
    (event.eventType === "memory_write" || event.eventType === "memory_update" || event.eventType === "aubi_learned" || event.node === "memory_updater")
  ));
  const owner = agents.find((agent) => result?.owners?.includes(agent.id)) ?? agents[0];

  return (
    <AnimatePresence>
      {result && (
        <motion.section
          initial={{ opacity: 0, y: 40 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 40 }}
          className="border-t border-aubi-border bg-aubi-surface/70 p-4"
        >
          <div className="mb-3 font-mono text-[10px] uppercase tracking-[0.16em] text-aubi-muted">{"// FIX PACKAGE"}</div>
          <div className="grid gap-4 xl:grid-cols-2">
            <div className="rounded border border-aubi-border bg-aubi-bg p-4">
              <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-aubi-muted">Owner</p>
              <p className="mt-2 font-syne text-xl text-white">{owner?.name ?? result.owners[0] ?? "Unassigned"}</p>
              <p className="mt-3 text-sm leading-relaxed text-aubi-muted">
                {result.fix_explanation ?? "Waiting for fix explanation..."}
              </p>
              {result.pr_url && (
                <a className="mt-4 inline-flex font-mono text-xs text-aubi-cyan" href={result.pr_url} target="_blank" rel="noreferrer">
                  Open GitHub PR
                </a>
              )}
            </div>
            <pre className="max-h-80 overflow-auto rounded border border-aubi-border bg-aubi-bg p-4 text-xs leading-relaxed text-aubi-text">
              {result.patch_diff ?? "Waiting for patch..."}
            </pre>
          </div>
          {learned.length > 0 && (
            <div className="aubi-scrollbar mt-3 flex gap-2 overflow-x-auto pb-1">
              {learned.map((event, index) => (
                <motion.span
                  key={`${event.receivedAt}-${index}`}
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: index * 0.1 }}
                  className="shrink-0 rounded border border-emerald-500/30 bg-aubi-surface px-3 py-1 font-mono text-[11px] text-emerald-400"
                >
                  {String(event.output?.update ?? event.output?.episode ?? event.output?.object ?? "Memory updated")}
                </motion.span>
              ))}
            </div>
          )}
        </motion.section>
      )}
    </AnimatePresence>
  );
}
