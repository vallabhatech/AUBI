import { backendUrl, proxyJson } from "@/lib/backend";

export async function GET() {
  return proxyJson(`${backendUrl()}/ready`, { cache: "no-store" });
}
