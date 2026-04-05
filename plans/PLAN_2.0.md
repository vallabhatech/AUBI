# AUBI 2.0 — Autonomous Understanding & Behaviour Inference
### GDSC Hackathon 2026 · UMD · April 26

**Target prizes:** Best App for Developer Productivity · Most Creative · Best Use of Gemini (multiagent)

---

## Model Assignments

| Role | Model | Why |
|---|---|---|
| **Orchestrator** (issue analysis, routing, fix gen, PR) | **Claude Sonnet** (`claude-sonnet-4-5-20251001`) | Best reasoning for multi-step autonomous flow |
| **Agent constitution queries** (fast per-agent look-up) | **Claude Haiku** (`claude-haiku-20240307`) | Cheap, fast, good at structured context |
| **Constitution building** (GitHub → facts) | **Claude Sonnet** | Long context, structured JSON output |

> One API key: `ANTHROPIC_API_KEY`

---

## The Demo — Full Story (what judges see)

This is a 90-second end-to-end demo. Prep a demo GitHub repo with a planted bug beforehand.

---

### Scene 1 — Meet the Team (20 sec)

Open AUBI dashboard. Three developer cards on screen.

> "Every developer on this team has an AI co-worker — an Aubi. Each Aubi knows who they are, what they own, and how they work."

Click **Alice's card** → expand her **Context Constitution**:
```
Code Ownership:   auth/  billing/  api/gateway/
Expertise:        Go · Kafka · distributed systems
Current Focus:    Refactoring payment retry logic
Collaboration:    Async-first, needs context before meetings
Known Issues:     Auth token race condition (unresolved)
```

> "This wasn't manually filled in. Aubi inferred it from Alice's GitHub commits, PRs, and review patterns."

Click **Bob's card** → shows:
```
Code Ownership:   frontend/  api/users/
Expertise:        TypeScript · React · REST APIs
Current Focus:    User profile redesign
```

> "And critically — these Aubis know each other. They can consult each other's constitutions."

---

### Scene 2 — The Issue Drops (10 sec)

Switch to the **Issue Feed** panel. A new GitHub issue appears (live, from a real repo):

```
Issue #47 — Professor Chen
"Authentication endpoint returning 401 for valid tokens
 after yesterday's deployment. Blocking 3 students from
 submitting their assignments. Urgent."
```

> "Professor Chen just filed a GitHub issue. She doesn't know who to ping. She just needs it fixed."

AUBI picks it up automatically.

---

### Scene 3 — Agent Communication (30 sec)

The **Agent Comm Feed** lights up — this is the centerpiece visual.

Real-time bubbles showing Aubis talking to each other, like a group chat but between AI agents:

```
🧠 Orchestrator Aubi
  "New issue: auth 401 after deployment. Reading codebase..."
  → Querying ownership for auth/

🤖 Alice's Aubi  [owns: auth/]
  "This matches the token race condition I've been tracking.
   The refresh logic in auth/token.go line 142 — if two
   requests hit simultaneously, the old token gets cached."

🤖 Bob's Aubi  [owns: api/users/]
  "I touched api/users/auth_middleware.go in PR #44 yesterday.
   Could be related — I changed how headers are passed."

🧠 Orchestrator Aubi
  "Root cause identified. Alice owns the fix. Bob's PR #44
   is likely the trigger. Reading auth/token.go..."
```

> "The Aubis figured out who owns what, consulted each other's knowledge, and traced the root cause — without paging a single human."

---

### Scene 4 — The Fix (20 sec)

**Code panel** slides in:
- Shows `auth/token.go` with the buggy section highlighted
- Aubi generates a diff (actual code fix, not pseudocode)
- Diff shown inline with syntax highlighting

```diff
- if cached := tokenCache.Get(userID); cached != "" {
-     return cached, nil
- }
+ tokenCache.mu.Lock()
+ defer tokenCache.mu.Unlock()
+ if cached := tokenCache.Get(userID); cached != "" {
+     return cached, nil
+ }
```

> "Aubi read the code, understood the race condition Alice's constitution flagged, and generated the fix."

---

### Scene 5 — PR Pushed (10 sec)

Click **"Push Fix"** (or it auto-pushes after 3-second countdown).

GitHub PR appears on screen (real URL):
- Title: `fix: resolve auth token race condition (fixes #47)`
- Body written in Alice's communication style (per her constitution)
- Reviewers auto-assigned: Alice (owner) + Bob (touched adjacent code)
- Issue #47 linked and auto-closed on merge

