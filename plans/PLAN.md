# AUBI — Autonomous Understanding & Behaviour Inference
### GDSC Hackathon 2026 · UMD · April 26

**Target prizes:** Best App for Developer Productivity · Best Use of Gemini

---

## The Idea

Every dev team leaks knowledge constantly. Onboarding takes weeks because tribal knowledge lives in people's heads. Incidents spiral because no one knows who owns what. Stand-ups repeat the same context every day.

AUBI gives every developer on a team a persistent AI co-worker agent. Each agent builds a **Context Constitution** — a living, structured model of how that developer thinks, what they own, and how they collaborate. Agents share this context with each other. When something goes wrong (P1 incident, unclear ownership, blocked PR), the agent mesh self-organizes: routes to the right person, surfaces the right context, drafts the right response.

Inspired by:
- **Letta's Context Constitution** — agents manage their own context as a first-class concern, using memory blocks (persona, human, work, collaboration)
- **MemGPT** — agents that read/write their own memory rather than relying on fixed retrieval
- **OpenAgents + Milvus** — distributed agent networks with shared semantic vector memory, no central orchestrator

---

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    AUBI Agent Mesh                       │
│                                                         │
│  Dev A Agent          Dev B Agent          Dev C Agent  │
│  ┌──────────┐         ┌──────────┐         ┌──────────┐ │
│  │ Persona  │         │ Persona  │         │ Persona  │ │
│  │ Work     │◄───────►│ Work     │◄───────►│ Work     │ │
│  │ Collab   │         │ Collab   │         │ Collab   │ │
│  │ Team     │         │ Team     │         │ Team     │ │
│  └────┬─────┘         └────┬─────┘         └────┬─────┘ │
│       │                    │                    │        │
│       └────────────────────┼────────────────────┘        │
│                            │                             │
│              ┌─────────────▼──────────────┐             │
│              │   Shared Vector Memory      │             │
│              │  (Firestore + embeddings)   │             │
│              │  • past incidents           │             │
│              │  • code ownership map       │             │
│              │  • cross-agent queries      │             │
│              └─────────────────────────────┘             │
└─────────────────────────────────────────────────────────┘
                            │
              ┌─────────────▼──────────────┐
              │       AgentOps Layer        │
              │  • incident trigger         │
              │  • auto-route to owner      │
              │  • draft response + postmortem │
              │  • self-learning loop       │
              └─────────────────────────────┘
