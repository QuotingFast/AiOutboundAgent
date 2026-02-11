// ── Campaign Management API Routes ─────────────────────────────────
// Campaign CRUD, DID mappings, voice sync, scheduled callbacks,
// template management, feature flags, enforcement log, and backfill.

import { Router, Request, Response } from 'express';
import { logger } from '../utils/logger';
import {
  getCampaign,
  getAllCampaigns,
  createCampaign,
  updateCampaign,
  deleteCampaign,
  setDidMapping,
  getDidMapping,
  getAllDidMappings,
  removeDidMapping,
  getOutboundCallRecords,
  getScheduledCallbacks,
  cancelScheduledCallback,
  getEnforcementLog,
  getFeatureFlags as getCampaignFeatureFlags,
  setFeatureFlag as setCampaignFeatureFlag,
  isFeatureFlagEnabled,
  getCampaignSmsTemplates,
  addCampaignSmsTemplate,
  removeCampaignSmsTemplate,
  getCampaignEmailTemplates,
  addCampaignEmailTemplate,
  removeCampaignEmailTemplate,
  getCampaignAiProfiles,
  addCampaignAiProfile,
  seedCampaigns,
  recordOutboundCall,
} from './store';
import { CampaignConfig, CampaignAIProfile, CampaignFeatureFlags } from './types';
import { getElevenLabsVoices, getVoicesForCampaign, invalidateVoiceCache } from './voices';
import { scheduleCallbackRequest, inferTimezoneFromPhone } from './scheduled-callbacks';
import { resolveCallbackCampaign, buildFallbackIvrTwiml, handleCampaignSelection } from './callback-router';
import { enforceCampaignContext } from './middleware';
import { SmsTemplate } from '../sms';
import { getLeadMemory, createOrUpdateLead, getAllLeads } from '../memory';

const campaignRouter = Router();

// ── Campaign CRUD ──────────────────────────────────────────────────

campaignRouter.get('/api/campaigns', (_req: Request, res: Response) => {
  res.json({ campaigns: getAllCampaigns() });
});

campaignRouter.get('/api/campaigns/:id', (req: Request, res: Response) => {
  const campaign = getCampaign(req.params.id);
  if (!campaign) {
    res.status(404).json({ error: 'Campaign not found' });
    return;
  }
  res.json(campaign);
});

