"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { AUBIEvent, AgentMessage } from "@/lib/types";
import { saveWarRoomSnapshot, snapshotFromAUBIEvents } from "@/lib/warRoomState";

const FALLBACK_MESSAGES: AgentMessage[] = [
  {
    sender: "orchestrator",
    recipient: "alice_aubi",
    message: "Issue reader found auth 401 failures in the deployed demo. Routing through local visual replay."
  },
  {
    sender: "alice_aubi",
    recipient: "orchestrator",
    message: "Ownership memory points to auth middleware and token validation. Preparing context for fix generation."
  },
  {
    sender: "orchestrator",
    recipient: "bob_aubi",
    message: "Checking billing and payments boundaries before generating the patch."
  },
  {
    sender: "bob_aubi",
    recipient: "orchestrator",
    message: "No downstream payment impact. The fix can be drafted and staged for PR preview."
  }
];

const FALLBACK_SEQUENCE: AUBIEvent[] = [
  { event: "node_start", node: "issue_reader", data: null },
  { event: "node_done",  node: "issue_reader", data: { mode: "visual_replay" } },
  { event: "agent_message", data: FALLBACK_MESSAGES[0] },
  { event: "node_start", node: "ownership_router", data: null },
  { event: "node_done",  node: "ownership_router", data: { owners: ["alice_aubi"], mode: "visual_replay" } },
  { event: "agent_message", data: FALLBACK_MESSAGES[1] },
  { event: "node_start", node: "query_agents", data: null },
  { event: "agent_message", data: FALLBACK_MESSAGES[2] },
  { event: "agent_message", data: FALLBACK_MESSAGES[3] },
  { event: "node_done",  node: "query_agents", data: { agents: ["alice_aubi", "bob_aubi"], mode: "visual_replay" } },
  { event: "node_start", node: "code_reader", data: null },
  { event: "node_done",  node: "code_reader", data: { files: ["auth/token.go", "billing/callbacks.go"], mode: "visual_replay" } },
  { event: "node_start", node: "fix_generator", data: null },
  { event: "node_done",  node: "fix_generator", data: { patch: "generated", mode: "visual_replay" } },
  { event: "node_start", node: "approval_gate", data: null },
  { event: "awaiting_approval", data: { mode: "visual_replay" } },
  { event: "node_start", node: "pr_pusher", data: null },
  { event: "node_done",  node: "pr_pusher", data: { pr_url: "visual-preview", mode: "visual_replay" } },
  { event: "complete", data: { mode: "visual_replay" } }
];

const CONNECTION_TIMEOUT_MS = 8000;