> "One GitHub issue. Zero Slack messages. No one manually debugged it. The Aubis handled everything."

---

## Architecture

```
GitHub Issue Webhook / Poll
         │
         ▼
┌─────────────────────────────────────────────────────┐
│              AUBI Incident Graph (LangGraph)         │
│                                                      │
│  issue_reader → ownership_router → agent_consultor   │
│       → code_reader → fix_generator → pr_pusher      │
└──────────────────────────┬──────────────────────────┘
                           │  agent-to-agent queries
          ┌────────────────┼────────────────┐
          ▼                ▼                ▼
   Alice's Aubi      Bob's Aubi       Carol's Aubi
   (Haiku + const.)  (Haiku + const.) (Haiku + const.)
          │                │
          └────────────────┘
               shared Qdrant memory
         (constitutions + past incidents)
                           │
                    GitHub API (PyGitHub)
                    read files + push PR
```

### Extended State (adds to existing AUBIIncidentState)

```python
class AUBIIssueState(TypedDict):
    # Input
    issue_url: str
    issue_title: str
    issue_body: str
    repo_name: str          # "owner/repo"

    # Analyzer output
    affected_files: list[str]
    error_type: str

    # Router output
    owner_ids: list[str]

    # Agent comms — list of {sender, recipient, message}
    agent_messages: Annotated[list[dict], operator.add]

    # Code reader output
    file_contents: dict[str, str]   # {filepath: code}

    # Fix generator output
    patch_diff: str
    fix_explanation: str

    # PR pusher output
    pr_url: str
    branch_name: str

    # Stream log for frontend
    stream_log: Annotated[list[str], operator.add]
```

---

## Graph: 6 Nodes (extended from 5-node incident graph)

```
issue_reader         reads GitHub issue, extracts affected area
      ↓
ownership_router     checks Qdrant ownership, finds Alice + Bob
      ↓
agent_consultor      queries each agent's Aubi in parallel
      ↓                (this produces the "agent comms" feed)
code_reader          reads affected files from GitHub repo
      ↓
fix_generator        Claude Sonnet: issue + code + agent context → diff
      ↓
pr_pusher            creates branch, commits diff, opens PR via GitHub API
```

---

## Scaffolded Files — Already Written

```
backend/
├── main.py                          ✅ WRITTEN — FastAPI + all endpoints
├── requirements.txt                 ✅ WRITTEN
├── .env.example                     ✅ WRITTEN
├── graphs/
│   ├── state.py                     ✅ WRITTEN — extend with AUBIIssueState
│   ├── incident_graph.py            ✅ WRITTEN — 5-node base (extend to 6)
│   ├── sse_events.py                ✅ COPIED from orchestrator-langgraph
│   ├── deep_agent_event_mapper.py   ✅ COPIED
│   ├── prompt_builder.py            ✅ COPIED from cognoxent
│   └── memory_scopes.py             ✅ COPIED
├── ingestion/
│   ├── github_ingest.py             ✅ WRITTEN — dev profile ingestion
│   └── github_issue.py              ❌ BUILD — issue reader + code reader + PR pusher
└── constitution/
    └── builder.py                   ✅ WRITTEN — GitHub → Claude → Qdrant facts
```

---

## Team Division of Work

### Person 1 — Extended Graph + Agent Comms
**Base off:** `backend/graphs/incident_graph.py` (already written, extend it)

**Goal:** Extend the 5-node incident graph to the 6-node issue→PR graph. Add the agent consultor that produces the agent-to-agent communication feed.

**Tasks:**
- [ ] Extend `state.py` → add `AUBIIssueState` fields (issue_url, repo_name, file_contents, patch_diff, pr_url, agent_messages)
- [ ] Rename/extend `incident_analyzer` → `issue_reader` node:
  - Accepts `issue_url` instead of raw text
  - Calls Person 3's `github_issue.read_issue()` to get title + body + repo
  - Claude Haiku: extract affected service / files from issue body
- [ ] `agent_consultor` node — PARALLEL agent queries using LangGraph `Send` API:
  - For each owner, call `POST /agents/{id}/query` with issue summary
  - Each response goes into `agent_messages` list (appended via `operator.add`)
  - Each message: `{sender: "alice_aubi", recipient: "orchestrator", message: "...", timestamp}`
  - This produces the real-time agent comm feed
