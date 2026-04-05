"use client";

import Link from "next/link";
import { useRef } from "react";
import type { CSSProperties } from "react";
import { StepCards } from "@/components/StepCard";
import { PerspectiveGrid } from "@/components/PerspectiveGrid";

const coworkerCards = [
  {
    initial: "O",
    name: "Owner Coworker",
    role: "Ownership Memory",
    owns: ["matched code paths", "recent commits"],
    known: "Routes incidents to the right developer profile using live constitution facts.",
  },
  {
    initial: "E",
    name: "Expert Coworker",
    role: "Adjacent Context",
    owns: ["related domains", "shared memory"],
    known: "Shares nearby context before code is read so fixes are not isolated guesses.",
  },
  {
    initial: "F",
    name: "Fix Coworker",
    role: "Patch Generation",
    owns: ["affected files", "test commands"],
    known: "Reads the configured repository, drafts a patch, and feeds verification results back into memory.",
  },
  {
    initial: "P",
    name: "PR Coworker",
    role: "Approval Flow",
    owns: ["PR body", "issue linkage"],
    known: "Keeps the human approval gate explicit before pushing changes back to GitHub.",
  },
];

const useCaseSteps = [
  {
    number: "01",
    title: "Issue opens",
    description: "A GitHub issue drops. Something is broken in auth. Users are getting 401s.",
    tag: "issue_reader",
  },
  {
    number: "02",
    title: "Right coworker found",
    description: "AUBI checks who owns auth/ from commit history and constitution memory — no Slack needed.",
    tag: "ownership_router",
  },
  {
    number: "03",
    title: "Coworkers consult each other",
    description: "The mesh exchanges context from ownership, expertise, known issues, and shared team memory before a fix is generated.",
    tag: "coworker_mesh",
    hot: true,
  },
  {
    number: "04",
    title: "Fix generated",
    description: "AUBI reads the actual code, writes the patch using shared team context, and runs the tests.",
    tag: "fix_generator",
  },
  {
    number: "05",
    title: "PR pushed",
    description: "You approve. AUBI opens the PR on GitHub with full context — owner, fix, test results.",
    tag: "pr_pusher",
  },
];

const constitutionSignals = [
  {
    label: "ownership",
    description: "Which files and directories each developer owns, inferred from real commit history.",
  },
  {
    label: "expertise",
    description: "Languages, frameworks, and domains each person actually works in — not self-reported.",
  },
  {
    label: "collaboration style",
    description: "How they prefer to communicate. Used when drafting fixes and PR messages in their voice.",
  },
  {
    label: "incident memory",
    description: "After every resolved incident, the coworker learns. Future runs reuse that context.",
  },
];

const pipelineNodes = [
  { label: "Issue Reader", state: "done", icon: <IssueIcon /> },
  { label: "Ownership Router", state: "done", icon: <RouteIcon /> },
  { label: "Coworker Mesh", state: "done", icon: <AgentsIcon /> },
  { label: "Fix Generator", state: "done", icon: <FixIcon /> },
  { label: "PR Pusher", state: "done", icon: <PrIcon /> },
];

const heroWords = [
  { text: "Every" },
  { text: "developer" },
  { text: "gets" },
  { text: "an" },
  { text: "AI" },
  { text: "coworker" },
  { text: "that" },
  { text: "actually", hot: true },
  { text: "knows", hot: true },
  { text: "them", hot: true },
];

function IssueIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1" />
      <path d="M12 7v6" stroke="currentColor" strokeWidth="1" strokeLinecap="round" />
      <path d="M12 17h.01" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function RouteIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M6 18C6 8 18 16 18 6" stroke="currentColor" strokeWidth="1" strokeLinecap="round" />
      <circle cx="6" cy="18" r="2" stroke="currentColor" strokeWidth="1" />
      <circle cx="18" cy="6" r="2" stroke="currentColor" strokeWidth="1" />
    </svg>
  );
}

function AgentsIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="8" cy="9" r="3" stroke="currentColor" strokeWidth="1" />
      <circle cx="16" cy="9" r="3" stroke="currentColor" strokeWidth="1" />
      <path d="M4 19c.8-3 2.2-4 4-4s3.2 1 4 4" stroke="currentColor" strokeWidth="1" strokeLinecap="round" />
      <path d="M12 19c.8-3 2.2-4 4-4s3.2 1 4 4" stroke="currentColor" strokeWidth="1" strokeLinecap="round" />
    </svg>
  );
}

function FixIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="m14 7 3 3-7 7H7v-3l7-7Z" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M12 9 9 6" stroke="currentColor" strokeWidth="1" strokeLinecap="round" />
    </svg>
  );
}

function PrIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="6" cy="18" r="2" stroke="currentColor" strokeWidth="1" />
      <circle cx="6" cy="6" r="2" stroke="currentColor" strokeWidth="1" />
      <circle cx="18" cy="18" r="2" stroke="currentColor" strokeWidth="1" />
      <path d="M6 8v8" stroke="currentColor" strokeWidth="1" />
      <path d="M8 6h4a6 6 0 0 1 6 6v4" stroke="currentColor" strokeWidth="1" strokeLinecap="round" />
    </svg>
  );
}

function SectionHeading({ eyebrow, title }: { eyebrow: string; title: string }) {
  return (
    <>
      <p className="typography-rise mono-animate font-mono text-[10px] uppercase tracking-[4px] text-[#39ff14] md:text-[11px]">{eyebrow}</p>
      <h2 className="typography-rise typography-scan font-syne mt-4 text-[42px] font-normal leading-[1.12] text-[#e8e4dc] md:text-[52px]">
        {title}
      </h2>
    </>
  );
}

function HeroMeshBackdrop() {
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-0 z-0 h-[720px] overflow-hidden">
      <PerspectiveGrid color="57,255,20" />
      <div className="mesh-scan absolute inset-x-0 top-0 h-px bg-[#39ff14]" />
      <svg className="hero-side-mesh hero-side-mesh-left absolute left-0 top-28 h-[360px] w-[360px] md:left-8 md:w-[420px]" viewBox="0 0 420 360" fill="none">
        <path className="hero-side-link" d="M18 86 C86 48 142 126 214 86 C284 48 326 72 396 34" />
        <path className="hero-side-link hero-side-link-hot" d="M42 244 C112 164 184 282 256 196 C308 132 344 160 394 104" />
        <path className="hero-side-link" d="M22 174 C96 238 156 102 232 168 C286 216 330 228 394 186" />
        {[
          [42, 86],[124, 118],[214, 86],[302, 68],[74, 244],[174, 238],[256, 196],[344, 160],[96, 198],[232, 168],
        ].map(([cx, cy]) => (
          <g key={`left-${cx}-${cy}`} className="hero-side-node">
            <circle cx={cx} cy={cy} r="3.5" />
            <path d={`M${cx} ${cy - 12} L${cx + 10} ${cy - 6} L${cx + 10} ${cy + 6} L${cx} ${cy + 12} L${cx - 10} ${cy + 6} L${cx - 10} ${cy - 6} Z`} />
          </g>
        ))}
      </svg>
      <svg className="hero-side-mesh hero-side-mesh-right absolute right-0 top-32 h-[360px] w-[360px] md:right-8 md:w-[420px]" viewBox="0 0 420 360" fill="none">
        <path className="hero-side-link hero-side-link-hot" d="M24 54 C86 96 128 42 190 90 C264 148 322 76 396 118" />
        <path className="hero-side-link" d="M18 186 C80 132 134 232 204 178 C278 120 324 200 396 146" />
        <path className="hero-side-link" d="M32 282 C112 220 166 318 244 254 C306 204 346 246 392 214" />
        {[
          [44, 70],[118, 62],[190, 90],[304, 102],[62, 178],[146, 216],[204, 178],[318, 184],[88, 264],[244, 254],
        ].map(([cx, cy]) => (
          <g key={`right-${cx}-${cy}`} className="hero-side-node">
            <circle cx={cx} cy={cy} r="3.5" />
            <path d={`M${cx} ${cy - 12} L${cx + 10} ${cy - 6} L${cx + 10} ${cy + 6} L${cx} ${cy + 12} L${cx - 10} ${cy + 6} L${cx - 10} ${cy - 6} Z`} />
          </g>
        ))}
      </svg>
      <svg className="absolute left-1/2 top-6 h-[620px] w-[min(1120px,120vw)] -translate-x-1/2" viewBox="0 0 1120 620" fill="none">
        <path className="mesh-path mesh-path-a" d="M130 388 C260 230 354 472 500 292 C642 118 774 390 986 196" />
        <path className="mesh-path mesh-path-b" d="M162 190 C320 320 416 150 578 322 C704 456 828 270 1006 420" />
        <path className="mesh-path mesh-path-c" d="M244 482 C430 400 438 206 612 214 C760 220 806 112 976 120" />
        {[
          [130, 388],[244, 482],[360, 268],[500, 292],[578, 322],
          [612, 214],[758, 392],[882, 166],[986, 196],[1006, 420],
        ].map(([cx, cy], index) => (
          <g key={`${cx}-${cy}`} className="mesh-node" style={{ animationDelay: `${index * 0.18}s` }}>
            <path d={`M${cx} ${cy - 18} L${cx + 16} ${cy - 9} L${cx + 16} ${cy + 9} L${cx} ${cy + 18} L${cx - 16} ${cy + 9} L${cx - 16} ${cy - 9} Z`} />
            <circle cx={cx} cy={cy} r="3" />
          </g>
        ))}
      </svg>
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_0%,transparent_38%,#080808_82%)]" />
      <div className="absolute inset-x-0 bottom-0 h-48 bg-gradient-to-b from-transparent to-[#080808]" />
    </div>
  );
}

