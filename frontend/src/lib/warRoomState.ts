"use client";

import type {
  AUBIEvent,
  CoworkerContextExchange,
  IncidentResult,
  MemoryUpdate,
  SSEEvent,
  SSENode,
  SharedMemoryHit,
} from "./types";

export const WAR_ROOM_SNAPSHOT_KEY = "aubi:war-room:latest-run";

export interface WarRoomSnapshot {
  issueUrl: string;
  events: SSEEvent[];
  result: IncidentResult | null;
  updatedAt: number;
}

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

function asNode(value: string | undefined, fallback: SSENode): SSENode {
  return value && GRAPH_NODES.has(value as SSENode) ? (value as SSENode) : fallback;
}

function asOutput(value: AUBIEvent["data"]): Record<string, unknown> | null {
  if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  if (typeof value === "string") return { message: value };
  return null;
}

function normalizeEvent(event: AUBIEvent, index: number): SSEEvent {
  if (event.event === "thread") {
    return { eventType: event.event, node: "thread", status: "done", output: asOutput(event.data), receivedAt: index * 250 };
  }
  if (event.event === "node_start") {
    return { eventType: event.event, node: asNode(event.node, "issue_reader"), status: "running", output: null, receivedAt: index * 250 };
  }
  if (event.event === "node_done") {
    return { eventType: event.event, node: asNode(event.node, "issue_reader"), status: "done", output: asOutput(event.data), receivedAt: index * 250 };
  }
  if (event.event === "agent_message") {
    return {
      eventType: event.event,
      node: "query_single_agent",
      status: "done",
      output: asOutput(event.data),
      agent: event.data.sender,
      receivedAt: index * 250,
    };
  }
  if (event.event === "routing_evidence") {
    return { eventType: event.event, node: "ownership_router", status: "done", output: asOutput(event.data), receivedAt: index * 250 };
  }
  if (event.event === "coworker_exchange" || event.event === "coworker_context" || event.event === "shared_memory_hit" || event.event === "shared_memory") {
    return { eventType: event.event, node: "coworker_mesh_exchange", status: "done", output: asOutput(event.data), receivedAt: index * 250 };
  }
  if (event.event === "memory_write" || event.event === "memory_update" || event.event === "aubi_learned") {
    return { eventType: event.event, node: "memory_updater", status: "done", output: asOutput(event.data), receivedAt: index * 250 };
  }
  if (event.event === "awaiting_approval") {
    return { eventType: event.event, node: "approval_gate", status: "done", output: asOutput(event.data), receivedAt: index * 250 };
  }
  if (event.event === "complete") {
    return { eventType: event.event, node: "complete", status: "done", output: asOutput(event.data), receivedAt: index * 250 };
  }
  return { eventType: event.event, node: "error", status: "error", output: asOutput(event.data), receivedAt: index * 250 };
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

export function mergeWarRoomResult(event: SSEEvent, current: IncidentResult | null): IncidentResult {
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

export function snapshotFromAUBIEvents(issueUrl: string, events: AUBIEvent[]): WarRoomSnapshot {
  const normalized = events.map(normalizeEvent);
  const result = normalized.reduce<IncidentResult | null>((current, event) => mergeWarRoomResult(event, current), null);
  return { issueUrl, events: normalized, result, updatedAt: Date.now() };
}

export function saveWarRoomSnapshot(snapshot: WarRoomSnapshot): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(WAR_ROOM_SNAPSHOT_KEY, JSON.stringify(snapshot));
}

export function loadWarRoomSnapshot(): WarRoomSnapshot | null {
  if (typeof window === "undefined") return null;
  const raw = window.localStorage.getItem(WAR_ROOM_SNAPSHOT_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as WarRoomSnapshot;
  } catch {
    return null;
  }
}
