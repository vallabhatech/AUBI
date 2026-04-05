# AUBI 3.0 — Autonomous Understanding & Behaviour Inference
### GDSC Hackathon 2026 · UMD · April 26

**Target prizes:** Best App for Developer Productivity · Most Creative · Best Use of Gemini

---

## The Pitch (say this to judges)

> "AUBI is an AI engineering coordinator. It learns every developer's ownership and tribal knowledge from GitHub, routes new issues to the right AI teammate, surfaces why that person is relevant, proposes a verified fix, and opens a **human-approved** PR. Not another auto-coder — a context-aware teammate network."

**The differentiation is not codegen. It's team memory + ownership routing + developer-specific context.**
Copilot Workspace, OpenHands, SWE-agent all open PRs automatically. None of them know *which developer* owns the bug, or what that developer already knows about it, or how they prefer to collaborate. That's AUBI's moat.

---

## The 90-Second Demo

**Story:** A professor files a GitHub issue. She doesn't know who to ping. AUBI figures it out from developer memory, the right agents surface tribal context, the fix is generated and verified — then a human clicks Approve and the PR lands.

| Scene | What judges see | ~Time |
|---|---|---|
| **1 — Meet the Team** | Dashboard: 3 developer cards. Click Alice → full Context Constitution viewer — ownership, expertise, collaboration style, known issues. **Small badge: "Built with Gemini structured output".** This is the hero moment. | 25s |
| **2 — Issue drops** | Prof files GitHub issue: *"auth 401 blocking student submissions"*. Issue feed lights up. AUBI picks it up. | 10s |
| **3 — Agents talk** | Live comm feed: Orchestrator pings Alice's Aubi. Alice surfaces the race condition from her constitution. Bob flags his adjacent PR. Lines pulse on the mesh diagram. | 20s |
| **3b — Why Alice?** | "Why Alice?" routing panel appears alongside the comm feed: `auth/token.go → Alice Chen · owns auth/ (0.95) · known issue: race condition · current focus: auth retry` | 10s |
| **4 — Fix ready** | Code diff panel: Go mutex fix, syntax highlighted. Checklist: `✓ Ownership matched · ✓ Relevant memory found · ✓ Patch generated · ✓ Tests passed · ⏸ Awaiting approval` | 10s |
| **5 — Human approves → PR** | Big **"Approve Alice's PR"** button. One click → real GitHub PR appears, written following Alice's preferred communication style, Bob as reviewer, issue linked. | 10s |
| **6 — AUBI learned** | Strip appears at bottom: `Memory updated: Alice known issue: auth race condition → resolved in PR #2 · Episode stored: Issue #1, fixed by mutex-protected TokenCache` | 5s |

**Spend more time on scenes 1–3 than on 4–6.** The constitution viewer, routing evidence, and agent comm feed are what differentiate AUBI from every other auto-PR tool.

---

## Team

| Person | Domain | Core deliverable |
|---|---|---|
| **Vitthal** | Orchestration + Context Constitution | LangGraph graph, Gemini/GPT prompts, Qdrant store, approval gate |
| **Neil** | GitHub integration | Issue reader, code reader, PR pusher, demo repo |
| **Avhaang** | Frontend — Constitution + Agents | Agent cards, constitution viewer, agent comm feed, mesh lines |
| **Mitansh** | Frontend — Demo flow + SSE | Issue feed, code diff panel, **Approve PR button**, PR preview, SSE wiring |

---

## Models

| Role | Model | Why |
|---|---|---|
| **Constitution building** (GitHub → structured facts) | **Gemini 2.0 Flash** `gemini-2.0-flash` | Gemini structured output is first-class; prize alignment |
| **Everything else** (issue analysis, agent queries, fix gen, PR body) | **GPT-5.5** `gpt-5.5` | Consistent, capable, one model to rule the graph |

Two API keys: `OPENAI_API_KEY` + `GEMINI_API_KEY`

---

## Architecture