export function useAUBIStream(issueUrl: string | null) {
  const [events, setEvents]               = useState<AUBIEvent[]>([]);
  const [agentMessages, setAgentMessages] = useState<AgentMessage[]>([]);
  const [nodeStatuses, setNodeStatuses]   = useState<Record<string, "idle" | "running" | "done">>({});
  const [isStreaming, setIsStreaming]      = useState(false);
  const [isVisualReplay, setIsVisualReplay] = useState(false);
  const [error, setError]                 = useState<string | null>(null);

  const eventSourceRef     = useRef<EventSource | null>(null);
  const timersRef          = useRef<number[]>([]);
  const connectionTimerRef = useRef<number | null>(null);
  const hasRealEventsRef   = useRef(false);

  const clearConnectionTimer = useCallback(() => {
    if (connectionTimerRef.current !== null) {
      window.clearTimeout(connectionTimerRef.current);
      connectionTimerRef.current = null;
    }
  }, []);

  const clearReplayTimers = useCallback(() => {
    timersRef.current.forEach((t) => window.clearTimeout(t));
    timersRef.current = [];
  }, []);

  const applyEvent = useCallback((event: AUBIEvent) => {
    setEvents((prev) => [...prev, event]);

    if (event.event === "node_start") {
      const key =
        event.node === "query_single_agent" || event.node === "agent_querier"
          ? "query_agents"
          : event.node;
      setNodeStatuses((prev) => ({ ...prev, [key]: "running" }));
    }
    if (event.event === "node_done") {
      const key =
        event.node === "query_single_agent" || event.node === "agent_querier"
          ? "query_agents"
          : event.node;
      setNodeStatuses((prev) => ({ ...prev, [key]: "done" }));
    }
    if (event.event === "agent_message") {
      setAgentMessages((prev) => [...prev, event.data]);
    }
    if (event.event === "awaiting_approval") {
      setNodeStatuses((prev) => ({ ...prev, approval_gate: "done" }));
    }
    if (event.event === "complete") {
      setIsStreaming(false);
    }
    if (event.event === "error") {
      const message = typeof event.data === "string" ? event.data : event.data?.message;
      setError(message ?? "Backend stream failed");
      setIsStreaming(false);
    }
  }, []);

  const startVisualReplay = useCallback((reason: string) => {
    clearConnectionTimer();
    clearReplayTimers();
    eventSourceRef.current?.close();
    eventSourceRef.current = null;

    setError(reason);
    setEvents([{ event: "error", data: { message: reason } }]);
    setAgentMessages([]);
    setNodeStatuses({});
    setIsStreaming(true);
    setIsVisualReplay(true);
    hasRealEventsRef.current = false;

    FALLBACK_SEQUENCE.forEach((ev, i) => {
      const t = window.setTimeout(() => applyEvent(ev), 400 + i * 420);
      timersRef.current.push(t);
    });
  }, [applyEvent, clearConnectionTimer, clearReplayTimers]);

  const reset = useCallback(() => {
    clearConnectionTimer();
    clearReplayTimers();
    eventSourceRef.current?.close();
    eventSourceRef.current = null;
    hasRealEventsRef.current = false;

    setEvents([]);
    setAgentMessages([]);
    setNodeStatuses({});
    setIsStreaming(false);
    setIsVisualReplay(false);
    setError(null);
  }, [clearConnectionTimer, clearReplayTimers]);

  useEffect(() => {
    reset();
    if (!issueUrl) return;

    setIsStreaming(true);
    hasRealEventsRef.current = false;

    const source = new EventSource(
      `/api/incidents/stream?issue_url=${encodeURIComponent(issueUrl)}`
    );
    eventSourceRef.current = source;

    // If the backend never sends a first event within the timeout, fall back to demo replay
    connectionTimerRef.current = window.setTimeout(() => {
      connectionTimerRef.current = null;
      if (!hasRealEventsRef.current && eventSourceRef.current) {
        startVisualReplay("Backend not responding — showing demo replay");
      }
    }, CONNECTION_TIMEOUT_MS);

    source.onmessage = (msg) => {
      if (!hasRealEventsRef.current) {
        clearConnectionTimer();
        hasRealEventsRef.current = true;
      }
      try {
        const event = JSON.parse(msg.data) as AUBIEvent;
        applyEvent(event);
        if (event.event === "awaiting_approval") {
          source.close();
          setIsStreaming(false);
        }
        if (event.event === "complete") {
          source.close();
          setIsStreaming(false);
        }
        if (event.event === "error") {
          const text = typeof event.data === "string" ? event.data : event.data?.message;
          startVisualReplay(text ?? "Backend stream unavailable");
        }
      } catch {
        setError("Failed to parse SSE event");
        setEvents((current) => [...current, { event: "error", data: { message: "Failed to parse SSE event" } }]);
        source.close();
        setIsStreaming(false);
      }
    };

    source.onerror = () => {
      if (hasRealEventsRef.current) {
        // Stream ended after real events — normal close
        clearConnectionTimer();
        source.close();
        eventSourceRef.current = null;
        setIsStreaming(false);
        return;
      }
      // CLOSED = won't retry — fall back immediately
      if (source.readyState === EventSource.CLOSED) {
        clearConnectionTimer();
        startVisualReplay("SSE connection failed");
      }
      // CONNECTING = EventSource is retrying — let the connection timer handle it
    };

    return reset;
  }, [applyEvent, clearConnectionTimer, issueUrl, reset, startVisualReplay]);

  useEffect(() => {
    if (!issueUrl || isVisualReplay || events.length === 0) return;
    saveWarRoomSnapshot(snapshotFromAUBIEvents(issueUrl, events));
  }, [events, isVisualReplay, issueUrl]);

  return { events, agentMessages, nodeStatuses, isStreaming, isVisualReplay, error, reset };
}