export default function Home() {
  const pageRef = useRef<HTMLDivElement | null>(null);

  return (
    <div
      ref={pageRef}
      className="relative overflow-hidden"
      onPointerMove={(event) => {
        const rect = event.currentTarget.getBoundingClientRect();
        const x = event.clientX - rect.left;
        const y = event.clientY - rect.top;
        pageRef.current?.style.setProperty("--spotlight-x", `${x}px`);
        pageRef.current?.style.setProperty("--spotlight-y", `${y}px`);
        pageRef.current?.style.setProperty("--grid-shift-x", `${x * -0.035}px`);
        pageRef.current?.style.setProperty("--grid-shift-y", `${y * -0.035}px`);
        pageRef.current?.style.setProperty("--mesh-drift-x", `${(x - rect.width / 2) * 0.014}px`);
        pageRef.current?.style.setProperty("--mesh-drift-right-x", `${(rect.width / 2 - x) * 0.014}px`);
        pageRef.current?.style.setProperty("--mesh-drift-y", `${(y - rect.height / 3) * 0.01}px`);
        pageRef.current?.style.setProperty("--spotlight-opacity", "1");
      }}
      onPointerLeave={() => {
        pageRef.current?.style.setProperty("--mesh-drift-x", "0px");
        pageRef.current?.style.setProperty("--mesh-drift-right-x", "0px");
        pageRef.current?.style.setProperty("--mesh-drift-y", "0px");
        pageRef.current?.style.setProperty("--spotlight-opacity", "0");
      }}
      style={
        {
          "--bg": "#080808",
          "--text": "#e8e4dc",
          "--accent": "#39ff14",
          "--divider": "#1f1f1f",
          "--spotlight-x": "50%",
          "--spotlight-y": "22%",
          "--grid-shift-x": "0px",
          "--grid-shift-y": "0px",
          "--mesh-drift-x": "0px",
          "--mesh-drift-right-x": "0px",
          "--mesh-drift-y": "0px",
          "--spotlight-opacity": 0,
          background: "var(--bg)",
          color: "var(--text)",
          minHeight: "calc(100vh - 64px)",
        } as CSSProperties
      }
    >
      <style dangerouslySetInnerHTML={{ __html: `
        @keyframes breathe { 0%,100%{opacity:.45}50%{opacity:1} }
        @keyframes slide { from{left:-100%}to{left:200%} }
        @keyframes fadeup { from{opacity:0;transform:translateY(16px)}to{opacity:1;transform:translateY(0)} }
        @keyframes meshScan { 0%{transform:translateY(0);opacity:0}15%{opacity:.75}100%{transform:translateY(640px);opacity:0} }
        @keyframes pathFlow { to{stroke-dashoffset:-220} }
        @keyframes nodePulse { 0%,100%{opacity:.28;transform:scale(1)}50%{opacity:.95;transform:scale(1.08)} }
        @keyframes signalFloat { 0%,100%{transform:translateY(0);opacity:.88}25%{transform:translateY(-3px);opacity:1}75%{transform:translateY(3px);opacity:1} }
        @keyframes borderSweep { 0%{transform:translateX(-120%)}100%{transform:translateX(220%)} }
        @keyframes softFloat { 0%,100%{transform:translateY(0)}50%{transform:translateY(-4px)} }
        @keyframes activeNode { 0%,100%{border-color:#39ff14;background:#39ff1412}50%{border-color:#e8e4dc99;background:#39ff1420} }
        @keyframes textReveal { from{opacity:0;transform:translateY(18px);filter:blur(7px)} to{opacity:1;transform:translateY(0);filter:blur(0)} }
        @keyframes textSweep { 0%{transform:translateX(-115%);opacity:0}22%{opacity:.72}100%{transform:translateX(115%);opacity:0} }
        @keyframes wordLift { 0%{opacity:0;transform:translateY(28px) rotateX(32deg);filter:blur(10px)} 58%{opacity:1;filter:blur(0)} 100%{opacity:1;transform:translateY(0) rotateX(0);filter:blur(0)} }
        @keyframes glyphGlow { 0%,100%{text-shadow:none;transform:translateY(0)}50%{text-shadow:0 0 18px #39ff1455,0 0 36px #39ff1426;transform:translateY(-2px)} }
        @keyframes monoBlink { 0%,100%{opacity:.62}50%{opacity:1} }
        @keyframes footerAubiFlow { from{background-position:180% 50%}to{background-position:-80% 50%} }
        .landing-fade{opacity:0;animation:fadeup .7s ease forwards;will-change:opacity,transform}
        .typography-rise{opacity:0;animation:textReveal .82s cubic-bezier(.16,1,.3,1) forwards;will-change:opacity,transform,filter}
        .typography-scan{position:relative;display:block;overflow:hidden}
        .typography-scan::after{content:"";position:absolute;inset:0;background:linear-gradient(90deg,transparent,#39ff1430,transparent);transform:translateX(-115%);animation:textSweep 1.25s ease .28s forwards;pointer-events:none}
        .hero-title{perspective:900px;text-align:center}
        .hero-word{display:inline-block;opacity:0;transform-origin:50% 80%;animation:wordLift .82s cubic-bezier(.16,1,.3,1) forwards;will-change:opacity,transform,filter}
        .hot-text{animation:wordLift .82s cubic-bezier(.16,1,.3,1) forwards,glyphGlow 3.4s ease-in-out 1.1s infinite}
        .mono-animate{animation:textReveal .72s cubic-bezier(.16,1,.3,1) forwards,monoBlink 3.2s ease-in-out 1s infinite}
        .aubi-button{position:relative;isolation:isolate;overflow:hidden;border:1px solid #e8e4dccc;transition:transform .22s ease,border-color .22s ease,background .22s ease,color .22s ease}
        .aubi-button::after{content:"";position:absolute;inset:0;z-index:-1;background:linear-gradient(90deg,transparent,#e8e4dc22,transparent);transform:translateX(-120%);transition:transform .42s ease}
        .aubi-button:hover{transform:translateY(-2px);border-color:#39ff14;background:#39ff14;color:#080808}
        .aubi-button:hover::after{transform:translateX(120%)}
        .aubi-button-primary{background:#080808cc;color:#e8e4dc}
        .aubi-button-secondary{background:#080808cc;color:#e8e4dc}
        .interactive-surface{position:relative;transition:transform .24s ease,border-color .24s ease,background .24s ease,box-shadow .24s ease}
        .interactive-surface:hover{z-index:2;transform:translateY(-6px) scale(1.04);border-color:#39ff14cc;background:#24c918;box-shadow:0 18px 45px #24c91824}
        .interactive-surface:hover p{color:#080808}
        .active-pipeline-node{animation:activeNode 2.8s ease-in-out infinite}
        .metric-tile{transition:transform .24s ease,background .24s ease}
        .metric-tile:hover{transform:translateY(-4px);background:#e8e4dc08}
        .hero-chip{animation:softFloat 4s ease-in-out infinite}
        .mesh-scan{animation:meshScan 6s ease-in-out infinite;box-shadow:0 0 18px #39ff1455}
        .hero-side-mesh{opacity:.22;filter:drop-shadow(0 0 12px #39ff1420);transition:transform .16s linear}
        .hero-side-mesh-left{transform:translate3d(var(--mesh-drift-x),var(--mesh-drift-y),0)}
        .hero-side-mesh-right{transform:translate3d(var(--mesh-drift-right-x),var(--mesh-drift-y),0)}
        .hero-side-link{stroke:#e8e4dc;stroke-opacity:.28;stroke-width:1;stroke-dasharray:8 18}
        .hero-side-link-hot{stroke:#39ff14;stroke-opacity:.35}
        .hero-side-node circle{fill:#39ff14;opacity:.72}
        .hero-side-node path{fill:#080808;stroke:#e8e4dc;stroke-opacity:.24;stroke-width:1}
        .mesh-path{stroke:#e8e4dc;stroke-opacity:.32;stroke-width:1.8;stroke-dasharray:14 18;animation:pathFlow 10s linear infinite}
        .mesh-path-a{stroke:#39ff14;stroke-opacity:.45;stroke-width:2;animation-duration:8s}
        .mesh-path-b{stroke-opacity:.28;stroke-width:1.8;animation-duration:12s}
        .mesh-path-c{stroke:#39ff14;stroke-opacity:.28;stroke-width:1.6;animation-duration:14s}
        .mesh-node{transform-box:fill-box;transform-origin:center;animation:nodePulse 3.8s ease-in-out infinite}
        .mesh-node path{fill:#080808;stroke:#e8e4dc;stroke-opacity:.22;stroke-width:1}
        .mesh-node circle{fill:#39ff14}
        .signal-rise{animation:signalFloat 2.6s ease-in-out infinite}
        .cursor-spotlight{opacity:var(--spotlight-opacity);background:radial-gradient(395px circle at var(--spotlight-x) var(--spotlight-y),#e8e4dc24 0%,#e8e4dc12 30%,#e8e4dc08 52%,transparent 74%);transition:opacity .24s ease;mix-blend-mode:screen}
        .hero-grid-base{opacity:.12;background-image:linear-gradient(#39ff14 1px,transparent 1px),linear-gradient(90deg,#39ff14 1px,transparent 1px);background-size:64px 64px}
        .hero-grid-lens{opacity:calc(var(--spotlight-opacity) * .72);background-image:linear-gradient(#39ff1433 1px,transparent 1px),linear-gradient(90deg,#39ff1433 1px,transparent 1px);background-size:54px 54px;background-position:var(--grid-shift-x) var(--grid-shift-y);transform:translate3d(0,0,0) scale(1.018);transform-origin:var(--spotlight-x) var(--spotlight-y);mask-image:radial-gradient(270px circle at var(--spotlight-x) var(--spotlight-y),black 0%,black 18%,transparent 64%);-webkit-mask-image:radial-gradient(270px circle at var(--spotlight-x) var(--spotlight-y),black 0%,black 18%,transparent 64%);filter:none;transition:opacity .18s ease,background-position .12s linear}
        .landing-connector::after{content:"";position:absolute;top:0;bottom:0;width:55%;background:linear-gradient(90deg,transparent,#39ff14,transparent);animation:slide 2.4s linear infinite}
        .coworker-card{transition:transform .24s ease,border-color .24s ease}
        .coworker-card:hover{transform:translateY(-4px);border-color:#39ff1444}
        .footer-aubi-flow{display:inline-block;color:transparent;background:linear-gradient(90deg,#159a10 0%,#39ff14 34%,#e5ffdf 50%,#39ff14 66%,#159a10 100%);background-size:260% 100%;-webkit-background-clip:text;background-clip:text;text-shadow:0 0 18px #39ff1440;animation:footerAubiFlow 6.4s linear infinite}
      ` }} />

      <div aria-hidden="true" className="cursor-spotlight pointer-events-none absolute inset-0 z-[1]" />
      <HeroMeshBackdrop />

      {/* ── HERO ── */}
      <section className="relative z-10 px-6 pb-24 pt-24 text-center md:px-10">
        <div className="hero-chip landing-fade mx-auto inline-flex items-center gap-3 border border-[#e8e4dc33] bg-[#080808aa] px-4 py-2" style={{ animationDelay: "0s" }}>
          <span className="h-[5px] w-[5px] rounded-full bg-[#39ff14]" style={{ animation: "breathe 2s ease-in-out infinite" }} />
          <span className="font-mono text-[11px] uppercase tracking-[3px] text-[#e8e4dc]">Live at GDSC Hackathon · UMD · April 26</span>
        </div>

        <h1 className="hero-title typography-scan font-syne mx-auto mt-8 max-w-[860px] text-[56px] font-normal leading-[1.18] tracking-[4px] text-[#e8e4dc] md:text-[84px]">
          {heroWords.map((word, index) => (
            <span
              key={`${word.text}-${index}`}
              className={`hero-word ${word.hot ? "hot-text text-[#39ff14]" : ""}`}
              style={{ animationDelay: `${0.08 + index * 0.055}s` }}
            >
              {word.text}{index < heroWords.length - 1 ? "\u00a0" : ""}
            </span>
          ))}
        </h1>

        <p className="mono-animate font-mono mx-auto mt-5 text-[12px] uppercase tracking-[4px] text-[#39ff14] md:text-[13px]" style={{ animationDelay: ".15s" }}>
          Autonomous Understanding &amp; Behaviour Inference
        </p>

        <p className="typography-rise mx-auto mt-6 max-w-[620px] text-center text-[17px] leading-[1.85] text-[#e8e4dccf] md:text-[18px]" style={{ animationDelay: ".75s" }}>
          AUBI reads your team&apos;s GitHub history and builds a persistent AI coworker for each developer. These coworkers know who owns what, share context with each other, and step in when something breaks — without anyone having to ask.
        </p>

        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <Link href="/incident" className="aubi-button aubi-button-primary px-6 py-3 text-[14px] font-medium">
            See it fix a bug
          </Link>
          <Link href="/team" className="aubi-button aubi-button-secondary px-6 py-3 text-[14px] font-medium">
            Meet the coworkers
          </Link>
          <Link href="/demo" className="aubi-button aubi-button-secondary px-6 py-3 text-[14px] font-medium">
            Watch the mesh
          </Link>
        </div>

      </section>

      {/* ── COWORKER MESH ── */}
      <section className="relative z-10 px-6 py-20 text-center md:px-10">
        <div className="mx-auto max-w-[1180px]">
          <SectionHeading eyebrow="The coworker mesh" title="Your team — as a living memory." />
          <p className="mx-auto mt-4 max-w-[620px] text-[15px] leading-[1.85] text-[#e8e4dcb8]">
            Each developer&apos;s GitHub history is turned into a Context Constitution — a structured memory of what they own, what they know, and how they work. These constitutions power the mesh.
          </p>
          <div className="mx-auto mt-10 grid max-w-[1040px] gap-4 text-left md:grid-cols-2 lg:grid-cols-4">
            {coworkerCards.map((cw, index) => (
              <div
                key={cw.name}
                className="coworker-card landing-fade border border-[#1f1f1f] bg-[#080808] p-5"
                style={{ animationDelay: `${0.05 + index * 0.08}s` }}
              >
                <div className="flex items-center gap-3 mb-4">
                  <div className="flex h-9 w-9 items-center justify-center border border-[#e8e4dc22] font-syne text-[18px] tracking-[2px] text-[#39ff14]">
                    {cw.initial}
                  </div>
                  <div>
                    <p className="text-[14px] font-medium text-[#e8e4dc]">{cw.name}</p>
                    <p className="font-mono text-[10px] uppercase tracking-[2px] text-[#e8e4dcaa]">{cw.role}</p>
                  </div>
                </div>
                <div className="space-y-2">
                  {cw.owns.slice(0, 2).map((o) => (
                    <div key={o} className="flex items-start gap-2">
                      <span className="font-mono mt-0.5 text-[9px] uppercase tracking-[2px] text-[#39ff14cc]">owns</span>
                      <span className="text-[12px] text-[#e8e4dcd6]">{o}</span>
                    </div>
                  ))}
                  <div className="flex items-start gap-2 pt-1 border-t border-[#1f1f1f]">
                    <span className="font-mono mt-0.5 text-[9px] uppercase tracking-[2px] text-[#e8e4dc99]">knows</span>
                    <span className="text-[12px] leading-relaxed text-[#e8e4dcc7]">{cw.known}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
          <div className="mt-6 flex justify-center">
            <Link href="/team" className="aubi-button aubi-button-secondary font-mono px-4 py-2 text-[11px] uppercase tracking-[2px]">
              Inspect full constitutions →
            </Link>
          </div>
        </div>
      </section>

      {/* ── USE CASE PIPELINE ── */}
      <section className="relative z-10 mx-6 mb-16 overflow-hidden border border-[#e8e4dc33] bg-[#080808dd] md:mx-10">
        <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-[#39ff14] to-transparent opacity-70" />
        <div className="font-mono flex items-center justify-between border-b border-[#1f1f1f] px-6 py-4 text-[11px] uppercase tracking-[3px] text-[#e8e4dcb8]">
          <span>Use case · Live incident</span>
          <span className="signal-rise text-[#39ff14]">Running</span>
        </div>
        <div className="flex flex-col gap-4 border-b border-[#1f1f1f] px-6 py-4 md:flex-row md:items-center md:justify-between">
          <div className="flex items-center gap-4">
            <span className="h-2 w-2 rounded-full bg-[#39ff14]" style={{ animation: "breathe 2s ease-in-out infinite" }} />
            <div>
              <p className="text-[14px] font-medium text-[#e8e4dc]">Latest configured issue routed through AUBI memory</p>
              <p className="font-mono mt-1 text-[10px] uppercase tracking-[2px] text-[#e8e4dcb8]">repo: configured target · AUBI routing through live memory</p>
            </div>
          </div>
          <Link href="/incident" className="aubi-button font-mono border-[#39ff14] px-3 py-2 text-[10px] uppercase tracking-[2px] text-[#39ff14]">
            Open war room
          </Link>
        </div>
        <div className="mx-auto flex max-w-[900px] flex-col gap-6 px-6 py-10 md:flex-row md:items-center md:justify-center md:px-8">
          {pipelineNodes.map((node, index) => (
            <div key={node.label} className="landing-fade flex items-center" style={{ animationDelay: `${0.1 + index * 0.08}s` }}>
              <div className="relative flex min-w-[96px] flex-col items-center text-center">
                <div
                  className={["relative flex h-12 w-12 items-center justify-center border transition-transform duration-300 hover:-translate-y-1", node.state === "active" ? "active-pipeline-node" : ""].join(" ")}
                  style={{ borderColor: node.state === "idle" ? "#1f1f1f" : "#39ff14", background: node.state === "active" ? "#39ff1414" : "transparent", color: node.state === "idle" ? "#e8e4dcb8" : "#39ff14" }}
                >
                  {node.icon}
                  {node.state === "done" && <span className="absolute -right-px -top-px flex h-4 w-4 items-center justify-center bg-[#39ff14] text-[10px] text-[#080808]">✓</span>}
                </div>
                <p className="font-mono mt-3 text-[10px] uppercase tracking-[2px] text-[#e8e4dcd6]">{node.label}</p>
              </div>
              {index < pipelineNodes.length - 1 && (
                <div className="landing-connector relative mx-5 hidden h-px w-14 overflow-hidden bg-[#1f1f1f] md:block lg:w-16" />
              )}
            </div>
          ))}
        </div>
      </section>

      {/* ── STATS ── */}
      <section className="relative z-10 grid grid-cols-2 px-6 py-16 md:grid-cols-4 md:px-10">
        {[
          ["live", "coworkers loaded from backend memory"],
          ["0", "Slack messages needed to route an issue"],
          ["∞", "memory facts per developer in Qdrant"],
          ["90s", "from GitHub issue open to merged PR"],
        ].map(([number, description], index) => (
          <div key={number} className={`${index > 0 ? "md:border-l md:border-[#1f1f1f]" : ""} metric-tile landing-fade px-6 py-4`} style={{ animationDelay: `${index * 0.08}s` }}>
            <div className="font-syne text-[52px] font-normal leading-none tracking-[4px] text-[#e8e4dc] transition-colors duration-300 hover:text-[#39ff14]">{number}</div>
            <p className="mt-2 text-[14px] leading-[1.6] text-[#e8e4dcb8]">{description}</p>
          </div>
        ))}
      </section>

      {/* ── HOW IT WORKS ── */}
      <section id="how-it-works" className="relative z-10 px-6 py-20 md:px-10">
        <SectionHeading eyebrow="How it works" title="Coworkers consult. Bug gets fixed." />
        <StepCards steps={useCaseSteps} />
      </section>

      {/* ── CONTEXT CONSTITUTION ── */}
      <section className="relative z-10 px-6 py-20 md:px-10">
        <SectionHeading eyebrow="Context Constitution" title="What each coworker remembers." />
        <p className="mt-4 max-w-[620px] text-[15px] leading-[1.85] text-[#e8e4dcb8]">
          Built from real GitHub activity. Updated after every incident. No fake data, no self-reported profiles.
        </p>
        <div className="mt-10 grid gap-px border border-[#1f1f1f] md:grid-cols-2 lg:grid-cols-4">
          {constitutionSignals.map((signal, index) => (
            <div key={signal.label} className="interactive-surface landing-fade border-[#1f1f1f] bg-[#080808] p-6 md:border-l" style={{ animationDelay: `${index * 0.07}s` }}>
              <p className="font-mono text-[10px] uppercase tracking-[3px] text-[#39ff14]">{signal.label}</p>
              <p className="mt-3 text-[14px] leading-[1.75] text-[#e8e4dcbd]">{signal.description}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── FOOTER ── */}
      <footer className="relative z-10 grid grid-cols-1 items-center gap-4 border-t border-[#1f1f1f] px-6 py-8 md:grid-cols-3 md:px-10">
        <div className="footer-aubi-flow font-syne text-[30px] font-normal tracking-[5px]">AUBI</div>
        <div className="font-mono text-center text-[12px] uppercase tracking-[2px] text-[#e8e4dc]">GDSC Hackathon 2026 · University of Maryland</div>
        <div className="flex justify-start gap-2 md:justify-end">
          {["Dev Tool", "Most Creative"].map((badge) => (
            <span key={badge} className="font-mono border border-[#1f1f1f] px-3 py-1.5 text-[10px] uppercase tracking-[2px] text-[#e8e4dc]">
              {badge}
            </span>
          ))}
        </div>
      </footer>
    </div>
  );
}
