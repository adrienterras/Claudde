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

-- Retouches de découpe partagées (option « Aider à améliorer le détourage », décochée par défaut) :
-- le navigateur y écrit seulement (anonyme ou connecté), personne n'y lit depuis l'application.
-- Fichiers : retouches/<AAAA-MM>/<id>/{image.jpg, auto.png, corrige.png, meta.json} ; une ligne par envoi.
create table if not exists public.retouches (
  id uuid primary key default gen_random_uuid(),
  path text not null,         -- dossier des fichiers dans le bucket « retouches »
  meta jsonb not null,        -- indications sur la page et la découpe (jamais de nom de fichier ni d'identifiant)
  created_at timestamptz not null default now()
);
alter table public.retouches enable row level security;
drop policy if exists "retouches: insert only" on public.retouches;
create policy "retouches: insert only" on public.retouches
  for insert to anon, authenticated
  with check (length(path) <= 120 and pg_column_size(meta) <= 8192);
revoke select, update, delete on public.retouches from anon, authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values ('retouches', 'retouches', false, 4194304, array['image/jpeg', 'image/png', 'application/json'])
  on conflict (id) do update set file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;
drop policy if exists "retouches: write only" on storage.objects;
create policy "retouches: write only" on storage.objects
  for insert to anon, authenticated
  with check (bucket_id = 'retouches' and name ~ '^[0-9]{4}-[0-9]{2}/[0-9a-f-]{8,40}/(image\.jpg|auto\.png|corrige\.png|meta\.json)$');

-- Suppression du compte par l'utilisateur lui-même (bouton « Supprimer mon compte ») :
-- efface ses compositions (cascade) et son compte ; ses fichiers sont effacés avant par l'application.
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
  -- (les fichiers du stockage sont effacés par l'application juste avant, avec l'API Storage :
  -- Supabase interdit de les effacer en SQL ; les lignes des tables partent en cascade)
  delete from auth.users where id = auth.uid();
end;
$$;
revoke all on function public.delete_account() from public;
-- Supabase donne aussi le droit d'exécution au rôle anon par défaut : on le retire (la fonction refusait déjà ces appels)
revoke execute on function public.delete_account() from anon;
grant execute on function public.delete_account() to authenticated;