- [ ] `fix_generator` node — Claude Sonnet prompt:
  - Input: issue body + file_contents + all agent_messages (their context)
  - Output: unified diff (patch) + fix_explanation
  - Must produce real, syntactically valid code — use a demo repo with a known bug
- [ ] Wire updated 6-node graph and expose via existing SSE endpoint
- [ ] Add `agent_messages` events to the SSE stream so frontend can show them

**Key pattern for parallel agent queries (Send API):**
```python
from langgraph.types import Send

def route_to_agents(state: AUBIIssueState):
    return [Send("query_single_agent", {"agent_id": id, **state})
            for id in state["owner_ids"]]

builder.add_conditional_edges("ownership_router", route_to_agents)
builder.add_node("query_single_agent", query_single_agent_node)
builder.add_edge("query_single_agent", "code_reader")
```

**Deliverable:** Full 6-node graph streaming agent messages + diff + PR URL via SSE.

---

### Person 2 — Constitution Store (Qdrant) + Knowledge Service
**Base off:** `backend/constitution/builder.py` (written) + `constitution/*_reference.py` files

**Goal:** Make the Qdrant storage actually work so constitutions persist and are queryable by the graph nodes.

**Tasks:**
- [ ] Set up Qdrant locally: `docker run -d -p 6333:6333 qdrant/qdrant`
- [ ] Create collections using reference: `qdrant_client_reference.py` → create `semantic_facts`, `episodes` collections
- [ ] `constitution/store.py` — extend `builder.py` with:
  - `store_facts(facts, user_id, tenant_id)` → embed each fact with sentence-transformers → upsert to Qdrant
  - `get_facts(user_id)` → search Qdrant, return facts grouped by category
  - `search_ownership(filepath)` → semantic search `semantic_facts` where predicate="owns" and object contains filepath
  - `add_episode(user_id, incident_summary)` → store in `episodes` collection
- [ ] Expose via FastAPI in `main.py`:
  - `GET /constitution/{agent_id}` → `store.get_facts(agent_id)`
  - `PATCH /constitution/{agent_id}` → `store.add_episode()`
  - `POST /constitution/store` → bulk store facts (called after `POST /agents`)
- [ ] Pre-populate 3 demo agent constitutions in Qdrant (hardcoded facts for Alice, Bob, Carol for demo reliability)
- [ ] Update `ownership_router` in incident graph to call `store.search_ownership()` instead of the mock HTTP call

**Key code from reference:**
```python
# embeddings_reference.py pattern
from sentence_transformers import SentenceTransformer
_model = SentenceTransformer("all-MiniLM-L6-v2")
def embed_text(text: str) -> list[float]:
    return _model.encode(text).tolist()
```

**Deliverable:** `POST /agents` fully creates an agent with real Qdrant storage. Ownership queries return real results.

---

### Person 3 — GitHub Integration (Issue + Code + PR)
**Base off:** `backend/ingestion/github_ingest.py` (written) — extend with issue/PR logic

**Goal:** The GitHub layer — read issues, read code files, push PRs. This is the "wow" that makes it real.

**File to create:**
```
backend/ingestion/github_issue.py
```

