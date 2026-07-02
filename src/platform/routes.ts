// ── Platform API (v2) ──────────────────────────────────────────────
// All new platform capabilities live under /api/v2/*. Legacy /api/*
// endpoints are untouched. Auth is enforced when configured (see
// security.ts); mutation endpoints require operator/admin roles.

import { Router, Request, Response } from 'express';
import { queryEvents, verifyLedger, ledgerStats, onEvent, recordEvent, PlatformEvent } from './events';
import {
  getPolicyConfig, updatePolicyConfig, evaluateOutreach, listSuppressions,
  recordComplaint, recordSmsStop, clearSmsStop,
} from './policy';
import {
  listBuyers, getBuyer, upsertBuyer, deleteBuyer, selectBuyer, evaluateBuyer,
  listTransfers, updateTransferStage,
} from './buyers';
import {
  listCadencePlans, getCadencePlan, upsertCadencePlan, deleteCadencePlan,
  computeNextAttempt, parseCallbackRequest,
} from './cadence';
import {
  getObjectionLibrary, getObjectionStats, addRebuttalVariant, updateRebuttalVariant,
  setObjectionLimit, recordObjectionOutcome, ObjectionCode,
} from './rebuttals';
import { listQaScores, getQaScore, reviewQaScore, qaSummary, scoreCall } from './qa';
import {
  listProfiles, getProfile, upsertProfile, deleteProfile, rollbackProfile,
  applyProfileToRuntime, applyProfileToCampaign,
} from './profiles';
import { getFunnel, getBreakdown, getLiveOps, getConversationIntelligence } from './funnel';
import { requireAuth, AuthedRequest, actorOf, login, logout, listUsers, createUser, deleteUser, authEnabled } from './security';
import {
  getLifecycleConfig, updateLifecycleConfig, getLeadLifecycle, createTrackedLink,
  handleLinkClick, recordWebformSubmission, recordOfferClick, recordConversion,
  revenueSummary, listConversions, renewalPipeline, runRenewalScan, ConversionType,
} from './lifecycle';
import {
  getJourneyDefinitions, upsertJourneyDefinition, getJourneyState, journeyStats,
  journeyResume, enterJourney, processDueJourneySteps,
} from './journey';
import { buildLeadProfile } from './leadprofile';
import { composeSms, SmsIntent } from './humanizer';
import { getSettings } from '../config/runtime';
import { seedDemoData } from './demo';
import { getDncList, getConsent, recordConsent } from '../compliance';
import { logger } from '../utils/logger';

export const platformRouter = Router();

// ── Auth ────────────────────────────────────────────────────────────

platformRouter.post('/api/v2/auth/login', (req: Request, res: Response) => {
  const { username, password } = req.body || {};
  if (!username || !password) { res.status(400).json({ error: 'username and password required' }); return; }
  const result = login(String(username), String(password), req.ip || 'unknown');
  if ('error' in result) { res.status(401).json(result); return; }
  res.setHeader('Set-Cookie', `qf_session=${result.token}; HttpOnly; Path=/; Max-Age=43200; SameSite=Lax`);
  res.json({ ok: true, role: result.role, username: result.username });
});

platformRouter.post('/api/v2/auth/logout', (req: Request, res: Response) => {
  const cookie = req.headers.cookie;
  const m = cookie ? /(?:^|;\s*)qf_session=([a-f0-9]{64})/.exec(cookie) : null;
  if (m) logout(m[1]);
  res.setHeader('Set-Cookie', 'qf_session=; HttpOnly; Path=/; Max-Age=0');
  res.json({ ok: true });
});

platformRouter.get('/api/v2/auth/me', requireAuth('viewer'), (req: AuthedRequest, res: Response) => {
  res.json({ authEnabled: authEnabled(), user: req.auth || { username: 'anonymous', role: 'admin' } });
});