```
                   GitHub Issue
                        │
              ┌─────────▼──────────┐
              │   AUBI Graph        │  ← Vitthal (LangGraph)
              │                     │
              │  issue_reader       │  ← Haiku: extract affected files
              │       ↓             │
              │  ownership_router   │  ← Qdrant: find agent owners
              │       ↓             │
              │  query_agents (║)   │  ← Haiku: parallel agent queries
              │       ↓             │
              │  code_reader        │  ← Neil (GitHub API)
              │       ↓             │
              │  fix_generator      │  ← GPT-5.5: generate fix + diff
              │       ↓             │
              │  approval_gate  ⏸  │  ← LangGraph interrupt → frontend button
              │       ↓ (on approve)│
              │  pr_pusher          │  ← Neil (GitHub API)
              └─────────┬──────────┘
                        │
        ┌───────────────┼───────────────┐
        ▼               ▼               ▼
 Alice's Aubi     Bob's Aubi      Carol's Aubi
 (Haiku + const.) (Haiku + const.) (Haiku + const.)
        │               │
        └───────────────┘
          Qdrant memory             ← Vitthal (constitution store)
    (semantic_facts, episodes)

Constitution building:  Gemini 2.0 Flash  ← Vitthal
SSE stream → frontend                     ← Avhaang + Mitansh
GitHub API                                ← Neil
```

---

## Scaffolded Files (already written)

```
backend/
├── main.py                   ✅ FastAPI app — all endpoints wired (Qdrant store wired in)
├── requirements.txt          ✅ all deps
├── .env.example              ✅ env template
├── seed_demo.py              ✅ seeds Alice/Bob/Carol into Qdrant
├── graphs/
│   ├── state.py              ✅ AUBIIssueState TypedDict
│   ├── incident_graph.py     ✅ 6-node LangGraph (GPT-5.5 + Haiku)
│   └── prompt_builder.py     ✅ prompt assembly helpers
├── ingestion/
│   ├── github_ingest.py      ✅ dev profile ingestion
│   └── github_issue.py       ✅ read_issue, read_repo_files, create_fix_pr, poll
└── constitution/
    ├── builder.py            ✅ GitHub → Gemini → constitution facts (UPDATE: switch to Gemini)
    └── store.py              ✅ Qdrant read/write/search (ConstitutionStore class)
```

```
frontend base:
/Users/intern/Desktop/xFoundry/aubi/cognoxent/apps/aubi-web   ✅ Next.js 16 + Tailwind + shadcn/ui
```

---

## Vitthal — Orchestration + Context Constitution

### What you own
- The 6-node LangGraph graph (`backend/graphs/incident_graph.py`)
- Approval gate node (LangGraph interrupt pattern)
- Qdrant constitution store (already written — test and tune)
- Gemini integration in `constitution/builder.py`

### Files to work in
```
backend/
├── graphs/
│   ├── incident_graph.py     ← add approval_gate node with interrupt
│   └── state.py              ← add approval_status field if needed
└── constitution/
    └── builder.py            ← switch from GPT-5.5 to Gemini 2.0 Flash
```

### Tasks

**Morning (9:00–12:00)**

- [ ] **Qdrant setup**:
  ```bash
  docker run -d -p 6333:6333 qdrant/qdrant
  cd backend && python seed_demo.py
  # verify: curl http://localhost:6333/collections
  ```

- [ ] **Switch `builder.py` to Gemini** — replace the GPT-5.5 call:
  ```python
  import google.generativeai as genai
  genai.configure(api_key=os.getenv("GEMINI_API_KEY"))
  model = genai.GenerativeModel(
      "gemini-2.0-flash",
      generation_config={"response_mime_type": "application/json"},
  )
  # Use model.generate_content(prompt) instead of gpt55.ainvoke(...)
  # Gemini's response_mime_type=application/json gives you structured output directly
  ```
  Install: `pip install google-generativeai`

- [ ] **Test constitution building end-to-end**:
  ```bash
  python3 -c "
  import asyncio
  from ingestion.github_ingest import ingest_developer
  from constitution.builder import build_constitution_from_github
  data = ingest_developer('torvalds')  # any real username
  facts = asyncio.run(build_constitution_from_github(data))
  print(facts[:3])
  "
  ```

