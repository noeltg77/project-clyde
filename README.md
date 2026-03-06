# Project Clyde

A multi-agent AI system built on the Claude Agent SDK. Clyde is your personal AI assistant that can delegate tasks to specialised sub-agents, remember past conversations, and improve its own prompts over time.

---

## Features

- **Multi-agent chat** — Clyde orchestrates a team of specialised sub-agents, delegating work and streaming responses in real time
- **Org chart** — Visualise the agent hierarchy with live status indicators
- **Skills dashboard** — Browse and manage agent capabilities
- **File browser** — Explore the working directory, upload files, and reference them in chat with `@`
- **Task board (Kanban)** — Drag-and-drop kanban board with customisable columns (Draft, Not Started, In Progress, Complete). Create tasks manually or let Clyde generate them during chat. Assign tasks to agents or yourself, link documents, and watch the board update live as work progresses
- **Cost tracking** — Per-agent cost breakdown with daily, weekly, and monthly aggregates
- **Schedules & triggers** — Automate agent runs with cron schedules or file-watch triggers
- **Performance analytics** — Track agent response times and success rates
- **Proactive insights** — Automated analysis that surfaces recommendations and optimisation opportunities
- **System prompt management** — Version-controlled prompt editing with rollback support
- **Global search** — Vector similarity search across all conversations (Cmd+K)

---

## Quick Start

```bash
git clone https://github.com/noeltg77/Project-Clyde-EA.git
cd Project-Clyde-EA
npm run clyde
```

That's it. On first run, the CLI walks you through everything — credentials, database setup, dependency installation — then starts the app and opens your browser.

Every run after that just launches the app.

---

## What You'll Need

### Prerequisites

| Requirement | Version | How to check |
|---|---|---|
| **Node.js** | 20 or higher | Run `node --version` in your terminal |
| **Python** | 3.10 or higher | Run `python3 --version` in your terminal |
| **Git** | Any recent version | Run `git --version` in your terminal |

The CLI checks these automatically and will let you know if anything is missing.

### Accounts (all have free tiers)

| Service | What it's for | Where to sign up |
|---|---|---|
| **Supabase** | Database | [supabase.com](https://supabase.com) |
| **Anthropic** | AI agents | [console.anthropic.com](https://console.anthropic.com) |
| **OpenAI** | Message search / embeddings | [platform.openai.com](https://platform.openai.com) |

### Before you run `npm run clyde`

Have these ready — the setup wizard will ask for them:

1. **Supabase Project URL** — looks like `https://abcdefgh.supabase.co` (Dashboard > Settings > API)
2. **Supabase Anon Key** — a long string starting with `eyJ` (same page)
3. **Supabase Service Role Key** — another `eyJ` string (click the eye icon to reveal)
4. **Supabase Database Password** — the password you set when creating the project
5. **Anthropic API Key** — starts with `sk-ant-` ([console.anthropic.com/settings/keys](https://console.anthropic.com/settings/keys))
6. **OpenAI API Key** — starts with `sk-` ([platform.openai.com/api-keys](https://platform.openai.com/api-keys))

> **Tip:** If you haven't created a Supabase project yet, go to [supabase.com](https://supabase.com), click **New Project**, pick a name, set a strong database password (save it!), choose a region, and wait about a minute for it to spin up.

---

## What the Setup Wizard Does

When you run `npm run clyde` for the first time (no `.env.local` file), the CLI will:

1. **Check prerequisites** — verifies Node.js 20+, Python 3.10+, and Git are installed
2. **Collect credentials** — prompts for your Supabase, Anthropic, and OpenAI keys (passwords are masked)
3. **Generate `.env.local`** — writes your config file with all the right values (never committed to git)
4. **Deploy the database schema** — connects directly to your Supabase Postgres instance and creates all 8 tables, functions, and indexes automatically
5. **Install dependencies** — runs `npm install` for the frontend and sets up a Python virtual environment with all backend packages
6. **Create the working directory** — sets up the folder structure for agent configs, prompts, memory, and logs
7. **Launch the app** — starts both the backend (port 8000) and frontend (port 3020), then opens your browser

All credentials are stored locally in `.env.local` and are never transmitted anywhere except directly to your own services.

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

This starts both the backend and frontend, with color-coded logs in your terminal. Press `Ctrl+C` to stop everything.

You can also run the services individually if you prefer separate terminals:

| Command | What it does |
|---|---|
| `npm run clyde` | Start everything (recommended) |
| `npm run dev:frontend` | Start only the frontend (port 3020) |
| `npm run dev:backend` | Start only the backend (port 8000) |
| `npm run lint` | Check frontend code for errors |

---

## Project Structure

```
project-clyde/
├── cli/               CLI setup wizard and app launcher
│   └── clyde.js       Entry point for `npm run clyde`
├── db/                Database schema
│   └── schema.sql     Idempotent SQL (safe to re-run)
├── frontend/          Next.js web interface (port 3020)
├── backend/           FastAPI server + AI agents (port 8000)
├── working/           Runtime data (agent registry, prompts, memory)
├── .env.example       Template for environment variables
└── .env.local         Your local config (not committed to git)
```

---

## Manual Setup (Alternative)

If you prefer to set things up step by step instead of using the CLI wizard, follow these instructions.

<details>
<summary>Click to expand manual setup steps</summary>

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
WORKING_DIR=/full/path/to/project-clyde/working
```

To find your full path for `WORKING_DIR`:

```bash
echo "$(pwd)/working"
```

### 3. Install the Frontend

```bash
cd frontend
npm install
```

### 4. Install the Backend

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

### 5. Start the App

**Terminal 1 — Backend:**

```bash
cd backend
source .venv/bin/activate
bash run.sh
```

**Terminal 2 — Frontend:**

```bash
cd frontend
npm run dev
```

Open your browser to **http://localhost:3020**

</details>

---

## Common Issues

### "Cannot connect to backend"
Make sure the backend is running. If using `npm run clyde`, check the terminal for backend errors (prefixed with `[backend]` in teal). If running manually, verify you see `Uvicorn running on http://127.0.0.1:8000`.

### Database schema deployment failed
- **Connection refused** — check your Supabase URL is correct and the project is active
- **Password authentication failed** — reset your database password in Supabase Dashboard > Settings > Database
- **Already exists** — this is fine; the schema is idempotent and safe to re-run

### "Module not found" errors in the backend
If running manually, make sure you activated the virtual environment:
```bash
source .venv/bin/activate
```
If using `npm run clyde`, the CLI handles this automatically.

### "node: command not found" or wrong Node version
Install Node.js 20+ from [nodejs.org](https://nodejs.org). Pick the LTS version.

### "python3: command not found"
- **Mac:** Run `brew install python3` (requires [Homebrew](https://brew.sh))
- **Windows:** Download from [python.org](https://www.python.org/downloads/) and check "Add to PATH" during install
- **Linux:** Run `sudo apt install python3 python3-venv`

### Red dots in Settings
This means one or more API keys are missing or incorrect. Open `.env.local` and check:
- No extra spaces around the `=` sign
- No quotes around the values
- Keys are pasted completely (no missing characters)

After editing `.env.local`, restart with `npm run clyde`.
