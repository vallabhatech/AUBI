"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { AgentCommFeed } from "@/components/aubi/AgentCommFeed";
import { AgentMeshLines } from "@/components/aubi/AgentMeshLines";
import { IssuePicker } from "@/components/aubi/IssuePicker";
import { useAUBIStream } from "@/hooks/useAUBIStream";
import { api } from "@/lib/api";
import { issueUrlFor } from "@/lib/githubIssues";
import type { AUBIEvent, GitHubIssue } from "@/lib/types";

const FLOW_NODES = [
  ["issue_reader", "Issue Read"],
  ["ownership_router", "Ownership Found"],
  ["query_agents", "Agents Consulted"],
  ["code_reader", "Code Read"],
  ["fix_generator", "Fix Generated"],
  ["approval_gate", "Approval Ready"],
  ["pr_pusher", "PR Pushed"]
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function eventRecords(
  events: AUBIEvent[],
  predicate: (event: AUBIEvent) => boolean = () => true
): Record<string, unknown>[] {
  return events.filter(predicate).map((event) => event.data).filter(isRecord);
}

function latestString(records: Record<string, unknown>[], keys: string[]): string {
  for (const record of records.slice().reverse()) {
    for (const key of keys) {
      const value = record[key];
      if (typeof value === "string" && value.trim()) return value;
    }
  }
  return "";
}

function latestBoolean(records: Record<string, unknown>[], keys: string[]): boolean | undefined {
  for (const record of records.slice().reverse()) {
    for (const key of keys) {
      const value = record[key];
      if (typeof value === "boolean") return value;
    }
  }
  return undefined;
}

function latestStringArray(records: Record<string, unknown>[], keys: string[]): string[] {
  for (const record of records.slice().reverse()) {
    for (const key of keys) {
      const value = record[key];
      if (Array.isArray(value)) return value.filter((item): item is string => typeof item === "string");
    }
  }
  return [];
}

export default function DemoPage() {
  const [inputIssueUrl, setInputIssueUrl] = useState("");
  const [issues, setIssues] = useState<GitHubIssue[]>([]);
  const [isLoadingIssues, setIsLoadingIssues] = useState(false);
  const [issueLoadError, setIssueLoadError] = useState<string | null>(null);
  const [issueUrl, setIssueUrl] = useState<string | null>(null);
  const [pushedPrUrl, setPushedPrUrl] = useState("");
  const [approving, setApproving] = useState(false);
  const { events, agentMessages, nodeStatuses, isStreaming, error, reset } = useAUBIStream(issueUrl);
  const hasRun = !!issueUrl || events.length > 0 || agentMessages.length > 0;
  const trimmedIssue = inputIssueUrl.trim();
  const runRecords = useMemo(
    () => eventRecords(events, (event) => ["node_done", "awaiting_approval", "complete"].includes(event.event)),
    [events]
  );
  const prRecords = useMemo(
    () => eventRecords(events, (event) => event.event === "complete" || (event.event === "node_done" && "node" in event && event.node === "pr_pusher")),
    [events]
  );
  const patchDiff = latestString(runRecords, ["patch_diff"]);
  const fixExplanation = latestString(runRecords, ["fix_explanation"]);
  const testOutput = latestString(runRecords, ["test_output"]);
  const testsPassed = latestBoolean(runRecords, ["tests_passed"]);
  const threadId = latestString(runRecords, ["thread_id"]);
  const generatedPrUrl = latestString(prRecords, ["pr_url"]);
  const prUrl = pushedPrUrl || generatedPrUrl;
  const issueTitle = latestString(runRecords, ["issue_title"]);
  const repoName = latestString(runRecords, ["repo_name"]);
  const owners = latestStringArray(runRecords, ["owner_ids", "owners"]);
  const awaitingApproval = !prUrl && events.some((event) => event.event === "awaiting_approval");

  const visualNodeStatuses = useMemo(() => {
    return Object.fromEntries(
      FLOW_NODES.map(([node], index) => {
        const realStatus = nodeStatuses[node];
        return [node, realStatus ?? "idle"];
      })
    ) as Record<(typeof FLOW_NODES)[number][0], "idle" | "running" | "done">;
  }, [nodeStatuses]);

  const statusText = useMemo(() => {
    if (error) return "Stream Error";
    if (prUrl) return "PR Ready";
    if (awaitingApproval) return "Approval";
    if (isStreaming) return "Incident Active";
    if (hasRun) return "Awaiting Data";
    return "Watching Repo";
  }, [awaitingApproval, error, hasRun, isStreaming, prUrl]);

  const completedCount = useMemo(
    () => FLOW_NODES.filter(([node]) => visualNodeStatuses[node] === "done").length,
    [visualNodeStatuses]
  );

  const progressPercent = Math.round((completedCount / FLOW_NODES.length) * 100);
  const activeMessage = agentMessages.at(-1) ?? null;
  const diffLines = patchDiff.split("\n").filter(Boolean);
  const checkItems = [
    { label: "Issue linked", done: Boolean(issueUrl || repoName) },
    { label: "Owner validated", done: owners.length > 0 || visualNodeStatuses.ownership_router === "done" },
    { label: "Patch generated", done: Boolean(patchDiff) },
    { label: "Tests attached", done: typeof testsPassed === "boolean" || Boolean(testOutput) },
  ];
  const prStatus = prUrl ? "Ready" : awaitingApproval ? "Approval" : "Waiting";

  useEffect(() => {
    let cancelled = false;

    async function loadIssues() {
      setIsLoadingIssues(true);
      setIssueLoadError(null);
      try {
        const data = await api.listGitHubIssues();
        if (cancelled) return;
        setIssues(data.issues);
        const firstIssue = data.issues[0];
        if (firstIssue) {
          setInputIssueUrl((current) => current.trim() ? current : issueUrlFor(firstIssue));
        }
      } catch (err) {
        if (!cancelled) setIssueLoadError(err instanceof Error ? err.message : "Failed to load GitHub issues");
      } finally {
        if (!cancelled) setIsLoadingIssues(false);
      }
    }

    void loadIssues();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleApprove = useCallback(async () => {
    if (!threadId || approving) return;
    setApproving(true);
    try {
      const res = await fetch(
        `/api/incidents/approve?thread_id=${encodeURIComponent(threadId)}&approved=true`,
        { method: "POST" }
      );
      const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      const nextPrUrl = data.pr_url;
      if (typeof nextPrUrl === "string" && nextPrUrl.trim()) setPushedPrUrl(nextPrUrl);
    } finally {
      setApproving(false);
    }
  }, [approving, threadId]);

  function runFlow() {
    if (!trimmedIssue || isStreaming) return;
    reset();
    setPushedPrUrl("");
    setIssueUrl(null);
    window.setTimeout(() => setIssueUrl(trimmedIssue), 0);
  }

  return (
    <div className="flex h-[calc(100vh-52px)] flex-col overflow-hidden">
      <header className="flex h-16 shrink-0 items-center justify-between border-b border-[#1f1f1f] bg-[#080808] px-6">
        <div>
          <h1 className="font-syne text-4xl font-normal leading-none text-[#e8e4dc]">AUBI Flow</h1>
          <p className="font-mono text-[10px] uppercase tracking-[3px] text-[#e8e4dc99]">Issue → Agents Talk → Fix → PR</p>
        </div>
        <div className="flex items-center gap-4">
          <div className="w-[430px]">
            <IssuePicker
              issues={issues}
              value={inputIssueUrl}
              onChange={setInputIssueUrl}
              loading={isLoadingIssues}
              disabled={isStreaming}
            />
            {issueLoadError && (
              <p className="mt-1 truncate font-mono text-[8px] uppercase tracking-[1.5px] text-[#ff3366]">
                {issueLoadError}
              </p>
            )}
          </div>
          <span className={`border px-3 py-1 font-mono text-[10px] uppercase tracking-[2px] ${
            error
              ? "border-[#ff3366] text-[#ff3366]"
              : awaitingApproval
                ? "border-amber-400 text-amber-400"
                : isStreaming || prUrl
                  ? "border-[#39ff14] text-[#39ff14]"
                  : "border-[#e8e4dc33] text-[#e8e4dc99]"
          }`}>
            {statusText}
          </span>
          {awaitingApproval && (
            <button
              onClick={() => void handleApprove()}
              disabled={!threadId || approving}
              className="border border-amber-400 bg-amber-400 px-4 py-2 font-mono text-xs font-semibold uppercase tracking-[2px] text-[#080808] transition-all hover:bg-amber-300 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {approving ? "Pushing PR" : "Approve PR"}
            </button>
          )}
          {prUrl && (
            <a
              href={prUrl}
              target="_blank"
              rel="noreferrer"
              className="border border-[#39ff14] bg-[#39ff14] px-4 py-2 font-mono text-xs font-semibold uppercase tracking-[2px] text-[#080808] transition-all hover:bg-[#39ff14cc]"
            >
              Open PR
            </a>
          )}
          <button
            onClick={runFlow}
            disabled={!trimmedIssue || isStreaming}
            className={[
              "relative overflow-hidden border px-4 py-2 font-mono text-xs font-semibold uppercase tracking-[2px] transition-all disabled:cursor-not-allowed",
              trimmedIssue && !isStreaming
                ? "border-[#39ff14] text-[#39ff14] hover:bg-[#39ff14] hover:text-[#080808]"
                : "border-[#e8e4dc33] text-[#e8e4dc66]",
            ].join(" ")}
          >
            <span className={isStreaming ? "animate-pulse" : ""}>{isStreaming ? "Running" : "Run AUBI"}</span>
          </button>
        </div>
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-[360px_1fr] gap-6 p-6">
        <div className="flex min-h-0 flex-col gap-6">
          <section className="flex h-[224px] shrink-0 flex-col overflow-hidden border border-[#e8e4dc33] bg-[#080808]">
            <header className="flex h-11 shrink-0 items-center justify-between border-b border-[#1f1f1f] px-4">
              <p className="font-mono text-[10px] uppercase tracking-[3px] text-[#e8e4dc99]">{"// PR REVIEW"}</p>
              <span className={`font-mono text-[10px] uppercase tracking-[2px] ${prUrl || awaitingApproval ? "text-[#39ff14]" : "text-[#e8e4dc66]"}`}>
                {prStatus}
              </span>
            </header>
            <div className="flex min-h-0 flex-1 flex-col p-4">
              <p className="font-mono text-[8px] uppercase tracking-[3px] text-[#e8e4dc66]">Pull request title</p>
              <p className="mt-2 line-clamp-2 text-sm font-medium leading-snug text-[#e8e4dc]">
                {issueTitle ? `Fix ${issueTitle}` : awaitingApproval ? "Approval required before PR push" : "Waiting for generated PR"}
              </p>
              <p className="mt-2 truncate font-mono text-[9px] uppercase tracking-[1.5px] text-[#e8e4dc55]">
                {repoName || trimmedIssue || "No issue selected"}
              </p>
              <div className="mt-4 grid grid-cols-2 gap-2">
                {checkItems.map((check) => (
                  <div key={check.label} className="flex items-center justify-between border border-[#1f1f1f] px-2 py-1.5 font-mono text-[8px] uppercase tracking-[1.5px]">
                    <span className={check.done ? "text-[#39ff14]" : "text-[#e8e4dc66]"}>{check.label}</span>
                    <span className={`h-1.5 w-1.5 rounded-full ${check.done ? "bg-[#39ff14]" : "bg-[#1f1f1f]"}`} />
                  </div>
                ))}
              </div>
              {prUrl && (
                <a href={prUrl} target="_blank" rel="noreferrer" className="mt-auto pt-3 font-mono text-[10px] uppercase tracking-[2px] text-[#39ff14]">
                  Open PR
                </a>
              )}
              {awaitingApproval && !prUrl && (
                <button
                  onClick={() => void handleApprove()}
                  disabled={!threadId || approving}
                  className="mt-auto border border-amber-400 px-3 py-2 font-mono text-[10px] font-semibold uppercase tracking-[2px] text-amber-400 transition-all hover:bg-amber-400 hover:text-[#080808] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {approving ? "Pushing PR" : "Approve PR Push"}
                </button>
              )}
            </div>
          </section>
          <AgentCommFeed messages={agentMessages} isStreaming={isStreaming} />
        </div>

        <section className="grid min-h-0 grid-rows-[auto_1fr] gap-6">
          <div className="relative overflow-hidden border border-[#e8e4dc33] bg-[#080808] p-4">
            <div className="absolute inset-x-0 top-0 h-px bg-[#39ff14]" style={{ width: `${Math.max(progressPercent, isStreaming ? 8 : 0)}%` }} />
            <div className="mb-4 flex items-center justify-between">
              <div className="font-mono text-[10px] uppercase tracking-[3px] text-[#e8e4dc99]">{"// GRAPH PROGRESS"}</div>
              <div className="font-mono text-[10px] uppercase tracking-[2px] text-[#39ff14]">{progressPercent}% synced</div>
            </div>
            <div className="grid gap-2 md:grid-cols-3 xl:grid-cols-7">
              {FLOW_NODES.map(([node, label], index) => {
                const status = visualNodeStatuses[node] ?? "idle";
                return (
                  <motion.div
                    key={node}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: index * 0.04 }}
                    className={[
                      "relative min-h-14 overflow-hidden border px-3 py-2 font-mono text-[10px] uppercase tracking-[2px] transition-colors",
                      status === "done"
                        ? "border-[#39ff14] bg-[#39ff1412] text-[#39ff14]"
                        : status === "running"
                          ? "border-[#39ff14] text-[#39ff14]"
                        : "border-[#1f1f1f] text-[#e8e4dc99]"
                    ].join(" ")}
                  >
                    {status === "running" && (
                      <motion.span
                        className="absolute inset-y-0 left-0 w-10 bg-[#39ff1422]"
                        animate={{ x: ["-120%", "760%"] }}
                        transition={{ duration: 1.2, repeat: Infinity, ease: "linear" }}
                      />
                    )}
                    <span className="relative block">{label}</span>
                    <span className="relative mt-2 block text-[8px] text-[#e8e4dc66]">{status}</span>
                  </motion.div>
                );
              })}
            </div>
          </div>

          <div className="grid min-h-0 gap-6 xl:grid-cols-[0.92fr_1.08fr]">
            <section className="flex min-h-0 flex-col overflow-hidden border border-[#e8e4dc33] bg-[#080808]">
              <header className="flex h-12 shrink-0 items-center justify-between border-b border-[#1f1f1f] px-4">
                <div>
                  <p className="font-mono text-[10px] uppercase tracking-[3px] text-[#e8e4dc99]">{"// CODE DIFF"}</p>
                  {patchDiff && <p className="mt-0.5 font-mono text-[8px] uppercase tracking-[2px] text-[#e8e4dc44]">{diffLines.length} lines streamed from fix generator</p>}
                </div>
                <span className={`font-mono text-[10px] uppercase tracking-[2px] ${visualNodeStatuses.fix_generator === "done" || visualNodeStatuses.fix_generator === "running" ? "text-[#39ff14]" : "text-[#e8e4dc66]"}`}>
                  {patchDiff ? "Generated" : visualNodeStatuses.fix_generator === "running" ? "Writing" : "Waiting"}
                </span>
              </header>
              <div className="aubi-scrollbar flex-1 overflow-auto p-4 font-mono text-[11px] leading-6">
                {!hasRun && <div className="flex h-full items-center justify-center uppercase tracking-[3px] text-[#e8e4dc66]">Run AUBI to stream a live patch</div>}
                {hasRun && !patchDiff && (
                  <div className="flex h-full items-center justify-center px-8 text-center">
                    {error ? (
                      <div>
                        <p className="font-mono text-[10px] uppercase tracking-[3px] text-[#ff3366]">Stream error</p>
                        <p className="mt-3 max-w-md whitespace-pre-wrap text-xs leading-6 text-[#e8e4dc88]">{error}</p>
                      </div>
                    ) : (
                      <p className="font-mono text-[10px] uppercase tracking-[3px] text-[#e8e4dc66]">Waiting for fix generator output</p>
                    )}
                  </div>
                )}
                <div className="min-w-max space-y-0.5">
                {diffLines.map((line, index) => {
                  const sign = line.startsWith("+") ? "+" : line.startsWith("-") ? "-" : " ";
                  const addition = sign === "+";
                  const removal = sign === "-";
                  return (
                    <motion.div
                      key={`${line}-${index}`}
                      initial={{ opacity: 0, x: -12 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: index * 0.12 }}
                      className={[
                        "grid grid-cols-[38px_24px_minmax(0,1fr)] items-start gap-2 border-l px-2 py-0.5",
                        addition
                          ? "border-[#39ff14] bg-[#39ff1408] text-[#39ff14]"
                          : removal
                            ? "border-[#ff3366]/45 bg-[#ff336606] text-[#e8e4dc66]"
                            : "border-transparent text-[#e8e4dc55]",
                      ].join(" ")}
                    >
                      <span className="select-none text-right text-[#e8e4dc44]">{String(index + 1).padStart(2, "0")}</span>
                      <span className="select-none text-center">{sign}</span>
                      <span className="whitespace-pre pr-6">{line.replace(/^[+-]/, "")}</span>
                    </motion.div>
                  );
                })}
                </div>
              </div>
            </section>

            <section className="grid min-h-0 grid-rows-[1fr_auto] gap-4">
              <AgentMeshLines messages={agentMessages} activeMessage={activeMessage} events={events} className="h-full min-h-0" />
              <div className="grid min-h-0 gap-4 xl:grid-cols-2">
                {(typeof testsPassed === "boolean" || testOutput) && (
                  <div className="border border-[#1f1f1f] p-3">
                    <p className={`font-mono text-[10px] uppercase tracking-[2px] ${testsPassed ? "text-[#39ff14]" : "text-amber-300"}`}>
                      {typeof testsPassed === "boolean" ? (testsPassed ? "Verification passed" : "Verification failed") : "Verification output"}
                    </p>
                    {testOutput && <pre className="mt-2 max-h-24 overflow-auto whitespace-pre-wrap text-[10px] leading-relaxed text-[#e8e4dc99]">{testOutput}</pre>}
                  </div>
                )}
                {fixExplanation && (
                  <div className="border border-[#1f1f1f] p-3">
                    <p className="font-mono text-[9px] uppercase tracking-[3px] text-[#e8e4dc66]">Fix explanation</p>
                    <p className="mt-2 line-clamp-4 text-xs leading-relaxed text-[#e8e4dc99]">{fixExplanation}</p>
                  </div>
                )}
                <div className="border border-[#1f1f1f] p-3 xl:col-span-2">
                  <p className="font-mono text-[9px] uppercase tracking-[3px] text-[#e8e4dc66]">Live stream</p>
                  <div className="mt-3 space-y-2">
                    {(events.length ? events.slice(-4) : [{ event: "idle", data: null }]).map((event, index) => (
                      <motion.div
                        key={`${event.event}-${index}`}
                        initial={{ opacity: 0, y: 6 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[2px] text-[#e8e4dc99]"
                      >
                        <span className="h-1.5 w-1.5 rounded-full bg-[#39ff14]" />
                        {event.event.replaceAll("_", " ")}
                      </motion.div>
                    ))}
                  </div>
                </div>
              </div>
            </section>
          </div>
        </section>
      </div>
    </div>
  );
}
