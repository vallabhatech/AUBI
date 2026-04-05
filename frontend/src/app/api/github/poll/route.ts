import { backendUrl, proxyJson } from "@/lib/backend";

export async function GET() {
  return proxyJson(`${backendUrl()}/github/poll`, { cache: "no-store" });
}
