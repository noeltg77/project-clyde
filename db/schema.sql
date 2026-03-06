-- ============================================
-- Project Clyde: Database Setup
-- Idempotent — safe to run multiple times
-- ============================================

-- Enable the vector extension (required for message search)
create extension if not exists vector with schema extensions;

-- ============================================
-- Chat Sessions
-- ============================================
create table if not exists public.chat_sessions (
  id uuid primary key default gen_random_uuid(),
  title text not null default 'New Chat',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  metadata jsonb default '{}'::jsonb
);

create index if not exists idx_chat_sessions_updated_at on public.chat_sessions (updated_at desc);

create or replace function update_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_chat_sessions_updated_at on public.chat_sessions;
create trigger trg_chat_sessions_updated_at
  before update on public.chat_sessions
  for each row execute function update_updated_at();

-- ============================================
-- Chat Messages (with vector embeddings)
-- ============================================
create table if not exists public.chat_messages (
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

create index if not exists idx_chat_messages_session_id on public.chat_messages (session_id, created_at);

create index if not exists idx_chat_messages_embedding on public.chat_messages
  using hnsw (embedding extensions.vector_cosine_ops)
  with (m = 16, ef_construction = 64);

-- ============================================
-- System Prompt History
-- ============================================
create table if not exists public.system_prompt_history (
  id uuid primary key default gen_random_uuid(),
  agent_id text not null,
  previous_version text,
  new_version text not null,
  reason text,
  changed_by text not null check (changed_by in ('clyde', 'user')),
  created_at timestamptz not null default now()
);

create index if not exists idx_system_prompt_history_agent on public.system_prompt_history (agent_id, created_at desc);

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

drop trigger if exists trg_proactive_insights_updated_at on proactive_insights;
create trigger trg_proactive_insights_updated_at
  before update on proactive_insights
  for each row
  execute function update_proactive_insights_updated_at();

-- ============================================
-- Task Board (Kanban) — Columns
-- ============================================
create table if not exists public.task_columns (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  position integer not null default 0,
  created_at timestamptz not null default now()
);

-- Seed default columns (skip if already seeded)
insert into public.task_columns (name, position)
select name, position from (values
  ('Draft', 0),
  ('Not Started', 1),
  ('In Progress', 2),
  ('Complete', 3)
) as v(name, position)
where not exists (select 1 from public.task_columns limit 1);

-- ============================================
-- Task Board (Kanban) — Tasks
-- ============================================
create table if not exists public.tasks (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text not null default '',
  column_id uuid not null references public.task_columns(id) on delete cascade,
  position integer not null default 0,
  assignee_type text,
  assignee_id text,
  assignee_name text,
  linked_docs jsonb default '[]'::jsonb,
  session_id uuid references public.chat_sessions(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_tasks_column_id
  on public.tasks(column_id, position);

create index if not exists idx_tasks_updated_at
  on public.tasks(updated_at desc);

create or replace function update_tasks_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_tasks_updated_at on public.tasks;
create trigger trg_tasks_updated_at
  before update on public.tasks
  for each row
  execute function update_tasks_updated_at();
