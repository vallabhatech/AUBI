"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import type { WarRoomSnapshot } from "@/lib/warRoomState";
import type {
  CoworkerContextExchange,
  IncidentResult,
  MemoryUpdate,
  SSEEvent,
  SSENode,
  SharedMemoryHit,
  StreamLike,
} from "@/lib/types";

type BackendEvent = {
  event?: string;
  node?: string;
  data?: Record<string, unknown> | string | null;
};

const GRAPH_NODES = new Set<SSENode>([
  "thread",
  "issue_reader",
  "incident_analyzer",
  "ownership_router",
  "query_single_agent",
  "agent_querier",
  "coworker_mesh_exchange",
  "code_reader",
  "fix_generator",
  "test_runner",
  "approval_gate",
  "pr_pusher",
  "response_drafter",
  "memory_updater",
  "complete",
  "error",
]);

function asNode(value: string | undefined, defaultNode: SSENode): SSENode {
  return value && GRAPH_NODES.has(value as SSENode) ? (value as SSENode) : defaultNode;
}

function asOutput(value: BackendEvent["data"]): Record<string, unknown> | null {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value;
  }
  if (typeof value === "string") {
    return { message: value };
  }
  return null;
}

function normalizeBackendEvent(raw: BackendEvent): SSEEvent {
  const eventType = raw.event ?? "message";

  if (eventType === "thread") {
    return { eventType, node: "thread", status: "done", output: asOutput(raw.data) };
  }
  if (eventType === "node_start") {
    return { eventType, node: asNode(raw.node, "issue_reader"), status: "running", output: null };
  }
  if (eventType === "node_done") {
    return { eventType, node: asNode(raw.node, "issue_reader"), status: "done", output: asOutput(raw.data) };
  }
  if (eventType === "agent_message") {
    const output = asOutput(raw.data);
    return {
      eventType,
      node: "query_single_agent",
      status: "done",
      output,
      agent: typeof output?.sender === "string" ? output.sender : undefined,
    };
  }
  if (eventType === "routing_evidence") {
    return { eventType, node: "ownership_router", status: "done", output: asOutput(raw.data) };
  }
  if (eventType === "coworker_exchange" || eventType === "coworker_context") {
    return { eventType, node: "coworker_mesh_exchange", status: "done", output: asOutput(raw.data) };
  }
  if (eventType === "shared_memory_hit" || eventType === "shared_memory") {
    return { eventType, node: "coworker_mesh_exchange", status: "done", output: asOutput(raw.data) };
  }
  if (eventType === "memory_write" || eventType === "memory_update") {
    return { eventType, node: "memory_updater", status: "done", output: asOutput(raw.data) };
  }
  if (eventType === "aubi_learned") {
    return { eventType, node: "memory_updater", status: "done", output: asOutput(raw.data) };
  }
  if (eventType === "awaiting_approval") {
    return { eventType, node: "approval_gate", status: "done", output: asOutput(raw.data) };
  }
  if (eventType === "error") {
    return { eventType, node: "error", status: "error", output: asOutput(raw.data) };
  }
  if (eventType === "complete") {
    return { eventType, node: "complete", status: "done", output: asOutput(raw.data) };
  }

  return { eventType, node: "error", status: "error", output: { message: `Unknown SSE event: ${eventType}` } };
}

function mergeArrays<T>(left: T[] | undefined, right: unknown): T[] | undefined {
  if (!Array.isArray(right)) return left;
  return [...(left ?? []), ...(right as T[])];
}

function appendPayload<T>(left: T[] | undefined, event: SSEEvent, eventTypes: string[]): T[] | undefined {
  if (!event.eventType || !eventTypes.includes(event.eventType) || !event.output) return left;
  return [...(left ?? []), event.output as T];
}