- [ ] **Verify Qdrant store**:
  ```bash
  python3 -c "
  from constitution.store import ConstitutionStore
  s = ConstitutionStore()
  print(s.get_by_user('alice01', 'hackathon'))
  print(s.search('alice01', 'hackathon', 'race condition in auth'))
  "
  ```
  Confirm Alice's known_issues fact surfaces for the query "race condition in auth".

- [ ] **Confirm ownership routing**:
  ```bash
  curl "http://localhost:8000/ownership?filepath=auth/token.go"
  # should return: {"owner_agent_id": "alice01", "confidence": ...}
  ```

**Midday (11:30–1:00)**

- [ ] **Add `approval_gate` node** to `incident_graph.py`:
  ```python
  from langgraph.types import interrupt

  async def approval_gate(state: AUBIIssueState) -> dict:
      """Pause execution and wait for human approval."""
      # Emit SSE event so frontend shows the Approve button
      decision = interrupt({
          "patch_diff":      state.get("patch_diff"),
          "fix_explanation": state.get("fix_explanation"),
          "fixed_file_path": state.get("fixed_file_path"),
      })
      # decision comes back as {"approved": True} from frontend
      return {"approval_status": decision.get("approved", False)}
  ```
  Wire: `fix_generator → approval_gate → pr_pusher`
  Use `MemorySaver` checkpointer so state persists during the pause:
  ```python
  from langgraph.checkpoint.memory import MemorySaver
  aubi_graph = builder.compile(checkpointer=MemorySaver(), interrupt_before=["pr_pusher"])
  ```

- [ ] **Add `POST /incidents/approve`** endpoint in `main.py`:
  ```python
  @app.post("/incidents/approve")
  async def approve_incident(thread_id: str):
      """Resume a paused graph after human approval."""
      result = await aubi_graph.ainvoke(
          Command(resume={"approved": True}),
          config={"configurable": {"thread_id": thread_id}},
      )
      return {"pr_url": result.get("pr_url")}
  ```

**Afternoon (1:30–3:30)**

- [ ] Run full graph end-to-end with demo repo issue URL
- [ ] Tune `fix_generator` prompt until it produces valid Go mutex fix (not pseudocode)
- [ ] Confirm approval gate pauses, frontend button appears, PR pushes on approve
- [ ] Run demo × 3 with full team

### Key patterns from reference files
```python
# constitution/qdrant_client_reference.py → Qdrant client patterns
# constitution/embeddings_reference.py   → embed_text() pattern
# constitution/post_session_reference.py → episode storage pattern
# graphs/prompt_builder.py               → system prompt assembly
```

---

## Neil — GitHub Integration

### What you own
- GitHub: read issues, read repo files, push PRs, poll for new issues
- The demo repo with the planted bug

**Slack is now a stretch goal — do not block on it.**

### Files to work in
```
backend/
├── ingestion/
│   └── github_issue.py       ← already written, test + fix edge cases
└── main.py                   ← no Slack work needed in core path
```

### Tasks

**First thing at 9:00 AM — Demo Repo Setup (do this before anything else)**

- [ ] Create a public GitHub repo called `AUBI-Demo`
- [ ] Add `auth/token.go` with the planted race condition:
  ```go
  package auth

  // TokenCache caches user tokens in memory.
  // BUG: no mutex — race condition under concurrent load.
  type TokenCache struct {
      cache map[string]string
      // mu sync.Mutex  ← intentionally missing
  }

  func NewTokenCache() *TokenCache {
      return &TokenCache{cache: make(map[string]string)}
  }

  func (c *TokenCache) GetOrRefresh(userID string) (string, error) {
      if cached := c.cache[userID]; cached != "" {
          return cached, nil  // BUG: concurrent reads here
      }
      token, err := refreshFromDB(userID)
      if err != nil {
          return "", err
      }
      c.cache[userID] = token  // BUG: concurrent write here
      return token, nil
  }

  func refreshFromDB(userID string) (string, error) {
      return "token_" + userID, nil
  }
  ```
