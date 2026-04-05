# AUBI Frontend Implementation Plan

## Current Status — PLAN 3.0 (April 26 2026)

All primary pages and components are implemented and TypeScript-clean. The project
has two parallel UI tracks that coexist under the same nav and design language.

### Primary demo track (PLAN 3.0 — active)

| Page | Purpose | Status |
|---|---|---|
| `/` | Landing — hero, pipeline overview, coworker cards, how-it-works | ✅ complete |
| `/team` | Agent cards with live constitution data, click-to-open dossier panel | ✅ complete |
| `/demo` | Full AUBI flow: GitHub issue → coworker mesh → fix → PR | ✅ complete |

### Secondary track (cyberpunk design, PLAN 2.0 origin)

| Page | Purpose | Status |
|---|---|---|
| `/agents` | Radial orbital mesh, interactive dot background, dossier panel | ✅ complete |
| `/incident` | War room: issue URL input, NeuralTrace SSE timeline, fix review, approval | ✅ complete |

Both tracks share the same nav (`/team → TEAM`, `/demo → FLOW`, `/agents → COWORKERS`, `/incident → INCIDENT`).

---

## Design Language

Two design systems coexist:

**Primary track** (`/`, `/team`, `/demo`):
- Background `#080808`, text `#e8e4dc`, accent `#39ff14` (neon green)
- `font-syne` headings, `font-mono` (JetBrains Mono) system labels
- Border `#1f1f1f`, surface `#050505`

**Secondary track** (`/agents`, `/incident`):
- Background `#0a0e1a`, text `#e2e8f0`, accent `#00f0ff` (cyan)
- Amber `#ffaa00` for routing, red `#ff3366` for danger, violet `#8b5cf6` for agent query, emerald `#10b981` for memory
- 40px grid overlay, terminal scanlines on incident input

---

## App File Structure (current)

```txt
frontend/src/
├── app/
│   ├── layout.tsx              # RootLayout — mounts Nav
│   ├── page.tsx                # Landing page (primary track)
│   ├── team/page.tsx           # Agent cards + ConstitutionPanel
│   ├── demo/page.tsx           # AUBI flow demo — useAUBIStream
│   ├── agents/page.tsx         # Radial orbital mesh (secondary track)
│   ├── incident/page.tsx       # War room (secondary track)
│   └── api/
│       ├── agents/route.ts           # GET/POST → backend /agents
│       ├── agents/[id]/route.ts      # GET/DELETE → backend /agents/:id
│       ├── github/poll/route.ts      # GET → backend /github/poll
│       ├── incidents/run/route.ts    # POST → backend /incidents/run
│       ├── incidents/stream/route.ts # GET SSE proxy → backend /incidents/stream?issue_url=
│       ├── incidents/approve/route.ts# POST → backend /incidents/approve?thread_id=&approved=
│       └── ready/route.ts
├── components/
│   ├── Nav.tsx                 # Sticky 52px nav, System Online badge
│   ├── InteractiveBackground.tsx # Canvas repel-dot background
│   ├── CoworkerMeshPanel.tsx   # Coworker exchanges, shared memory, memory writes
│   ├── DossierPanel.tsx        # Sliding agent dossier (secondary track)
│   ├── HexGrid.tsx             # SVG hex agent map with connection lines
│   ├── HexNode.tsx             # Single hex: avatar, constitution ring, breathing
│   ├── IncidentTerminal.tsx    # Terminal-style issue URL input
│   ├── NeuralTrace.tsx         # Vertical SSE timeline (secondary track)
│   ├── TraceNode.tsx           # Per-node animations: radar, router, typewriter, constellation
│   ├── ResponsePanel.tsx       # Slack mockup + postmortem + memory strip
│   └── aubi/
│       ├── AgentCard.tsx       # Card with avatar, constitution facts, expertise pills
│       ├── AgentCommFeed.tsx   # Chat bubbles for agent messages
│       ├── AgentMeshLines.tsx  # SVG mesh with animated particle on active line
│       └── ConstitutionPanel.tsx # Slide-in panel: categories, confidence bars
│   └── ui/
│       ├── badge.tsx
│       ├── button.tsx
│       ├── card.tsx
│       └── radial-orbital-timeline.tsx # Orbital ring mesh for /agents
├── hooks/
│   ├── useAUBIStream.ts        # Central SSE hook for PLAN 3.0 pipeline
│   ├── useAgents.ts            # Agent list fetch with refetch
│   └── useIncidentStream.ts    # SSE hook for /incident page (PLAN 2.0 flow)
└── lib/
    ├── api.ts                  # Typed fetch wrappers for all API calls
    ├── agents.ts               # normalizeAgent/s, coworkerName, factsFor, etc.
    ├── backend.ts              # backendUrl() and proxyJson() for Next.js routes
    ├── types.ts                # All shared TypeScript types
    └── utils.ts                # cn() (clsx + twMerge)
```

---

## PLAN 3.0 Pipeline (GitHub issue → PR)

The `/demo` page and `useAUBIStream` hook implement the full PLAN 3.0 flow:

```txt
GitHub Issue URL
    ↓
issue_reader        — reads the issue from GitHub
    ↓
ownership_router    — matches issue to owning AUBI agent via Qdrant
    ↓
query_agents        — all relevant agents consult each other via coworker mesh
    ↓
code_reader         — reads actual source files from the demo repo
    ↓
fix_generator       — drafts a code patch with test output
    ↓
approval_gate       — pauses graph with LangGraph interrupt(); waits for human
    ↓  (user clicks "Approve" in UI)
pr_pusher           — opens PR on GitHub with the fix
```