campaignRouter.post('/api/campaigns', (req: Request, res: Response) => {
  try {
    const body = req.body as Partial<CampaignConfig>;
    if (!body.id || !body.name || !body.type) {
      res.status(400).json({ error: 'Missing required fields: id, name, type' });
      return;
    }
    if (getCampaign(body.id)) {
      res.status(409).json({ error: 'Campaign already exists' });
      return;
    }
    const now = new Date().toISOString();
    const campaign = createCampaign({
      ...body as CampaignConfig,
      createdAt: now,
      updatedAt: now,
    });
    res.json(campaign);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

campaignRouter.put('/api/campaigns/:id', (req: Request, res: Response) => {
  const updated = updateCampaign(req.params.id, req.body);
  if (!updated) {
    res.status(404).json({ error: 'Campaign not found' });
    return;
  }
  res.json(updated);
});

campaignRouter.delete('/api/campaigns/:id', (req: Request, res: Response) => {
  const ok = deleteCampaign(req.params.id);
  res.json({ success: ok });
});

// ── Campaign Toggle ────────────────────────────────────────────────

campaignRouter.put('/api/campaigns/:id/toggle', (req: Request, res: Response) => {
  const campaign = getCampaign(req.params.id);
  if (!campaign) {
    res.status(404).json({ error: 'Campaign not found' });
    return;
  }
  const active = req.body.active ?? !campaign.active;
  const updated = updateCampaign(req.params.id, { active });
  res.json(updated);
});

// ── Campaign Features ──────────────────────────────────────────────

campaignRouter.put('/api/campaigns/:id/features', (req: Request, res: Response) => {
  const campaign = getCampaign(req.params.id);
  if (!campaign) {
    res.status(404).json({ error: 'Campaign not found' });
    return;
  }
  const features = { ...campaign.features, ...req.body };
  const updated = updateCampaign(req.params.id, { features });
  res.json(updated);
});

// ── Campaign Voice Config ──────────────────────────────────────────

campaignRouter.put('/api/campaigns/:id/voice', (req: Request, res: Response) => {
  const campaign = getCampaign(req.params.id);
  if (!campaign) {
    res.status(404).json({ error: 'Campaign not found' });
    return;
  }
  const voiceConfig = { ...campaign.voiceConfig, ...req.body };
  const updated = updateCampaign(req.params.id, { voiceConfig });
  res.json(updated);
});

// ── Campaign Transfer Routing ──────────────────────────────────────

campaignRouter.put('/api/campaigns/:id/transfer-routing', (req: Request, res: Response) => {
  const campaign = getCampaign(req.params.id);
  if (!campaign) {
    res.status(404).json({ error: 'Campaign not found' });
    return;
  }
  const transferRouting = { ...campaign.transferRouting, ...req.body };
  const updated = updateCampaign(req.params.id, { transferRouting });
  res.json(updated);
});

// ── Campaign AI Profile ────────────────────────────────────────────

campaignRouter.get('/api/campaigns/:id/ai-profiles', (req: Request, res: Response) => {
  res.json(getCampaignAiProfiles(req.params.id));
});

campaignRouter.put('/api/campaigns/:id/ai-profile', (req: Request, res: Response) => {
  const campaign = getCampaign(req.params.id);
  if (!campaign) {
    res.status(404).json({ error: 'Campaign not found' });
    return;
  }
  const aiProfile = { ...campaign.aiProfile, ...req.body, campaignId: req.params.id };
  const updated = updateCampaign(req.params.id, { aiProfile });
  res.json(updated);
});

campaignRouter.post('/api/campaigns/:id/ai-profiles', (req: Request, res: Response) => {
  const campaign = getCampaign(req.params.id);
  if (!campaign) {
    res.status(404).json({ error: 'Campaign not found' });
    return;
  }
  const profile: CampaignAIProfile = {
    ...req.body,
    campaignId: req.params.id,
    id: `ai-profile-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
  };
  addCampaignAiProfile(req.params.id, profile);
  res.json(profile);
});

// ── DID Mappings ───────────────────────────────────────────────────

campaignRouter.get('/api/did-mappings', (_req: Request, res: Response) => {
  res.json({ mappings: getAllDidMappings() });
});

campaignRouter.post('/api/did-mappings', (req: Request, res: Response) => {
  const { did, campaignId } = req.body;
  if (!did || !campaignId) {
    res.status(400).json({ error: 'Missing did or campaignId' });
    return;
  }
  if (!getCampaign(campaignId)) {
    res.status(404).json({ error: 'Campaign not found' });
    return;
  }
  setDidMapping(did, campaignId);
  res.json({ success: true, did, campaignId });
});

campaignRouter.delete('/api/did-mappings/:did', (req: Request, res: Response) => {
  const ok = removeDidMapping(req.params.did);
  res.json({ success: ok });
});

// ── ElevenLabs Voice Sync ──────────────────────────────────────────

campaignRouter.get('/api/voices/elevenlabs', async (_req: Request, res: Response) => {
  try {
    const voices = await getElevenLabsVoices();
    res.json({ voices, count: voices.length });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

campaignRouter.get('/api/voices/elevenlabs/campaign/:id', async (req: Request, res: Response) => {
  try {
    const voices = await getVoicesForCampaign(req.params.id);
    res.json({ voices, count: voices.length });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

campaignRouter.post('/api/voices/elevenlabs/refresh', async (_req: Request, res: Response) => {
  invalidateVoiceCache();
  const voices = await getElevenLabsVoices();
  res.json({ voices, count: voices.length, refreshed: true });
});

// ── Campaign SMS Templates ─────────────────────────────────────────

campaignRouter.get('/api/campaigns/:id/sms-templates', (req: Request, res: Response) => {
  res.json(getCampaignSmsTemplates(req.params.id));
});

campaignRouter.post('/api/campaigns/:id/sms-templates', (req: Request, res: Response) => {
  const { name, body, category, active } = req.body;
  if (!name || !body) {
    res.status(400).json({ error: 'Missing name or body' });
    return;
  }
  const tpl: SmsTemplate = {
    id: `tpl-${req.params.id}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    name,
    body,
    category: category || 'custom',
    active: active !== false,
    createdAt: new Date().toISOString(),
  };
  addCampaignSmsTemplate(req.params.id, tpl);
  res.json(tpl);
});

campaignRouter.delete('/api/campaigns/:id/sms-templates/:templateId', (req: Request, res: Response) => {
  const ok = removeCampaignSmsTemplate(req.params.id, req.params.templateId);
  res.json({ success: ok });
});

// ── Campaign Email Templates ───────────────────────────────────────

campaignRouter.get('/api/campaigns/:id/email-templates', (req: Request, res: Response) => {
  res.json(getCampaignEmailTemplates(req.params.id));
});

campaignRouter.post('/api/campaigns/:id/email-templates', (req: Request, res: Response) => {
  const { name, body, category, active } = req.body;
  if (!name || !body) {
    res.status(400).json({ error: 'Missing name or body' });
    return;
  }
  const tpl: SmsTemplate = {
    id: `email-${req.params.id}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    name,
    body,
    category: category || 'custom',
    active: active !== false,
    createdAt: new Date().toISOString(),
  };
  addCampaignEmailTemplate(req.params.id, tpl);
  res.json(tpl);
});

campaignRouter.delete('/api/campaigns/:id/email-templates/:templateId', (req: Request, res: Response) => {
  const ok = removeCampaignEmailTemplate(req.params.id, req.params.templateId);
  res.json({ success: ok });
});

// ── Scheduled Callbacks (Campaign-Locked) ──────────────────────────

campaignRouter.post('/api/campaigns/:id/schedule-callback', (req: Request, res: Response) => {
  const campaign = getCampaign(req.params.id);
  if (!campaign) {
    res.status(404).json({ error: 'Campaign not found' });
    return;
  }

  const { phone, leadId, requestedLocalDatetime, requestedTimezone, consentCapture } = req.body;
  if (!phone || !requestedLocalDatetime) {
    res.status(400).json({ error: 'Missing phone or requestedLocalDatetime' });
    return;
  }

  const vc = campaign.voiceConfig;
  const voiceId = vc.voiceProvider === 'openai' ? vc.openaiVoice : vc.elevenlabsVoiceId;

  const result = scheduleCallbackRequest({
    leadId: leadId || null,
    phone,
    campaignId: req.params.id,
    aiProfileId: campaign.aiProfile.id,
    voiceId,
    requestedLocalDatetime,
    requestedTimezone,
    consentCapture: consentCapture || 'api_request',
  });

  if (!result.callback) {
    res.status(400).json({ error: 'Failed to schedule callback', reason: result.adjustedReason });
    return;
  }

  res.json({
    callback: result.callback,
    adjusted: result.adjusted,
    adjustedReason: result.adjustedReason,
  });
});

campaignRouter.get('/api/campaign-callbacks', (req: Request, res: Response) => {
  const campaignId = req.query.campaign_id as string | undefined;
  const status = req.query.status as string | undefined;
  res.json(getScheduledCallbacks({ status, campaignId }));
});

campaignRouter.delete('/api/campaign-callbacks/:id', (req: Request, res: Response) => {
  const ok = cancelScheduledCallback(req.params.id);
  res.json({ success: ok });
});

// ── Outbound Call Records ──────────────────────────────────────────

campaignRouter.get('/api/outbound-records', (req: Request, res: Response) => {
  const records = getOutboundCallRecords();
  const campaignId = req.query.campaign_id as string | undefined;
  if (campaignId) {
    res.json(records.filter(r => r.campaignId === campaignId));
    return;
  }
  res.json(records);
});

// ── Enforcement Log ────────────────────────────────────────────────

campaignRouter.get('/api/enforcement-log', (req: Request, res: Response) => {
  const limit = req.query.limit ? parseInt(req.query.limit as string) : 100;
  res.json(getEnforcementLog(limit));
});

// ── Feature Flags ──────────────────────────────────────────────────

campaignRouter.get('/api/campaign-flags', (_req: Request, res: Response) => {
  res.json(getCampaignFeatureFlags());
});

campaignRouter.put('/api/campaign-flags', (req: Request, res: Response) => {
  const flags = req.body as Partial<CampaignFeatureFlags>;
  for (const [key, value] of Object.entries(flags)) {
    if (typeof value === 'boolean') {
      setCampaignFeatureFlag(key as keyof CampaignFeatureFlags, value);
    }
  }
  res.json(getCampaignFeatureFlags());
});

// ── Backfill Endpoint ──────────────────────────────────────────────

campaignRouter.post('/api/campaigns/backfill', (req: Request, res: Response) => {
  const { defaultCampaignId } = req.body;
  if (!defaultCampaignId) {
    res.status(400).json({ error: 'Missing defaultCampaignId' });
    return;
  }

  const campaign = getCampaign(defaultCampaignId);
  if (!campaign) {
    res.status(404).json({ error: 'Campaign not found' });
    return;
  }

  // Backfill: map existing leads to the default campaign
  let backfilledLeads = 0;
  const allLeads = getAllLeads();
  for (const lead of allLeads) {
    if (!lead.customFields?.campaignId) {
      createOrUpdateLead(lead.phone, {
        customFields: { ...(lead.customFields || {}), campaignId: defaultCampaignId },
      });
      backfilledLeads++;
    }
  }

  logger.info('campaign-routes', 'Backfill completed', {
    defaultCampaignId,
    backfilledLeads,
  });

  res.json({
    success: true,
    defaultCampaignId,
    backfilledLeads,
  });
});

// ── Timezone Inference ─────────────────────────────────────────────

campaignRouter.get('/api/infer-timezone/:phone', (req: Request, res: Response) => {
  const tz = inferTimezoneFromPhone(req.params.phone);
  res.json({ phone: req.params.phone, timezone: tz || 'unknown' });
});

// ── Twilio Webhooks for Campaign Routing ───────────────────────────

// POST /twilio/campaign-select — IVR digit handler
campaignRouter.post('/twilio/campaign-select', (req: Request, res: Response) => {
  const digit = req.body?.Digits || '';
  const callerPhone = req.query.caller as string || req.body?.From || '';

  logger.info('campaign-routes', 'Campaign IVR selection', { digit, callerPhone });

  const result = handleCampaignSelection(digit, callerPhone);
  res.type('text/xml');
  res.send(result.twiml);
});

export { campaignRouter };
