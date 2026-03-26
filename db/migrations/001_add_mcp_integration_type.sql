-- ============================================
-- Migration 001: Add 'mcp' to integrations type
-- ============================================
-- Run this against existing Supabase databases to allow
-- MCP server integrations. Safe to run multiple times.
--
-- New installs already include 'mcp' in schema.sql.
-- ============================================

-- Drop the old CHECK constraint and re-create with 'mcp' included.
-- The constraint name follows Postgres's default: <table>_<column>_check
ALTER TABLE public.integrations
  DROP CONSTRAINT IF EXISTS integrations_type_check;

ALTER TABLE public.integrations
  ADD CONSTRAINT integrations_type_check
  CHECK (type IN ('api', 'webhook', 'mcp'));
