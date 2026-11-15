-- MedLedger initial schema. Apply in a new Supabase project after reviewing the table model.
-- This migration is designed for a single-facility pilot and enforces facility-scoped access.

create extension if not exists pgcrypto;

create table if not exists public.facilities (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 2 and 180),
  code text unique,
  notification_email text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.facility_members (
  id uuid primary key default gen_random_uuid(),
  facility_id uuid not null references public.facilities(id) on delete restrict,
  user_id uuid not null references auth.users(id) on delete restrict,
  full_name text not null check (char_length(full_name) between 2 and 120),
  role text not null check (role in ('facility_admin','clinician','records_officer')),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (facility_id, user_id)
);

create table if not exists public.patients (
  id uuid primary key default gen_random_uuid(),
  facility_id uuid not null references public.facilities(id) on delete restrict,
  mrn text not null,
  first_name text not null check (char_length(first_name) between 1 and 80),
  last_name text not null check (char_length(last_name) between 1 and 80),
  date_of_birth date,
  sex text check (sex is null or sex in ('Female','Male','Other','Prefer not to say')),
  phone text check (phone is null or char_length(phone) <= 30),
  address text check (address is null or char_length(address) <= 180),
  record_status text not null default 'active' check (record_status in ('active','archived')),
  privacy_notice_acknowledged boolean not null default false,
  privacy_notice_version text,
  privacy_notice_recorded_at timestamptz,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (facility_id, mrn),
  unique (facility_id, id)
);

create table if not exists public.encounters (
  id uuid primary key default gen_random_uuid(),
  facility_id uuid not null references public.facilities(id) on delete restrict,
  patient_id uuid not null references public.patients(id) on delete restrict,
  encounter_date timestamptz not null default now(),
  visit_type text not null check (char_length(visit_type) between 2 and 80),
  chief_complaint text check (chief_complaint is null or char_length(chief_complaint) <= 1000),
  assessment text check (assessment is null or char_length(assessment) <= 2000),
  plan text check (plan is null or char_length(plan) <= 2000),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint encounter_patient_same_facility foreign key (facility_id, patient_id)
    references public.patients(facility_id, id) deferrable initially immediate
);

create table if not exists public.referrals (
  id uuid primary key default gen_random_uuid(),
  facility_id uuid not null references public.facilities(id) on delete restrict,
  patient_id uuid not null references public.patients(id) on delete restrict,
  destination_name text not null check (char_length(destination_name) between 2 and 160),
  reason text not null check (char_length(reason) between 2 and 2000),
  urgency text not null default 'routine' check (urgency in ('routine','urgent')),
  referral_status text not null default 'pending' check (referral_status in ('pending','in-progress','completed','cancelled')),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint referral_patient_same_facility foreign key (facility_id, patient_id)
    references public.patients(facility_id, id) deferrable initially immediate
);

create table if not exists public.follow_ups (
  id uuid primary key default gen_random_uuid(),
  facility_id uuid not null references public.facilities(id) on delete restrict,
  patient_id uuid not null references public.patients(id) on delete restrict,
  due_date date not null,
  followup_status text not null default 'scheduled' check (followup_status in ('scheduled','pending','completed','missed','cancelled')),
  outcome text check (outcome is null or char_length(outcome) <= 1000),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint followup_patient_same_facility foreign key (facility_id, patient_id)
    references public.patients(facility_id, id) deferrable initially immediate
);

create table if not exists public.audit_events (
  id uuid primary key default gen_random_uuid(),
  facility_id uuid not null references public.facilities(id) on delete restrict,
  actor_id uuid references auth.users(id) on delete set null,
  entity_type text not null,
  entity_id uuid not null,
  action text not null check (action in ('INSERT','UPDATE')),
  occurred_at timestamptz not null default now()
);

create table if not exists public.email_alert_log (
  id uuid primary key default gen_random_uuid(),
  facility_id uuid not null references public.facilities(id) on delete restrict,
  actor_id uuid not null references auth.users(id) on delete restrict,
  event_type text not null check (event_type in ('referral_created','followup_scheduled')),
  created_at timestamptz not null default now()
);

-- Atomic per-user email-alert throttle. Callable only by the Edge Function's service role.
create or replace function public.consume_email_alert_quota(
  p_facility_id uuid,
  p_actor_id uuid,
  p_event_type text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  recent_count integer;
begin
  if p_event_type is null or p_event_type not in ('referral_created', 'followup_scheduled') then
    raise exception 'Unsupported alert type' using errcode = '22023';
  end if;

  if not exists (
    select 1 from public.facility_members fm
    where fm.facility_id = p_facility_id
      and fm.user_id = p_actor_id
      and fm.is_active = true
      and fm.role in ('facility_admin', 'clinician')
  ) then
    raise exception 'Actor is not authorised for facility alerts' using errcode = '42501';
  end if;

  -- Serialise concurrent requests for this actor so parallel calls cannot bypass the quota.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_actor_id::text, 0));
  select pg_catalog.count(*) into recent_count
  from public.email_alert_log e
  where e.actor_id = p_actor_id
    and e.created_at >= pg_catalog.now() - interval '1 hour';

  if recent_count >= 10 then
    return false;
  end if;

  insert into public.email_alert_log (facility_id, actor_id, event_type)
  values (p_facility_id, p_actor_id, p_event_type);
  return true;