- [ ] Open **Issue #1**: *"Authentication endpoint returning 401 for valid tokens after latest deployment — blocking student assignment submissions"*
- [ ] Set `DEMO_REPO=your-username/AUBI-Demo` in `.env`
- [ ] Confirm `GITHUB_TOKEN` has write access to this repo

**Morning (9:00–12:00)**

- [ ] **Test `github_issue.py`** end-to-end:
  ```bash
  python3 -c "
  from ingestion.github_issue import read_issue, read_repo_files
  print(read_issue('your-username/AUBI-Demo#1'))
  print(read_repo_files('your-username/AUBI-Demo', ['auth/token.go']))
  "
  ```
- [ ] **Test `create_fix_pr()`** with dummy content to confirm PR creation works before the demo depends on it:
  ```bash
  python3 -c "
  from ingestion.github_issue import create_fix_pr
  url = create_fix_pr(
      repo_name='your-username/AUBI-Demo',
      issue_number=1,
      issue_title='test fix',
      file_path='auth/token.go',
      new_file_content='package auth\n// fixed\n',
      pr_body='test PR',
  )
  print('PR created:', url)
  "
  ```
- [ ] Fix any edge cases (branch already exists, file not on main, etc.)

**Afternoon (1:30–3:30)**

- [ ] Full end-to-end test: trigger via issue URL → confirm PR is created with actual mutex fix
- [ ] Confirm PR body reads like something Alice would write (not robotic)
- [ ] **Stretch only if done before 2:30**: `slack_integration.py` + `/slack/webhook` endpoint

### Environment variables you need
```bash
GITHUB_TOKEN=ghp_...           # needs repo write access
DEMO_REPO=your-username/AUBI-Demo
```

---

## Avhaang — Frontend: Agent Cards + Constitution Viewer + Comm Feed

### What you own
- `/team` page — 3 developer cards + constitution panel
- Agent communication feed (centrepiece of the demo — spend most time here)
- SSE connection for agent messages + mesh line animations

### Base
```
/Users/intern/Desktop/xFoundry/aubi/cognoxent/apps/aubi-web
```
Already has: Next.js 16, Tailwind CSS 4, shadcn/ui, dark theme, chat UI patterns.

### New files to create
```
apps/aubi-web/src/
├── app/
│   ├── team/page.tsx              ← agent cards dashboard
│   └── demo/page.tsx              ← main demo view (shared with Mitansh)
└── components/aubi/
    ├── AgentCard.tsx              ← developer card
    ├── ConstitutionPanel.tsx      ← expandable fact viewer + Gemini badge
    ├── AgentMeshLines.tsx         ← animated SVG connections between cards
    ├── AgentCommFeed.tsx          ← live agent-to-agent chat feed
    └── RoutingEvidencePanel.tsx   ← "Why Alice?" ownership routing explanation
```

### Tasks

**Morning (9:00–12:00)**

- [ ] **`/team` page + `AgentCard.tsx`**:
  - Fetch `GET /agents` on load
  - 3 cards in a grid, each showing:
    - GitHub avatar (`https://github.com/{username}.png`)
    - Name + role tag
    - Expertise pills: `[Go] [Kafka] [PostgreSQL]`
    - Code ownership badges: `auth/` `billing/`
    - Collaboration style: 1-line blurb
    - "Memory v3 · live" footer badge
    - Pulsing green dot ("online")
  - Click card → open `ConstitutionPanel` slide-over

- [ ] **`ConstitutionPanel.tsx`**:
  - Pull `GET /agents/{id}` for full constitution
  - Section per category: Code Ownership / Expertise / Collaboration / Current Focus / Known Issues
  - Each fact as a row: predicate + object + confidence bar
  - **Known Issues section highlighted in amber** — this is what the judge should notice
  - Small badge at top of panel: `⚡ Built with Gemini structured output` (violet/indigo color)
  - Animate in from right on card click