```

### Context Constitution (per agent)

Each agent maintains structured memory blocks (inspired by MemGPT/Letta):

```json
{
  "persona": {
    "name": "Alice Chen",
    "role": "Senior Backend Engineer",
    "team": "Payments",
    "expertise": ["Go", "PostgreSQL", "Kafka", "distributed systems"]
  },
  "work": {
    "code_ownership": ["auth/", "billing/", "api/gateway/"],
    "current_focus": "Refactoring retry logic in payment pipeline",
    "known_issues": ["auth token race condition on mobile"],
    "upcoming": "Q3 payment gateway migration"
  },
  "collaboration": {
    "communication_pref": "async, needs specifics before asking",
    "review_style": "thorough, prefers small PRs",
    "availability": "9am-6pm EST, P1 only after hours",
    "how_to_engage": "lead with error + stack trace, not open questions"
  },
  "team": {
    "shared_context": "Team is mid-migration from monolith to microservices",
    "shared_pain": "Flaky tests in CI blocking releases"
  }
}
```

### Self-Learning Loop

After each incident resolves:
1. Gemini summarizes what happened, who was right to page, what the fix was
2. Relevant agents update their `work` and `collaboration` memory blocks
3. The incident + resolution is embedded and stored in shared vector memory
4. Next similar incident: agents retrieve this context before routing

---

## Demo Flow (judges see this)

**Setup:** 3 developer cards on screen, each with their auto-generated constitution pulled from GitHub

**Trigger:** User pastes a Slack thread:
> "prod is down, payment service throwing 500s, no idea why, started ~20 min ago"

**Watch the agents work:**
1. Incident analyzer agent reads the message, queries shared memory for similar past incidents
2. Code ownership agent checks git blame on payment service → "This is Alice's territory"
3. Alice's agent is queried: "Payment service 500s, here are the logs — relevant to you?"
4. Alice's agent responds with context from her constitution: "Yes, this matches the retry logic issue I've been tracking. Root cause likely X. Here's the fix direction."
5. Response drafted, Slack message auto-written in Alice's communication style
6. Postmortem skeleton generated, action items assigned per each person's constitution

**Total time on screen: ~15 seconds**

---

## Tech Stack

| Component | Technology |
|---|---|
| Primary AI | Gemini 2.5 Pro (constitution building, incident analysis) |
| Agent queries | Gemini 2.5 Flash (fast agent-to-agent) |
| Backend | Python + FastAPI |
| Frontend | React + Vite |
| Agent state | Firebase Firestore |
| Vector memory | Firebase + Gemini embeddings (or Milvus lite) |
| GitHub ingestion | GitHub REST API |
| Deployment | Google Cloud Run |
| Dev | Google AI Studio for prompt engineering |

---

## Team Division of Work

### Person 1 — Agent Core & Constitution Builder
**Goal:** Build the brain of each agent — ingests GitHub data, builds the Context Constitution, manages memory blocks.

**Tasks:**
- [ ] Set up Python FastAPI project, install `google-generativeai`, `firebase-admin`, `PyGithub`
- [ ] GitHub ingestion: pull commits, PRs, code reviews, file ownership for a given user
- [ ] Gemini 2.5 Pro prompt: `GitHub data → Context Constitution JSON`
- [ ] Memory block CRUD: read/write persona, work, collaboration, team blocks to Firestore
- [ ] Constitution update endpoint: `POST /agents/{id}/update-memory`
- [ ] Self-learning endpoint: `POST /agents/reflect` — Gemini summarizes a resolved incident and patches relevant memory blocks

**Deliverable:** REST API that, given a GitHub username, returns a full Context Constitution and persists it to Firestore.

---

### Person 2 — Multi-Agent Orchestration & AgentOps
**Goal:** Build the agent mesh — how agents query each other, the incident router, and the postmortem generator.

**Tasks:**
- [ ] Agent registry: list of active agents and their constitutions (read from Firestore)
- [ ] Agent-to-agent query: `POST /agents/{id}/query` — ask an agent if something is in their domain; agent responds using its constitution as context
- [ ] Incident intake: `POST /incidents` — accepts raw Slack thread / error message
- [ ] Incident router: Gemini reads incident + all constitutions, identifies which agent(s) to involve, with reasoning
- [ ] Response drafter: Gemini drafts the Slack response in the style defined in the relevant agent's collaboration block
- [ ] Postmortem generator: structured markdown postmortem auto-filled from incident + agent responses
- [ ] Orchestration loop: incident → route → query relevant agents → gather context → draft response → update memory

**Deliverable:** `POST /incidents` endpoint that accepts a pasted Slack thread and returns: routing decision, drafted response, postmortem skeleton.

---

### Person 3 — Integrations & Data Pipeline
**Goal:** Wire up real data sources so the demo uses real GitHub data. Build the shared vector memory.

**Tasks:**
- [ ] GitHub API wrapper: given a list of GitHub usernames, pull their commit history, PRs authored, files touched, review comments (last 90 days)
- [ ] Code ownership map: parse git log to build `file_path → primary_owner` map
- [ ] Gemini embeddings: embed constitutions + past incidents using `text-embedding-004`
- [ ] Firebase vector store: store embeddings with metadata (agent_id, type, timestamp)
- [ ] Semantic retrieval: `query_shared_memory(text) → top-k relevant past incidents/constitutions`
- [ ] Slack mock: simple webhook receiver or just a UI text box that simulates pasting a Slack thread
- [ ] Pre-load 3 demo developer profiles from real public GitHub repos for the demo

**Deliverable:** Working data pipeline + semantic memory retrieval that the orchestration layer can call.

---

### Person 4 — Frontend Dashboard
**Goal:** Make it look incredible. Judges need to see the agents working in real time.

**Tasks:**
- [ ] React + Vite setup, Tailwind for styling
- [ ] **Agent Cards view:** 3 developer cards, each showing:
  - Profile photo (from GitHub)
  - Expertise tags
  - Code ownership areas
  - Current focus
  - Collaboration style snippet
- [ ] **Incident Console:** text box to paste a Slack thread / incident message, big "Trigger Incident" button
- [ ] **Live Agent Activity Feed:** real-time stream showing agents being queried, responding, context being pulled — like a chat between agents
- [ ] **Incident Response Panel:** shows the drafted Slack message + postmortem side by side
- [ ] **Memory Update Toast:** after incident resolves, show which memory blocks were updated on which agents
- [ ] Polish: dark theme, animated agent "thinking" state, smooth transitions

**Deliverable:** Full React app connected to the FastAPI backend, demo-ready with pre-loaded data.

---

## Timeline

| Time | Milestone |
|---|---|
| 9:00–9:30 | Everyone sets up dev environment, shares API keys, agree on API contracts |
| 9:30–11:00 | Each person builds their core piece (parallel) |
| 11:00–11:30 | Integration checkpoint — Person 1 + 2 connect; Person 3 + 4 connect |
| 11:30–1:00 | Full pipeline working end-to-end with mock data |
| 1:00–1:30 | Lunch |
| 1:30–3:00 | Replace mock data with real GitHub data; polish the demo flow |
| 3:00–4:30 | Full demo run-through, fix bugs, handle edge cases |
| 4:30–5:30 | UI polish, deploy to Cloud Run |
| 5:30–6:30 | Record demo video, write DevPost description |
| 6:30–7:00 | Submit |

---

## API Contract (agree on this in the first 30 min)

```
# Person 1 exposes:
GET  /agents                          → list all agents + constitutions
GET  /agents/{id}                     → get one agent's full constitution
POST /agents/{id}/build               → trigger constitution build from GitHub username
POST /agents/{id}/update-memory       → patch specific memory blocks
POST /agents/reflect                  → post-incident self-learning update

