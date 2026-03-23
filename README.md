<p align="center">
  <img src="docs/images/clyde-banner.png" alt="Project Clyde — Clyde Corp HQ" width="100%" />
</p>

<h1 align="center">Project Clyde — Early Access</h1>

<p align="center">
  <strong>Your personal AI workforce, powered by the Claude Agent SDK.</strong><br/>
  Multi-agent system with delegated sub-agents, persistent memory, and self-improving prompts.
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Next.js-16-black?style=for-the-badge&logo=next.js" alt="Next.js 16" />
  <img src="https://img.shields.io/badge/FastAPI-009688?style=for-the-badge&logo=fastapi&logoColor=white" alt="FastAPI" />
  <img src="https://img.shields.io/badge/Claude_Agent_SDK-191919?style=for-the-badge&logo=anthropic&logoColor=white" alt="Claude Agent SDK" />
  <img src="https://img.shields.io/badge/React-19-61DAFB?style=for-the-badge&logo=react&logoColor=black" alt="React 19" />
</p>

---

## What is Project Clyde?

Clyde is a multi-agent AI system where a lead agent delegates tasks to specialised sub-agents, remembers past conversations, and improves its own prompts over time. Think of it as a virtual AI team that works for you.

The Early Access build includes a CLI setup wizard that handles everything — credentials, database deployment, dependencies, and launch — so you can go from clone to running in under five minutes.

---

## Key Features

| Feature | Description |
|---|---|
| **Agent Delegation** | Lead agent routes tasks to specialised sub-agents automatically |
| **Persistent Memory** | Conversations are stored with vector embeddings for semantic recall |
| **Self-Improving Prompts** | Agents refine their own system prompts over time |
| **Activity Feed** | Real-time visibility into what each agent is doing |
| **Permission System** | Approve or deny tool use before agents act |
| **Org Chart** | Visual agent hierarchy with live status indicators and team grouping |
| **Skills Dashboard** | Create and assign prompt extensions to agents, lazy-loaded for efficiency |
| **Task Board (Kanban)** | Drag-and-drop board with columns, agent assignment, and document linking |
| **File Browser** | Explore the working directory, upload files, and reference them in chat with `@` |
| **Cost Tracking** | Per-agent cost breakdown with daily, weekly, and monthly aggregates |
| **Schedules & Triggers** | Cron-based automation and file-watch triggers for hands-off agent runs |
| **Performance Analytics** | Track agent response times and success rates with charts |
| **Proactive Insights** | Automated analysis that surfaces recommendations and optimisations |
| **APIs & Webhooks** | Full CRUD integration manager — assign external APIs to agents |
| **Workflows** | Team-scoped, multi-stage processes stored as JSON definitions |
| **Global Search (Cmd+K)** | Vector similarity search across all conversations |
| **Debug Mode** | Collapsible prompt viewer showing system prompts and agent instructions |
| **Cost-Saving Mode** | CLI toggle to default to Sonnet/Haiku for lower-cost operation |
| **Brutalist UI** | Dark theme with acid-green accents — built different |

---

## Tech Stack

```
Frontend     Next.js 16  ·  React 19  ·  Tailwind v4  ·  Zustand  ·  Motion  ·  Recharts
Backend      FastAPI  ·  Claude Agent SDK  ·  Supabase  ·  OpenAI  ·  APScheduler
Infra        WebSocket (real-time)  ·  Vector search (pgvector)  ·  File watchers
CLI          Node.js  ·  Interactive setup wizard  ·  Secure credential input
```

---

## Prerequisites

| Requirement | Version | Check |
|---|---|---|
| **Node.js** | 20+ | `node --version` |
| **Python** | 3.10+ | `python3 --version` |
| **Git** | Any recent | `git --version` |

The CLI checks these automatically and will let you know if anything is missing.

You'll also need accounts (all have free tiers):

