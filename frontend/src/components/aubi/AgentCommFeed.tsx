"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import type { AgentMessage } from "@/lib/types";

function labelFor(value: string) {
  const key = value.toLowerCase().trim();
  if (key === "orchestrator") return "AUBI Orchestrator";
  const cleaned = value
    .replace(/[_-]?aubi$/i, "")
    .replace(/[_-]+/g, " ")
    .trim();
  const compact = cleaned.replace(/[^a-z0-9]/gi, "");
  if (!cleaned || /^[a-f0-9]{7,}$/i.test(compact) || /^[a-z0-9]{12,}$/i.test(compact)) {
    return "Routed AUBI";
  }
  const base = cleaned.split(/\s+/).find(Boolean) ?? cleaned;
  const name = base.charAt(0).toUpperCase() + base.slice(1);
  return `${name}${name.toLowerCase().endsWith("s") ? "'" : "'s"} AUBI`;
}

function isOrchestrator(value: string) {
  return value.toLowerCase().trim() === "orchestrator";
}

function compactMessage(message: string) {
  const trimmed = message.replace(/\s+/g, " ").trim();
  return trimmed.length > 560 ? `${trimmed.slice(0, 557)}...` : trimmed;
}

export function AgentCommFeed({
  messages,
  isStreaming = false,
}: {
  messages: AgentMessage[];
  isStreaming?: boolean;
}) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [revealedCount, setRevealedCount] = useState(0);

  useEffect(() => {
    if (messages.length <= revealedCount) return;
    const id = setTimeout(() => setRevealedCount(messages.length), 380);
    return () => clearTimeout(id);
  }, [messages.length, revealedCount]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [revealedCount]);

  const visible = useMemo(() => messages.slice(0, revealedCount), [messages, revealedCount]);
  const pending = revealedCount < messages.length ? messages[revealedCount] : null;

  return (
    <section className="flex h-full flex-col overflow-hidden border-t border-[#1f1f1f] bg-[#080808]">
      {/* header */}
      <div className="flex h-12 shrink-0 items-center justify-between border-b border-[#1f1f1f] px-5">
        <span className="font-mono text-[10px] uppercase tracking-[3px] text-[#e8e4dc55]">
          {"// agent comms"}
        </span>
        <div className="flex items-center gap-1.5">
          <span
            className={`h-1.5 w-1.5 rounded-full transition-colors ${
              isStreaming ? "animate-pulse bg-[#39ff14]" : "bg-[#e8e4dc22]"
            }`}
          />
          <span className="font-mono text-[10px] uppercase tracking-[2px] text-[#e8e4dc44]">
            {isStreaming ? "live" : "standby"}
          </span>
        </div>
      </div>

      {/* feed */}
      <div ref={scrollRef} className="aubi-scrollbar flex-1 space-y-5 overflow-y-auto px-5 py-5">
        {messages.length === 0 && (
          <div className="flex h-full items-center justify-center">
            <div className="border border-dashed border-[#1f1f1f] px-6 py-5 text-center">
              <p className="font-mono text-[11px] uppercase tracking-[3px] text-[#e8e4dc44]">Awaiting agent traffic</p>
              <p className="mt-2 font-mono text-[9px] uppercase tracking-[2px] text-[#e8e4dc33]">Messages appear as each AUBI answers</p>
            </div>
          </div>
        )}

        <AnimatePresence initial={false}>
          {visible.map((msg, index) => {
            const fromLeft = isOrchestrator(msg.sender);
            return (
              <motion.div
                key={`${msg.sender}-${msg.recipient}-${index}`}
                initial={{ opacity: 0, x: fromLeft ? -12 : 12, y: 4 }}
                animate={{ opacity: 1, x: 0, y: 0 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.22, ease: "easeOut" }}
                className={`flex ${fromLeft ? "justify-start" : "justify-end"}`}
              >
                <div className="max-w-[94%]">
                  {/* sender → recipient row */}
                  <div
                    className={`mb-2 flex items-center gap-2 ${
                      fromLeft ? "" : "justify-end"
                    }`}
                  >
                    <span
                      className={`font-mono text-[11px] uppercase tracking-[2px] ${
                        isStreaming ? "text-[#39ff14]" : "text-[#e8e4dc66]"
                      }`}
                    >
                      {labelFor(msg.sender)}
                    </span>
                    <span className="font-mono text-[10px] text-[#e8e4dc33]">→</span>
                    <span className="font-mono text-[11px] uppercase tracking-[2px] text-[#e8e4dc44]">
                      {labelFor(msg.recipient)}
                    </span>
                  </div>

                  {/* bubble */}
                  <div
                    className={[
                      "relative border bg-[#050505] px-5 py-4 text-[15px] leading-7 text-[#e8e4dcdd]",
                      fromLeft
                        ? "border-[#e8e4dc22] border-l-[#e8e4dc55]"
                        : isStreaming
                        ? "border-[#39ff14]/30 border-r-[#39ff14]/70"
                        : "border-[#e8e4dc22] border-r-[#e8e4dc44]",
                    ].join(" ")}
                  >
                    <p className="line-clamp-9">{compactMessage(msg.message)}</p>
                  </div>
                </div>
              </motion.div>
            );
          })}
        </AnimatePresence>

        {/* typing indicator */}
        {pending && (
          <motion.div
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            className={`flex ${isOrchestrator(pending.sender) ? "justify-start" : "justify-end"}`}
          >
            <div className="border border-[#e8e4dc11] px-4 py-3">
              <div className="flex items-center gap-1">
                {[0, 1, 2].map((i) => (
                  <motion.span
                    key={i}
                    className="h-[3px] w-[3px] rounded-full bg-[#e8e4dc44]"
                    animate={{ opacity: [0.3, 1, 0.3] }}
                    transition={{ duration: 1, repeat: Infinity, delay: i * 0.2 }}
                  />
                ))}
              </div>
            </div>
          </motion.div>
        )}
      </div>
    </section>
  );
}