**Tasks:**
- [ ] `read_issue(issue_url)` → parse `owner/repo#number` or full URL, return `{title, body, repo_name, issue_number, author}`
- [ ] `read_repo_files(repo_name, filepaths)` → given a list of file paths, return `{filepath: content}` dict using GitHub API
- [ ] `create_fix_pr(repo_name, issue_number, patch_diff, fix_explanation, pr_body_style)`:
  - Create new branch: `aubi/fix-issue-{number}`
  - Apply the diff to the right file(s) using GitHub Contents API
  - Create commit: `fix: resolve {issue_title} (closes #{issue_number})`
  - Open PR with auto-generated body (written in primary owner's communication style)
  - Add reviewers (owner_ids mapped to GitHub handles)
  - Return PR URL
- [ ] `POST /github/issue` endpoint in `main.py` — accepts `{issue_url}` → triggers the full graph
- [ ] `GET /github/poll` — polls a configured repo for new issues every 30 sec (for live demo: open an issue during demo, AUBI auto-picks it up)
- [ ] Pre-prep demo repo: a public GitHub repo with a planted bug that Claude can find and fix deterministically

**Key code:**
```python
from github import Github, GithubException
from github.InputGitAuthor import InputGitAuthor
import base64

def create_fix_pr(repo_name, issue_number, file_path, new_content, commit_msg, pr_title, pr_body):
    g = Github(os.getenv("GITHUB_TOKEN"))
    repo = g.get_repo(repo_name)

    # Get base branch SHA
    base = repo.get_branch("main")
    branch_name = f"aubi/fix-issue-{issue_number}"

    # Create branch
    repo.create_git_ref(f"refs/heads/{branch_name}", base.commit.sha)

    # Update file
    contents = repo.get_contents(file_path, ref="main")
    repo.update_file(
        contents.path, commit_msg, new_content,
        contents.sha, branch=branch_name,
        author=InputGitAuthor("Aubi Bot", "aubi@cognoxent.ai"),
    )

    # Open PR
    pr = repo.create_pull(
        title=pr_title, body=pr_body,
        head=branch_name, base="main",
        issue=repo.get_issue(issue_number),
    )
    return pr.html_url
```

**Deliverable:** Given a GitHub issue URL, system reads the code, generates a fix, and pushes a real PR. Works end-to-end in the demo.

---

### Person 4 — Frontend: Full Demo UI
**Base off:** `cognoxent/apps/aubi-web` (Next.js 16 + Tailwind + shadcn/ui)

**Goal:** Three views that tell the demo story visually. The agent comm feed is the centrepiece.

**Pages/components:**

```
/team                 ← Agent cards (Scene 1)
/issue-feed           ← Live issue watcher (Scene 2)
/aubi-comms           ← Agent communication + fix + PR (Scenes 3-5)
```

**Tasks:**

**`/team` page:**
- [ ] `AgentCard` — GitHub avatar, name, role, expertise tag pills, code ownership badges, collaboration style blurb
- [ ] `ConstitutionPanel` — expandable drawer showing all constitution facts grouped by category, confidence bars
- [ ] "Memory version N · Updated 2 min ago" footer on each card
- [ ] Animated connection lines between cards (SVG) showing the agent mesh

**`/issue-feed` panel (embedded on `/aubi-comms`):**
- [ ] Polls `GET /github/poll` every 5 seconds
- [ ] New issue appears with slide-in animation: repo icon + issue title + author + "🔴 Open"
- [ ] "AUBI is on it" badge appears after 1 second with a loading spinner

**`/aubi-comms` page (main demo view):**
- [ ] Left panel: **Agent Comm Feed** — the centrepiece
  - Each message is a chat bubble: agent avatar (colored per agent) + name + message text
  - Bubbles animate in from left/right depending on sender
  - Orchestrator = center/top, agents on sides
  - Shows agent thinking (animated "..." before each message appears)
  - Color coded: Orchestrator = indigo, Alice = emerald, Bob = amber, Carol = rose
- [ ] Center panel: **Code Diff** (shows up after code_reader node)
  - Syntax-highlighted diff view (use `react-syntax-highlighter` or `shiki`)
  - Removed lines red, added lines green
  - File name + line numbers
- [ ] Right panel: **PR Preview**
  - Mockup GitHub PR card: title, branch name, "Draft → Ready" badge
  - PR body rendered as markdown
  - Reviewers section with avatars
  - "Push Fix →" button (calls `POST /incidents/run` or auto-pushes)
  - After push: actual GitHub PR link appears with confetti animation
- [ ] SSE wiring: `EventSource` on `/incidents/stream` → route each event to the right panel:
  - `agent_consultor` events → Agent Comm Feed
  - `code_reader` done → Code Diff panel
  - `fix_generator` done → PR Preview panel
  - `pr_pusher` done → real PR URL + confetti

**Deliverable:** Demo-ready UI. Judges see agents chatting, code being fixed, PR being pushed — all in one view, in real time.

---

## Timeline (updated for new flow)

| Time | What |
|---|---|
| **9:00–9:30** | Install deps. Spin up Qdrant docker. Agree API contracts. Person 3: create demo GitHub repo with planted bug. |
| **9:30–11:30** | Parallel build. Person 2 gets Qdrant working first (others depend on it). |
| **11:30–12:00** | Integration #1: Graph SSE → frontend. Hardcoded agent contexts OK for now. |
| **12:00–1:00** | Full pipeline: real GitHub issue → graph → draft PR (no actual push yet). |
| **1:00–1:30** | Lunch |
| **1:30–2:30** | Person 3: actual PR push working. Person 4: agent comm animation polished. |
| **2:30–4:00** | Full demo rehearsal 3x. Tune prompts so fix quality is good. |
| **4:00–5:00** | Deploy. Record demo video. |
| **5:00–7:00** | DevPost write-up + submit. |

---

## Prep: Demo Repo Setup (Person 3, do at 9:00am)

Create a public GitHub repo: `AUBI-Demo` with a planted bug:

```go
// auth/token.go — buggy version (race condition)
func (c *TokenCache) GetOrRefresh(userID string) (string, error) {
    if cached := c.cache[userID]; cached != "" {
        return cached, nil   // BUG: no mutex — race condition under concurrent load
    }
    token, err := c.refreshToken(userID)
    if err != nil {
        return "", err
    }
    c.cache[userID] = token
    return token, nil
}
```

Pre-register Alice as the owner of `auth/` in the demo. When the graph runs `fix_generator`, Claude will see the race condition from Alice's constitution context and generate the correct mutex fix. This makes the demo deterministic.

---

## API Contracts

```
POST /github/issue               body: {issue_url} → triggers full graph, returns stream_id
GET  /incidents/stream           query: issue_url → SSE stream
POST /incidents/run              body: {issue_url} → blocking, returns {slack_msg, pr_url, patch}

GET  /agents                     → [{id, name, role, expertise[], code_ownership[]}]
GET  /agents/{id}                → full agent + grouped constitution
POST /agents                     → body: {github_username, name, role}
POST /agents/{id}/query          → body: {incident_text} → agent context

GET  /constitution/{id}          → facts grouped by category
PATCH /constitution/{id}         → body: {fact} → append fact
POST /constitution/store         → body: {user_id, tenant_id, facts[]}

GET  /ownership                  → query: filepath → {owner_agent_id, confidence}
GET  /github/poll                → returns latest open issue on demo repo
GET  /health
```

---

## SSE Event Format (Person 1 emits, Person 4 consumes)

```jsonc
// Graph node lifecycle
{"event": "node_start",  "node": "issue_reader",    "data": null}
{"event": "node_done",   "node": "issue_reader",    "data": {"title": "401 errors...", "repo": "..."}}
{"event": "node_start",  "node": "ownership_router", "data": null}
{"event": "node_done",   "node": "ownership_router", "data": {"owners": ["alice_id", "bob_id"]}}

// Agent comms (new — generated by agent_consultor)
{"event": "agent_message", "data": {
  "sender":    "orchestrator",
  "recipient": "alice_aubi",
  "message":   "New issue: auth 401 after deploy. Is this yours?",
  "timestamp": 1714150000
}}
{"event": "agent_message", "data": {
  "sender":    "alice_aubi",
  "recipient": "orchestrator",
  "message":   "Yes — this matches the race condition in auth/token.go I've been tracking.",
  "timestamp": 1714150003
}}

// Code + fix
{"event": "node_done",   "node": "code_reader",      "data": {"files": {"auth/token.go": "..."}}}
{"event": "node_done",   "node": "fix_generator",     "data": {"diff": "...", "explanation": "..."}}
{"event": "node_done",   "node": "pr_pusher",         "data": {"pr_url": "https://github.com/..."}}

// Terminal
{"event": "complete", "data": null}
```

---

## Environment Variables

```bash
ANTHROPIC_API_KEY=sk-ant-...     # Claude Sonnet + Haiku
GITHUB_TOKEN=ghp_...             # GitHub PAT (needs repo write access for PR push)
DEMO_REPO=your-org/AUBI-Demo    # the repo with the planted bug
KNOWLEDGE_SERVICE_URL=http://localhost:8002
QDRANT_URL=http://localhost:6333
```

---

## Quick Start

```bash
# 1. Qdrant
docker run -d -p 6333:6333 qdrant/qdrant

# 2. Backend
cd backend
python3.11 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env   # fill in keys
uvicorn main:app --port 8000 --reload

# 3. Frontend
cd /Users/intern/Desktop/xFoundry/aubi/cognoxent/apps/aubi-web
npm install && npm run dev
```

---

## What Makes This Win

1. **Complete autonomous loop** — issue filed by a human → agents communicate → code fixed → PR pushed, zero manual intervention
2. **Agent-to-agent communication is visible** — not a black box, judges see the Aubis talking in real time
3. **Context Constitution is the differentiator** — the agents know who owns what and why because they learned it
4. **Real output** — an actual GitHub PR with a real diff, not a mock
5. **Story arc** — Prof files issue → students' assignment unblocked → all in 90 seconds
6. **Research-grounded** — Letta Context Constitution + MemGPT memory blocks + OpenAgents mesh