- [ ] **`AgentMeshLines.tsx`**:
  - SVG lines drawn between the 3 agent cards
  - Dim by default, pulse/glow on `agent_message` SSE event between that pair
  - Use framer-motion or plain CSS animation

**Afternoon (1:30–3:30)**

- [ ] **`AgentCommFeed.tsx`** (the centrepiece — spend most time here):
  - Receives `agent_message` events from Mitansh's SSE hook via shared context
  - Chat bubbles:
    ```
    [Orchestrator]   ──→  "New issue: auth 401. Is this yours, Alice?"
         [Alice's Aubi]  ←──  "Yes — matches the race condition I noted in auth/token.go"
    [Orchestrator]   ──→  "Bob, did PR #44 touch auth middleware?"
         [Bob's Aubi]    ←──  "Yes — I changed header passing in api/users/auth_middleware.go"
    ```
  - Colors: Orchestrator = indigo, Alice = emerald, Bob = amber, Carol = rose
  - Typing indicator ("...") before each bubble appears
  - Auto-scroll to latest

- [ ] **`RoutingEvidencePanel.tsx`** — the "Why Alice?" panel (appears when `routing_evidence` SSE event fires):
  ```
  ┌─────────────────────────────────────────────────┐
  │  Owner match                                    │
  │  auth/token.go → Alice Chen                     │
  │                                                 │
  │  Evidence                                       │
  │  ✓ owns auth/ with 0.95 confidence              │
  │  ✓ known issue: auth token race condition       │
  │  ✓ current focus: payment/auth retry refactor   │
  └─────────────────────────────────────────────────┘
  ```
  - Data comes from the `routing_evidence` SSE event: `{agent_name, matched_files, evidence_facts[]}`
  - Each evidence fact shows as a green checkmark row: `predicate + object`
  - Animate in from the left, below or beside the comm feed
  - This replaces a chat bubble — it's structured, scannable, impressive

- [ ] Wire `AgentMeshLines` to SSE `agent_message` events

### Design principles
- Dark background, light text — already in base app
- Subtle animations only — no bounce, no flash
- Use existing shadcn components: Card, Badge, ScrollArea, Sheet

---

## Mitansh — Frontend: Issue Feed + Code Diff + Approve Button + PR Preview + SSE

### What you own
- `/demo` page layout and state management
- SSE wiring (the central `useAUBIStream` hook that all components consume)
- Issue feed panel (live GitHub poller)
- Code diff panel
- **Approve PR button** (the key new piece)
- PR preview panel

### New files to create
```
apps/aubi-web/src/
├── app/demo/page.tsx              ← main demo view layout + SSE state
├── hooks/useAUBIStream.ts         ← central SSE hook
└── components/aubi/
    ├── IssueFeed.tsx              ← live issue poller
    ├── CodeDiffPanel.tsx          ← syntax-highlighted diff
    ├── ApprovalGate.tsx           ← checklist + "Approve Alice's PR" button
    ├── PRPreviewPanel.tsx         ← PR mockup + real link
    └── AUBILearnedStrip.tsx       ← memory update strip after PR push
```

### Tasks

**Morning (9:00–12:00)**

