import { NextResponse } from "next/server";

const DEFAULT_BACKEND_URL = "https://gdsc-hackathon-production.up.railway.app";
const BACKEND_TIMEOUT_MS = 15_000;

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
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), BACKEND_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      ...init,
      cache: "no-store",
      headers: {
        Accept: "application/json",
        ...init?.headers,
      },
      signal: controller.signal,
    });
    const data = await response.json().catch(() => ({}));
    const body = response.ok && transform ? transform(data as T) : data;

    return NextResponse.json(body, {
      status: response.status,
      headers: {
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    const detail =
      error instanceof Error && error.name === "AbortError"
        ? "Backend request timed out"
        : error instanceof Error
          ? error.message
          : "Backend unavailable";

    return NextResponse.json(
      { detail: `Backend unavailable: ${detail}` },
      { status: 502, headers: { "Cache-Control": "no-store" } }
    );
  } finally {
    clearTimeout(timeout);
  }
}
