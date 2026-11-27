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

-- Administration (8 novembre 2026 ; rôle serveur depuis le 12 novembre ; double authentification,
-- périmètre réduit et journal depuis le 16 novembre). Le compte administrateur lit les œuvres des
-- autres comptes, en lecture seule (il les rouvre en copie dans son propre compte ; il ne modifie ni
-- n'efface rien chez les autres) :
--   - il est désigné par un rôle dans app_metadata, que seul le serveur peut écrire ;
--   - il doit s'être connecté avec la double authentification (code à 6 chiffres d'une application
--     d'authentification) : niveau « aal2 » du jeton ; un mot de passe volé ne suffit pas ;
--   - il ne lit pas directement les tables : la liste passe par admin_works, l'ouverture d'une œuvre
--     par admin_open, qui l'inscrit au journal admin_log ; les fichiers d'un compte ne lui sont ouverts
--     que dans l'heure qui suit l'ouverture d'une de ses œuvres, et jamais ses exports ;
--   - ni le panier ni les exports des autres comptes ne lui sont ouverts.
create or replace function public.is_admin()
returns boolean
language sql
stable
as $$
  select coalesce((select auth.jwt() -> 'app_metadata' ->> 'atelier_role'), '') = 'admin'
     and coalesce((select auth.jwt() ->> 'aal'), '') = 'aal2';
$$;
revoke all on function public.is_admin() from public;
grant execute on function public.is_admin() to authenticated;
-- Le rôle se donne une fois, à la main, dans l'éditeur SQL (il prend effet à la prochaine connexion) :
--   update auth.users set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb) || '{"atelier_role": "admin"}'::jsonb
--     where id = '<identifiant du compte, Authentication → Users>';
-- Pour le retirer : « - 'atelier_role' » au lieu de « || … ». (Plus d'adresse e-mail dans ce fichier.)

-- Les anciennes règles de lecture directe sont retirées
drop policy if exists "compositions: admin reads all" on public.compositions;
drop policy if exists "drawings: admin reads all" on storage.objects;
drop function if exists public.admin_owners(uuid[]);

-- Journal des consultations : qui a ouvert quelle œuvre de quel compte, et quand. Écrit seulement par
-- les fonctions ci-dessous ; ni lu ni modifié depuis le navigateur (aucune règle d'accès) ; gardé
-- même après la suppression du compte consulté. À lire dans Table Editor → admin_log.
create table if not exists public.admin_log (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  admin_id uuid not null,
  owner_id uuid,
  composition_id uuid,
  action text not null
);
create index if not exists admin_log_admin_idx on public.admin_log (admin_id, owner_id, at desc);
alter table public.admin_log enable row level security;
revoke all on public.admin_log from anon, authenticated;

-- La liste des œuvres des autres comptes (sans le panier ni l'ancien brouillon unique), par pages,
-- avec l'e-mail du propriétaire
create or replace function public.admin_works(p_from integer default 0, p_count integer default 60)
returns table (id uuid, user_id uuid, email text, name text, created_at timestamptz, thumb text, meta jsonb)
language plpgsql
security definer
set search_path = public
stable
as $$
begin
  if not public.is_admin() then
    raise exception 'réservé à l''administrateur, connecté avec la double authentification';
  end if;
  return query
    select c.id, c.user_id, u.email::text, c.name, c.created_at, c.thumb,
      jsonb_build_object('date', c.meta -> 'date', 'n', c.meta -> 'n', 'ordered', c.meta -> 'ordered', 'frozen', c.meta -> 'frozen',
        'comp', jsonb_build_object('style', c.meta -> 'comp' -> 'style', 'W', c.meta -> 'comp' -> 'W', 'H', c.meta -> 'comp' -> 'H'),
        'settings', jsonb_build_object('mode', c.meta -> 'settings' -> 'mode', 'format', c.meta -> 'settings' -> 'format'))
    from public.compositions c
    left join auth.users u on u.id = c.user_id
    where c.user_id <> auth.uid() and c.meta ->> 'cart' is null and c.meta ->> 'draft' is null
    order by c.created_at desc
    offset greatest(p_from, 0) limit least(greatest(p_count, 1), 200);
end;
$$;
revoke all on function public.admin_works(integer, integer) from public;
revoke execute on function public.admin_works(integer, integer) from anon;
grant execute on function public.admin_works(integer, integer) to authenticated;

-- Ouvrir une œuvre d'un autre compte : la fiche complète, inscrite au journal ; ses fichiers sont
-- alors lisibles pendant une heure (règle « drawings: admin reads opened works » ci-dessous)
create or replace function public.admin_open(p_id uuid)
returns table (id uuid, user_id uuid, name text, created_at timestamptz, thumb text, meta jsonb)
language plpgsql
security definer
set search_path = public
as $$
declare
  owner uuid;
begin
  if not public.is_admin() then
    raise exception 'réservé à l''administrateur, connecté avec la double authentification';
  end if;
  select c.user_id into owner from public.compositions c where c.id = p_id and c.meta ->> 'cart' is null;
  if owner is null then
    raise exception 'œuvre introuvable';
  end if;
  insert into public.admin_log (admin_id, owner_id, composition_id, action) values (auth.uid(), owner, p_id, 'open');
  return query select c.id, c.user_id, c.name, c.created_at, c.thumb, c.meta from public.compositions c where c.id = p_id;
end;
$$;
revoke all on function public.admin_open(uuid) from public;
revoke execute on function public.admin_open(uuid) from anon;
grant execute on function public.admin_open(uuid) to authenticated;

-- (pour la règle du stockage : une œuvre de ce compte ouverte par cet administrateur dans l'heure)
create or replace function public.admin_opened(owner text)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select public.is_admin() and exists (
    select 1 from public.admin_log l
    where l.admin_id = auth.uid() and l.action = 'open' and l.owner_id::text = owner and l.at > now() - interval '1 hour');
$$;
revoke all on function public.admin_opened(text) from public;
revoke execute on function public.admin_opened(text) from anon;
grant execute on function public.admin_opened(text) to authenticated;

drop policy if exists "drawings: admin reads opened works" on storage.objects;
create policy "drawings: admin reads opened works" on storage.objects
  for select to authenticated
  using (bucket_id = 'drawings'
    and coalesce((storage.foldername(name))[2], '') <> 'exports'
    and public.admin_opened((storage.foldername(name))[1]));

-- Limites côté serveur (16 novembre 2026) : la limite de 15 œuvres et la purge à 60 jours sont tenues
-- par l'atelier ; le serveur pose en plus des plafonds larges, qu'un script ne peut pas contourner.
-- Le compte administrateur (rôle) n'est pas plafonné en nombre : il rouvre en copie les œuvres des autres.
create or replace function public.has_admin_role()
returns boolean
language sql
stable
as $$
  select coalesce((select auth.jwt() -> 'app_metadata' ->> 'atelier_role'), '') = 'admin';
$$;

-- Taille des champs (NOT VALID : les lignes déjà en place ne sont pas revérifiées)
alter table public.compositions drop constraint if exists compositions_sizes;
alter table public.compositions add constraint compositions_sizes check (
  char_length(name) <= 300 and coalesce(octet_length(thumb), 0) <= 1000000 and octet_length(meta::text) <= 8000000) not valid;
alter table public.exports drop constraint if exists exports_sizes;
alter table public.exports add constraint exports_sizes check (
  char_length(name) <= 300 and coalesce(octet_length(thumb), 0) <= 1000000 and char_length(path) <= 300
  and kind in ('jpg', 'png', 'pdf', 'guide') and coalesce(char_length(comp_name), 0) <= 300) not valid;

-- Nombre de lignes par compte : 300 œuvres (panier et commandes compris), 1 000 exports
create or replace function public.limit_rows()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  n integer;
  cap integer := case tg_table_name when 'compositions' then 300 else 1000 end;
begin
  if public.has_admin_role() then
    return new;
  end if;
  execute format('select count(*) from public.%I where user_id = $1', tg_table_name) into n using new.user_id;
  if n >= cap then
    raise exception 'quota atteint : % lignes au plus par compte', cap;
  end if;
  return new;
end;
$$;
revoke all on function public.limit_rows() from public;
drop trigger if exists compositions_limit on public.compositions;
create trigger compositions_limit before insert on public.compositions for each row execute function public.limit_rows();
drop trigger if exists exports_limit on public.exports;
create trigger exports_limit before insert on public.exports for each row execute function public.limit_rows();

-- Fichiers par compte : 5 000 fichiers et 3 Go au plus (vérifié à chaque envoi)
create or replace function public.drawings_room()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select public.has_admin_role() or (
    select count(*) < 5000 and coalesce(sum((o.metadata ->> 'size')::bigint), 0) < 3221225472
    from storage.objects o
    where o.bucket_id = 'drawings' and o.name like auth.uid()::text || '/%');
$$;
revoke all on function public.drawings_room() from public;
revoke execute on function public.drawings_room() from anon;
grant execute on function public.drawings_room() to authenticated;
drop policy if exists "drawings: quota" on storage.objects;
create policy "drawings: quota" on storage.objects
  as restrictive
  for insert to authenticated
  with check (bucket_id <> 'drawings' or public.drawings_room());

-- Commandes payées en ligne (Stripe, 25 novembre 2026). Une ligne par commande, écrite seulement par les
-- fonctions « commande » (création, en attente de paiement) et « stripe-webhook » (payée, abandonnée),
-- avec la clé serveur : le navigateur ne peut ni en créer ni en modifier une. Chaque compte lit les
-- siennes (« Mes commandes ») ; l'administrateur (double authentification) les lit toutes et en change
-- le statut et le suivi. Gardées après la suppression du compte (obligations comptables) : user_id passe
-- alors à null. Statuts : attente_paiement, payee, en_preparation, expediee, livree, annulee, abandonnee.
-- Livraison : à domicile, standard ou express (delivery). Annulation (fonction commande-annuler) :
-- remboursée par Stripe (refund, cancelled_at). E-mails des étapes : fonctions, avec la clé RESEND_API_KEY.
create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users (id) on delete set null,
  ref text not null unique,
  status text not null default 'attente_paiement'
    check (status in ('attente_paiement', 'payee', 'en_preparation', 'expediee', 'livree', 'annulee', 'abandonnee')),
  email text,
  consent boolean not null default false,   -- accord pour montrer l'œuvre (réseaux, publicité)
  items jsonb not null,                     -- articles : œuvre (compId, title), produit, taille, quantité, prix unitaire
  subtotal_cents integer not null,
  shipping_cents integer not null default 0,
  total_cents integer not null,
  delivery text,                           -- mode de livraison : domicile (Colissimo), express (Chronopost)
  stripe_session text,
  payment_intent text,
  shipping jsonb,                           -- nom et adresse de livraison (Stripe)
  customer jsonb,                           -- nom, e-mail, téléphone (Stripe)
  carrier text,
  tracking text,                            -- numéro de suivi du colis
  created_at timestamptz not null default now(),
  paid_at timestamptz,
  updated_at timestamptz not null default now()
);
create index if not exists orders_user_idx on public.orders (user_id, created_at desc);
alter table public.orders add column if not exists delivery text; -- (table créée avant cette colonne)
alter table public.orders add column if not exists refund text;               -- remboursement Stripe (annulation)
alter table public.orders add column if not exists cancelled_at timestamptz;
alter table public.orders enable row level security;
revoke all on public.orders from anon;
revoke insert, delete on public.orders from authenticated;
drop policy if exists "orders: own rows" on public.orders;
create policy "orders: own rows" on public.orders
  for select to authenticated
  using (auth.uid() = user_id);
drop policy if exists "orders: admin reads" on public.orders;
create policy "orders: admin reads" on public.orders
  for select to authenticated
  using (public.is_admin());
-- (le statut, le transporteur et le numéro de suivi ne changent que par la fonction « commande-statut »,
-- qui vérifie l'administrateur et l'ordre des étapes : aucune modification directe depuis le navigateur)
drop policy if exists "orders: admin updates" on public.orders;
revoke update on public.orders from authenticated;

-- Journal du site (27 novembre 2026) : les erreurs des fonctions serveur et les e-mails qui ne sont pas
-- partis. Écrit seulement par les fonctions (clé serveur), lu seulement par le tableau de bord de
-- l'administrateur (fonction admin_dashboard ci-dessous) ; gardé 30 jours. Aucun accès depuis le navigateur.
create table if not exists public.site_events (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  kind text not null check (kind in ('erreur', 'email')),
  fn text check (char_length(fn) <= 40),
  message text not null check (char_length(message) <= 400),
  ref text check (char_length(ref) <= 60)
);
create index if not exists site_events_at_idx on public.site_events (at desc);
alter table public.site_events enable row level security;
revoke all on public.site_events from anon, authenticated;

-- Les chiffres du tableau de bord (tableau-de-bord.html), en un appel : ventes, commandes à préparer,
-- comptes, œuvres, partages, stockage, journal. Appelée seulement par la fonction « tableau-de-bord »
-- (clé serveur), qui vérifie d'abord l'administrateur et sa double authentification ; jours comptés à
-- l'heure de Paris. Ventes : commandes payées, sans les annulées (remboursées) ni les abandonnées.
create or replace function public.admin_dashboard()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  today date := (now() at time zone 'Europe/Paris')::date;
  now_iso text := to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS');
  out jsonb;
begin
  delete from public.site_events where at < now() - interval '30 days';
  with days as (
    select (today - g)::date as d from generate_series(0, 29) as g
  ),
  paid as (
    select o.total_cents, (o.paid_at at time zone 'Europe/Paris')::date as d
    from public.orders o
    where o.paid_at is not null and o.status not in ('annulee', 'abandonnee', 'attente_paiement')
  ),
  works as (
    select c.created_at, c.meta from public.compositions c
    where c.meta ->> 'cart' is null and c.meta ->> 'draft' is null
  )
  select jsonb_build_object(
    'at', now(),
    'ventes', jsonb_build_object(
      'today', (select jsonb_build_object('cents', coalesce(sum(total_cents), 0), 'n', count(*)) from paid where d = today),
      'd7', (select jsonb_build_object('cents', coalesce(sum(total_cents), 0), 'n', count(*)) from paid where d > today - 7),
      'd30', (select jsonb_build_object('cents', coalesce(sum(total_cents), 0), 'n', count(*)) from paid where d > today - 30),
      'byDay', (select jsonb_agg(jsonb_build_object('d', days.d, 'cents', coalesce(s.cents, 0)) order by days.d)
                from days left join (select d, sum(total_cents) as cents from paid group by d) s on s.d = days.d),
      'statuts', coalesce((select jsonb_object_agg(status, n) from (select status, count(*) as n from public.orders group by status) st), '{}'::jsonb),
      'aPreparer', coalesce((select jsonb_agg(x order by x.paid_at) from (
          select o.ref, o.total_cents, o.paid_at, o.delivery,
            coalesce(o.shipping ->> 'name', o.customer ->> 'name', '') as client,
            (select coalesce(sum(greatest(coalesce((it ->> 'qty')::int, 1), 1)), 0) from jsonb_array_elements(o.items) it where (it ->> 'qty') is null or (it ->> 'qty') ~ '^[0-9]{1,3}$') as articles
          from public.orders o where o.status = 'payee' order by o.paid_at limit 20) x), '[]'::jsonb)
    ),
    'activite', jsonb_build_object(
      'comptes', (select jsonb_build_object('total', count(*), 'd7', count(*) filter (where created_at > now() - interval '7 days')) from auth.users),
      'oeuvres', (select jsonb_build_object('total', count(*), 'd7', count(*) filter (where created_at > now() - interval '7 days')) from works),
      'partages', jsonb_build_object(
        'actifs', (select count(*) from public.compositions c where c.meta -> 'share' ->> 'token' is not null
          and (c.meta -> 'share' ->> 'expires') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T' and (c.meta -> 'share' ->> 'expires') > now_iso),
        'recus7', (select count(*) from public.compositions c where c.meta ? 'sharedFrom' and c.created_at > now() - interval '7 days')),
      'stockage', (select jsonb_build_object('bytes', coalesce(sum(case when (o.metadata ->> 'size') ~ '^[0-9]{1,15}$' then (o.metadata ->> 'size')::bigint else 0 end), 0), 'files', count(*))
                   from storage.objects o where o.bucket_id = 'drawings'),
      'byDay', (select jsonb_agg(jsonb_build_object('d', days.d, 'comptes', coalesce(u.n, 0), 'oeuvres', coalesce(w.n, 0)) order by days.d)
                from days
                left join (select (created_at at time zone 'Europe/Paris')::date as d, count(*) as n from auth.users group by 1) u on u.d = days.d
                left join (select (created_at at time zone 'Europe/Paris')::date as d, count(*) as n from works group by 1) w on w.d = days.d)
    ),
    'sante', jsonb_build_object(
      'erreurs24', (select count(*) from public.site_events where kind = 'erreur' and at > now() - interval '24 hours'),
      'erreurs', coalesce((select jsonb_agg(jsonb_build_object('at', e.at, 'fn', e.fn, 'message', e.message, 'ref', e.ref) order by e.at desc)
                 from (select * from public.site_events where kind = 'erreur' and at > now() - interval '7 days' order by at desc limit 20) e), '[]'::jsonb),
      'emails', coalesce((select jsonb_agg(jsonb_build_object('at', e.at, 'fn', e.fn, 'what', e.message, 'ref', e.ref) order by e.at desc)
                 from (select * from public.site_events where kind = 'email' and at > now() - interval '7 days' order by at desc limit 20) e), '[]'::jsonb)
    )
  ) into out;
  return out;
end;
$$;
revoke all on function public.admin_dashboard() from public;
revoke execute on function public.admin_dashboard() from anon, authenticated;
grant execute on function public.admin_dashboard() to service_role;

-- Partage d'une œuvre (renforcé le 27 novembre 2026) : le lien est créé par la fonction « partage »
-- (share_set : le jeton tiré par le serveur, écrit dans la fiche sans toucher au reste) ; recevoir une
-- œuvre n'est possible que si la copie tient dans la place du compte (share_room : 3 Go et 5 000 fichiers,
-- comme drawings_room). Deux fonctions appelables seulement avec la clé serveur.
create or replace function public.share_set(p_id uuid, p_uid uuid, p_share jsonb)
returns boolean
language sql
security definer
set search_path = public
as $$
  with u as (
    update public.compositions set meta = jsonb_set(coalesce(meta, '{}'::jsonb), '{share}', p_share)
    where id = p_id and user_id = p_uid
    returning 1
  )
  select exists (select 1 from u);
$$;
revoke all on function public.share_set(uuid, uuid, jsonb) from public;
revoke execute on function public.share_set(uuid, uuid, jsonb) from anon, authenticated;
grant execute on function public.share_set(uuid, uuid, jsonb) to service_role;

create or replace function public.share_room(p_uid uuid, p_paths text[], p_admin boolean default false)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select p_admin or (
    with mine as (
      select count(*) as files, coalesce(sum(case when (o.metadata ->> 'size') ~ '^[0-9]{1,15}$' then (o.metadata ->> 'size')::bigint else 0 end), 0) as bytes
      from storage.objects o where o.bucket_id = 'drawings' and o.name like p_uid::text || '/%'
    ), src as (
      select count(*) as files, coalesce(sum(case when (o.metadata ->> 'size') ~ '^[0-9]{1,15}$' then (o.metadata ->> 'size')::bigint else 0 end), 0) as bytes
      from storage.objects o where o.bucket_id = 'drawings' and o.name = any (p_paths)
    )
    select mine.files + src.files <= 5000 and mine.bytes + src.bytes <= 3221225472 from mine, src
  );
$$;
revoke all on function public.share_room(uuid, text[], boolean) from public;
revoke execute on function public.share_room(uuid, text[], boolean) from anon, authenticated;
grant execute on function public.share_room(uuid, text[], boolean) to service_role;

-- un jeton de partage ne mène qu'à une seule œuvre (un compte ne peut pas recopier celui d'un autre sur
-- la sienne), et l'ouverture d'un lien est une simple lecture d'index
create unique index if not exists compositions_share_token_key
  on public.compositions ((meta -> 'share' ->> 'token'))
  where meta -> 'share' ->> 'token' is not null;