platformRouter.get('/api/v2/auth/users', requireAuth('admin'), (_req, res) => res.json(listUsers()));
platformRouter.post('/api/v2/auth/users', requireAuth('admin'), (req: AuthedRequest, res) => {
  const { username, password, role } = req.body || {};
  const result = createUser(String(username || ''), String(password || ''), role || 'viewer', actorOf(req));
  if ('error' in result) { res.status(400).json(result); return; }
  const { scryptHash: _h, ...safe } = result;
  res.status(201).json(safe);
});
platformRouter.delete('/api/v2/auth/users/:id', requireAuth('admin'), (req: AuthedRequest, res) => {
  res.json({ deleted: deleteUser(req.params.id, actorOf(req)) });
});

// ── Live ops, funnel, intelligence ──────────────────────────────────

platformRouter.get('/api/v2/liveops', requireAuth('viewer'), (_req, res) => res.json(getLiveOps()));

platformRouter.get('/api/v2/funnel', requireAuth('viewer'), (req, res) => {
  res.json(getFunnel({
    since: req.query.since as string | undefined,
    until: req.query.until as string | undefined,
    campaignId: req.query.campaignId as string | undefined,
  }));
});

platformRouter.get('/api/v2/breakdown/:dimension', requireAuth('viewer'), (req, res) => {
  const dim = req.params.dimension as 'campaignId' | 'state' | 'source' | 'insurer';
  if (!['campaignId', 'state', 'source', 'insurer'].includes(dim)) {
    res.status(400).json({ error: 'dimension must be campaignId|state|source|insurer' });
    return;
  }
  res.json(getBreakdown(dim, { since: req.query.since as string | undefined }));
});

platformRouter.get('/api/v2/intelligence', requireAuth('viewer'), (_req, res) => res.json(getConversationIntelligence()));

// ── Events / audit ledger ───────────────────────────────────────────

platformRouter.get('/api/v2/events', requireAuth('viewer'), (req, res) => {
  res.json(queryEvents({
    type: req.query.type as never,
    typePrefix: req.query.typePrefix as string | undefined,
    phone: req.query.phone as string | undefined,
    callSid: req.query.callSid as string | undefined,
    campaignId: req.query.campaignId as string | undefined,
    since: req.query.since as string | undefined,
    until: req.query.until as string | undefined,
    limit: req.query.limit ? parseInt(String(req.query.limit), 10) : 100,
    offset: req.query.offset ? parseInt(String(req.query.offset), 10) : 0,
  }));
});

platformRouter.get('/api/v2/events/verify', requireAuth('compliance'), (_req, res) => {
  res.json({ ...verifyLedger(), ...ledgerStats() });
});

// Compliance review export: everything the ledger knows about one lead.
platformRouter.get('/api/v2/compliance/export/:phone', requireAuth('compliance'), (req: AuthedRequest, res) => {
  const phone = req.params.phone;
  const { events } = queryEvents({ phone, limit: 5000 });
  const consent = getConsent(phone);
  const pkg = {
    generatedAt: new Date().toISOString(),
    generatedBy: actorOf(req),
    phone,
    consent: consent || null,
    onDnc: getDncList().includes(phone.replace(/\D/g, '').replace(/^1/, '')),
    suppressions: listSuppressions(),
    eventCount: events.length,
    events,
    ledgerIntegrity: verifyLedger(),
  };
  recordEvent('export.compliance', { phone }, { actor: actorOf(req), phone });
  res.setHeader('Content-Disposition', `attachment; filename="compliance-${phone.replace(/\D/g, '')}.json"`);
  res.json(pkg);
});

platformRouter.get('/api/v2/compliance/suppressions', requireAuth('compliance'), (_req, res) => res.json(listSuppressions()));

platformRouter.post('/api/v2/compliance/complaint', requireAuth('compliance'), (req: AuthedRequest, res) => {
  const { phone, note } = req.body || {};
  if (!phone) { res.status(400).json({ error: 'phone required' }); return; }
  recordComplaint(String(phone), String(note || ''), actorOf(req));
  res.json({ ok: true });
});

platformRouter.post('/api/v2/compliance/sms-stop', requireAuth('compliance'), (req: AuthedRequest, res) => {
  const { phone, clear } = req.body || {};
  if (!phone) { res.status(400).json({ error: 'phone required' }); return; }
  if (clear) clearSmsStop(String(phone), actorOf(req));
  else recordSmsStop(String(phone), 'manual');
  res.json({ ok: true });
});

