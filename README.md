<p align="center">
  <img src="docs/images/clyde-banner.png" alt="Project Clyde — Clyde Corp HQ" width="100%" />
</p>

<h1 align="center">Project Clyde</h1>

<p align="center">
  <strong>Your personal AI workforce, powered by the Claude Agent SDK.</strong><br/>
  Multi-agent system with delegated sub-agents, persistent memory, and self-improving prompts.
</p>

<p align="center">
  <a href="https://www.patreon.com/cw/ProjectClyde">
    <img src="https://img.shields.io/badge/Patreon-Support%20Project%20Clyde-ff424d?style=for-the-badge&logo=patreon&logoColor=white" alt="Support on Patreon" />
  </a>
  &nbsp;
  <img src="https://img.shields.io/badge/Next.js-15-black?style=for-the-badge&logo=next.js" alt="Next.js 15" />
  <img src="https://img.shields.io/badge/FastAPI-009688?style=for-the-badge&logo=fastapi&logoColor=white" alt="FastAPI" />
  <img src="https://img.shields.io/badge/Claude_Agent_SDK-191919?style=for-the-badge&logo=anthropic&logoColor=white" alt="Claude Agent SDK" />
</p>

---

## What is Project Clyde?

Clyde is a multi-agent AI system where a lead agent delegates tasks to specialised sub-agents, remembers past conversations, and improves its own prompts over time. Think of it as a virtual AI team that works for you.

> **Early access & exclusive updates** — Patreon members get access to early dev builds, vote on the roadmap, and get behind-the-scenes updates as the project evolves.
>
> <a href="https://www.patreon.com/cw/ProjectClyde"><strong>Join on Patreon &rarr;</strong></a>

---

## Key Features

| Feature | Description |
|---|---|
| **Agent Delegation** | Lead agent routes tasks to specialised sub-agents automatically |
| **Persistent Memory** | Conversations are stored with vector embeddings for semantic recall |
| **Self-Improving Prompts** | Agents refine their own system prompts over time |
| **Activity Feed** | Real-time visibility into what each agent is doing |
| **Permission System** | Approve or deny tool use before agents act |
| **Brutalist UI** | Dark theme with acid-green accents — built different |

---

## Tech Stack

```
Frontend     Next.js 15  ·  Tailwind v4  ·  Zustand  ·  Motion
Backend      FastAPI  ·  Claude Agent SDK  ·  Supabase  ·  OpenAI
Infra        WebSocket (real-time)  ·  Vector search (pgvector)
```

---

## Prerequisites

| Requirement | Version | Check |
|---|---|---|
| **Node.js** | 20+ | `node --version` |
| **Python** | 3.10+ | `python3 --version` |
| **Git** | Any recent | `git --version` |

You'll also need accounts (all have free tiers):

