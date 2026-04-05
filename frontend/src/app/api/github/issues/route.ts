import { NextRequest } from "next/server";
import { backendUrl, proxyJson } from "@/lib/backend";

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const params = new URLSearchParams();
  const repoName = searchParams.get("repo_name") ?? searchParams.get("repo");
  const limit = searchParams.get("limit");

  if (repoName) params.set("repo_name", repoName);
  if (limit) params.set("limit", limit);

  const query = params.toString();
  return proxyJson(`${backendUrl()}/github/issues${query ? `?${query}` : ""}`, { cache: "no-store" });
}