platformRouter.post('/api/v2/compliance/consent', requireAuth('operator'), (req, res) => {
  const { phone, consentType, source, trustedFormUrl, jornayaId, ip } = req.body || {};
  if (!phone || !source) { res.status(400).json({ error: 'phone and source required' }); return; }
  recordConsent({
    phone: String(phone),
    consentType: consentType || 'express',
    source: String(source),
    timestamp: new Date().toISOString(),
    trustedFormUrl, jornayaId, ip,
  });
  res.json({ ok: true });
});

// ── Policy engine ───────────────────────────────────────────────────

platformRouter.get('/api/v2/policy', requireAuth('viewer'), (_req, res) => res.json(getPolicyConfig()));

platformRouter.put('/api/v2/policy', requireAuth('admin'), (req: AuthedRequest, res) => {
  res.json(updatePolicyConfig(req.body || {}, actorOf(req)));
});

platformRouter.post('/api/v2/policy/evaluate', requireAuth('viewer'), (req, res) => {
  const { channel, phone, state, campaignId, leadCreatedAt, isCallback } = req.body || {};
  if (!phone || !['call', 'sms'].includes(channel)) {
    res.status(400).json({ error: 'channel (call|sms) and phone required' });
    return;
  }
  res.json(evaluateOutreach({ channel, phone, state, campaignId, leadCreatedAt, isCallback }));
});

// ── Buyers & transfers ──────────────────────────────────────────────

platformRouter.get('/api/v2/buyers', requireAuth('viewer'), (_req, res) => {
  // Strip auth headers from the payload sent to the browser.
  res.json(listBuyers().map(({ handoffAuthHeader: _a, ...b }) => ({ ...b, hasAuthHeader: Boolean(_a) })));
});

platformRouter.post('/api/v2/buyers', requireAuth('operator'), (req: AuthedRequest, res) => {
  const body = req.body || {};
  if (!body.name || !body.destinationNumber) { res.status(400).json({ error: 'name and destinationNumber required' }); return; }
  const { handoffAuthHeader: _a, ...safe } = upsertBuyer(body, actorOf(req));
  res.status(201).json(safe);
});

platformRouter.delete('/api/v2/buyers/:id', requireAuth('operator'), (req: AuthedRequest, res) => {
  res.json({ deleted: deleteBuyer(req.params.id, actorOf(req)) });
});

platformRouter.post('/api/v2/buyers/select', requireAuth('viewer'), (req, res) => {
  const { selected, ranked } = selectBuyer(req.body || {});
  res.json({
    selected: selected ? { buyerId: selected.buyer.id, name: selected.buyer.name, reasons: selected.reasons } : null,
    ranked: ranked.map(r => ({ buyerId: r.buyer.id, name: r.buyer.name, eligible: r.eligible, reasons: r.reasons, transfersToday: r.transfersToday })),
  });
});

platformRouter.get('/api/v2/buyers/:id/evaluate', requireAuth('viewer'), (req, res) => {
  const buyer = getBuyer(req.params.id);
  if (!buyer) { res.status(404).json({ error: 'buyer not found' }); return; }
  const evaln = evaluateBuyer(buyer, {
    state: req.query.state as string | undefined,
    currentInsurer: req.query.insurer as string | undefined,
  });
  res.json({ eligible: evaln.eligible, reasons: evaln.reasons, transfersToday: evaln.transfersToday });
});

platformRouter.get('/api/v2/transfers', requireAuth('viewer'), (req, res) => {
  res.json(listTransfers({
    limit: req.query.limit ? parseInt(String(req.query.limit), 10) : 100,
    buyerId: req.query.buyerId as string | undefined,
    since: req.query.since as string | undefined,
  }).map(t => ({ ...t, handoffPacket: undefined, hasPacket: Boolean(t.handoffPacket) })));
});

platformRouter.get('/api/v2/transfers/:id/packet', requireAuth('operator'), (req, res) => {
  const t = listTransfers({ limit: 5000 }).find(x => x.id === req.params.id);
  if (!t) { res.status(404).json({ error: 'transfer not found' }); return; }
  res.json(t.handoffPacket || null);
});

