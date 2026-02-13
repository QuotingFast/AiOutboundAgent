// ── Campaign Isolation Tests ───────────────────────────────────────
// Unit tests for resolver, enforcement invariants, callback routing,
// scheduled callbacks, and regression tests for legacy transfer logic.

import {
  seedCampaigns,
  getCampaign,
  getAllCampaigns,
  createCampaign,
  updateCampaign,
  setDidMapping,
  getDidMapping,
  recordOutboundCall,
  findOutboundByPhone,
  logEnforcement,
  getEnforcementLog,
  getCampaignSmsTemplates,
  getCampaignEmailTemplates,
  getCampaignAiProfiles,
  isFeatureFlagEnabled,
  setFeatureFlag,
  getFeatureFlags,
} from '../store';
import { resolveCampaignContext } from '../resolver';
import {
  enforceCampaignContext,
  enforceOutboundDial,
  enforceInboundCall,
  enforceSmsSend,
  enforceScheduledCallback,
} from '../middleware';
import {
  resolveCallbackCampaign,
  buildFallbackIvrTwiml,
  handleCampaignSelection,
} from '../callback-router';
import {
  inferTimezoneFromPhone,
  isWithinTcpaWindow,
  findNearestCompliantTime,
} from '../scheduled-callbacks';
import { CampaignConfig, CampaignAIProfile, OutboundCallRecord } from '../types';

// ── Test Helpers ───────────────────────────────────────────────────

let testsPassed = 0;
let testsFailed = 0;
const errors: string[] = [];

function assert(condition: boolean, message: string): void {
  if (condition) {
    testsPassed++;
  } else {
    testsFailed++;
    errors.push(`FAIL: ${message}`);
    console.error(`  FAIL: ${message}`);
  }
}

function assertEqual(actual: any, expected: any, message: string): void {
  if (actual === expected) {
    testsPassed++;
  } else {
    testsFailed++;
    const err = `FAIL: ${message} (expected: ${JSON.stringify(expected)}, got: ${JSON.stringify(actual)})`;
    errors.push(err);
    console.error(`  ${err}`);
  }
}

function describe(name: string, fn: () => void): void {
  console.log(`\n=== ${name} ===`);
  fn();
}

function it(name: string, fn: () => void): void {
  try {
    fn();
    console.log(`  PASS: ${name}`);
  } catch (err) {
    testsFailed++;
    const msg = err instanceof Error ? err.message : String(err);
    errors.push(`FAIL: ${name} - ${msg}`);
    console.error(`  FAIL: ${name} - ${msg}`);
  }
}

// ── Setup ──────────────────────────────────────────────────────────

seedCampaigns();

// ── Tests ──────────────────────────────────────────────────────────

describe('Campaign Store', () => {
  it('should seed two default campaigns', () => {
    const campaigns = getAllCampaigns();
    assert(campaigns.length >= 2, 'At least 2 campaigns seeded');
  });

  it('should have consumer auto insurance campaign', () => {
    const campaign = getCampaign('campaign-consumer-auto');
    assert(campaign !== undefined, 'Consumer campaign exists');
    assertEqual(campaign!.type, 'consumer_auto_insurance', 'Consumer campaign type');
    assertEqual(campaign!.active, true, 'Consumer campaign active');
    assertEqual(campaign!.aiProfile.agentName, 'Alex', 'Consumer agent name');
    assertEqual(campaign!.aiProfile.companyName, 'Affordable Auto Rates', 'Consumer company name');
  });

  it('should have agency development campaign', () => {
    const campaign = getCampaign('campaign-agency-dev');
    assert(campaign !== undefined, 'Agency campaign exists');
    assertEqual(campaign!.type, 'agency_development', 'Agency campaign type');
    assertEqual(campaign!.active, true, 'Agency campaign active');
    assertEqual(campaign!.aiProfile.agentName, 'Jordan', 'Agency agent name');
    assertEqual(campaign!.aiProfile.companyName, 'Quoting Fast', 'Agency company name');
  });

  it('should have separate SMS templates per campaign', () => {
    const consumerTemplates = getCampaignSmsTemplates('campaign-consumer-auto');
    const agencyTemplates = getCampaignSmsTemplates('campaign-agency-dev');
    assert(consumerTemplates.length > 0, 'Consumer has SMS templates');
    assert(agencyTemplates.length > 0, 'Agency has SMS templates');
    // Verify no cross-contamination
    for (const t of consumerTemplates) {
      assert(!t.id.startsWith('agency-'), `Consumer template ${t.id} should not be agency-prefixed`);
    }
    for (const t of agencyTemplates) {
      assert(!t.id.startsWith('consumer-'), `Agency template ${t.id} should not be consumer-prefixed`);
    }
  });

  it('should have separate email templates per campaign', () => {
    const consumerEmails = getCampaignEmailTemplates('campaign-consumer-auto');
    const agencyEmails = getCampaignEmailTemplates('campaign-agency-dev');
    assert(consumerEmails.length > 0, 'Consumer has email templates');
    assert(agencyEmails.length > 0, 'Agency has email templates');
  });

  it('should have different voice configs per campaign', () => {
    const consumer = getCampaign('campaign-consumer-auto')!;
    const agency = getCampaign('campaign-agency-dev')!;
    assert(consumer.voiceConfig.elevenlabsVoiceId !== agency.voiceConfig.elevenlabsVoiceId,
      'Different ElevenLabs voice IDs');
  });

  it('should have different dispositions per campaign', () => {
    const consumer = getCampaign('campaign-consumer-auto')!;
    const agency = getCampaign('campaign-agency-dev')!;
    assert(consumer.dispositions.includes('transferred'), 'Consumer has transferred disposition');
    assert(agency.dispositions.includes('meeting_booked'), 'Agency has meeting_booked disposition');
    assert(!consumer.dispositions.includes('meeting_booked'), 'Consumer does NOT have meeting_booked');
    assert(!agency.dispositions.includes('transferred'), 'Agency does NOT have transferred');
  });
});