- **Anthropic** — powers the AI agents ([console.anthropic.com](https://console.anthropic.com))
- **OpenAI** — message search & embeddings ([platform.openai.com](https://platform.openai.com))
- **Supabase** — the database ([supabase.com](https://supabase.com))

---

## Quick Start

### 1. Clone the repo

```bash
git clone https://github.com/noeltg77/project-clyde.git
cd project-clyde
```

### 2. Set up Supabase

#### 2.1 — Create a Supabase project

1. Go to [supabase.com](https://supabase.com) and click **Start your project**
2. Sign up with GitHub (or email)
3. Click **New Project** and fill in:
   - **Name:** `project-clyde` (or anything you like)
   - **Database Password:** pick a strong one and save it
   - **Region:** closest to you
4. Click **Create new project** and wait ~1 minute

#### 2.2 — Get your keys

1. In the Supabase dashboard, go to **Settings** > **API**
2. Note these three values (you'll need them in step 3):
   - **Project URL** — `https://abcdefgh.supabase.co`
   - **anon public key** — starts with `eyJ`
   - **service_role secret key** — click the eye icon to reveal

#### 2.3 — Run the database setup SQL

1. Click **SQL Editor** in the sidebar
2. Click **New query**
3. Copy and paste the **entire** SQL block below into the editor
4. Click **Run** (or press Ctrl+Enter / Cmd+Enter)
5. You should see "Success. No rows returned" — that means it worked

```sql
-- ============================================
-- Project Clyde: Database Setup
-- Run this entire block in the Supabase SQL Editor
-- ============================================

-- Enable the vector extension (required for message search)
create extension if not exists vector with schema extensions;

-- ============================================
-- Chat Sessions
-- ============================================
create table public.chat_sessions (
  id uuid primary key default gen_random_uuid(),
  title text not null default 'New Chat',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  metadata jsonb default '{}'::jsonb
);

create index idx_chat_sessions_updated_at on public.chat_sessions (updated_at desc);

create or replace function update_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger trg_chat_sessions_updated_at
  before update on public.chat_sessions
  for each row execute function update_updated_at();

-- ============================================
-- Chat Messages (with vector embeddings)
-- ============================================
create table public.chat_messages (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.chat_sessions(id) on delete cascade,
  role text not null check (role in ('user', 'clyde', 'agent')),
  agent_id text,
  agent_name text,
  content text not null,
  embedding extensions.vector(1536),
  token_count integer default 0,
  cost_usd numeric(10, 6) default 0,
  metadata jsonb default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index idx_chat_messages_session_id on public.chat_messages (session_id, created_at);

create index idx_chat_messages_embedding on public.chat_messages
  using hnsw (embedding extensions.vector_cosine_ops)
  with (m = 16, ef_construction = 64);

-- ============================================
-- System Prompt History
-- ============================================
create table public.system_prompt_history (
  id uuid primary key default gen_random_uuid(),
  agent_id text not null,
  previous_version text,
  new_version text not null,
  reason text,
  changed_by text not null check (changed_by in ('clyde', 'user')),
  created_at timestamptz not null default now()
);

create index idx_system_prompt_history_agent on public.system_prompt_history (agent_id, created_at desc);

-- ============================================
-- Vector Similarity Search Function
-- ============================================
create or replace function match_chat_messages(
  query_embedding extensions.vector(1536),
  match_threshold float default 0.7,
  match_count int default 10,
  filter_session_id uuid default null
)
returns table (
  id uuid,
  session_id uuid,
  role text,
  agent_name text,
  content text,
  similarity float,
  created_at timestamptz
)
language plpgsql
as $$
begin
  return query
  select
    cm.id,
    cm.session_id,
    cm.role,
    cm.agent_name,
    cm.content,
    (1 - (cm.embedding <=> query_embedding))::float as similarity,
    cm.created_at
  from public.chat_messages cm
  where
    cm.embedding is not null
    and (1 - (cm.embedding <=> query_embedding)) > match_threshold
    and (filter_session_id is null or cm.session_id = filter_session_id)
  order by cm.embedding <=> query_embedding
  limit match_count;
end;
$$;

-- ============================================
-- Activity Events (agent activity feed)
-- ============================================
create table if not exists activity_events (
  id uuid primary key default gen_random_uuid(),
  session_id uuid references chat_sessions(id) on delete cascade,
  agent_id text not null,
  agent_name text not null,
  event_type text not null,
  description text,
  metadata jsonb default '{}',
  created_at timestamptz default now()
);

-- ============================================
-- Permission Log (tool permission decisions)
-- ============================================
create table if not exists permission_log (
  id uuid primary key default gen_random_uuid(),
  session_id uuid references chat_sessions(id) on delete cascade,
  agent_id text,
  agent_name text,
  tool_name text not null,
  tool_input jsonb,
  decision text not null,
  decided_at timestamptz default now()
);

create index if not exists idx_activity_events_session
  on activity_events(session_id, created_at desc);

create index if not exists idx_permission_log_session
  on permission_log(session_id);

-- ============================================
-- Proactive Insights
-- ============================================
create table if not exists public.proactive_insights (
  id uuid primary key default gen_random_uuid(),
  insight_type text not null,
  title text not null,
  description text not null,
  severity text not null default 'info',
  data jsonb default '{}',
  status text not null default 'pending',
  snoozed_until timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_proactive_insights_status
  on proactive_insights(status, created_at desc);

create index if not exists idx_proactive_insights_type
  on proactive_insights(insight_type);

create or replace function update_proactive_insights_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger trg_proactive_insights_updated_at
  before update on proactive_insights
  for each row
  execute function update_proactive_insights_updated_at();
```

> **If you see any errors**, make sure you copied the entire block from the very first line (`create extension`) to the very last line.

### 3. Configure environment variables

```bash
cp .env.example .env.local
```

Open `.env.local` and fill in your keys:

```env
# Anthropic — https://console.anthropic.com/settings/keys
ANTHROPIC_API_KEY=sk-ant-paste-your-key-here

# Supabase — from step 2.2
NEXT_PUBLIC_SUPABASE_URL=https://your-project-id.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=paste-your-anon-key-here
SUPABASE_SERVICE_ROLE_KEY=paste-your-service-role-key-here

# OpenAI — https://platform.openai.com/api-keys
OPENAI_API_KEY=sk-proj-paste-your-key-here

# Backend (leave as-is)
BACKEND_URL=http://localhost:8000
NEXT_PUBLIC_BACKEND_WS_URL=ws://localhost:8000

# Working directory — run: echo "$(pwd)/working"
WORKING_DIR=/full/path/to/project-clyde/working
```

### 4. Install dependencies

```bash
# Frontend
cd frontend && npm install && cd ..

# Backend
cd backend && python3 -m venv .venv && source .venv/bin/activate && pip install -r requirements.txt && cd ..
```

### 5. Start the app

You need **two terminals** running simultaneously:

**Terminal 1 — Backend:**
```bash
cd backend && source .venv/bin/activate && bash run.sh
```

**Terminal 2 — Frontend:**
```bash
cd frontend && npm run dev
```

Open **http://localhost:3020** and verify all status indicators are green in **Settings**.

---

## Project Structure

```
project-clyde/
├── frontend/          Next.js web interface (port 3020)
├── backend/           FastAPI server + AI agents (port 8000)
├── supabase/          Database migration files
├── working/           Runtime data (registry, prompts, memory)
├── docs/              Documentation and images
├── .env.example       Template for environment variables
└── .env.local         Your local config (not committed)
```

---

## Useful Commands

| Command | Description |
|---|---|
| `npm run dev` | Start frontend (from `frontend/`) |
| `bash run.sh` | Start backend (from `backend/`) |
| `npm run build` | Production build |
| `npm run lint` | Lint check |

---

## Troubleshooting

<details>
<summary><strong>"Cannot connect to backend"</strong></summary>

Make sure the backend terminal shows `Uvicorn running on http://127.0.0.1:8000`. Restart with `bash run.sh` if needed.
</details>

<details>
<summary><strong>"Module not found" in backend</strong></summary>

Activate the virtual environment first:
```bash
source .venv/bin/activate
```
</details>

<details>
<summary><strong>Wrong Node.js version</strong></summary>

Install Node.js 20+ from [nodejs.org](https://nodejs.org) (LTS).
</details>

<details>
<summary><strong>"python3: command not found"</strong></summary>

- **Mac:** `brew install python3`
- **Windows:** Download from [python.org](https://www.python.org/downloads/) — check "Add to PATH"
- **Linux:** `sudo apt install python3 python3-venv`
</details>

<details>
<summary><strong>Supabase SQL errors</strong></summary>

Make sure you copied the entire SQL block including the first line: `create extension if not exists vector with schema extensions;`
</details>

<details>
<summary><strong>Red dots in Settings</strong></summary>

Check `.env.local` for: no extra spaces around `=`, no quotes around values, keys fully pasted. Restart both terminals after editing.
</details>

---

## Support the Project

<p align="center">
  <a href="https://www.patreon.com/cw/ProjectClyde">
    <img src="https://img.shields.io/badge/Become%20a%20Patron-Support%20Project%20Clyde-ff424d?style=for-the-badge&logo=patreon&logoColor=white" alt="Become a Patron" />
  </a>
</p>

<p align="center">
  Early dev builds &nbsp;·&nbsp; Exclusive updates &nbsp;·&nbsp; Shape the roadmap
</p>

---

<p align="center">
  Built by <a href="https://github.com/noeltg77">Make Automations</a> · Powered by <a href="https://www.anthropic.com">Anthropic</a>
</p>