# Person 2 exposes:
POST /agents/{id}/query               → ask agent if something is in their domain
POST /incidents                       → trigger incident flow, returns full response

# Person 3 exposes:
POST /ingest/github/{username}        → pull GitHub data for a user
GET  /memory/search?q={text}          → semantic search shared vector memory
GET  /ownership/{filepath}            → who owns this file?
```

---

## Environment Variables Needed

```bash
GEMINI_API_KEY=            # Google AI Studio key
GITHUB_TOKEN=              # GitHub personal access token
FIREBASE_PROJECT_ID=       # Firebase project
GOOGLE_APPLICATION_CREDENTIALS=  # Firebase service account JSON path
```

---

## What Makes This Win

1. **Novel concept:** Agent-to-agent communication with behavioral constitutions — not just "chatbot with tools"
2. **Research-grounded:** Directly inspired by Letta's Context Constitution + MemGPT memory blocks + OpenAgents distributed mesh
3. **Gemini-native:** Uses Gemini 2.5 Pro for long-context constitution building, Flash for fast agent queries, embeddings for shared memory — not a wrapper
4. **Demo is magic:** 15 seconds from "prod is down" to full coordinated response
5. **Story that sells:** "Every org loses knowledge constantly. AUBI makes it immortal and actionable."

---

## Stretch Goals (if time allows)

- [ ] Voice input for incident trigger (Gemini audio)
- [ ] Actual Slack webhook integration
- [ ] Constitution diff view: "Here's what the agent learned today"
- [ ] Agent health score: how complete/confident is each constitution?
- [ ] Multi-team simulation with cross-team agent queries
