# Quoting Fast Platform Rebuild — Current State vs Target State

Date: 2026-07-02 · Branch: `claude/quoting-fast-platform-rebuild-7mlcql`

## 1. Current-State Findings (full-repo audit)

### What exists and works well (preserved)
- **Realtime voice pipeline** (`src/audio/stream.ts`): OpenAI Realtime GA API (µ-law
  end-to-end), semantic VAD, manual response gating (fixes phantom-VAD double-fires),
  debounced barge-in with echo suppression, transcript acceptance gate, greeting-hold
  vs AMD, four voice providers (OpenAI speech-to-speech, ElevenLabs, Deepgram, DeepSeek).
- **Weblead ingestion** (`/webhook/weblead`, `/webhooks/jangl`): defensive parsing of
  Jangl-style payloads, TrustedForm/TCPA metadata capture, campaign resolution,
  synchronous speed-to-lead auto-dial (opt-in).
- **Campaign isolation** (`src/campaign/*`): fail-closed campaign resolution
  (explicit > DID > lead > history), per-campaign AI profile/voice/transfer routes,
  enforcement middleware, TCPA-window-aware campaign callback worker with per-area-code
  timezone inference.
- **Prompt engineering** (`src/agent/prompts.ts`): tight qualification state machine
  (identity → recording disclosure → carrier → tenure → vehicles → record → transfer),
  tool-call transfer with a code-level affirmative-consent gate, objection table,
  voicemail/wrong-party/opt-out handling, auto-DNC on spoken opt-out phrases.
- **VICIdial/AudioSocket bridge**, dual persistence backend (Postgres kv / JSON files),
  AMD, recording capture, voice preset library.

### Critical gaps found (each fixed or mitigated in this rebuild)

| # | Finding | Severity | Where |
|---|---------|----------|-------|
| 1 | **DNC list, consent store, and audit log are in-memory only — wiped on every deploy.** Direct TCPA exposure. | Critical | `src/compliance/index.ts` |
| 2 | **SMS STOP/opt-out is not handled at all.** Inbound SMS webhook logs and ignores STOP. | Critical | `routes.ts /twilio/sms-incoming` |
| 3 | **Zero authentication** on the dashboard and every API (dial, SMS, DNC mutation, settings). No Twilio signature validation, no weblead webhook secret. | Critical | server layer |
| 4 | **Consent is recorded but never enforced** — missing consent only warns pre-call. | High | `compliance/runPreCallComplianceCheck` |
| 5 | **Two callback schedulers persist to the same key** (`scheduled_callbacks`) and clobber each other. Legacy scheduler has no TCPA window at all. | High | `scheduler/index.ts` vs `campaign/store.ts` |
| 6 | **Transfer route business hours/days are defined but never evaluated**; the LLM picks the route by name-substring match; no buyer capacity/priority/state eligibility; no handoff packet; "warm transfer" is a blind TwiML redirect (whisper only). | High | `stream.ts:1767+`, `twiml.ts` |
| 7 | **Inbound prompt instructs the agent to affirmatively lie about being human** ("No no, I'm real"). Outbound deflects; inbound lies. Legal/brand exposure. | High | `prompts.ts:561-571` |
| 8 | Full lead JSON passed in Twilio webhook URL query params (PII in access logs). | Medium | `twilio/client.ts:28-34` |
| 9 | Analytics/transcripts capped at 100 calls in memory, lost on restart; no funnel model, no events ledger. | Medium | `analytics/index.ts` |
| 10 | Per-campaign SMS templates / AI profile lists not persisted (empty after restart). | Medium | `campaign/store.ts` |
| 11 | Phone normalization differs between compliance and campaign store (same number = different keys). | Medium | both |
| 12 | Dashboard is a single 4,116-line template string, 15s full-table polling, cosmetic "Connected"/"Admin" chrome, no live channel. | Medium | `server/dashboard.ts` |
| 13 | No rebuttal analytics, no QA scoring, no cadence engine (only fixed retry delays), no natural-language callback parsing. | Medium | — |
| 14 | `ssl.rejectUnauthorized:false` on the DB pool; fire-and-forget debounced saves. | Low | `db/persistence.ts` |

