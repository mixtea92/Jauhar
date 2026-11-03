-- Reference only: already applied to the JIMS STAGING database using Supabase migrations.
-- Do not rerun automatically. Not a production deployment.
create schema if not exists private;
create table if not exists private.jims_wa_approval_requests (
  id uuid primary key default gen_random_uuid(),
  voucher_id uuid not null references public.payment_vouchers(id),
  approval_round integer not null check(approval_round >= 1),
  authority text not null check(authority in ('ceo','bod')),
  approver_id uuid not null references public.user_profiles(id),
  recipient_e164 text not null check(recipient_e164 ~ '^([+])[1-9][0-9]{7,14}$'),
  state text not null default 'draft' check(state in (
    'draft','queued','sent','intent_received','awaiting_mfa',
    'cancelled','expired','failed','completed'
  )),
  requested_action text check(requested_action in ('approve','return','reject')),
  meta_outbound_message_id text unique,
  created_at timestamptz not null default now(),
  sent_at timestamptz, responded_at timestamptz,
  expires_at timestamptz not null default(now()+interval '15 minutes'),
  updated_at timestamptz not null default now(),
  constraint jims_wa_expiration_after_creation check(expires_at>created_at),
  constraint jims_wa_action_requires_intent check(
    requested_action is null or state in ('intent_received','awaiting_mfa','cancelled','expired','failed','completed')
  )
);
create unique index if not exists jims_wa_active_pv_authority_unique
  on private.jims_wa_approval_requests(voucher_id,approval_round,authority,approver_id)
  where state in ('queued','sent','intent_received','awaiting_mfa');
create index if not exists jims_wa_pending_expiry
  on private.jims_wa_approval_requests(expires_at)
  where state in ('queued','sent','intent_received','awaiting_mfa');
create table if not exists private.jims_wa_webhook_events (
  provider_message_id text primary key,
  request_id uuid references private.jims_wa_approval_requests(id),
  action text check(action in ('approve','return','reject')),
  outcome text not null check(outcome in ('intent_recorded','ignored','rejected')),
  received_at timestamptz not null default now()
);
alter table private.jims_wa_approval_requests enable row level security;
alter table private.jims_wa_webhook_events enable row level security;
revoke all on private.jims_wa_approval_requests from public,anon,authenticated;
revoke all on private.jims_wa_webhook_events from public,anon,authenticated;
