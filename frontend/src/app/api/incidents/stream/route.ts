import { NextRequest } from "next/server";
import { backendUrl } from "@/lib/backend";

export async function GET(req: NextRequest) {
  const issueUrl = req.nextUrl.searchParams.get("issue_url") ?? "";
  try {
    const upstream = await fetch(
      `${backendUrl()}/incidents/stream?issue_url=${encodeURIComponent(issueUrl)}`,
      { cache: "no-store" }
    );
    return new Response(upstream.body, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  } catch {
    return new Response(
      `data: ${JSON.stringify({ event: "error", data: "Backend unavailable" })}\n\n`,
      { headers: { "Content-Type": "text/event-stream" } }
    );
  }
}
