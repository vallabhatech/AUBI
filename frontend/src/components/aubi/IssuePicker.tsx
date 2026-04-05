"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { issueRefFor, issueUrlFor } from "@/lib/githubIssues";
import type { GitHubIssue } from "@/lib/types";

export function IssuePicker({
  issues,
  value,
  onChange,
  loading = false,
  disabled = false,
  className = "",
}: {
  issues: GitHubIssue[];
  value: string;
  onChange: (value: string) => void;
  loading?: boolean;
  disabled?: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const selectedIssue = useMemo(
    () => issues.find((issue) => issueUrlFor(issue) === value),
    [issues, value]
  );

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    window.addEventListener("pointerdown", onPointerDown);
    return () => window.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  return (
    <div ref={rootRef} className={`relative min-w-0 ${className}`}>
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        disabled={disabled || loading || issues.length === 0}
        className={[
          "flex h-10 w-full min-w-0 items-center justify-between border bg-[#0b0d12] px-3 text-left transition-colors",
          open ? "border-[#39ff14]/70" : "border-[#23324f] hover:border-[#58a6ff]/70",
          "disabled:cursor-not-allowed disabled:opacity-50",
        ].join(" ")}
      >
        <span className="min-w-0">
          <span className="block font-mono text-[8px] uppercase tracking-[2px] text-[#58a6ff]">
            {loading ? "Syncing issues" : selectedIssue ? issueRefFor(selectedIssue) : "Choose AUBI-demo issue"}
          </span>
          <span className="mt-0.5 block truncate text-[11px] font-medium leading-none text-[#e8e4dc]">
            {loading
              ? "Fetching from GitHub..."
              : selectedIssue
                ? selectedIssue.title
                : issues.length
                  ? "Select an open issue"
                  : "No open issues loaded"}
          </span>
        </span>
        <span className={`ml-3 font-mono text-[12px] text-[#39ff14] transition-transform ${open ? "rotate-180" : ""}`}>
          ▾
        </span>
      </button>

      {open && (
        <div className="absolute left-0 right-0 top-[calc(100%+8px)] z-50 overflow-hidden border border-[#23324f] bg-[#080808] shadow-[0_18px_40px_rgba(0,0,0,0.55)]">
          <div className="flex items-center justify-between border-b border-[#1f1f1f] px-3 py-2">
            <span className="font-mono text-[8px] uppercase tracking-[2px] text-[#9db6d8]">Open GitHub Issues</span>
            <span className="font-mono text-[8px] uppercase tracking-[2px] text-[#39ff14]">{issues.length} live</span>
          </div>
          <div className="aubi-scrollbar max-h-[280px] overflow-y-auto p-1.5">
            {issues.map((issue) => {
              const url = issueUrlFor(issue);
              const selected = url === value;
              return (
                <button
                  key={url}
                  type="button"
                  onClick={() => {
                    onChange(url);
                    setOpen(false);
                  }}
                  className={[
                    "grid w-full grid-cols-[72px_1fr] gap-3 border px-3 py-2.5 text-left transition-colors",
                    selected
                      ? "border-[#39ff14]/60 bg-[#39ff14]/10"
                      : "border-transparent hover:border-[#23324f] hover:bg-[#10141d]",
                  ].join(" ")}
                >
                  <span className="font-mono text-[9px] uppercase tracking-[1.5px] text-[#39ff14]">
                    #{issue.issue_number}
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-[12px] font-medium text-[#e8e4dc]">
                      {issue.title}
                    </span>
                    <span className="mt-1 block truncate font-mono text-[8px] uppercase tracking-[1.5px] text-[#8aa0c0]">
                      {issue.repo_name} · {issue.labels?.join(", ") || "unlabeled"}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