| Service | What it's for | Where to sign up |
|---|---|---|
| **Supabase** | Database | [supabase.com](https://supabase.com) |
| **Anthropic** | AI agents | [console.anthropic.com](https://console.anthropic.com) |
| **OpenAI** | Message search / embeddings | [platform.openai.com](https://platform.openai.com) |

---

## Quick Start

### 1. Clone the repo

```bash
git clone https://github.com/noeltg77/Project-Clyde-EA.git
cd Project-Clyde-EA
```

### 2. Run the CLI

```bash
npm run clyde
```

That's it. On first run, the CLI walks you through everything — credentials, database setup, dependency installation — then starts the app and opens your browser.

Every run after that just launches the app.

### What the Setup Wizard Does

When you run `npm run clyde` for the first time (no `.env.local` file), the CLI will:

1. **Check prerequisites** — verifies Node.js 20+, Python 3.10+, and Git are installed
2. **Collect credentials** — prompts for your Supabase, Anthropic, and OpenAI keys (passwords are masked)
3. **Choose cost mode** — toggle between Opus/Sonnet (full power) or Sonnet/Haiku (cost-saving) defaults
4. **Generate `.env.local`** — writes your config file with all the right values (never committed to git)
5. **Deploy the database schema** — connects directly to your Supabase Postgres instance and creates all tables, functions, and indexes automatically
6. **Install dependencies** — runs `npm install` for the frontend and sets up a Python virtual environment with all backend packages
7. **Create the working directory** — sets up the folder structure for agent configs, prompts, memory, and logs
8. **Launch the app** — starts both the backend (port 8000) and frontend (port 3020), then opens your browser

All credentials are stored locally in `.env.local` and are never transmitted anywhere except directly to your own services.

### Before You Run — Have These Ready

The setup wizard will ask for:

1. **Supabase Project URL** — looks like `https://abcdefgh.supabase.co` (Dashboard > Settings > API)
2. **Supabase Anon Key** — a long string starting with `eyJ` (same page)
3. **Supabase Service Role Key** — another `eyJ` string (click the eye icon to reveal)
4. **Supabase Database Password** — the password you set when creating the project
5. **Anthropic API Key** — starts with `sk-ant-` ([console.anthropic.com/settings/keys](https://console.anthropic.com/settings/keys))
6. **OpenAI API Key** — starts with `sk-` ([platform.openai.com/api-keys](https://platform.openai.com/api-keys))

> **Tip:** If you haven't created a Supabase project yet, go to [supabase.com](https://supabase.com), click **New Project**, pick a name, set a strong database password (save it!), choose a region, and wait about a minute for it to spin up.

---

## Verify Your Setup

Once the app opens in your browser:

1. Click the **Settings** icon (gear icon)
2. Under the **System** tab, check that the status indicators show green dots next to:
   - Anthropic API Key
   - Supabase Connection
   - OpenAI API Key
3. If any show red, check the corresponding values in your `.env.local` file, then restart with `npm run clyde`

Once all three are green, close settings and create your first chat session.

---

## Day-to-Day Usage

```bash
npm run clyde
```

This starts both the backend and frontend, with colour-coded logs in your terminal. Press `Ctrl+C` to stop everything.

You can also run the services individually if you prefer separate terminals:

| Command | Description |
|---|---|
| `npm run clyde` | Start everything (recommended) |
| `npm run dev:frontend` | Start only the frontend (port 3020) |
| `npm run dev:backend` | Start only the backend (port 8000) |
| `npm run lint` | Lint check |

---

## Project Structure

```
Project-Clyde-EA/
├── cli/               CLI setup wizard and app launcher
│   └── clyde.js       Entry point for `npm run clyde`
├── db/                Database schema
│   └── schema.sql     Idempotent SQL (safe to re-run)
├── frontend/          Next.js web interface (port 3020)
├── backend/           FastAPI server + AI agents (port 8000)
├── working/           Runtime data (registry, prompts, memory, workflows)
├── docs/              Documentation and images
├── .env.example       Template for environment variables
└── .env.local         Your local config (not committed to git)
```

---

## Manual Setup (Alternative)

If you prefer to set things up step by step instead of using the CLI wizard:

<details>
<summary><strong>Click to expand manual setup steps</strong></summary>

### 1. Set Up Supabase

1. Create a project at [supabase.com](https://supabase.com)
2. In the dashboard, click **SQL Editor** > **New query**
3. Copy the contents of `db/schema.sql` and paste them into the editor
4. Click **Run** — you should see "Success. No rows returned"

### 2. Configure Environment Variables

```bash
cp .env.example .env.local
```

Open `.env.local` and fill in each value:

```env
# Anthropic — https://console.anthropic.com/settings/keys
ANTHROPIC_API_KEY=sk-ant-paste-your-key-here

# Supabase — Dashboard > Settings > API
NEXT_PUBLIC_SUPABASE_URL=https://your-project-id.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=paste-your-anon-key-here
SUPABASE_SERVICE_ROLE_KEY=paste-your-service-role-key-here

# OpenAI — https://platform.openai.com/api-keys
OPENAI_API_KEY=sk-proj-paste-your-key-here

# Backend (leave these as-is)
BACKEND_URL=http://localhost:8000
NEXT_PUBLIC_BACKEND_WS_URL=ws://localhost:8000

# Working directory — replace with the actual path on YOUR computer
WORKING_DIR=/full/path/to/Project-Clyde-EA/working
```

To find your full path for `WORKING_DIR`:

```bash
echo "$(pwd)/working"
```

### 3. Install the Frontend

```bash
cd frontend && npm install && cd ..
```

### 4. Install the Backend

```bash
cd backend && python3 -m venv .venv && source .venv/bin/activate && pip install -r requirements.txt && cd ..
```

### 5. Start the App

**Terminal 1 — Backend:**
```bash
cd backend && source .venv/bin/activate && bash run.sh
```

**Terminal 2 — Frontend:**
```bash
cd frontend && npm run dev
```

Open **http://localhost:3020** and verify all status indicators are green in **Settings**.

</details>

---

## Troubleshooting

<details>
<summary><strong>"Cannot connect to backend"</strong></summary>

Make sure the backend is running. If using `npm run clyde`, check the terminal for backend errors (prefixed with `[backend]` in teal). If running manually, verify you see `Uvicorn running on http://127.0.0.1:8000`.
</details>

<details>
<summary><strong>Database schema deployment failed</strong></summary>

- **Connection refused** — check your Supabase URL is correct and the project is active
- **Password authentication failed** — reset your database password in Supabase Dashboard > Settings > Database
- **Already exists** — this is fine; the schema is idempotent and safe to re-run
</details>

<details>
<summary><strong>"Module not found" in backend</strong></summary>

If running manually, activate the virtual environment first:
```bash
source .venv/bin/activate
```
If using `npm run clyde`, the CLI handles this automatically.
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
<summary><strong>Red dots in Settings</strong></summary>

Check `.env.local` for: no extra spaces around `=`, no quotes around values, keys fully pasted. Restart with `npm run clyde` after editing.
</details>

---

<p align="center">
  Built by <a href="https://github.com/noeltg77">Make Automations</a> · Powered by <a href="https://www.anthropic.com">Anthropic</a>
</p>