end;
$$;

create index if not exists facility_members_user_active_idx on public.facility_members (user_id, is_active, facility_id);
create index if not exists patients_facility_created_idx on public.patients (facility_id, created_at desc);
create index if not exists patients_facility_name_idx on public.patients (facility_id, last_name, first_name);
create index if not exists encounters_facility_date_idx on public.encounters (facility_id, encounter_date desc);
create index if not exists encounters_patient_date_idx on public.encounters (patient_id, encounter_date desc);
create index if not exists referrals_facility_date_idx on public.referrals (facility_id, created_at desc);
create index if not exists followups_facility_due_idx on public.follow_ups (facility_id, due_date asc);
create index if not exists audit_facility_date_idx on public.audit_events (facility_id, occurred_at desc);
create index if not exists email_alert_rate_idx on public.email_alert_log (actor_id, created_at desc);

create or replace function public.is_facility_member(target_facility uuid)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.facility_members fm
    where fm.facility_id = target_facility
      and fm.user_id = auth.uid()
      and fm.is_active = true
  );
$$;

create or replace function public.can_document_clinical_care(target_facility uuid)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.facility_members fm
    where fm.facility_id = target_facility
      and fm.user_id = auth.uid()
      and fm.is_active = true
      and fm.role in ('facility_admin','clinician')
  );
$$;

create or replace function public.can_manage_patient_demographics(target_facility uuid)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.facility_members fm
    where fm.facility_id = target_facility
      and fm.user_id = auth.uid()
      and fm.is_active = true
      and fm.role in ('facility_admin','clinician','records_officer')
  );
$$;

create or replace function public.is_facility_admin(target_facility uuid)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.facility_members fm
    where fm.facility_id = target_facility
      and fm.user_id = auth.uid()
      and fm.is_active = true
      and fm.role = 'facility_admin'
  );
$$;

create or replace function public.set_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at = pg_catalog.now();
  return new;
end;
$$;

create or replace function public.write_audit_event()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  target_facility uuid;
  target_id uuid;
begin
  target_facility := coalesce(new.facility_id, old.facility_id);
  target_id := coalesce(new.id, old.id);
  insert into public.audit_events (facility_id, actor_id, entity_type, entity_id, action)
  values (target_facility, auth.uid(), tg_table_name, target_id, tg_op);
  return new;
end;
$$;

create trigger facilities_updated_at before update on public.facilities for each row execute function public.set_updated_at();
create trigger patients_updated_at before update on public.patients for each row execute function public.set_updated_at();
create trigger encounters_updated_at before update on public.encounters for each row execute function public.set_updated_at();
create trigger referrals_updated_at before update on public.referrals for each row execute function public.set_updated_at();
create trigger followups_updated_at before update on public.follow_ups for each row execute function public.set_updated_at();

create trigger audit_facility_members after insert or update on public.facility_members for each row execute function public.write_audit_event();
create trigger audit_patients after insert or update on public.patients for each row execute function public.write_audit_event();
create trigger audit_encounters after insert or update on public.encounters for each row execute function public.write_audit_event();
create trigger audit_referrals after insert or update on public.referrals for each row execute function public.write_audit_event();
create trigger audit_followups after insert or update on public.follow_ups for each row execute function public.write_audit_event();

alter table public.facilities enable row level security;
alter table public.facility_members enable row level security;
alter table public.patients enable row level security;
alter table public.encounters enable row level security;
alter table public.referrals enable row level security;
alter table public.follow_ups enable row level security;
alter table public.audit_events enable row level security;
alter table public.email_alert_log enable row level security;

create policy "members read their facilities" on public.facilities
  for select to authenticated using (public.is_facility_member(id));

create policy "members read facility membership" on public.facility_members
  for select to authenticated using (user_id = auth.uid() or public.is_facility_admin(facility_id));
create policy "admins add facility members" on public.facility_members
  for insert to authenticated with check (public.is_facility_admin(facility_id));
create policy "admins update facility members" on public.facility_members
  for update to authenticated using (public.is_facility_admin(facility_id)) with check (public.is_facility_admin(facility_id));

create policy "facility members read patients" on public.patients
  for select to authenticated using (public.is_facility_member(facility_id));
