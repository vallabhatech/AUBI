import { NextRequest, NextResponse } from "next/server";
import { backendUrl, proxyJson } from "@/lib/backend";
import { normalizeAgent, normalizeAgents } from "@/lib/agents";
import type { Agent } from "@/lib/types";

export async function GET() {
  return proxyJson<Agent[]>(`${backendUrl()}/agents`, { cache: "no-store" }, normalizeAgents);
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    return proxyJson<Agent>(
      `${backendUrl()}/agents`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      },
      normalizeAgent
    );
  } catch {
    return NextResponse.json({ error: "Backend unavailable" }, { status: 502 });
  }
}