describe('Feature Flags', () => {
  it('should have all required flags', () => {
    const flags = getFeatureFlags();
    assert('multi_campaign_mode' in flags, 'multi_campaign_mode flag exists');
    assert('scheduled_callbacks' in flags, 'scheduled_callbacks flag exists');
    assert('dynamic_voice_sync' in flags, 'dynamic_voice_sync flag exists');
    assert('hardened_campaign_isolation' in flags, 'hardened_campaign_isolation flag exists');
  });

  it('should toggle flags', () => {
    setFeatureFlag('hardened_campaign_isolation', false);
    assertEqual(isFeatureFlagEnabled('hardened_campaign_isolation'), false, 'Flag disabled');
    setFeatureFlag('hardened_campaign_isolation', true);
    assertEqual(isFeatureFlagEnabled('hardened_campaign_isolation'), true, 'Flag re-enabled');
  });
});

describe('DID Mappings', () => {
  it('should map DIDs to campaigns', () => {
    setDidMapping('+18001234567', 'campaign-consumer-auto');
    const mapping = getDidMapping('+18001234567');
    assert(mapping !== undefined, 'DID mapping exists');
    assertEqual(mapping!.campaignId, 'campaign-consumer-auto', 'DID mapped to consumer');
  });

  it('should map different DIDs to different campaigns', () => {
    setDidMapping('+18007654321', 'campaign-agency-dev');
    const m1 = getDidMapping('+18001234567');
    const m2 = getDidMapping('+18007654321');
    assertEqual(m1!.campaignId, 'campaign-consumer-auto', 'DID 1 -> consumer');
    assertEqual(m2!.campaignId, 'campaign-agency-dev', 'DID 2 -> agency');
  });
});

