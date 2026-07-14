-- Allow auto mode for existing custom_sources tables.

do $$
begin
  if to_regclass('public.custom_sources') is not null then
    alter table public.custom_sources
      drop constraint if exists custom_sources_mode_chk;

    alter table public.custom_sources
      add constraint custom_sources_mode_chk
      check (mode in ('auto', 'static', 'playwright', 'rss', 'sitemap'));

    drop trigger if exists custom_sources_set_updated_at on public.custom_sources;

    create trigger custom_sources_set_updated_at
    before update on public.custom_sources
    for each row execute function public.set_updated_at();

    alter table public.custom_sources enable row level security;

    drop policy if exists "custom_sources_service_role_all" on public.custom_sources;

    create policy "custom_sources_service_role_all"
      on public.custom_sources
      for all
      using (auth.role() = 'service_role')
      with check (auth.role() = 'service_role');
  end if;
end $$;
