"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import type { Agent } from "@/lib/types";

export function useAgents() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const fetched = await api.getAgents();
      setAgents(Array.isArray(fetched) ? fetched : []);
    } catch (err) {
      setAgents([]);
      setError(err instanceof Error ? err.message : "Failed to load coworker memory");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  return { agents, isLoading, error, refetch, setAgents };
}
