-- ============================================================
-- SoFin — Supabase schema
--
-- Run once in the SQL Editor of your project (or `supabase db push`).
-- Safe to re-run: everything is idempotent.
--
-- Storage model: one JSONB snapshot per user. The client owns the shape of
-- `data` (see the state object in public/js/app.js); Postgres only enforces
-- ownership. See README for why this over normalised tables.
-- ============================================================

-- ---------- table ----------
create table if not exists public.user_state (
  user_id     uuid primary key references auth.users (id) on delete cascade,
  data        jsonb        not null default '{}'::jsonb,
  device_id   text,
  updated_at  timestamptz  not null default now(),
  created_at  timestamptz  not null default now()
);

comment on table  public.user_state is 'SoFin: one whole-app state snapshot per user.';
comment on column public.user_state.device_id is 'Writer device, so a client can ignore the realtime echo of its own write.';

-- ---------- row level security ----------
alter table public.user_state enable row level security;

drop policy if exists "own row: select" on public.user_state;
create policy "own row: select" on public.user_state
  for select using (auth.uid() = user_id);

drop policy if exists "own row: insert" on public.user_state;
create policy "own row: insert" on public.user_state
  for insert with check (auth.uid() = user_id);

drop policy if exists "own row: update" on public.user_state;
create policy "own row: update" on public.user_state
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "own row: delete" on public.user_state;
create policy "own row: delete" on public.user_state
  for delete using (auth.uid() = user_id);

-- ---------- keep updated_at honest ----------
-- The client sends its own updated_at; overwrite it server-side so the column
-- always reflects when Postgres actually accepted the row.
create or replace function public.touch_user_state()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists user_state_touch on public.user_state;
create trigger user_state_touch
  before insert or update on public.user_state
  for each row execute function public.touch_user_state();

-- ---------- realtime ----------
-- Realtime needs the full previous/next row to evaluate the user_id filter.
alter table public.user_state replica identity full;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'user_state'
  ) then
    alter publication supabase_realtime add table public.user_state;
  end if;
end
$$;

-- ---------- optional: create the row on sign-up ----------
-- Not required (the client upserts on first sync), but it makes a brand-new
-- account visible in the table straight away.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.user_state (user_id, data)
  values (new.id, '{}'::jsonb)
  on conflict (user_id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