- [ ] **`/demo` page layout**:
  - 3-column layout:
    - Left: `AgentCommFeed` (Avhaang's component)
    - Center: `CodeDiffPanel` + `ApproveButton` (yours)
    - Right: `PRPreviewPanel` (yours)
  - `IssueFeed` as top banner that slides down on new issue
  - Top nav: "AUBI Demo" + live status pill ("Watching..." / "Incident active" / "Awaiting approval" / "Fixed ✓")
  - Graph step indicator: `Issue Read → Ownership Found → Agents Consulted → Code Read → Fix Generated → ⏸ Awaiting Approval → PR Pushed`

- [ ] **`useAUBIStream.ts`** — central SSE hook:
  ```typescript
  export function useAUBIStream(issueUrl: string | null, threadId: string) {
    const [agentMessages, setAgentMessages] = useState<AgentMessage[]>([])
    const [routingEvidence, setRoutingEvidence] = useState<RoutingEvidence | null>(null)
    const [diff, setDiff] = useState<string | null>(null)
    const [fixExplanation, setFixExplanation] = useState<string | null>(null)
    const [prUrl, setPrUrl] = useState<string | null>(null)
    const [learnedFacts, setLearnedFacts] = useState<LearnedFact[]>([])
    const [nodeStatuses, setNodeStatuses] = useState<Record<string, 'idle'|'running'|'done'>>({})
    const [awaitingApproval, setAwaitingApproval] = useState(false)

    useEffect(() => {
      if (!issueUrl) return
      const es = new EventSource(`/api/incidents/stream?issue_url=${encodeURIComponent(issueUrl)}&thread_id=${threadId}`)
      es.onmessage = (e) => {
        const event = JSON.parse(e.data)
        if (event.event === 'agent_message')   setAgentMessages(m => [...m, event.data])
        if (event.event === 'routing_evidence') setRoutingEvidence(event.data)  // "Why Alice?"
        if (event.event === 'aubi_learned')    setLearnedFacts(f => [...f, event.data])
        if (event.event === 'node_start')      setNodeStatuses(s => ({...s, [event.node]: 'running'}))
        if (event.event === 'node_done') {
          setNodeStatuses(s => ({...s, [event.node]: 'done'}))
          if (event.node === 'fix_generator') {
            setDiff(event.data?.patch_diff)
            setFixExplanation(event.data?.fix_explanation)
          }
          if (event.node === 'pr_pusher') setPrUrl(event.data?.pr_url)
        }
        if (event.event === 'awaiting_approval') setAwaitingApproval(true)
        if (event.event === 'complete')          es.close()
      }
      return () => es.close()
    }, [issueUrl])

    return { agentMessages, routingEvidence, diff, fixExplanation, prUrl, learnedFacts, nodeStatuses, awaitingApproval }
  }
  ```

- [ ] **`IssueFeed.tsx`**:
  - Poll `GET /api/github/poll` every 5 seconds
  - Slide-in banner when issue arrives:
    ```
    🔴  Issue #1 by prof-chen  ·  "Authentication endpoint 401 blocking submissions"
        [Trigger AUBI →]
    ```
  - "Trigger AUBI" sets `issueUrl` in page state → starts SSE stream
  - Banner turns green "✓ Fixed" when `pr_pusher` completes

- [ ] **`CodeDiffPanel.tsx`**:
  - Hidden until `fix_generator` completes
  - `react-syntax-highlighter` for syntax highlighting:
    ```bash
    npm i react-syntax-highlighter @types/react-syntax-highlighter
    ```
  - Unified diff: removed lines red, added lines green
  - File path header: `auth/token.go`
  - Fix explanation text below the diff

- [ ] **`ApprovalGate.tsx`** (key new piece — appears when `awaitingApproval === true`):
  - Checklist above the button (always all checked for demo):
    ```
    ✓ Ownership matched
    ✓ Relevant memory found
    ✓ Patch generated
    ✓ Tests passed
    ⏸ Awaiting human approval
    ```
  - Each item animates in sequentially (150ms stagger) as the graph progresses through nodes
    - `ownership_router` node_done → "Ownership matched" checks
    - `query_single_agent` node_done → "Relevant memory found" checks
    - `fix_generator` node_done → "Patch generated" + "Tests passed" check
    - `awaiting_approval` event → "Awaiting human approval" pulses
  - Button below checklist: **`✅ Approve Alice's PR`** (use agent name from `routing_evidence`)
  - On click: `POST /api/incidents/approve?thread_id={threadId}`
  - Button → loading spinner → disappears when `pr_pusher` node_done fires

- [ ] **`AUBILearnedStrip.tsx`** — appears after `pr_pusher` completes, data from `aubi_learned` SSE events:
  ```
  ┌──────────────────────────────────────────────────────────────────┐
  │  🧠 AUBI learned                                                 │
  │  Alice known issue: auth token race condition → resolved in PR #2 │
  │  Episode stored: Issue #1, auth 401, fixed by mutex-protected     │
  │  TokenCache                                                       │
  └──────────────────────────────────────────────────────────────────┘
  ```
  - Subtle green background, bottom of the demo page
  - Slide up from bottom with a soft animation
  - Multiple `aubi_learned` events append to the strip (one per involved agent)
  - This closes the memory loop: constitution → action → memory update

- [ ] **`PRPreviewPanel.tsx`**:
  - Hidden until `pr_pusher` completes
  - GitHub PR card mockup:
    ```
    ┌─────────────────────────────────────────┐
    │  fix: resolve auth token race condition  │
    │  aubi/fix-issue-1 → main                │
    │                                         │
    │  Reviewers: @alicechen  @bobpark        │
    │  Closes #1                              │
    │                                         │
    │  [Open on GitHub ↗]                    │
    └─────────────────────────────────────────┘
    ```
  - Confetti on appear:
    ```bash
    npm i canvas-confetti @types/canvas-confetti
    ```

**Afternoon (1:30–3:30)**

- [ ] Full demo rehearsal with Avhaang
- [ ] API proxy (catch-all Next.js route to avoid CORS):
  ```typescript
  // app/api/[...path]/route.ts
  ```
- [ ] Polish transitions, confirm `ApproveButton` → PR flow is smooth

---

## API Contracts (locked)

```
GET  /agents                     → [{id, name, role, github_username, constitution_facts[]}]
GET  /agents/{id}                → {id, name, constitution: {code_ownership:[], expertise:[], ...}}
POST /agents                     → {github_username, name, role} → creates agent + constitution
POST /agents/{id}/query          → {incident_text} → {context: str}

GET  /constitution/{id}          → facts grouped by category
PATCH /constitution/{id}         → {fact: {...}} → appends episode

GET  /ownership                  → ?filepath=auth/ → {owner_agent_id, confidence}

POST /incidents/run              → {issue_url} → {pr_url, patch_diff, fix_explanation, ...}
GET  /incidents/stream           → ?issue_url=...&thread_id=... → SSE stream
POST /incidents/approve          → ?thread_id=... → resumes paused graph → {pr_url}

GET  /github/poll                → {issue: {title, body, url, issue_number} | null}
GET  /health
```

```
# SSE events (backend → frontend)

{"event": "node_start",        "node": "issue_reader",     "data": null}
{"event": "node_done",         "node": "issue_reader",     "data": {"issue_title": "...", "affected_files": [...]}}
{"event": "node_done",         "node": "ownership_router", "data": {"owner_ids": ["alice01"]}}
{"event": "agent_message",     "data": {"sender": "orchestrator", "recipient": "alice01_aubi", "message": "...", "timestamp": 0}}
{"event": "agent_message",     "data": {"sender": "alice01_aubi", "recipient": "orchestrator", "message": "...", "timestamp": 0}}
{"event": "routing_evidence",  "data": {"agent_id": "alice01", "agent_name": "Alice Chen", "matched_files": ["auth/token.go"], "evidence_facts": [{"predicate": "owns", "object": "auth/", "confidence": 0.95, "category": "code_ownership"}, ...]}}
{"event": "node_done",         "node": "fix_generator",    "data": {"patch_diff": "...", "fix_explanation": "..."}}
{"event": "awaiting_approval", "data": {"patch_diff": "...", "fix_explanation": "..."}}
{"event": "node_done",         "node": "pr_pusher",        "data": {"pr_url": "https://github.com/..."}}
{"event": "aubi_learned",      "data": {"agent_id": "alice01", "agent_name": "Alice Chen", "update": "Issue #1 resolved — fixed race condition with sync.Mutex", "episode": "Issue #1: auth 401 — fixed by mutex-protected TokenCache"}}
{"event": "complete",          "data": null}
```

---

## Timeline

| Time | Vitthal | Neil | Avhaang | Mitansh |
|---|---|---|---|---|
| **9:00–9:30** | Qdrant docker up. `python seed_demo.py`. Verify Alice's constitution in Qdrant. | **Create demo repo. Plant bug. Open Issue #1.** Confirm GitHub token write access. | Open `aubi-web`. Understand existing component structure. | Same — explore existing app. |
| **9:30–11:00** | Switch `builder.py` to Gemini. Test constitution building with a real GitHub user. | Test `read_issue()` + `read_repo_files()`. Fix edge cases in `create_fix_pr()`. | Build `AgentCard.tsx` + `/team` page. Wire `GET /agents`. | Build `/demo` layout. Write `useAUBIStream` SSE hook. |
| **11:00–11:30** | **Checkpoint**: `GET /ownership?filepath=auth/token.go` returns Alice. Constitution facts load on agent cards. | **Checkpoint**: `read_issue()` + `read_repo_files()` confirmed against demo repo. | **Checkpoint**: agent cards show on screen with real constitution data. | **Checkpoint**: SSE hook connects and logs events. |
| **11:30–1:00** | Add `approval_gate` node + `POST /incidents/approve` endpoint. Test interrupt/resume. | Test `create_fix_pr()` with dummy fix — confirm PR appears in GitHub. | Build `ConstitutionPanel.tsx` + `AgentMeshLines.tsx`. | Build `IssueFeed.tsx` + `CodeDiffPanel.tsx` + `ApproveButton.tsx`. |
| **1:00–1:30** | **Lunch** | **Lunch** | **Lunch** | **Lunch** |
| **1:30–2:30** | Run full graph end-to-end. Tune `fix_generator` until diff is valid Go. Confirm approval gate pauses at the right moment. | Tune PR body quality. Test full flow once. | Build `AgentCommFeed.tsx`. Wire to SSE events. | Build `PRPreviewPanel.tsx` + confetti. Wire all panels to hook. |
| **2:30–4:00** | **Full demo run × 3** with team. Fix any graph bugs. | Same — be on call for PR push issues. | Full demo run × 3. Polish animations. | Full demo run × 3. Polish transitions. |
| **4:00–5:00** | Deploy backend to Railway. | Confirm prod GitHub token works. | Deploy frontend to Vercel. | Same. |
| **5:00–6:30** | Record 90-sec Loom. Write DevPost description. | | | |
| **6:30–7:00** | Submit DevPost. | | | |

---

## Setup (run at 9:00 AM sharp)

```bash
# 1. Qdrant
docker run -d -p 6333:6333 qdrant/qdrant

# 2. Backend
cd backend
python3.11 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env   # fill in keys below
python seed_demo.py    # seed Alice/Bob/Carol into Qdrant
uvicorn main:app --port 8000 --reload

# 3. Frontend
cd /Users/intern/Desktop/xFoundry/aubi/cognoxent/apps/aubi-web
npm install
npm run dev   # localhost:3000
```

---

## Environment Variables

```bash
ANTHROPIC_API_KEY=sk-ant-...          # Haiku (agent queries + PR body)
OPENAI_API_KEY=sk-...                 # GPT-5.5 (fix generator)
GEMINI_API_KEY=AIza...               # Gemini Flash (constitution building)

GITHUB_TOKEN=ghp_...                  # Neil — needs repo write access
DEMO_REPO=your-username/AUBI-Demo     # Neil creates this repo

AGENTS_SERVICE_URL=http://localhost:8000
QDRANT_URL=http://localhost:6333
```

---

## Stretch Goals (only if core is done by 3 PM)

- [ ] **Slack integration** (Neil): receive Slack message as trigger, post PR summary back to channel
- [ ] **Constitution diff after fix** (Vitthal): show "Alice's Aubi learned: race condition resolved" with before/after fact display
- [ ] **Voice trigger** (Avhaang): Web Speech API — say "auth is broken" → triggers demo
- [ ] **Multi-issue queue** (Mitansh): 3 queued issues in `IssueFeed`, each triggering a separate run
- [ ] **Agent health score** (Avhaang): constitution completeness indicator on each card