platformRouter.post('/api/v2/transfers/:id/stage', requireAuth('operator'), (req, res) => {
  const { stage, failureReason } = req.body || {};
  const rec = updateTransferStage(req.params.id, stage, failureReason);
  if (!rec) { res.status(404).json({ error: 'transfer not found' }); return; }
  res.json({ ok: true, currentStage: rec.currentStage });
});

// ── Cadence & callbacks ─────────────────────────────────────────────

platformRouter.get('/api/v2/cadence/plans', requireAuth('viewer'), (_req, res) => res.json(listCadencePlans()));

platformRouter.post('/api/v2/cadence/plans', requireAuth('operator'), (req: AuthedRequest, res) => {
  const body = req.body || {};
  if (!body.name || !Array.isArray(body.steps)) { res.status(400).json({ error: 'name and steps[] required' }); return; }
  res.status(201).json(upsertCadencePlan(body, actorOf(req)));
});

platformRouter.delete('/api/v2/cadence/plans/:id', requireAuth('operator'), (req: AuthedRequest, res) => {
  res.json({ deleted: deleteCadencePlan(req.params.id, actorOf(req)) });
});

platformRouter.post('/api/v2/cadence/next-attempt', requireAuth('viewer'), (req, res) => {
  const { planId, leadSubmittedAt, attempts, state, phone } = req.body || {};
  const plan = getCadencePlan(planId) || listCadencePlans()[0];
  if (!plan || !leadSubmittedAt) { res.status(400).json({ error: 'planId and leadSubmittedAt required' }); return; }
  res.json(computeNextAttempt({ plan, leadSubmittedAt, attempts: attempts || [], state, phone }));
});

platformRouter.post('/api/v2/cadence/parse-callback', requireAuth('viewer'), (req, res) => {
  const { text, state, phone } = req.body || {};
  res.json(parseCallbackRequest(String(text || ''), { state, phone }));
});

// ── Rebuttals ───────────────────────────────────────────────────────

platformRouter.get('/api/v2/rebuttals', requireAuth('viewer'), (_req, res) => res.json(getObjectionLibrary()));
platformRouter.get('/api/v2/rebuttals/stats', requireAuth('viewer'), (_req, res) => res.json(getObjectionStats()));

platformRouter.post('/api/v2/rebuttals/:code/variants', requireAuth('operator'), (req: AuthedRequest, res) => {
  const v = addRebuttalVariant(req.params.code as ObjectionCode, String(req.body?.text || ''), actorOf(req));
  if (!v) { res.status(404).json({ error: 'objection code not found' }); return; }
  res.status(201).json(v);
});

platformRouter.put('/api/v2/rebuttals/:code/variants/:variantId', requireAuth('operator'), (req: AuthedRequest, res) => {
  const v = updateRebuttalVariant(req.params.code as ObjectionCode, req.params.variantId, req.body || {}, actorOf(req));
  if (!v) { res.status(404).json({ error: 'variant not found' }); return; }
  res.json(v);
});

platformRouter.put('/api/v2/rebuttals/:code/limit', requireAuth('operator'), (req: AuthedRequest, res) => {
  setObjectionLimit(req.params.code as ObjectionCode, parseInt(String(req.body?.maxAttempts ?? 1), 10), actorOf(req));
  res.json({ ok: true });
});

platformRouter.post('/api/v2/rebuttals/outcome', requireAuth('operator'), (req, res) => {
  const { code, variantId, outcome, callSid, campaignId, phone } = req.body || {};
  if (!code || !outcome) { res.status(400).json({ error: 'code and outcome required' }); return; }
  recordObjectionOutcome({ code, variantId, outcome, callSid, campaignId, phone });
  res.json({ ok: true });
});

// ── QA ──────────────────────────────────────────────────────────────

platformRouter.get('/api/v2/qa', requireAuth('viewer'), (req, res) => {
  res.json(listQaScores({
    limit: req.query.limit ? parseInt(String(req.query.limit), 10) : 100,
    flaggedOnly: req.query.flagged === 'true',
    campaignId: req.query.campaignId as string | undefined,
  }));
});

