"use client";

import { useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { TraceNode } from "./TraceNode";
import type { SSEEvent } from "@/lib/types";

interface Props {
  events: SSEEvent[];
  isStreaming: boolean;
  autoScroll?: boolean;
}

export function NeuralTrace({ events, isStreaming, autoScroll = true }: Props) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const visible = events.filter((e) => e.node !== "complete");

  useEffect(() => {
    if (!autoScroll) return;
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [autoScroll, events.length]);

  if (events.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full">
        <svg width={80} height={80} viewBox="-40 -40 80 80" className="mb-5">
          <motion.circle
            cx={0} cy={0} r={30}
            fill="none" stroke="#1e2d45" strokeWidth={1.5}
            animate={{ rotate: 360 }}
            transition={{ duration: 8, repeat: Infinity, ease: "linear" }}
          />
          <motion.circle
            cx={0} cy={0} r={20}
            fill="none" stroke="#2a3f5f" strokeWidth={1}
            strokeDasharray="10 5"
            animate={{ rotate: -360 }}
            transition={{ duration: 5, repeat: Infinity, ease: "linear" }}
          />
          <circle cx={0} cy={0} r={4} fill="#1e2d45" />
        </svg>
        <p className="font-mono text-[11px] text-[#2a3f5f] tracking-widest">AWAITING INCIDENT</p>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto aubi-scrollbar pr-2">
      {/* Timeline header */}
      <div className="mb-3 flex items-center gap-2 border-b border-[#1e2d45] pb-2">
        <span className="font-mono text-[9px] text-[#4a6080] tracking-widest">{"// NEURAL TRACE"}</span>
        {isStreaming && (
          <motion.span
            animate={{ opacity: [1, 0] }}
            transition={{ duration: 0.8, repeat: Infinity }}
            className="font-mono text-[9px] text-[#00f0ff]"
          >
            ● LIVE
          </motion.span>
        )}
      </div>

      <div className="space-y-2">
        <AnimatePresence>
          {visible.map((event, i) => (
            <TraceNode key={`${event.node}-${i}`} event={event} index={i} />
          ))}
        </AnimatePresence>
      </div>

      {isStreaming && (
        <div className="mt-2 flex items-center gap-3 border border-[#1e2d45] bg-[#050912] px-3 py-3">
          <div className="w-2.5 h-2.5 rounded-full flex-shrink-0">
            <motion.div
              className="w-2.5 h-2.5 rounded-full bg-[#00f0ff]"
              animate={{ opacity: [1, 0.2] }}
              transition={{ duration: 0.6, repeat: Infinity }}
            />
          </div>
          <span className="font-mono text-[10px] text-[#4a6080]">processing...</span>
        </div>
      )}

      <div ref={bottomRef} />
    </div>
  );
}