function dedupeRecords<T>(records: T[] | undefined): T[] | undefined {
  if (!records) return records;
  const seen = new Set<string>();
  return records.filter((record) => {
    const key = JSON.stringify(record);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function mergeResult(event: SSEEvent, current: IncidentResult | null): IncidentResult {
  const output = event.output ?? {};
  const next: IncidentResult = current ?? { owners: [], stream_log: [] };

  const ownerIds = Array.isArray(output.owner_ids) ? (output.owner_ids as string[]) : undefined;
  const owners = Array.isArray(output.owners) ? (output.owners as string[]) : ownerIds;

  return {
    ...next,
    thread_id: typeof output.thread_id === "string" ? output.thread_id : next.thread_id,
    awaiting_approval: event.node === "approval_gate" ? true : next.awaiting_approval,
    approval: event.node === "approval_gate" ? output : next.approval,
    pr_url: typeof output.pr_url === "string" ? output.pr_url : next.pr_url,
    patch_diff: typeof output.patch_diff === "string" ? output.patch_diff : next.patch_diff,
    fix_explanation: typeof output.fix_explanation === "string" ? output.fix_explanation : next.fix_explanation,
    test_output: typeof output.test_output === "string" ? output.test_output : next.test_output,
    tests_passed: typeof output.tests_passed === "boolean" ? output.tests_passed : next.tests_passed,
    owners: owners ?? next.owners,
    agent_messages: mergeArrays(next.agent_messages, output.agent_messages),
    routing_evidence: mergeArrays(next.routing_evidence, output.routing_evidence),
    coworker_exchanges: dedupeRecords(appendPayload<CoworkerContextExchange>(
      mergeArrays(next.coworker_exchanges, output.coworker_exchanges),
      event,
      ["coworker_exchange", "coworker_context"]
    )),
    coworker_contexts: dedupeRecords(appendPayload<CoworkerContextExchange>(
      mergeArrays(next.coworker_contexts, output.coworker_contexts ?? output.coworker_exchanges ?? output.agent_contexts),
      event,
      ["coworker_exchange", "coworker_context"]
    )),
    shared_memory_hits: dedupeRecords(appendPayload<SharedMemoryHit>(
      mergeArrays(next.shared_memory_hits, output.shared_memory_hits),
      event,
      ["shared_memory_hit", "shared_memory"]
    )),
    shared_memory: dedupeRecords(appendPayload<SharedMemoryHit>(
      mergeArrays(next.shared_memory, output.shared_memory ?? output.shared_memory_hits),
      event,
      ["shared_memory_hit", "shared_memory"]
    )),
    memory_writes: dedupeRecords(appendPayload<MemoryUpdate>(
      mergeArrays(next.memory_writes, output.memory_writes),
      event,
      ["memory_write", "memory_update", "aubi_learned"]
    )),
    memory_updates: dedupeRecords(appendPayload<MemoryUpdate>(
      mergeArrays(next.memory_updates, output.memory_updates ?? output.memory_writes),
      event,
      ["memory_write", "memory_update", "aubi_learned"]
    )),
    learned_facts: mergeArrays(next.learned_facts, output.learned_facts),
    stream_log: mergeArrays(next.stream_log, output.stream_log) ?? next.stream_log,
  };
}

export function useIncidentStream() {
  const [events, setEvents] = useState<SSEEvent[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [result, setResult] = useState<IncidentResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const sourceRef = useRef<StreamLike | null>(null);
  const startedAtRef = useRef<number>(0);

  const reset = useCallback(() => {
    sourceRef.current?.close();
    sourceRef.current = null;
    setEvents([]);
    setResult(null);
    setError(null);
    setIsStreaming(false);
    startedAtRef.current = 0;
  }, []);

  const hydrate = useCallback((snapshot: WarRoomSnapshot) => {
    sourceRef.current?.close();
    sourceRef.current = null;
    setEvents(snapshot.events);
    setResult(snapshot.result);
    setError(null);
    setIsStreaming(false);
    startedAtRef.current = 0;
  }, []);

  const start = useCallback((issueUrl: string) => {
    reset();
    setIsStreaming(true);
    startedAtRef.current = Date.now();

    const source = api.streamIncident(issueUrl);
    sourceRef.current = source;

    source.onmessage = (message) => {
      try {
        const parsed = JSON.parse(message.data) as BackendEvent;
        const normalized = normalizeBackendEvent(parsed);
        const enriched: SSEEvent = {
          ...normalized,
          receivedAt: Date.now() - startedAtRef.current,
        };
        setEvents((current) => [...current, enriched]);
        setResult((current) => mergeResult(enriched, current));
        if (enriched.node === "approval_gate" || enriched.node === "complete") {
          source.close();
          setIsStreaming(false);
        }
      } catch (err) {
        const detail = err instanceof Error ? err.message : "Could not parse SSE event";
        setError(detail);
        setEvents((current) => [
          ...current,
          { node: "error", status: "error", output: { message: detail }, receivedAt: Date.now() - startedAtRef.current },
        ]);
      }
    };

    source.onerror = () => {
      const detail = "SSE connection failed";
      setError(detail);
      setEvents((current) => [
        ...current,
        { node: "error", status: "error", output: { message: detail }, receivedAt: Date.now() - startedAtRef.current },
      ]);
      source.close();
      setIsStreaming(false);
    };
  }, [reset]);

  const approve = useCallback(async (approved = true) => {
    if (!result?.thread_id) return;
    const response = await api.approveIncident(result.thread_id, approved);
    setResult((current) => ({
      ...(current ?? { owners: [], stream_log: [] }),
      ...response,
      awaiting_approval: false,
      owners: current?.owners ?? [],
      stream_log: [...(current?.stream_log ?? []), ...(response.stream_log ?? [])],
    }));
  }, [result?.thread_id]);

  useEffect(() => {
    return () => {
      sourceRef.current?.close();
    };
  }, []);

  return { events, isStreaming, result, error, start, approve, reset, setResult, hydrate };
}