platformRouter.get('/api/v2/qa/summary', requireAuth('viewer'), (_req, res) => res.json(qaSummary()));
platformRouter.get('/api/v2/qa/call/:callSid', requireAuth('viewer'), (req, res) => {
  const s = getQaScore(req.params.callSid);
  if (!s) { res.status(404).json({ error: 'no QA score for call' }); return; }
  res.json(s);
});

platformRouter.post('/api/v2/qa/score', requireAuth('operator'), (req, res) => {
  const body = req.body || {};
  if (!body.callSid || !Array.isArray(body.transcript)) { res.status(400).json({ error: 'callSid and transcript[] required' }); return; }
  res.status(201).json(scoreCall(body));
});

platformRouter.post('/api/v2/qa/:id/review', requireAuth('compliance'), (req: AuthedRequest, res) => {
  const s = reviewQaScore(req.params.id, actorOf(req), String(req.body?.note || ''));
  if (!s) { res.status(404).json({ error: 'score not found' }); return; }
  res.json(s);
});

// ── Agent profiles ──────────────────────────────────────────────────

platformRouter.get('/api/v2/profiles', requireAuth('viewer'), (_req, res) => res.json(listProfiles()));
platformRouter.get('/api/v2/profiles/:id', requireAuth('viewer'), (req, res) => {
  const p = getProfile(req.params.id);
  if (!p) { res.status(404).json({ error: 'profile not found' }); return; }
  res.json(p);
});

platformRouter.post('/api/v2/profiles', requireAuth('operator'), (req: AuthedRequest, res) => {
  const body = req.body || {};
  if (!body.name || !body.settings) { res.status(400).json({ error: 'name and settings required' }); return; }
  res.status(201).json(upsertProfile(body, actorOf(req)));
});

platformRouter.delete('/api/v2/profiles/:id', requireAuth('operator'), (req: AuthedRequest, res) => {
  res.json({ deleted: deleteProfile(req.params.id, actorOf(req)) });
});

platformRouter.post('/api/v2/profiles/:id/rollback', requireAuth('operator'), (req: AuthedRequest, res) => {
  const p = rollbackProfile(req.params.id, parseInt(String(req.body?.toVersion), 10), actorOf(req));
  if (!p) { res.status(404).json({ error: 'profile or version not found' }); return; }
  res.json(p);
});

platformRouter.post('/api/v2/profiles/:id/apply', requireAuth('operator'), (req: AuthedRequest, res) => {
  const { scope, campaignId } = req.body || {};
  if (scope === 'campaign') {
    if (!campaignId) { res.status(400).json({ error: 'campaignId required for campaign scope' }); return; }
    const ok = applyProfileToCampaign(req.params.id, String(campaignId), actorOf(req));
    if (!ok) { res.status(404).json({ error: 'profile or campaign not found' }); return; }
    res.json({ ok: true });
    return;
  }
  const result = applyProfileToRuntime(req.params.id, actorOf(req));
  if (!result) { res.status(404).json({ error: 'profile not found' }); return; }
  res.json({ ok: true, ...result });
});

// ── Lifecycle revenue engine ────────────────────────────────────────

// Public redirect for tracked links — the consumer clicks this from an
// SMS, so it must work without a session. Tokens are unguessable
// (72-bit random) and leak nothing on miss.
platformRouter.get('/t/:token', (req: Request, res: Response) => {
  const hit = handleLinkClick(req.params.token);
  if (!hit) { res.status(404).send('Link expired'); return; }
  res.redirect(302, hit.destination);
});

