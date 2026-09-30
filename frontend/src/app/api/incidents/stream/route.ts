import { NextRequest } from "next/server";
import { backendUrl } from "@/lib/backend";

export async function GET(req: NextRequest) {
  const issueUrl = req.nextUrl.searchParams.get("issue_url")?.trim();

  if (!issueUrl) {
    return new Response(
      `data: ${JSON.stringify({ event: "error", data: "issue_url is required" })}\n\n`,
      {
        status: 400,
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache, no-transform",
        },
      }
    );
  }

  try {
    const upstream = await fetch(
      `${backendUrl()}/incidents/stream?issue_url=${encodeURIComponent(issueUrl)}`,
      { cache: "no-store" }
    );

    return new Response(upstream.body, {
      status: upstream.status,
      headers: {
        "Content-Type": upstream.headers.get("content-type") ?? "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      },
    });
  } catch {
    return new Response(
      `data: ${JSON.stringify({ event: "error", data: "Backend unavailable" })}\n\n`,
      {
        status: 502,
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache, no-transform",
        },
      }
    );
  }
}
