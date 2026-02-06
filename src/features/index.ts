// ── Feature Flags — barrel export ──────────────────────────────────
// All feature modules are exported from here for convenient imports.

export {
  // Constants
  FEATURE_AUTO_CALL_NEW_LEADS,
  FEATURE_SCHEDULED_CALLBACKS,
  FEATURE_AI_SMS_AUTOMATION,
  FEATURE_WARM_HANDOFF,
  FEATURE_CALL_DISPOSITIONS,
  FEATURE_AI_CALL_NOTES,
  FEATURE_GLOBAL_KILL_SWITCH,
  ALL_FEATURE_FLAGS,
  DEFAULT_WORKSPACE,
  // Core resolution
  resolveFeatureFlag,
  resolveAutoCall,
  isKillSwitchActive,
  // Workspace management
  setWorkspaceFlag,
  getWorkspaceFlags,
  // Campaign management
  setCampaignOverride,
  removeCampaignOverride,
  getCampaignOverrides,
  // Bulk status
  getAllResolvedFlags,
} from './flags';

export type { FeatureFlagId } from './flags';

export { isOutboundDialingAllowed } from './kill-switch';
export { shouldAutoCallLead } from './auto-call';

export {
  createScheduledCallback,
  cancelScheduledCallback,
  getScheduledCallbacks,
  getScheduledCallback,
  processDueCallbacks,
  setCallbackDialer,
  startCallbackProcessor,
  stopCallbackProcessor,
} from './scheduled-callbacks';
export type { ScheduledCallback, CallbackStatus } from './scheduled-callbacks';

export {
  triggerAISMS,
  processStopRequest,
  isSMSSuppressed,
  setCampaignSMSConfig,
  getCampaignSMSConfig,
  removeCampaignSMSConfig,
  getSMSLog,
} from './sms-automation';
export type { SMSTrigger, CampaignSMSConfig, SMSLogEntry } from './sms-automation';

export {
  buildWarmHandoffTwiml,
  buildWhisperTwiml,
  buildAcceptTwiml,
  buildWhisperText,
} from './warm-handoff';
export type { WhisperContent } from './warm-handoff';

export {
  autoSetDisposition,
  setCallDisposition,
  getCallDisposition,
  getAllDispositions,
  inferDisposition,
  shouldRetryLead,
  shouldSuppressLead,
  shouldSendSMS,
  ALL_DISPOSITIONS,
} from './dispositions';
export type { CallDisposition, CallDispositionRecord } from './dispositions';

export {
  generateCallNotes,
  getCallNotes,
  getAllCallNotes,
  editCallNotes,
} from './call-notes';
export type { CallNote } from './call-notes';