// Webform-submission postback from the form host. Lives under /webhook
// so the WEBLEAD_SHARED_SECRET guard applies when configured.
// A submission ALWAYS renews the TCPA opt-in; it only counts as a new
// sellable weblead outside the 30-day cooldown (else flagged duplicate).
platformRouter.post('/webhook/webform-submitted', (req: Request, res: Response) => {
  const { token, phone, campaign_id, trusted_form_cert_url, jornaya_id, source } = req.body || {};
  const result = recordWebformSubmission({
    token, phone, campaignId: campaign_id,
    trustedFormUrl: trusted_form_cert_url, jornayaId: jornaya_id, source,
    payload: req.body,
  });
  if (!result) { res.status(400).json({ error: 'token or phone required' }); return; }
  res.json({
    ok: true,
    duplicate: result.duplicate,
    sellable: !result.duplicate,
    consentRenewedUntil: result.consentRenewedUntil,
    offerWallUrl: result.offerWallUrl,
  });
});

// Offer-click postback from the offer wall / partner network. Unlimited.
platformRouter.post('/webhook/offer-click', (req: Request, res: Response) => {
  const { token, phone, offer_id, payout } = req.body || {};
  const rec = recordOfferClick({ token, phone, offerId: offer_id, payout: payout !== undefined ? Number(payout) : undefined });
  if (!rec) { res.status(400).json({ error: 'token or phone required' }); return; }
  res.json({ ok: true, conversionId: rec.id, value: rec.value });
});

platformRouter.get('/api/v2/lifecycle/config', requireAuth('viewer'), (_req, res) => res.json(getLifecycleConfig()));
platformRouter.put('/api/v2/lifecycle/config', requireAuth('admin'), (req: AuthedRequest, res) => {
  res.json(updateLifecycleConfig(req.body || {}, actorOf(req)));
});

platformRouter.get('/api/v2/lifecycle/pipeline', requireAuth('viewer'), (_req, res) => res.json(renewalPipeline()));

platformRouter.post('/api/v2/lifecycle/scan', requireAuth('operator'), async (_req, res) => {
  // Manual scan never auto-sends; it refreshes the renewal-due ledger.
  res.json(await runRenewalScan());
});

platformRouter.get('/api/v2/lifecycle/lead/:phone', requireAuth('viewer'), (req, res) => {
  res.json(getLeadLifecycle(req.params.phone));
});

platformRouter.get('/api/v2/revenue', requireAuth('viewer'), (req, res) => {
  res.json(revenueSummary({ since: req.query.since as string | undefined }));
});

platformRouter.get('/api/v2/conversions', requireAuth('viewer'), (req, res) => {
  res.json(listConversions({
    phone: req.query.phone as string | undefined,
    type: req.query.type as ConversionType | undefined,
    limit: req.query.limit ? parseInt(String(req.query.limit), 10) : 100,
  }));
});

// Manual conversion recording (e.g. a verified inbound call sold
// without handoff, confirmed by the buyer's postback or an operator).
platformRouter.post('/api/v2/conversions', requireAuth('operator'), (req: AuthedRequest, res) => {
  const { type, phone, campaignId, callSid, value, meta } = req.body || {};
  const valid: ConversionType[] = ['warm_transfer', 'verified_inbound', 'weblead_submission', 'offer_click'];
  if (!phone || !valid.includes(type)) {
    res.status(400).json({ error: `phone and type (${valid.join('|')}) required` });
    return;
  }
  res.status(201).json(recordConversion({ type, phone, campaignId, callSid, value: value !== undefined ? Number(value) : undefined, meta: { ...meta, recordedBy: actorOf(req) } }));
});

// Create a tracked link (and see whether cooldown downgraded it).
platformRouter.post('/api/v2/links', requireAuth('operator'), (req: AuthedRequest, res) => {
  const { phone, kind, campaignId } = req.body || {};
  if (!phone || !['webform', 'offers'].includes(kind)) {
    res.status(400).json({ error: 'phone and kind (webform|offers) required' });
    return;
  }
  res.status(201).json(createTrackedLink(String(phone), kind, { campaignId, sentVia: 'manual' }));
});

// ── Journey funnel ──────────────────────────────────────────────────

platformRouter.get('/api/v2/journey/definitions', requireAuth('viewer'), (_req, res) => res.json(getJourneyDefinitions()));

platformRouter.post('/api/v2/journey/definitions', requireAuth('operator'), (req: AuthedRequest, res) => {
  const def = req.body || {};
  if (!def.id || !Array.isArray(def.steps)) { res.status(400).json({ error: 'id and steps[] required' }); return; }
  res.json(upsertJourneyDefinition(def, actorOf(req)));
});