The human-in-the-loop approval gate is the central UX moment of the PLAN 3.0 demo.
After the backend emits `awaiting_approval`, the frontend shows an "Approve PR Push"
button. Clicking it calls `POST /api/incidents/approve?thread_id=&approved=true` which
resumes the LangGraph interrupt. The PR URL is emitted in the final `complete` event.

---

## SSE Event Format (PLAN 3.0)

All events are sent as JSON `data:` payloads on the stream.

```ts
// Discriminated union — see src/lib/types.ts
type AUBIEvent =
  | { event: "node_start"; node: string; data: null }
  | { event: "node_done"; node: string; data: Record<string, unknown> | null }
  | { event: "agent_message"; data: AgentMessage }
  | { event: "routing_evidence"; data: Record<string, unknown> }
  | { event: "coworker_exchange"; data: CoworkerContextExchange }
  | { event: "shared_memory_hit"; data: SharedMemoryHit }
  | { event: "memory_write"; data: MemoryUpdate }
  | { event: "awaiting_approval"; data: Record<string, unknown> }
  | { event: "complete"; data: Record<string, unknown> | null }
  | { event: "error"; data: string | { message: string } }
```

### useAUBIStream visual replay fallback

When the backend is unavailable, `useAUBIStream` automatically falls through to a
19-event `FALLBACK_SEQUENCE` that fires at 430ms intervals, so the demo is always
presentable. The fallback emits the same event types as a real backend run.

---

## Agent Types and Data

Agents are stored in Qdrant and fetched via the FastAPI backend. Each agent carries:

```ts
interface Agent {
  id: string;
  github_username: string;
  name: string;
  role: string;
  constitution_facts: ConstitutionFact[];   // SPO triples with category + confidence
  constitution?: Partial<Record<ConstitutionCategory, ConstitutionFact[]>>;
  github_data_summary: {
    commit_count: number;
    pr_count: number;
    top_files: string[];
    languages: string[];
  };
}

type ConstitutionCategory =
  | "code_ownership"
  | "expertise"
  | "collaboration"
  | "current_focus"
  | "known_issues"
  | "episodes";
```

The `normalizeAgent` / `normalizeAgents` functions in `lib/agents.ts` handle all
backend shape variations including nested `constitution` objects and flat
`constitution_facts` arrays, and deduplicate agents by identity key.

---

## Backend API Surface (used by frontend)

```txt
GET  /agents                         → Agent[]
GET  /agents/{id}                    → Agent
POST /agents                         → Agent   (ingest + build constitution)
DELETE /agents/{id}

GET  /github/poll                    → GitHubPollResult

POST /incidents/run                  → IncidentResult (blocking, non-streaming)
GET  /incidents/stream?issue_url=    → SSE stream of AUBIEvent
POST /incidents/approve?thread_id=&approved=  → ApprovalResult
```

All are proxied through Next.js API routes. `BACKEND_URL` or `NEXT_PUBLIC_BACKEND_URL`
env var is required for the proxy to resolve.

---

## Remaining Work

### Backend (not frontend)

- Approval gate node not yet added to `backend/graphs/incident_graph.py`. The graph
  needs a new `approval_gate` node using LangGraph `interrupt()` between
  `fix_generator` and `pr_pusher`.
- `backend/constitution/builder.py` still uses `ChatOpenAI(model="gpt-5.5")` — PLAN 3.0
  specifies Gemini 2.0 Flash for constitution building (cheaper, faster).
- The fix generator node should use GPT-5.5 or Claude Sonnet for patch quality.
- `constitution/builder.py` calls `facts_to_qdrant_points()` but nothing persists to
  Qdrant — the `ConstitutionStore.upsert_facts()` call is missing.

### Frontend polish

- `/team` page: the ConstitutionPanel's `getAgent(id)` refetch on open is the main
  data call; verify it returns full facts for real backend agents.
- `/demo` page: the "Approve" button is not yet wired in the demo page — it exists only
  in the `/incident` page. Add an approval CTA to `/demo` for the PLAN 3.0 demo.
- Responsive behavior: both tracks are designed for 1440px+ screens; test on demo
  hardware if it's a laptop.
- The `AgentMeshLines` component has hardcoded node positions for orchestrator, alice,
  bob, carol. Once real agent names come from the backend stream, this may need to
  normalise names dynamically (currently handled by `normalizeEndpoint()`).

---

## Demo Script (PLAN 3.0)

1. Open `/team` — show live AUBI agents with constitution facts.
2. Click an agent card — slide in ConstitutionPanel showing SPO facts, confidence bars.
3. Navigate to `/demo`.
4. Enter `Neilyoo98/GDSC-Hackathon#1` (or the planted demo issue URL).
5. Click "Run AUBI".
6. Watch the 7-node progress bar light up left to right.
7. Watch the AgentMeshLines pulse as agents message each other.
8. Watch AgentCommFeed fill with coworker messages.
9. Graph pauses at "Approval Ready" — fix is ready, waiting for human.
10. Click "Approve PR Push" — graph resumes, PR is created on GitHub.
11. Final event: `pr_pusher done` — show the PR URL.

If backend is offline, the visual replay kicks in automatically and shows the same flow.
