<div align="center">

<img src="./Logo.png" width="110" alt="AUBI logo" />



### AUBI - Autonomous Understanding and Behaviour Inference

**A context layer for autonomous software engineering: persistent AI coworkers that understand ownership, share team memory, coordinate fixes, and turn GitHub issues into human-approved pull requests.**

![Next.js](https://img.shields.io/badge/Next.js-14-black)
![FastAPI](https://img.shields.io/badge/FastAPI-backend-009688)
![LangGraph](https://img.shields.io/badge/LangGraph-agent_graph-5B5BD6)
![Qdrant](https://img.shields.io/badge/Qdrant-vector_memory-DC244C)
![GitHub](https://img.shields.io/badge/GitHub-issues_to_PRs-181717)
![Railway](https://img.shields.io/badge/Railway-backend-0B0D0E)
![Vercel](https://img.shields.io/badge/Vercel-frontend-000000)

GDSC Hackathon 2026 - University of Maryland

</div>

---

## Technical Thesis

AI coding is no longer bottlenecked only by "can the model write code?"

The harder bottleneck is **context orchestration**.

In real teams, the best fix depends on organizational memory: who owns a system, who recently touched nearby files, what broke before, which edge cases matter, and which teammate would know the risk. Most coding agents flatten all of that into one prompt. AUBI turns it into a first-class system layer.

```mermaid
flowchart TD
    incomingIssue["GitHub issue"] --> contextLayer["AUBI context layer"]

    subgraph contextLayerBox["Context layer"]
        constitutions["Context Constitutions"]
        semanticMemory["Qdrant semantic memory"]
        ownerRouting["Ownership routing"]
        coworkerExchange["Coworker context exchange"]
        considerations["Should-check considerations"]
    end

    contextLayer --> constitutions
    constitutions --> semanticMemory
    semanticMemory --> ownerRouting
    ownerRouting --> coworkerExchange
    coworkerExchange --> considerations

    considerations --> codePatch["Patch generation"]
    codePatch --> verification["Verification"]
    verification --> humanApproval["Human approval"]
    humanApproval --> pullRequest["GitHub PR"]
    pullRequest --> memoryWriteback["Memory writeback"]
    memoryWriteback --> semanticMemory
```

**AUBI is the missing layer between a codebase and a coding agent.** It makes autonomous development team-aware, explainable, and memory-backed.

---

## Why AUBI Exists

Modern coding agents are impressive at generating patches, but production software work usually fails earlier: the agent does not know the team.

On a real engineering team, a developer does not fix an issue by only reading one file. They bring years of context:

- who owns the affected area,
- who recently changed nearby code,
- what previous incidents looked similar,
- what tests or edge cases the team already learned to care about,
- what should be checked before opening a PR.

That knowledge usually lives in people, commit history, PR discussions, and memory. It is not cleanly available to a single coding agent.

AUBI makes that layer explicit. Every developer gets a persistent AI coworker backed by a **Context Constitution**: a living memory of that person's ownership, expertise, collaboration style, current focus, known issues, and resolved incidents.

Instead of one generic bot guessing, AUBI asks the right coworker AUBI first, lets related coworker AUBIs share context, and only then generates a fix.

The result is an issue-to-PR system that can explain:

```text
why this owner was selected
what team memory was used
which coworkers contributed context
what the generated fix changed
which checks passed
what memory was learned for next time
```

---

## What AUBI Does

AUBI turns a GitHub issue into a human-approved pull request through a live, explainable coworker workflow.

```mermaid
flowchart LR
    issueNode["GitHub issue"] --> incidentNode["Incident understanding"]
    incidentNode --> ownerNode["Owner AUBI selected"]
    ownerNode --> meshNode["Coworkers exchange context"]
    meshNode --> sourceNode["Live repo files read"]
    sourceNode --> patchNode["Patch generated"]
    patchNode --> testNode["Tests run"]
    testNode --> approvalNode["Human approval gate"]
    approvalNode --> prNode["PR opened"]
    prNode --> learnNode["Memory updated"]
```

| Step | What happens |
|---|---|
| **Issue intake** | AUBI loads a live GitHub issue or accepts an issue URL like `owner/repo#123`. |
| **Incident understanding** | The backend extracts affected files, service area, error type, severity, and likely fix direction. |
| **Ownership routing** | Qdrant memory and filepath evidence select the coworker AUBI most likely to own the issue. |
| **Coworker context exchange** | Related AUBIs are consulted for adjacent context, previous fixes, risks, and should-check items. |
| **Code reading** | AUBI reads the relevant files from the target GitHub repository. |
| **Patch generation** | The fix is generated using the issue, owner constitution, coworker context, shared memory, and source files. |
| **Verification** | For Go repos, AUBI applies the generated file in a temp checkout and runs `go test ./...`. |
| **Approval gate** | The graph pauses until a human approves the PR push. |
| **PR creation** | AUBI pushes a branch and opens a GitHub PR linked to the issue. |
| **Learning loop** | The resolved incident is stored back into user and team memory for future retrieval. |

In short: **AUBI is not a chat assistant. It is a context-aware coworker mesh for moving issues from signal to reviewed PR.**

### The core loop

| Phase | AUBI's job | Why it matters |
|---|---|---|
| **Understand** | Convert a GitHub issue into service, file, error, and risk signals. | Prevents patching before the problem is framed. |
| **Route** | Select the most relevant coworker AUBI from ownership and semantic memory. | Gets the right developer context into the run. |
| **Exchange** | Ask adjacent coworkers for prior incidents, constraints, and checks. | Recreates how real teams solve problems through context sharing. |
| **Fix** | Generate code using issue context, source files, owner memory, and coworker memory. | Makes the patch grounded in both code and team knowledge. |
| **Verify** | Apply the patch and run repository tests where supported. | Keeps the demo tied to executable behavior. |
| **Approve** | Pause before PR creation. | Keeps humans in control of repository writes. |
| **Learn** | Store the resolved episode back into Qdrant. | Makes the next incident smarter. |

---

## What Judges Should Notice

| Signal | Why it is impressive |
|---|---|
| **Developer-shaped coworkers** | The system represents Vitthal-AUBI, Avhaan-AUBI, Neilyoo98-AUBI, and Mitanshcodes-AUBI as persistent coworkers instead of generic bots. |
| **Context before code** | AUBI explains who owns the issue, why they were selected, and what related coworkers contributed before generating a fix. |
| **Live coworker mesh** | The UI shows AUBIs exchanging context, retrieving shared memory, and flagging considerations that affect the generated patch. |
| **Real repository integration** | Issues, file reads, verification, branches, and PR creation are wired to GitHub instead of being a static mock. |
| **Human approval gate** | AUBI stops before pushing a PR and waits for explicit approval. |
| **Learning loop** | Approved work becomes future user and team memory in Qdrant. |

---

## Demo Script

1. Open **Team** to show each coworker's Context Constitution.
2. Open **Coworkers** to show the mesh of developer AUBIs and their ownership relationships.
3. Open **Flow**, choose a live issue from `Neilyoo98/AUBI-demo`, and run AUBI.
4. Watch the issue move through routing, coworker exchange, code read, fix generation, tests, and approval.
5. Click **Approve PR Push**.
6. Open **War Room** to explain why the routing happened, which memory was used, which considerations were handled, and what got written back.

The strongest moment is the chain:

```text
GitHub issue -> owner evidence -> coworker context -> generated diff -> verification -> approval -> PR -> memory update
```

---

## Product Surface

| Page | Purpose |
|---|---|
| **Team** | Card-based view of each AUBI coworker's constitution: expertise, ownership, style, memory age, and fact count. |
| **Coworkers** | Relationship graph showing how AUBI coworkers connect through ownership, expertise, collaboration, current focus, and known issues. |
| **Flow** | Operator view for running an issue-to-PR workflow with progress, diff, approval state, PR preview, and live agent messages. |
| **War Room** | Explanation layer: live context exchange, shared memory hits, considerations, coworker map, and reasoning trace for the same run. |

---

## Architecture

```mermaid
flowchart LR
    subgraph frontendBox["Next.js frontend"]
        teamView["Team view"]
        coworkerView["Coworkers graph"]
        flowView["Flow operator view"]
        warRoomView["War Room explanation"]
        apiProxy["Next.js API proxy"]
    end

    subgraph backendBox["FastAPI backend"]
        agentRegistry["Agent registry"]
        incidentGraph["LangGraph incident graph"]
        githubIngest["GitHub ingestion"]
        eventStream["SSE event stream"]
    end

    subgraph contextBox["AUBI context layer"]
        constitutionBuilder["Constitution builder"]
        ownershipRouter["Ownership router"]
        coworkerProtocol["Coworker exchange protocol"]
        memoryWriter["Memory writeback"]
    end

    subgraph memoryBox["Qdrant memory"]
        semanticFacts["semantic_facts"]
        episodeStore["episodes"]
        teamStore["team-scoped memory"]
    end

    subgraph githubBox["GitHub"]
        ghIssues["Issues"]
        ghFiles["Repository files"]
        ghBranch["Fix branch"]
        ghPr["Pull request"]
    end

    teamView --> apiProxy
    coworkerView --> apiProxy
    flowView --> apiProxy
    warRoomView --> apiProxy

    apiProxy --> agentRegistry
    apiProxy --> incidentGraph
    incidentGraph --> eventStream
    eventStream --> flowView
    eventStream --> warRoomView

    agentRegistry --> githubIngest
    githubIngest --> constitutionBuilder
    constitutionBuilder --> semanticFacts

    incidentGraph --> ownershipRouter
    ownershipRouter <--> semanticFacts
    ownershipRouter <--> episodeStore
    ownershipRouter --> coworkerProtocol
    coworkerProtocol <--> teamStore
    coworkerProtocol --> incidentGraph
    incidentGraph --> memoryWriter
    memoryWriter --> episodeStore
    memoryWriter --> teamStore

    incidentGraph <--> ghIssues
    incidentGraph <--> ghFiles
    incidentGraph --> ghBranch
    incidentGraph --> ghPr
```

---

## Issue-to-PR Graph

The backend uses LangGraph to model a real workflow with state, fan-out, streaming events, and an approval interrupt.

```mermaid
flowchart TD
    A["issue_reader"] --> B["ownership_router"]
    B --> C["query_single_agent fan-out"]
    C --> D["coworker_mesh_exchange"]
    D --> E["code_reader"]
    E --> F["fix_generator"]
    F --> G["test_runner"]
    G --> H{"approval_gate"}
    H -- approved --> I["pr_pusher"]
    H -- rejected --> J["end"]
    I --> K["memory writeback"]
    K --> J

    M[(Qdrant)] <--> B
    M <--> C
    M <--> D
    K --> M
    GH[(GitHub)] <--> A
    GH <--> E
    I --> GH
```

| Node | What it does |
|---|---|
| `issue_reader` | Reads the issue or pasted incident and extracts title, body, service, error type, and likely affected files. |
| `ownership_router` | Searches Qdrant and file-path evidence to select likely owner coworkers. |
| `query_single_agent` | Fans out to owner AUBIs and asks what their constitution knows. |
| `coworker_mesh_exchange` | Selects adjacent coworkers using ownership, expertise, current focus, known issues, collaboration, and shared-memory overlap. |
| `code_reader` | Resolves missing paths and reads live source files from GitHub. |
| `fix_generator` | Uses the issue, owner context, coworker context, memory, and source files to produce a patch. |
| `test_runner` | Applies generated files in a temporary checkout and runs verification, including `go test ./...` for Go repos. |
| `approval_gate` | Pauses the graph with a LangGraph interrupt until the UI approves or rejects. |
| `pr_pusher` | Pushes a branch, opens a PR, links the issue, and writes resolved episodes back to memory. |

---

## Context Constitution

Every AUBI coworker is backed by structured memory derived from GitHub activity and incident outcomes.

```mermaid
flowchart LR
    activity["GitHub commits, PRs, issues"] --> builder["constitution builder"]
    builder --> facts["structured facts"]
    facts --> qdrant[(Qdrant)]
    qdrant --> routing["ownership routing"]
    qdrant --> prompts["coworker prompts"]
    qdrant --> exchange["coworker exchange"]
    qdrant --> warroom["war room evidence"]
    approved["approved PR outcome"] --> episodes["episode memory"]
    episodes --> qdrant
```

| Memory block | Example use |
|---|---|
| `code_ownership` | "Vitthal-AUBI owns auth/token.go and auth-related backend work." |
| `expertise` | "Avhaan-AUBI is strong in frontend, TypeScript, and UI implementation." |
| `collaboration` | "This coworker tends to validate changes through tests before PRs." |
| `current_focus` | "Recent commits show active work in frontend routes and dashboard components." |
| `known_issues` | "Prior auth token cache bugs involved concurrent map access." |
| `episodes` | "Issue #1 was fixed by guarding TokenCache and verifying Go tests." |

Memory is stored in two Qdrant collections:

| Collection | Scope | Purpose |
|---|---|---|
| `semantic_facts` | User and team | Ownership, expertise, collaboration, current focus, known issues. |
| `episodes` | User and team | Resolved incidents and PR outcomes that should influence future runs. |

---

## The Context Layer We Built

AUBI's main technical layer is the bridge between individual developer memory and a shared coworker network.

It is made of four parts:

```mermaid
flowchart TD
    A["1. Constitution Builder"] --> B["2. Semantic Memory Store"]
    B --> C["3. Ownership Router"]
    C --> D["4. Coworker Context Exchange"]
    D --> E["Patch + Test + Approval"]
    E --> F["Memory Writeback"]
    F --> B

    A1["GitHub activity"] --> A
    A2["Commits, files, languages, PR patterns"] --> A
    B1["user-scoped facts"] --> B
    B2["team-scoped episodes"] --> B
    D1["peer AUBI messages"] --> D
    D2["shared memory hits"] --> D
```

| Layer | What it owns |
|---|---|
| **Constitution Builder** | Converts GitHub activity into stable facts about a developer's ownership, expertise, current focus, collaboration style, and known issues. |
| **Semantic Memory Store** | Stores those facts and incident episodes in Qdrant with tenant, team, user, scope, category, and predicate metadata. |
| **Ownership Router** | Combines affected files, issue text, semantic search, and profile facts to pick the coworker AUBI that should lead. |
| **Coworker Context Exchange** | Selects adjacent AUBIs and asks them for relevant context before code generation. |
| **Memory Writeback** | Turns approved PR outcomes into future user and team episodes. |

### Constitution Fact Shape

Each memory item is stored as a structured semantic fact:

```json
{
  "subject": "Vitthal-Agarwal",
  "predicate": "owns",
  "object": "auth/ directory and auth/token.go in Neilyoo98/AUBI-demo",
  "category": "code_ownership",
  "confidence": 0.92
}
```

The backend adds operational metadata before writing to Qdrant:

| Field | Why it matters |
|---|---|
| `tenant_id` | Keeps hackathon/demo memory isolated. |
| `scope` | Separates `user` memory from `team` memory. |
| `scope_id` | Enables filtered retrieval for a specific coworker or shared team. |
| `category` | Lets the router favor ownership, expertise, current focus, known issues, and collaboration facts differently. |
| `predicate` | Makes facts queryable as human-readable relationships instead of opaque chunks. |

### Coworker Communication Protocol

When an issue starts, AUBI does not simply retrieve top-k chunks and write code. It runs a small communication protocol:

```mermaid
sequenceDiagram
    participant O as AUBI Orchestrator
    participant Owner as Owner AUBI
    participant Peer as Related AUBI
    participant Team as Team Memory
    participant Repo as GitHub Repo

    O->>Team: Search prior episodes and ownership facts
    Team-->>O: Candidate owners + related memories
    O->>Owner: "Is this your domain?"
    Owner-->>O: Ownership answer + first checks
    O->>Peer: "Do you have adjacent context?"
    Peer->>Team: Retrieve matching shared memory
    Team-->>Peer: Similar prior fixes and risks
    Peer-->>O: Context, why it matters, and should-check items
    O->>Repo: Read files only after context is assembled
    O-->>O: Generate patch with checks as constraints
```

Each coworker exchange carries:

| Payload | Used by |
|---|---|
| `requester` and `responder` | War Room and Flow visualizations. |
| `reason` | Explains why that coworker was consulted. |
| `selection_signals` | Shows whether the match came from ownership, expertise, current focus, known issues, collaboration, or shared-memory overlap. |
| `context_shared` | Feeds the fix generator and War Room explanation. |
| `should_check` | Becomes the visible considerations checklist against the generated patch. |
| `shared_memory_hits` | Proves the answer came from persistent team memory, not just the current prompt. |

This is the layer that makes AUBI feel like a team of persistent coworkers instead of one stateless coding assistant.

### Retrieval Path

```mermaid
flowchart LR
    issue["Issue title/body/files"] --> signals["Issue signals"]
    signals --> ownerSearch["Owner search"]
    signals --> teamSearch["Team memory search"]
    ownerSearch --> owner["Lead coworker AUBI"]
    teamSearch --> related["Related coworker AUBIs"]
    owner --> exchange["Context exchange"]
    related --> exchange
    exchange --> constraints["Fix constraints + checks"]
    constraints --> patch["Generated patch"]
```

The frontend exposes this path in two ways:

| View | What it proves |
|---|---|
| **Flow** | The operational state: progress, patch, tests, approval, and PR readiness. |
| **War Room** | The reasoning state: human signal, owner routing, coworker exchange, memory impact, considerations, and live trace. |

---

## Coworker Mesh

AUBI does not use a single central bot to hallucinate context. It routes through coworker AUBIs.

```mermaid
sequenceDiagram
    participant O as AUBI Orchestrator
    participant V as Vitthal-AUBI
    participant N as Neilyoo98-AUBI
    participant A as Avhaan-AUBI
    participant M as Qdrant Memory
    participant G as GitHub

    O->>M: Search ownership and prior episodes
    M-->>O: Owner and related coworker evidence
    O->>V: Is this issue in your domain?
    V-->>O: Owner context and fix direction
    V->>N: Ask for adjacent memory
    N->>M: Retrieve related team memory
    M-->>N: Similar prior incident
    N-->>V: Risk, checks, and test considerations
    O->>G: Read affected files
    O-->>O: Generate patch and considerations
    O-->>G: Push PR only after approval
```

The War Room makes this visible. It shows:

- Which AUBI asked which coworker for context.
- Why that coworker was selected.
- Which shared memory was used.
- Which considerations were addressed by the generated fix.
- What got written back after the run.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | Next.js 14, React 18, TypeScript, Tailwind CSS, Framer Motion |
| Backend | FastAPI, Python, LangGraph, LangChain OpenAI |
| Memory | Qdrant Cloud or local Qdrant |
| Embeddings | Sentence Transformers `all-MiniLM-L6-v2` for local 384-d vectors |
| LLM | OpenAI-compatible chat model configured with `OPENAI_MODEL` |
| GitHub | PyGithub plus Git CLI for issue reads, source reads, branch creation, and PRs |
| Streaming | Server-Sent Events from FastAPI to Next.js |
| Deployment | Railway backend, Vercel frontend |

---

## Repository Map

```text
backend/
  main.py                         FastAPI app, API routes, SSE stream, approval resume
  graphs/
    incident_graph.py             LangGraph issue-to-PR workflow
    state.py                      Graph state schema
    sse_events.py                 Event mapping for the frontend
    prompt_builder.py             Context-aware prompt assembly
  constitution/
    builder.py                    GitHub profile data -> Context Constitution facts
    store.py                      Qdrant semantic facts, episodes, team memory
  ingestion/
    github_ingest.py              Developer profile ingestion from GitHub
    github_issue.py               Issue reads, file reads, PR creation

frontend/
  src/app/team/page.tsx           Team constitution cards
  src/app/agents/page.tsx         Coworker mesh visualization
  src/app/demo/page.tsx           Flow page
  src/app/incident/page.tsx       War Room explanation page
  src/components/aubi/*           AUBI-specific panels and visualizations
  src/hooks/useIncidentStream.ts  SSE run state and approval integration
  src/lib/api.ts                  Frontend API client
  src/lib/warRoomState.ts         Shared run snapshot between Flow and War Room
```

---

## API Surface

| Endpoint | Purpose |
|---|---|
| `POST /agents` | Create an AUBI coworker from a GitHub username and persist its constitution. |
| `GET /agents` | List coworker AUBIs from memory and Qdrant. |
| `GET /agents/{agent_id}` | Fetch one coworker and its constitution. |
| `DELETE /agents/{agent_id}` | Delete a coworker and associated constitution records. |
| `POST /agents/{agent_id}/query` | Ask a coworker's constitution about an incident. |
| `GET /constitution/{agent_id}` | Fetch grouped constitution facts. |
| `PATCH /constitution/{agent_id}` | Add or update a constitution fact. |
| `GET /constitution/team` | Query shared team memory. |
| `POST /constitution/team` | Write shared team facts or episodes. |
| `GET /ownership?filepath=...` | Resolve likely owner for a path. |
| `GET /github/poll` | Fetch latest open issue from `TARGET_REPO`. |
| `GET /github/issues` | List open issues for the target repo. |
| `POST /incidents/run` | Run the graph as a blocking request. |
| `GET /incidents/stream` | Run the graph and stream SSE events. |
| `POST /incidents/approve` | Resume a paused graph and approve or reject PR creation. |
| `GET /health` | Basic health check. |
| `GET /ready` | Configuration and dependency readiness check. |

---

## Local Setup

### 1. Backend

```bash
cd backend
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
```

Fill in:

```bash
OPENAI_API_KEY=...
OPENAI_BASE_URL=https://us.api.openai.com/v1
OPENAI_MODEL=gpt-5.5
OPENAI_CONSTITUTION_MODEL=gpt-5.4-mini

GITHUB_TOKEN=...
TARGET_REPO=Neilyoo98/AUBI-demo
TARGET_REPOS=Neilyoo98/AUBI-demo,Neilyoo98/GDSC-Hackathon

AUBI_TENANT_ID=hackathon
AUBI_TEAM_ID=default

QDRANT_URL=https://your-qdrant-cloud-url
QDRANT_API_KEY=...
```

Run:

```bash
uvicorn main:app --reload --port 8000
```

Check:

```bash
curl http://localhost:8000/ready
```

### 2. Frontend

```bash
cd frontend
npm install
cp .env.example .env.local
```

Set:

```bash
NEXT_PUBLIC_BACKEND_URL=http://localhost:8000
BACKEND_URL=http://localhost:8000
```

Run:

```bash
npm run dev
```

Open:

- `http://localhost:3000/team`
- `http://localhost:3000/agents`
- `http://localhost:3000/demo`
- `http://localhost:3000/incident`

---

## Deployment

### Railway Backend

The backend is deployed from the root using `railway.toml` and `backend/Dockerfile`.

```toml
[build]
dockerfilePath = "backend/Dockerfile"

[deploy]
startCommand = "sh -c 'uvicorn main:app --host 0.0.0.0 --port ${PORT:-8000} --workers 1'"
healthcheckPath = "/health"
```

Use one worker for the demo deployment so the in-memory LangGraph checkpointer can preserve interrupted approval threads inside the process.

### Vercel Frontend

`vercel.json` points Vercel at the `frontend` directory:

```json
{
  "framework": "nextjs",
  "rootDirectory": "frontend",
  "buildCommand": "npm run build",
  "outputDirectory": ".next",
  "installCommand": "npm install",
  "devCommand": "npm run dev"
}
```

Set:

```bash
NEXT_PUBLIC_BACKEND_URL=https://your-railway-backend
BACKEND_URL=https://your-railway-backend
```

---

## Why This Is Different From Plain RAG

| Plain RAG assistant | AUBI |
|---|---|
| Retrieves chunks from a codebase. | Retrieves developer ownership, team memory, known issues, and resolved episodes. |
| Usually acts as one assistant. | Models multiple developer AUBIs that exchange context. |
| Often hides why a patch was chosen. | Shows owner routing, coworker messages, memory hits, and considerations. |
| Ends at generated code. | Continues through tests, approval, PR creation, and memory writeback. |
| Forgets after the chat. | Writes incident outcomes back into persistent Qdrant memory. |

---

## Hackathon Scope

Implemented:

- GitHub issue picker and issue polling.
- Qdrant-backed user and team memory.
- Context Constitution ingestion from GitHub activity.
- Coworker routing and coworker mesh exchange.
- SSE streaming into Flow and War Room.
- Patch generation from live repository files.
- Go verification path with `go test ./...`.
- Human approval before PR push.
- GitHub PR creation and memory writeback.
- Railway backend and Vercel frontend configuration.

Next:

- More language-specific test runners.
- Persistent external LangGraph checkpointing for multi-worker production deployments.
- Reviewer assignment and PR comment automation.
- Richer memory evaluation and decay rules.
- Slack/Discord ingestion for collaboration memory.

---

<div align="center">

**AUBI is AI that knows the team, not just the codebase.**

</div>