## 2. Target Architecture

Additive platform layer under `src/platform/` — existing call paths keep working; every
new enforcement point is behind a feature flag so rollout is incremental and reversible.

```
                       ┌────────────────────────────────────────────┐
 Lead sources ───────▶ │  Ingestion  (weblead/Jangl + HMAC secret)  │
 (Jangl, CSV, API)     └───────────────┬────────────────────────────┘
                                       ▼
                       ┌────────────────────────────────────────────┐
                       │  POLICY ENGINE  src/platform/policy.ts     │
                       │  consent scope · DNC · STOP · quiet hours  │
                       │  (lead-local tz) · frequency caps · lead   │
                       │  age · disposition suppression · state     │
                       │  rules — every decision → event ledger     │
                       └───────────────┬────────────────────────────┘
                              allowed  ▼        blocked → Compliance Center
        ┌──────────────────────────────────────────────────┐
        │  CONTACT STRATEGY  src/platform/cadence.ts       │
        │  cadence plans · contact windows · NL callback   │
        │  parsing · SMS follow-up gating                  │
        └───────────────┬──────────────────────────────────┘
                        ▼
        ┌──────────────────────────────────────────────────┐
        │  VOICE ENGINE (existing stream.ts, preserved)    │
        │  + agent profiles (src/platform/profiles.ts)     │
        └───────────────┬──────────────────────────────────┘
                        ▼ qualified + affirmative consent
        ┌──────────────────────────────────────────────────┐
        │  TRANSFER ORCHESTRATION  src/platform/buyers.ts  │
        │  buyer registry (states/hours/caps/priority) ·   │
        │  stage telemetry · handoff packet + webhook ·    │
        │  whisper · fallback-to-callback                  │
        └───────────────┬──────────────────────────────────┘
                        ▼
        ┌──────────────────────────────────────────────────┐
        │  QA + INTELLIGENCE  src/platform/qa.ts,          │
        │  rebuttals.ts, funnel.ts — post-call scoring,    │
        │  objection/rebuttal analytics, funnel metrics    │
        └───────────────┬──────────────────────────────────┘
                        ▼
        ┌──────────────────────────────────────────────────┐
        │  COMMAND CENTER dashboard (SSE live) + AUTH/RBAC │
        │  src/platform/security.ts, dashboard/            │
        └──────────────────────────────────────────────────┘
```

**Event ledger** (`src/platform/events.ts`) is the backbone: append-only, hash-chained,
persisted. Every policy decision, call attempt, transfer stage, SMS, opt-out, config
change, and QA flag is an event. The funnel, compliance exports, and audit trails are
all views over the ledger.

## 3. Data Model (new persisted stores, kv keys)

| Key | Contents |
|-----|----------|
| `platform_events` | Append-only event ledger (hash-chained, capped ring with archival counts) |
| `platform_policy` | Policy engine config (quiet hours, caps, consent enforcement, per-campaign overrides) |
| `platform_buyers` | Buyer/destination registry + daily transfer counters |
| `platform_transfers` | Transfer records with per-stage timestamps + handoff packets |
| `platform_cadence_plans` | Cadence plans (day-bucket windows, attempt caps, SMS steps) |
| `platform_rebuttals` | Versioned objection→rebuttal library + usage stats |
| `platform_objection_events` | Per-call objection/rebuttal outcomes |
| `platform_qa` | QA scores, dimensions, risk flags, review queue state |
| `platform_profiles` | Agent profiles (provider/voice/model/VAD/prompt bundles) + version history |
| `platform_users` | Users, scrypt password hashes, roles, API keys (hashed) |
| `compliance_dnc` / `compliance_consent` / `compliance_audit` | Now-persistent compliance state (was in-memory) |
| `legacy_scheduled_callbacks` / `legacy_scheduled_retries` | Legacy scheduler moved off the colliding key |