describe('CampaignContext Resolver', () => {
  it('should resolve via inbound DID', () => {
    setDidMapping('+18001111111', 'campaign-consumer-auto');
    const result = resolveCampaignContext({ inboundDid: '+18001111111' });
    assert(result.success, 'Resolution succeeded');
    assertEqual(result.context!.campaignId, 'campaign-consumer-auto', 'Resolved to consumer');
    assertEqual(result.source, 'inbound_did', 'Source is inbound_did');
  });

  it('should resolve via explicit campaign_id', () => {
    const result = resolveCampaignContext({ explicitCampaignId: 'campaign-agency-dev' });
    assert(result.success, 'Resolution succeeded');
    assertEqual(result.context!.campaignId, 'campaign-agency-dev', 'Resolved to agency');
    assertEqual(result.source, 'explicit_campaign_id', 'Source is explicit_campaign_id');
  });

  it('should resolve via last outbound call', () => {
    recordOutboundCall({
      callId: 'test-call-1',
      leadId: null,
      toPhone: '+15551234567',
      fromDid: '+18001111111',
      campaignId: 'campaign-consumer-auto',
      aiProfileId: 'ai-profile-consumer-default',
      voiceId: 'cjVigY5qzO86Huf0OWal',
      messageProfileId: 'sms-set-consumer',
      timestamp: new Date().toISOString(),
      status: 'completed',
    });
    const result = resolveCampaignContext({ leadPhone: '+15551234567' });
    assert(result.success, 'Resolution succeeded');
    assertEqual(result.context!.campaignId, 'campaign-consumer-auto', 'Resolved via call history');
    assertEqual(result.source, 'last_outbound_call', 'Source is last_outbound_call');
  });

  it('should FAIL CLOSED when no context resolves', () => {
    const result = resolveCampaignContext({ leadPhone: '+19999999999' });
    assert(!result.success, 'Resolution failed');
    assert(result.context === null, 'Context is null');
  });

  it('should detect ambiguity when multiple campaigns called same phone', () => {
    recordOutboundCall({
      callId: 'test-call-ambig-1',
      leadId: null,
      toPhone: '+15559999999',
      fromDid: '+18001111111',
      campaignId: 'campaign-consumer-auto',
      aiProfileId: 'ai-profile-consumer-default',
      voiceId: 'cjVigY5qzO86Huf0OWal',
      messageProfileId: 'sms-set-consumer',
      timestamp: new Date().toISOString(),
      status: 'completed',
    });
    recordOutboundCall({
      callId: 'test-call-ambig-2',
      leadId: null,
      toPhone: '+15559999999',
      fromDid: '+18007654321',
      campaignId: 'campaign-agency-dev',
      aiProfileId: 'ai-profile-agency-default',
      voiceId: 'iP95p4xoKVk53GoZ742B',
      messageProfileId: 'sms-set-agency',
      timestamp: new Date().toISOString(),
      status: 'completed',
    });
    const result = resolveCampaignContext({ leadPhone: '+15559999999' });
    assert(!result.success, 'Ambiguous resolution fails');
    assert(result.ambiguous, 'Marked as ambiguous');
  });

  it('should follow priority: explicit > DID > lead > call history', () => {
    setDidMapping('+18002222222', 'campaign-agency-dev');
    // Explicit campaign_id takes highest priority over DID mapping
    const result = resolveCampaignContext({
      inboundDid: '+18002222222',
      explicitCampaignId: 'campaign-consumer-auto',
    });
    assert(result.success, 'Resolution succeeded');
    assertEqual(result.context!.campaignId, 'campaign-consumer-auto', 'Explicit takes priority');
    assertEqual(result.source, 'explicit_campaign_id', 'Source confirms explicit priority');
  });
});

describe('Enforcement Middleware', () => {
  it('should allow outbound dial with valid campaign', () => {
    const result = enforceOutboundDial({
      phone: '+15551234567',
      campaignId: 'campaign-consumer-auto',
    });
    assert(result.allowed, 'Outbound dial allowed');
    assert(result.context !== null, 'Context provided');
  });

  it('should block outbound dial without campaign context', () => {
    const result = enforceOutboundDial({
      phone: '+19998887777',
    });
    assert(!result.allowed, 'Outbound dial blocked');
  });

  it('should allow SMS send with valid campaign', () => {
    const result = enforceSmsSend({
      phone: '+15551234567',
      campaignId: 'campaign-consumer-auto',
    });
    assert(result.allowed, 'SMS send allowed');
  });

  it('should block SMS send without campaign context', () => {
    const result = enforceSmsSend({
      phone: '+19998887777',
    });
    assert(!result.allowed, 'SMS send blocked');
  });

  it('should enforce scheduled callback field matching', () => {
    const result = enforceScheduledCallback({
      phone: '+15551234567',
      campaignId: 'campaign-consumer-auto',
      aiProfileId: 'ai-profile-consumer-default',
      voiceId: 'cjVigY5qzO86Huf0OWal',
    });
    assert(result.allowed, 'Scheduled callback allowed');
  });

  it('should block scheduled callback with mismatched AI profile', () => {
    const result = enforceScheduledCallback({
      phone: '+15551234567',
      campaignId: 'campaign-consumer-auto',
      aiProfileId: 'ai-profile-agency-default', // WRONG profile
      voiceId: 'cjVigY5qzO86Huf0OWal',
    });
    assert(!result.allowed, 'Mismatched AI profile blocked');
  });

  it('should block scheduled callback with mismatched voice', () => {
    const result = enforceScheduledCallback({
      phone: '+15551234567',
      campaignId: 'campaign-consumer-auto',
      aiProfileId: 'ai-profile-consumer-default',
      voiceId: 'iP95p4xoKVk53GoZ742B', // WRONG voice (agency voice)
    });
    assert(!result.allowed, 'Mismatched voice blocked');
  });

  it('should bypass enforcement when hardened isolation is disabled', () => {
    setFeatureFlag('hardened_campaign_isolation', false);
    const result = enforceOutboundDial({
      phone: '+19998887777',
    });
    assert(result.allowed, 'Allowed when isolation disabled');
    setFeatureFlag('hardened_campaign_isolation', true);
  });
});

