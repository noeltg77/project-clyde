# Project Clyde

A multi-agent AI system built on the Claude Agent SDK. Clyde is your personal AI assistant that can delegate tasks to specialised sub-agents, remember past conversations, and improve its own prompts over time.

---

## What You'll Need

Before you start, make sure you have the following installed on your computer:

| Requirement | Version | How to check |
|---|---|---|
| **Node.js** | 20 or higher | Run `node --version` in your terminal |
| **Python** | 3.10 or higher | Run `python3 --version` in your terminal |
| **Git** | Any recent version | Run `git --version` in your terminal |

You'll also need accounts (all have free tiers) for:

- **Anthropic** — powers the AI agents ([console.anthropic.com](https://console.anthropic.com))
- **OpenAI** — used for message search/embeddings ([platform.openai.com](https://platform.openai.com))
- **Supabase** — the database ([supabase.com](https://supabase.com))

---

## Step 1: Clone the Repository

Open your terminal and run:

```bash
git clone https://github.com/YOUR_USERNAME/project-clyde.git
cd project-clyde
```

---

## Step 2: Set Up Supabase (Free Database)

Supabase is a hosted database service. You'll create a free project and then run some SQL to set up the tables Clyde needs.

### 2.1 — Create a Supabase Account

1. Go to [supabase.com](https://supabase.com) and click **Start your project**
2. Sign up with your GitHub account (or email)
3. Once logged in, click **New Project**
4. Fill in the details:
   - **Name:** anything you like (e.g. `project-clyde`)
   - **Database Password:** pick a strong password and save it somewhere safe
   - **Region:** choose the one closest to you
5. Click **Create new project** and wait for it to finish setting up (takes about 1 minute)

### 2.2 — Get Your Supabase Keys

Once your project is ready:

1. In the Supabase dashboard, click **Settings** (gear icon) in the left sidebar
2. Click **API** under the Configuration section
3. You'll see three things you need — keep this page open, you'll copy these values in Step 3:
   - **Project URL** — looks like `https://abcdefgh.supabase.co`
   - **anon public key** — a long string starting with `eyJ`
   - **service_role secret key** — another long string starting with `eyJ` (click the eye icon to reveal it)

### 2.3 — Run the Database Setup SQL

Now you need to create the tables. In your Supabase dashboard:

1. Click **SQL Editor** in the left sidebar
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

If you see any errors, make sure you copied the entire block from the very first line (`create extension`) to the very last line.

---

## Step 3: Set Up Your Environment Variables

Environment variables are how the app knows your API keys and database details. These are stored in a file that stays on your machine and is never uploaded to GitHub.

1. In the root `project-clyde` folder, copy the example file:

```bash
cp .env.example .env.local
```

2. Open `.env.local` in any text editor and fill in each value:

```env
# Anthropic — get your key from https://console.anthropic.com/settings/keys
ANTHROPIC_API_KEY=sk-ant-paste-your-key-here

# Supabase — from Step 2.2 above
NEXT_PUBLIC_SUPABASE_URL=https://your-project-id.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=paste-your-anon-key-here
SUPABASE_SERVICE_ROLE_KEY=paste-your-service-role-key-here

# OpenAI — get your key from https://platform.openai.com/api-keys
OPENAI_API_KEY=sk-proj-paste-your-key-here

# Backend (leave these as-is)
BACKEND_URL=http://localhost:8000
NEXT_PUBLIC_BACKEND_WS_URL=ws://localhost:8000

# Working directory — replace with the actual path on YOUR computer
WORKING_DIR=/full/path/to/project-clyde/working
```

To find your full path for `WORKING_DIR`, run this in your terminal from the project folder:

```bash
echo "$(pwd)/working"
```

Copy the output and paste it as the `WORKING_DIR` value.

---

## Step 4: Install the Frontend

```bash
cd frontend
npm install
```

This will download all the JavaScript dependencies. It may take a minute or two.

---

## Step 5: Install the Backend

Open a **new terminal window** (keep the first one open) and run:

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

**What this does:**
- Creates an isolated Python environment (so it doesn't affect other Python projects)
- Activates that environment
- Installs all the Python libraries Clyde needs

---

## Step 6: Start the App

You need **two terminal windows** running at the same time.

**Terminal 1 — Backend:**

```bash
cd backend
source .venv/bin/activate
bash run.sh
```

You should see output like:
```
INFO:     Uvicorn running on http://127.0.0.1:8000
INFO:     Started reloader process
```

**Terminal 2 — Frontend:**

```bash
cd frontend
npm run dev
```

You should see output like:
```
▲ Next.js 16.x.x
- Local: http://localhost:3020
```

Now open your browser and go to **http://localhost:3020**

---

## Step 7: Add Your API Keys in Settings

Before you create your first chat session, you need to verify your API keys are connected:

1. Open Clyde in your browser at `http://localhost:3020`
2. Click the **Settings** icon (gear icon)
3. Under the **System** tab, check that the status indicators show green dots next to:
   - Anthropic API Key
   - Supabase Connection
   - OpenAI API Key
4. If any show red, double-check the corresponding values in your `.env.local` file and restart both terminals

Once all three are green, close settings and create your first chat session.

---

## Project Structure

```
project-clyde/
├── frontend/          Next.js web interface (port 3020)
├── backend/           FastAPI server + AI agents (port 8000)
├── supabase/          Database migration files (reference only)
├── working/           Runtime data (agent registry, prompts, memory)
├── .env.example       Template for environment variables
└── .env.local         Your local config (not committed to git)
```

---

## Common Issues

### "Cannot connect to backend"
Make sure the backend is running in its own terminal. Check that you see the `Uvicorn running on http://127.0.0.1:8000` message.

### "Module not found" errors in the backend
Make sure you activated the virtual environment first:
```bash
source .venv/bin/activate
```

### "node: command not found" or wrong Node version
Install Node.js 20+ from [nodejs.org](https://nodejs.org). Pick the LTS version.

### "python3: command not found"
- **Mac:** Run `brew install python3` (requires [Homebrew](https://brew.sh))
- **Windows:** Download from [python.org](https://www.python.org/downloads/) and make sure to check "Add to PATH" during install
- **Linux:** Run `sudo apt install python3 python3-venv`

### Supabase SQL errors
Make sure you copied the entire SQL block. The most common issue is missing the first line (`create extension if not exists vector with schema extensions;`) — this enables the vector search feature that Clyde relies on.

### Red dots in Settings
This means one or more API keys are missing or incorrect. Open `.env.local` and check:
- No extra spaces around the `=` sign
- No quotes around the values
- Keys are pasted completely (no missing characters)

After editing `.env.local`, restart both the backend and frontend.

---

## Stopping the App

Press `Ctrl+C` in each terminal window to stop the frontend and backend.

---

## Useful Commands

| Command | What it does |
|---|---|
| `npm run dev` | Start the frontend (from `frontend/` folder) |
| `bash run.sh` | Start the backend (from `backend/` folder) |
| `npm run build` | Build the frontend for production |
| `npm run lint` | Check frontend code for errors |