Existing keys (`campaigns`, `leads`, `outbound_call_records`, `scheduled_callbacks`,
`did_mappings`, `recordings`, `settings`, `call_history`) unchanged.

## 4. New User Flows

1. **Lead → first dial**: webhook (HMAC-verified) → lead stored + `lead.received` event →
   policy engine evaluates (consent/DNC/window/caps) → allowed: immediate dial
   (speed-to-lead) + `call.attempted`; blocked: visible in Compliance Center with reason.
2. **Qualification → transfer**: agent confirms identity → discloses recording → verifies
   carrier/tenure/vehicles/record → asks permission → `transfer_call` tool → orchestrator
   selects buyer (state, hours, caps, priority) → handoff packet POSTed to buyer webhook →
   whisper briefing → stages recorded (initiated/answered/connected/failed) → failure
   falls back to scheduled callback.
3. **Objection**: objection detected → rebuttal from versioned library (≤ campaign limit)
   → outcome recorded (advanced / callback / opt-out / declined).
4. **Callback**: "call me at 6" → NL parser → confirmed window in lead-local tz →
   campaign-locked worker dials inside window only.
5. **Opt-out**: spoken phrase or SMS STOP → immediate persistent DNC + suppression event +
   SMS confirmation (for STOP) → all channels blocked by policy engine.
6. **Config change**: profile edit → new version stored → audit event → one-click rollback.

## 5. Dashboard Structure (Command Center, `/dashboard`)

Dark-first, SSE-driven live command center (legacy UI preserved at `/dashboard/legacy`):
1. **Command Center** — live calls (speaking-state), transfer queue, buyer availability,
   callback queue, compliance blocks today, provider health, value in motion.
2. **Funnel** — leads → consent-valid → attempted → answered → correct party → verified →
   qualified → transfer offer → accept → buyer connect → quote → policy; drill-down.
3. **Conversation Intelligence** — objection/rebuttal leaderboards, QA scores, risk queue,
   sentiment, talk ratio, repeat-question rate.
4. **Leads & Campaigns** — performance by source/state/insurer/lead-age/voice/script.
5. **Compliance Center** — blocked outreach, DNC/STOP events, consent failures, exports.
6. **Configuration Studio** — campaigns, agent profiles (+versions/rollback), buyers &
   routing, cadence plans, rebuttal library, policy rules, feature flags.
7. **Executive Reports** — daily flash, buyer performance, voice/model comparison.

## 6. Implementation Plan / Rollout

| Phase | Content | Flag |
|-------|---------|------|
| 0 | Persist DNC/consent/audit; SMS STOP handling; scheduler key split; inbound-prompt honesty fix | always-on (safety) |
| 1 | Event ledger + policy engine wired into `/call/start`, weblead auto-dial, SMS send | `policy_engine_enforced` (DNC/STOP always enforced; consent gate via `policy_consent_required`) |
| 2 | Transfer orchestration + buyer registry + handoff packets | `transfer_orchestration_enabled` |
| 3 | Cadence engine + NL callback parsing | `cadence_engine_enabled` |
| 4 | Rebuttal library + QA scoring | passive (analytics only) |
| 5 | Auth/RBAC + Twilio signature + weblead HMAC | `ADMIN_PASSWORD` / `TWILIO_VALIDATE_SIGNATURE` / `WEBLEAD_SHARED_SECRET` env |
| 6 | Command Center dashboard + SSE | replaces `/dashboard`, legacy kept |
| 7 | Seeded demo data + automated tests | `POST /api/v2/demo/seed` |

Backward compatibility: no existing endpoint changes shape; all new APIs live under
`/api/v2/*`; enforcement points no-op when flags are off (except DNC persistence and
STOP handling, which are unconditional safety fixes).

## 7. Known compliance-policy decision made in this rebuild

The inbound prompt previously instructed the agent to claim to be human when asked
("No no, I'm real… Yeah, of course."). This was changed to match the outbound stance
(deflect, never affirmatively claim to be human, exit politely after repeated pushes).
Several states now regulate AI voice disclosure; an operator-facing toggle for full
proactive disclosure is the recommended next step.
