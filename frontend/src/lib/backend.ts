import { NextResponse } from "next/server";

const DEFAULT_BACKEND_URL = "https://gdsc-hackathon-production.up.railway.app";

export function backendUrl() {
  const configured =
    process.env.BACKEND_URL ||
    process.env.NEXT_PUBLIC_BACKEND_URL ||
    DEFAULT_BACKEND_URL;
  return configured.replace(/\/+$/, "");
}

export async function proxyJson<T = unknown>(
  url: string,
  init?: RequestInit,
  transform?: (data: T) => unknown
) {
  try {
    const response = await fetch(url, init);
    const data = await response.json().catch(() => ({}));
    const body = response.ok && transform ? transform(data as T) : data;
    return NextResponse.json(body, { status: response.status });
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Backend unavailable";
    return NextResponse.json({ detail: `Backend unavailable: ${detail}` }, { status: 502 });
  }
}