describe('Enforcement Log', () => {
  it('should record enforcement decisions', () => {
    const log = getEnforcementLog(100);
    assert(log.length > 0, 'Enforcement log has entries');
    const entry = log[0];
    assert('timestamp' in entry, 'Has timestamp');
    assert('eventType' in entry, 'Has eventType');
    assert('action' in entry, 'Has action');
    assert('allowed' in entry, 'Has allowed flag');
    assert('reason' in entry, 'Has reason');
  });
});

describe('Callback Router', () => {
  it('should resolve callback via DID', () => {
    setDidMapping('+18003333333', 'campaign-consumer-auto');
    const result = resolveCallbackCampaign({
      callerPhone: '+15551234567',
      calledDid: '+18003333333',
    });
    assert(result.resolved, 'Callback resolved');
    assertEqual(result.context!.campaignId, 'campaign-consumer-auto', 'Resolved to consumer');
    assert(!result.useFallbackIvr, 'No fallback IVR needed');
  });

  it('should use fallback IVR for ambiguous callbacks', () => {
    const result = resolveCallbackCampaign({
      callerPhone: '+15559999999', // Has records in both campaigns
      calledDid: '+18004444444',   // Not mapped to any campaign
    });
    assert(!result.resolved, 'Callback not resolved');
    assert(result.useFallbackIvr, 'Fallback IVR activated');
  });

  it('should generate safe fallback IVR TwiML', () => {
    const twiml = buildFallbackIvrTwiml('+15551234567');
    assert(twiml.includes('<?xml'), 'Valid XML');
    assert(twiml.includes('<Gather'), 'Contains Gather');
    assert(twiml.includes('press 1'), 'Has option 1');
    assert(twiml.includes('press 2'), 'Has option 2');
    // Must NOT mention campaign-specific terms
    assert(!twiml.includes('Quoting Fast'), 'No Quoting Fast mention');
    assert(!twiml.includes('auto insurance quote'), 'No auto insurance quote mention');
    assert(!twiml.includes('Affordable Auto'), 'No Affordable Auto mention');
    assert(!twiml.includes('insurance agency'), 'No insurance agency mention');
  });

  it('should handle campaign selection digit 1 -> consumer', () => {
    const result = handleCampaignSelection('1', '+15551234567');
    assertEqual(result.campaignId, 'campaign-consumer-auto', 'Digit 1 -> consumer');
    assert(result.twiml.includes('campaignId'), 'TwiML includes campaignId parameter');
  });

  it('should handle campaign selection digit 2 -> agency', () => {
    const result = handleCampaignSelection('2', '+15551234567');
    assertEqual(result.campaignId, 'campaign-agency-dev', 'Digit 2 -> agency');
  });

  it('should reject invalid digit', () => {
    const result = handleCampaignSelection('5', '+15551234567');
    assertEqual(result.campaignId, null, 'Invalid digit -> null');
    assert(result.twiml.includes('Hangup'), 'TwiML hangs up');
  });
});

describe('TCPA Compliance', () => {
  it('should infer timezone from area code', () => {
    assertEqual(inferTimezoneFromPhone('+12125551234'), 'America/New_York', 'NYC -> Eastern');
    assertEqual(inferTimezoneFromPhone('+13125551234'), 'America/Chicago', 'Chicago -> Central');
    assertEqual(inferTimezoneFromPhone('+13035551234'), 'America/Denver', 'Denver -> Mountain');
    assertEqual(inferTimezoneFromPhone('+14155551234'), 'America/Los_Angeles', 'SF -> Pacific');
    assertEqual(inferTimezoneFromPhone('+18085551234'), 'Pacific/Honolulu', 'Hawaii');
  });

  it('should return null for unknown area codes', () => {
    const tz = inferTimezoneFromPhone('+10005551234');
    assertEqual(tz, null, 'Unknown area code returns null');
  });

  it('should check TCPA window correctly', () => {
    // 2pm UTC = 9am Eastern (within 8-21 window)
    const within = isWithinTcpaWindow('2025-06-15T14:00:00Z', 'America/New_York', 8, 21);
    assert(within, '9am Eastern is within window');

    // 5am UTC = midnight Eastern (outside 8-21 window)
    const outside = isWithinTcpaWindow('2025-06-15T05:00:00Z', 'America/New_York', 8, 21);
    assert(!outside, 'midnight Eastern is outside window');
  });

  it('should find nearest compliant time', () => {
    // 3am Eastern -> should move to 8am
    const adjusted = findNearestCompliantTime('2025-06-15T07:00:00Z', 'America/New_York', 8, 21);
    assert(adjusted > '2025-06-15T07:00:00Z', 'Adjusted time is later');
  });
});