platformRouter.get('/api/v2/journey/stats', requireAuth('viewer'), (_req, res) => res.json(journeyStats()));

platformRouter.get('/api/v2/journey/lead/:phone', requireAuth('viewer'), (req, res) => {
  const st = getJourneyState(req.params.phone);
  if (!st) { res.status(404).json({ error: 'lead not in a journey' }); return; }
  res.json(st);
});

platformRouter.post('/api/v2/journey/lead/:phone/enter', requireAuth('operator'), (req: AuthedRequest, res) => {
  const st = enterJourney(req.params.phone, { campaignId: req.body?.campaignId, definitionId: req.body?.definitionId });
  if (!st) { res.status(400).json({ error: 'could not enter journey (DNC or no active definition)' }); return; }
  res.json(st);
});

platformRouter.post('/api/v2/journey/lead/:phone/resume', requireAuth('operator'), (req: AuthedRequest, res) => {
  const st = journeyResume(req.params.phone, actorOf(req));
  if (!st) { res.status(400).json({ error: 'lead is not paused (engaged)' }); return; }
  res.json(st);
});

platformRouter.post('/api/v2/journey/tick', requireAuth('operator'), async (_req, res) => {
  res.json({ processed: await processDueJourneySteps() });
});

// Message preview: exactly what a given lead would receive for an
// intent, personalized from their real quote data — for QA before a
// campaign goes live.
platformRouter.post('/api/v2/journey/preview-sms', requireAuth('viewer'), (req, res) => {
  const { phone, intent } = req.body || {};
  if (!phone || !intent) { res.status(400).json({ error: 'phone and intent required' }); return; }
  const profile = buildLeadProfile(String(phone));
  const s = getSettings();
  const spouse = profile.additionalDrivers.find(d => d.relationship === 'spouse');
  const { body, sendDelayMs } = composeSms(String(phone), intent as SmsIntent, {
    firstName: profile.firstName,
    agentName: s.agentName,
    companyName: s.companyName,
    state: profile.state,
    city: profile.city,
    currentInsurer: profile.currentInsurer,
    vehicle: profile.vehicles[0],
    vehicleCount: profile.vehicleCount,
    product: profile.product,
    spouseFirstName: spouse?.firstName,
    additionalDriverCount: profile.additionalDrivers.length,
    hasSr22: profile.hasSr22,
    link: intent === 'link_send' || intent === 'renewal' ? '(tracked link)' : undefined,
  });
  res.json({ body, sendDelayMs, profile });
});

platformRouter.get('/api/v2/leadprofile/:phone', requireAuth('viewer'), (req, res) => {
  res.json(buildLeadProfile(req.params.phone));
});

// ── Demo seeding ────────────────────────────────────────────────────

platformRouter.post('/api/v2/demo/seed', requireAuth('admin'), (req, res) => {
  res.json(seedDemoData({ force: req.body?.force === true }));
});

// ── Server-Sent Events: live command-center stream ──────────────────

platformRouter.get('/api/v2/stream', requireAuth('viewer'), (req: Request, res: Response) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write(`event: snapshot\ndata: ${JSON.stringify(getLiveOps())}\n\n`);

  const unsubscribe = onEvent((ev: PlatformEvent) => {
    try {
      res.write(`event: platform\ndata: ${JSON.stringify(ev)}\n\n`);
    } catch { /* client gone; cleanup below */ }
  });
  const snapshotTimer = setInterval(() => {
    try {
      res.write(`event: snapshot\ndata: ${JSON.stringify(getLiveOps())}\n\n`);
    } catch { /* ignore */ }
  }, 5000);
  const heartbeat = setInterval(() => {
    try { res.write(': ping\n\n'); } catch { /* ignore */ }
  }, 25000);

  req.on('close', () => {
    unsubscribe();
    clearInterval(snapshotTimer);
    clearInterval(heartbeat);
    logger.debug('platform', 'SSE client disconnected');
  });
});
