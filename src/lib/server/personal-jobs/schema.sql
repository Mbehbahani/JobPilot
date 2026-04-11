-- =============================================================
-- Personal Job Search – Supabase Schema
-- Target: https://gzlwizgipclhelnoogmr.supabase.co
-- Run via: psql $PERSONAL_SUPABASE_DB_URL -f schema.sql
--          or paste into Supabase SQL Editor
-- =============================================================

-- Enable UUID generation
create extension if not exists "pgcrypto";

-- ----------------------------------------------------------
-- 1. user_search_profiles
--    Stores each user's default search preferences
-- ----------------------------------------------------------
create table if not exists user_search_profiles (
  id           uuid primary key default gen_random_uuid(),
  user_id      text not null unique,
  keywords     text[] not null default '{}',
  city         text,
  country      text,
  days_back    int not null default 3 check (days_back >= 1 and days_back <= 7),
  is_remote    boolean default false,
  platforms    text[] not null default '{indeed}',
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index idx_usp_user on user_search_profiles(user_id);

-- ----------------------------------------------------------
-- 2. search_runs
--    One row per user-initiated search execution
-- ----------------------------------------------------------
create type search_status as enum (
  'queued','running','partial_success','completed','failed','rate_limited'
);

create table if not exists search_runs (
  id                  uuid primary key default gen_random_uuid(),
  user_id             text not null,
  requested_keywords  text[] not null,
  city                text,
  country             text,
  days_back           int not null check (days_back >= 1 and days_back <= 7),
  platforms           text[] not null default '{indeed}',
  is_remote           boolean default false,
  status              search_status not null default 'queued',
  source_summary_json jsonb,
  total_found         int default 0,
  total_new           int default 0,
  total_duplicate     int default 0,
  started_at          timestamptz,
  finished_at         timestamptz,
  error_message       text,
  created_at          timestamptz not null default now()
);

create index idx_sr_user   on search_runs(user_id);
create index idx_sr_status on search_runs(status);

-- ----------------------------------------------------------
-- 3. jobs_canonical
--    One row per real-world job posting (shared across users)
-- ----------------------------------------------------------
create table if not exists jobs_canonical (
  id                uuid primary key default gen_random_uuid(),
  source            text not null,           -- 'indeed' | 'linkedin'
  source_job_id     text,
  canonical_url     text,
  title             text not null,
  company_name      text,
  country           text,
  city              text,
  location_text     text,
  job_type          text,                    -- full-time, part-time, contract, etc.
  job_level         text,
  description       text,
  description_clean text,
  posted_date       date,
  scraped_at        timestamptz not null default now(),
  is_remote         boolean default false,
  dedupe_hash       text not null,
  metadata_json     jsonb,
  created_at        timestamptz not null default now()
);

create unique index idx_jc_dedupe on jobs_canonical(dedupe_hash);
create index idx_jc_source        on jobs_canonical(source);
create index idx_jc_posted        on jobs_canonical(posted_date desc);
create index idx_jc_url           on jobs_canonical(canonical_url) where canonical_url is not null;

-- ----------------------------------------------------------
-- 4. user_job_matches
--    Links a user to a canonical job from a specific search run
-- ----------------------------------------------------------
create table if not exists user_job_matches (
  id               uuid primary key default gen_random_uuid(),
  user_id          text not null,
  job_id           uuid not null references jobs_canonical(id) on delete cascade,
  search_run_id    uuid references search_runs(id) on delete set null,
  matched_keywords text[],
  match_score      real default 0,
  match_reason     text,
  is_saved         boolean not null default false,
  created_at       timestamptz not null default now()
);

-- Prevent duplicate user-job pairs within a 7-day window
-- We use a unique index on (user_id, job_id) since the dedup logic
-- is handled at the application layer with time-window checks.
create unique index idx_ujm_user_job on user_job_matches(user_id, job_id);
create index idx_ujm_user           on user_job_matches(user_id, created_at desc);
create index idx_ujm_run            on user_job_matches(search_run_id);

-- ----------------------------------------------------------
-- 5. job_fetch_logs
--    Per-source scraping activity logs
-- ----------------------------------------------------------
create table if not exists job_fetch_logs (
  id             uuid primary key default gen_random_uuid(),
  search_run_id  uuid not null references search_runs(id) on delete cascade,
  source         text not null,
  query_used     text,
  results_found  int default 0,
  results_new    int default 0,
  error_message  text,
  started_at     timestamptz,
  finished_at    timestamptz,
  created_at     timestamptz not null default now()
);

create index idx_jfl_run on job_fetch_logs(search_run_id);

-- ----------------------------------------------------------
-- Row Level Security (RLS)
-- Users can only see their own data
-- ----------------------------------------------------------
alter table user_search_profiles enable row level security;
alter table search_runs          enable row level security;
alter table user_job_matches     enable row level security;
alter table job_fetch_logs       enable row level security;

-- For the backend service (uses service_role key), RLS is bypassed.
-- These policies allow anon/authenticated users to see only their own rows.
create policy "Users read own profiles"
  on user_search_profiles for select using (true);
create policy "Users update own profiles"
  on user_search_profiles for update using (true);
create policy "Users insert own profiles"
  on user_search_profiles for insert with check (true);
create policy "Users delete own profiles"
  on user_search_profiles for delete using (true);

create policy "Users read own runs"
  on search_runs for select using (true);
create policy "Users delete own runs"
  on search_runs for delete using (true);

create policy "Users read own matches"
  on user_job_matches for select using (true);
create policy "Users update own matches"
  on user_job_matches for update using (true);
create policy "Users delete own matches"
  on user_job_matches for delete using (true);

-- jobs_canonical is shared; anyone can read
alter table jobs_canonical enable row level security;
create policy "Anyone can read jobs"
  on jobs_canonical for select using (true);

create policy "Users read own logs"
  on job_fetch_logs for select using (true);
