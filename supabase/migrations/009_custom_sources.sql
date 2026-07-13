-- Owner-managed custom discovery websites.

create table if not exists public.custom_sources (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  base_url text not null,
  listing_url text not null,
  mode text not null default 'static',
  enabled boolean not null default true,
  location_scope text not null default 'global',
  topic_scope text[] not null default '{}',
  max_items integer not null default 100,
  status text not null default 'unknown',
  last_checked_at timestamptz,
  last_error_safe text,
  selectors jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint custom_sources_slug_chk check (slug ~ '^[a-z0-9][a-z0-9_-]{0,62}$'),
  constraint custom_sources_mode_chk check (mode in ('auto', 'static', 'playwright', 'rss', 'sitemap')),
  constraint custom_sources_status_chk check (status in ('healthy', 'degraded', 'auth_required', 'failed', 'disabled', 'unknown')),
  constraint custom_sources_max_items_chk check (max_items between 1 and 100),
  constraint custom_sources_selectors_object_chk check (jsonb_typeof(selectors) = 'object')
);

create index if not exists custom_sources_enabled_idx
  on public.custom_sources (enabled, status, updated_at desc);

create index if not exists custom_sources_location_scope_idx
  on public.custom_sources (location_scope);

create trigger custom_sources_set_updated_at
before update on public.custom_sources
for each row execute function public.set_updated_at();

alter table public.custom_sources enable row level security;

create policy "custom_sources_service_role_all"
  on public.custom_sources
  for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');
