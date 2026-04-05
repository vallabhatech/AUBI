import { NextRequest, NextResponse } from "next/server";
import { backendUrl, proxyJson } from "@/lib/backend";

export async function POST(req: NextRequest) {
  const threadId = req.nextUrl.searchParams.get("thread_id");
  const approved = req.nextUrl.searchParams.get("approved") ?? "true";
  if (!threadId) {
    return NextResponse.json({ detail: "thread_id is required" }, { status: 400 });
  }

  return proxyJson(
    `${backendUrl()}/incidents/approve?thread_id=${encodeURIComponent(threadId)}&approved=${encodeURIComponent(approved)}`,
    { method: "POST" }
  );
}
