# Bug Audit Report

## Scope
Repository audited: `QuotingFast/AiOutboundAgent`

## What I ran
- `npm ci`
- `npm run build`
- Local app smoke run with env overrides:
  - `BASE_URL=http://127.0.0.1:3055 PORT=3055 TWILIO_ACCOUNT_SID=ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx TWILIO_AUTH_TOKEN=test OPENAI_API_KEY=test npm run dev`
  - `BASE_URL=http://127.0.0.1:3055 npm run smoke -- http://127.0.0.1:3055`
- Campaign test harness:
  - `SKIP_ENV_VALIDATION=true npx ts-node src/campaign/__tests__/campaign.test.ts`

## Bugs found and fixed

### 1) Weblead auto-dial lost campaign context before media stream
**Root cause:** In `/webhook/weblead`, `registerPendingSession` did not pass `campaignId`, so follow-on stream handling could fall back to default profile/voice instead of campaign-specific settings.

**Fix:** Pass `campaignCtx?.campaignId || resolvedCampaignId` into `registerPendingSession`.

**File changed:**
- `src/server/routes.ts`

---

### 2) Strict env validation blocked unit/integration imports in test tooling
**Root cause:** `src/config/index.ts` threw on missing required env vars at module import time. This broke test-only paths that do not need live provider credentials.

**Fix:** Added opt-in bypass with `SKIP_ENV_VALIDATION=true` that returns placeholder values for required envs instead of throwing.

**File changed:**
- `src/config/index.ts`

---

### 3) Smoke script failure mode was misleading when wrong service responded
**Root cause:** `scripts/smoke.js` always parsed `/health` as JSON. If a different process served HTML on that host/port, it failed with a generic JSON parse error.

**Fix:** Added content-type guard and improved error with status + response prefix.

**File changed:**
- `scripts/smoke.js`

## Verification results
- `npm run build` ✅
- Smoke checks against local run ✅ (health, validation, TwiML, WebSocket)
- Campaign test harness still has **pre-existing expectation drift** (6 failures) unrelated to compile/runtime stability:
  - hardcoded old persona names/company names
  - expected resolver priority differs from implementation comments/code (explicit campaign currently wins)
  - expected scheduled callback voice id differs from seeded data

## Remaining risks / TODOs
1. Align `src/campaign/__tests__/campaign.test.ts` expected fixtures with current campaign seed data and resolver policy.
2. Decide and document canonical resolver priority (explicit campaign vs DID precedence) and update either tests or resolver accordingly.
3. Consider adding npm scripts for tests (e.g., `test:campaign`) to standardize CI execution.
