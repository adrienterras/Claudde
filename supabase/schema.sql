-- Atelier Gribouille — schéma Supabase pour les comptes et les compositions sauvegardées.
-- À exécuter une fois dans l'éditeur SQL du projet (Dashboard → SQL Editor → New query → Run).

-- Compositions : une ligne par composition sauvegardée, visible et modifiable par son auteur seulement.
create table if not exists public.compositions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null,
  thumb text,                 -- vignette (data URL JPEG, quelques Ko)
  meta jsonb not null,        -- réglages, mise en place, liste des dessins (chemins des fichiers) ;
                              -- meta.draft : l'œuvre en cours ; meta.cart : un article du panier (produit,
                              -- finition, taille, quantité), même panier sur tous les appareils du compte
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

-- Ancien partage des retouches de découpe (retiré le 22 octobre 2026) : plus aucun envoi anonyme.
-- Le bucket « retouches » se vide puis se supprime depuis le tableau de bord (Storage → retouches) :
-- Supabase interdit d'effacer ses fichiers en SQL.
drop policy if exists "retouches: write only" on storage.objects;
drop table if exists public.retouches;

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

-- Administration (8 novembre 2026) : le compte adrien@terras.me lit les œuvres de tous les comptes,
-- en lecture seule (il les rouvre en copie dans son propre compte ; il ne modifie ni n'efface rien
-- chez les autres). L'adresse est lue dans le jeton signé par Supabase : infalsifiable depuis le
-- navigateur. Les exports et le panier des autres comptes ne sont pas concernés.
create or replace function public.is_admin()
returns boolean
language sql
stable
as $$
  select coalesce((select auth.jwt() ->> 'email'), '') = 'adrien@terras.me';
$$;
revoke all on function public.is_admin() from public;
grant execute on function public.is_admin() to authenticated;

drop policy if exists "compositions: admin reads all" on public.compositions;
create policy "compositions: admin reads all" on public.compositions
  for select to authenticated
  using (public.is_admin());

drop policy if exists "drawings: admin reads all" on storage.objects;
create policy "drawings: admin reads all" on storage.objects
  for select to authenticated
  using (bucket_id = 'drawings' and public.is_admin());

-- L'e-mail des propriétaires (auth.users n'est pas lisible depuis le navigateur) : seulement pour
-- l'administrateur, seulement pour les identifiants demandés.
create or replace function public.admin_owners(ids uuid[])
returns table (id uuid, email text)
language sql
security definer
set search_path = public
stable
as $$
  select u.id, u.email::text
  from auth.users u
  where public.is_admin() and u.id = any(ids);
$$;
revoke all on function public.admin_owners(uuid[]) from public;
revoke execute on function public.admin_owners(uuid[]) from anon;
grant execute on function public.admin_owners(uuid[]) to authenticated;
