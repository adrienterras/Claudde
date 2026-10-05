-- Atelier Gribouille — schéma Supabase pour les comptes et les compositions sauvegardées.
-- À exécuter une fois dans l'éditeur SQL du projet (Dashboard → SQL Editor → New query → Run).

-- Compositions : une ligne par composition sauvegardée, visible et modifiable par son auteur seulement.
create table if not exists public.compositions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null,
  thumb text,                 -- vignette (data URL JPEG, quelques Ko)
  meta jsonb not null,        -- réglages, mise en place, liste des dessins (chemins des fichiers)
  created_at timestamptz not null default now()
);
create index if not exists compositions_user_idx on public.compositions (user_id, created_at desc);
alter table public.compositions enable row level security;
drop policy if exists "compositions: own rows" on public.compositions;
create policy "compositions: own rows" on public.compositions
  for all to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Exports : chaque fichier téléchargé (JPEG, PNG, PDF, guide) est aussi gardé dans le compte.
create table if not exists public.exports (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null,
  kind text not null,          -- jpg | png | pdf | guide
  dpi integer,
  width integer,
  height integer,
  size bigint,
  thumb text,
  path text not null,          -- chemin du fichier dans le bucket
  comp_name text,
  created_at timestamptz not null default now()
);
create index if not exists exports_user_idx on public.exports (user_id, created_at desc);
alter table public.exports enable row level security;
drop policy if exists "exports: own rows" on public.exports;
create policy "exports: own rows" on public.exports
  for all to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Fichiers (images des dessins, masques de retouche, exports) : bucket privé, un dossier par utilisateur.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values ('drawings', 'drawings', false, 52428800, array['image/jpeg', 'image/png', 'image/webp', 'application/pdf'])
  on conflict (id) do update set file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;
drop policy if exists "drawings: own folder" on storage.objects;
create policy "drawings: own folder" on storage.objects
  for all to authenticated
  using (bucket_id = 'drawings' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'drawings' and (storage.foldername(name))[1] = auth.uid()::text);

-- Suppression du compte par l'utilisateur lui-même (bouton « Supprimer mon compte ») :
-- efface ses fichiers, ses compositions (cascade) et son compte.
create or replace function public.delete_account()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'non connecté';
  end if;
  delete from storage.objects where bucket_id = 'drawings' and (storage.foldername(name))[1] = auth.uid()::text;
  delete from auth.users where id = auth.uid();
end;
$$;
revoke all on function public.delete_account() from public;
grant execute on function public.delete_account() to authenticated;