describe('Cross-Campaign Isolation Invariants', () => {
  it('consumer campaign should never use agency AI profile', () => {
    const consumer = getCampaign('campaign-consumer-auto')!;
    const agency = getCampaign('campaign-agency-dev')!;
    assert(consumer.aiProfile.id !== agency.aiProfile.id, 'Different AI profiles');
    assert(consumer.aiProfile.agentName !== agency.aiProfile.agentName, 'Different agent names');
    assert(consumer.aiProfile.companyName !== agency.aiProfile.companyName, 'Different company names');
  });

  it('consumer campaign should never use agency voice', () => {
    const consumer = getCampaign('campaign-consumer-auto')!;
    const agency = getCampaign('campaign-agency-dev')!;
    assert(consumer.voiceConfig.elevenlabsVoiceId !== agency.voiceConfig.elevenlabsVoiceId,
      'Different voice IDs');
  });

  it('consumer templates should not appear in agency registry', () => {
    const agencyTemplates = getCampaignSmsTemplates('campaign-agency-dev');
    for (const t of agencyTemplates) {
      assert(!t.body.includes('Affordable Auto Rates'),
        `Agency template should not mention "Affordable Auto Rates": ${t.id}`);
    }
  });

  it('agency templates should not appear in consumer registry', () => {
    const consumerTemplates = getCampaignSmsTemplates('campaign-consumer-auto');
    for (const t of consumerTemplates) {
      assert(!t.body.includes('Quoting Fast'),
        `Consumer template should not mention "Quoting Fast": ${t.id}`);
    }
  });
});

describe('Regression: Legacy Transfer Logic', () => {
  it('consumer campaign has transfer routes configured', () => {
    const consumer = getCampaign('campaign-consumer-auto')!;
    assert(consumer.transferRouting.routes.length >= 2, 'Consumer has 2+ transfer routes');
    const allstateRoute = consumer.transferRouting.routes.find(r => r.id === 'route-allstate');
    const otherRoute = consumer.transferRouting.routes.find(r => r.id === 'route-non-allstate');
    assert(allstateRoute !== undefined, 'Allstate route exists');
    assert(otherRoute !== undefined, 'Non-allstate route exists');
  });

  it('agency campaign has transfer routes configured', () => {
    const agency = getCampaign('campaign-agency-dev')!;
    assert(agency.transferRouting.routes.length >= 1, 'Agency has 1+ transfer routes');
    const salesRoute = agency.transferRouting.routes.find(r => r.id === 'route-agency-sales');
    assert(salesRoute !== undefined, 'Agency sales route exists');
  });

  it('campaign update preserves existing fields', () => {
    const before = getCampaign('campaign-consumer-auto')!;
    updateCampaign('campaign-consumer-auto', { uiBadgeLabel: 'Consumer Updated' });
    const after = getCampaign('campaign-consumer-auto')!;
    assertEqual(after.uiBadgeLabel, 'Consumer Updated', 'Badge label updated');
    assertEqual(after.type, before.type, 'Type preserved');
    assertEqual(after.aiProfile.agentName, before.aiProfile.agentName, 'Agent name preserved');
    // Restore
    updateCampaign('campaign-consumer-auto', { uiBadgeLabel: 'Consumer' });
  });
});

// ── Summary ────────────────────────────────────────────────────────

console.log(`\n${'='.repeat(50)}`);
console.log(`Tests: ${testsPassed} passed, ${testsFailed} failed`);
if (errors.length > 0) {
  console.log('\nFailures:');
  errors.forEach(e => console.log(`  ${e}`));
}
console.log('='.repeat(50));

if (testsFailed > 0) {
  process.exit(1);
}
