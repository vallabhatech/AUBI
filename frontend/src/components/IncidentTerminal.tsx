"use client";

import { useEffect, useRef } from "react";
import { motion } from "framer-motion";

interface Props {
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  isStreaming: boolean;
}

export function IncidentTerminal({ value, onChange, onSubmit, isStreaming }: Props) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const hasText = value.trim().length > 0;

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && hasText && !isStreaming) {
        onSubmit();
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [hasText, isStreaming, onSubmit]);

  return (
    <div className="flex flex-col gap-3">
      {/* Terminal box */}
      <motion.div
        className="terminal-container relative border rounded overflow-hidden"
        animate={{
          borderColor: hasText
            ? ["#1e2d45", "#ff336644", "#1e2d45"]
            : "#1e2d45",
        }}
        transition={{ duration: 2, repeat: hasText ? Infinity : 0 }}
        style={{ background: "#050912" }}
      >
        {/* Header bar */}
        <div className="flex items-center justify-between px-4 h-7 bg-[#0d1224] border-b border-[#1e2d45]">
          <span className="font-mono text-[9px] text-[#4a6080] tracking-widest">{"// INCIDENT INPUT"}</span>
          <div className="flex gap-1.5">
            <span className="w-2 h-2 rounded-full bg-[#1e2d45]" />
            <span className="w-2 h-2 rounded-full bg-[#1e2d45]" />
            <span className="w-2 h-2 rounded-full bg-[#1e2d45]" />
          </div>
        </div>

        {/* Textarea */}
        <textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          disabled={isStreaming}
          placeholder="paste GitHub issue URL or owner/repo#123..."
          rows={4}
          className="relative z-[2] w-full resize-none bg-transparent p-4 font-mono text-[13px] text-[#c8d6e8] placeholder-[#2a3f5f] focus:outline-none disabled:opacity-50"
        />

        {/* Footer bar */}
        <div className="flex items-center justify-between px-4 h-7 bg-[#0d1224] border-t border-[#1e2d45]">
          <span className="font-mono text-[10px] text-[#2a3f5f]">{value.length} chars</span>
          <span className="font-mono text-[10px] text-[#2a3f5f]">⌘ ENTER to trigger</span>
        </div>
      </motion.div>

      {/* Trigger button */}
      <motion.button
        onClick={onSubmit}
        disabled={!hasText || isStreaming}
        whileHover={hasText && !isStreaming ? { scale: 1.01, rotate: [-0.5, 0.5, -0.5, 0] } : {}}
        transition={{ rotate: { duration: 0.25 } }}
        className="w-full h-11 font-mono font-bold text-sm tracking-widest text-white rounded border border-[#ff3366] disabled:opacity-40 disabled:cursor-not-allowed transition-all"
        style={{
          background: "#ff3366",
          boxShadow: hasText ? "0 0 16px #ff336650, 0 0 32px #ff336620" : "none",
        }}
      >
        {isStreaming ? (
          <span className="flex items-center justify-center gap-2">
            <span className="inline-block w-2 h-2 rounded-full bg-white animate-pulse" />
            ANALYZING...
          </span>
        ) : (
          "⚡ TRIGGER INCIDENT"
        )}
      </motion.button>
    </div>
  );
}