create policy "facility members add patients" on public.patients
  for insert to authenticated with check (public.can_manage_patient_demographics(facility_id) and created_by = auth.uid() and privacy_notice_acknowledged = true and privacy_notice_version is not null and privacy_notice_recorded_at is not null);
create policy "facility members update patients" on public.patients
  for update to authenticated using (public.can_manage_patient_demographics(facility_id)) with check (public.can_manage_patient_demographics(facility_id));

create policy "clinical staff read encounters" on public.encounters
  for select to authenticated using (public.can_document_clinical_care(facility_id));
create policy "facility members add encounters" on public.encounters
  for insert to authenticated with check (public.can_document_clinical_care(facility_id) and created_by = auth.uid());
create policy "facility members update encounters" on public.encounters
  for update to authenticated using (public.can_document_clinical_care(facility_id)) with check (public.can_document_clinical_care(facility_id));

create policy "clinical staff read referrals" on public.referrals
  for select to authenticated using (public.can_document_clinical_care(facility_id));
create policy "facility members add referrals" on public.referrals
  for insert to authenticated with check (public.can_document_clinical_care(facility_id) and created_by = auth.uid());
create policy "facility members update referrals" on public.referrals
  for update to authenticated using (public.can_document_clinical_care(facility_id)) with check (public.can_document_clinical_care(facility_id));

create policy "clinical staff read followups" on public.follow_ups
  for select to authenticated using (public.can_document_clinical_care(facility_id));
create policy "facility members add followups" on public.follow_ups
  for insert to authenticated with check (public.can_document_clinical_care(facility_id) and created_by = auth.uid());
create policy "facility members update followups" on public.follow_ups
  for update to authenticated using (public.can_document_clinical_care(facility_id)) with check (public.can_document_clinical_care(facility_id));

create policy "facility admins read audit events" on public.audit_events
  for select to authenticated using (public.is_facility_admin(facility_id));

-- Start from an explicit deny baseline; grant only the operations and columns the app needs.
revoke all on public.facilities, public.facility_members, public.patients, public.encounters,
  public.referrals, public.follow_ups, public.audit_events, public.email_alert_log
  from public, anon, authenticated;

grant usage on schema public to authenticated, service_role;

grant select on public.facilities, public.facility_members, public.patients, public.encounters,
  public.referrals, public.follow_ups, public.audit_events to authenticated;

-- Immutable identity/ownership columns (id, facility_id, patient_id, created_by, created_at)
-- are deliberately excluded from UPDATE grants.
grant insert (facility_id, user_id, full_name, role, is_active) on public.facility_members to authenticated;
grant update (full_name, role, is_active) on public.facility_members to authenticated;

grant insert (facility_id, mrn, first_name, last_name, date_of_birth, sex, phone, address,
  record_status, privacy_notice_acknowledged, privacy_notice_version, privacy_notice_recorded_at, created_by)
  on public.patients to authenticated;
grant update (first_name, last_name, date_of_birth, sex, phone, address, record_status)
  on public.patients to authenticated;

grant insert (facility_id, patient_id, encounter_date, visit_type, chief_complaint, assessment, plan, created_by)
  on public.encounters to authenticated;
grant update (encounter_date, visit_type, chief_complaint, assessment, plan)
  on public.encounters to authenticated;

grant insert (facility_id, patient_id, destination_name, reason, urgency, referral_status, created_by)
  on public.referrals to authenticated;
grant update (destination_name, reason, urgency, referral_status)
  on public.referrals to authenticated;

grant insert (facility_id, patient_id, due_date, followup_status, outcome, created_by)
  on public.follow_ups to authenticated;
grant update (due_date, followup_status, outcome)
  on public.follow_ups to authenticated;

-- Only the Edge Function service role can access notification logs or quota RPC.
grant select on public.facilities, public.facility_members, public.referrals, public.follow_ups to service_role;
grant insert, select on public.email_alert_log to service_role;
revoke all on function public.consume_email_alert_quota(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.consume_email_alert_quota(uuid, uuid, text) to service_role;

revoke all on function public.is_facility_member(uuid) from public, anon;
revoke all on function public.is_facility_admin(uuid) from public, anon;
revoke all on function public.can_document_clinical_care(uuid) from public, anon;
revoke all on function public.can_manage_patient_demographics(uuid) from public, anon;
grant execute on function public.is_facility_member(uuid) to authenticated;
grant execute on function public.is_facility_admin(uuid) to authenticated;
grant execute on function public.can_document_clinical_care(uuid) to authenticated;
grant execute on function public.can_manage_patient_demographics(uuid) to authenticated;

-- Initial facility and first administrator are created separately after the first auth user exists.
-- See README.md for the exact bootstrap SQL. Do not enable public sign-up for real patient-data use.

revoke all on function public.set_updated_at() from public, anon, authenticated;
revoke all on function public.write_audit_event() from public, anon, authenticated;
