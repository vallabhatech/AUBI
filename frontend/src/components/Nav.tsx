"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export function Nav() {
  const path = usePathname();

  return (
    <nav className="sticky top-0 z-50 grid h-[64px] grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center border-b border-[#1f1f1f] bg-[#080808] px-6">
      <Link
        href="/"
        aria-label="AUBI home"
        className="flex min-w-0 flex-col justify-self-start leading-none transition-opacity hover:opacity-80 focus:outline-none focus-visible:ring-1 focus-visible:ring-[#39ff14]"
      >
        <span className="font-syne text-[34px] font-normal tracking-[5px] text-[#39ff14]">AUBI</span>
        <span className="mt-1 font-mono text-[9px] uppercase tracking-[2px] text-[#e8e4dcc7]">
          Autonomous Understanding and Behaviour Inference
        </span>
      </Link>

      <div className="grid w-[min(560px,52vw)] grid-cols-4 items-center justify-items-center">
        {[
          { href: "/team", label: "TEAM" },
          { href: "/agents", label: "COWORKERS" },
          { href: "/demo", label: "FLOW" },
          { href: "/incident", label: "WAR ROOM" }
        ].map(({ href, label }) => {
          const active = path.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              className={[
                "border-b font-mono text-[13px] uppercase tracking-[3px] transition-colors",
                active
                  ? "border-[#39ff14] text-[#39ff14]"
                  : "border-transparent text-[#e8e4dcc7] hover:text-[#e8e4dc]"
              ].join(" ")}
            >
              {label}
            </Link>
          );
        })}
      </div>

      <div className="system-online-fade flex items-center gap-2 justify-self-end">
        <span className="h-2 w-2 rounded-full bg-[#39ff14]" />
        <span className="font-mono text-[10px] uppercase tracking-[3px] text-[#39ff14]">
          System Online
        </span>
      </div>
    </nav>
  );
}
