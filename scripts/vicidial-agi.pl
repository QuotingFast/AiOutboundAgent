#!/usr/bin/perl
# ==========================================================================
# vicidial-agi.pl — VICIdial AGI script for AI Outbound Agent
# ==========================================================================
#
# This script is called by VICIdial when a call enters AUTO_DROP (answered
# but no agent available).  It:
#
#   1. Registers a session with the AI service (passes lead context)
#   2. Connects the call audio to the AI via Asterisk's AudioSocket
#   3. After AudioSocket disconnects, checks the session outcome
#   4. If transfer → sets VICIdial variables for agent routing
#   5. If hangup/other → hangs up the call
#
# INSTALLATION:
#   1. Copy to /var/lib/asterisk/agi-bin/vicidial-agi.pl
#   2. chmod +x /var/lib/asterisk/agi-bin/vicidial-agi.pl
#   3. Set the AI_SERVICE_URL and AI_AUDIOSOCKET_HOST environment vars
#      or edit the defaults below.
#
# VICIDIAL SETUP:
#   In VICIdial admin → Campaign → Campaign settings:
#     - Drop Call Seconds: 0  (or your preferred timeout)
#     - Drop Action: AGI
#     - Drop Script: vicidial-agi.pl
#
#   Or in the dialplan (extensions.conf):
#     [ai-autodrop]
#     exten => s,1,AGI(vicidial-agi.pl)
#     same => n,Hangup()
#
# ==========================================================================

use strict;
use warnings;
use Asterisk::AGI;
use LWP::UserAgent;
use JSON;

# ── Configuration ─────────────────────────────────────────────────────────

# HTTP API for session registration (runs on the web/API port)
my $AI_SERVICE_URL = $ENV{AI_SERVICE_URL} || 'http://127.0.0.1:3000';

# AudioSocket TCP server (separate port, same host by default)
my $AI_AUDIOSOCKET_HOST = $ENV{AI_AUDIOSOCKET_HOST} || '127.0.0.1';
my $AI_AUDIOSOCKET_PORT = $ENV{AI_AUDIOSOCKET_PORT} || '9092';

# Campaign ID to use (override per campaign in VICIdial)
my $CAMPAIGN_ID = $ENV{AI_CAMPAIGN_ID} || 'campaign-consumer-auto';

# ── AGI setup ─────────────────────────────────────────────────────────────

my $AGI = Asterisk::AGI->new;
my %input = $AGI->ReadParse();

# Gather call context from AGI variables
my $callerid    = $input{callerid} || $AGI->get_variable('CALLERIDNUM') || '';
my $calledid    = $input{dnid}     || $AGI->get_variable('EXTEN')       || '';
my $uniqueid    = $input{uniqueid} || '';
my $channel     = $input{channel}  || '';

# VICIdial passes lead info via custom variables (set in your campaign)
my $lead_first  = $AGI->get_variable('LEAD_FIRST_NAME')      || 'there';
my $lead_state  = $AGI->get_variable('LEAD_STATE')            || '';
my $lead_insurer = $AGI->get_variable('LEAD_CURRENT_INSURER') || '';
my $lead_vyear  = $AGI->get_variable('LEAD_VEHICLE_YEAR')     || '';
my $lead_vmake  = $AGI->get_variable('LEAD_VEHICLE_MAKE')     || '';
my $lead_vmodel = $AGI->get_variable('LEAD_VEHICLE_MODEL')    || '';
my $campaign_id = $AGI->get_variable('AI_CAMPAIGN_ID')        || $CAMPAIGN_ID;

$AGI->verbose("AI-AGI: Starting for $callerid (lead=$lead_first, campaign=$campaign_id)", 3);

# ── Step 1: Register session with AI service ──────────────────────────────

my $ua = LWP::UserAgent->new(timeout => 5);
my $reg_url = "$AI_SERVICE_URL/audiosocket/session";

my $payload = encode_json({
    leadFirstName      => $lead_first,
    leadState          => $lead_state,
    leadCurrentInsurer => $lead_insurer,
    leadVehicleYear    => $lead_vyear,
    leadVehicleMake    => $lead_vmake,
    leadVehicleModel   => $lead_vmodel,
    campaignId         => $campaign_id,
    direction          => 'outbound',
    callerNumber       => $callerid,
});

my $response = $ua->post(
    $reg_url,
    'Content-Type' => 'application/json',
    Content        => $payload,
);

unless ($response->is_success) {
    $AGI->verbose("AI-AGI: Failed to register session: " . $response->status_line, 1);
    $AGI->hangup();
    exit 1;
}

my $result = decode_json($response->decoded_content);
my $session_uuid = $result->{uuid};

unless ($session_uuid) {
    $AGI->verbose("AI-AGI: No UUID returned from session registration", 1);
    $AGI->hangup();
    exit 1;
}

$AGI->verbose("AI-AGI: Session registered, UUID=$session_uuid", 3);

# ── Step 2: Connect call audio via AudioSocket ────────────────────────────
#
# Asterisk's AudioSocket() application streams bidirectional audio over
# a TCP connection.  The AI service receives the caller's voice, processes
# it, and sends synthesized audio back.
#
# AudioSocket(uuid,host:port)
#   uuid = the session UUID we just registered
#   host:port = the AI AudioSocket server

my $audiosocket_target = "$AI_AUDIOSOCKET_HOST:$AI_AUDIOSOCKET_PORT";
$AGI->verbose("AI-AGI: Connecting AudioSocket to $audiosocket_target (UUID=$session_uuid)", 3);

$AGI->exec('AudioSocket', "$session_uuid,$audiosocket_target");

# ── Step 3: AudioSocket returned — check outcome ─────────────────────────
#
# When the AI finishes (transfer, hangup, callback), it updates the session
# and closes the TCP connection.  Control returns here.

$AGI->verbose("AI-AGI: AudioSocket disconnected, checking session outcome", 3);

my $outcome_url = "$AI_SERVICE_URL/audiosocket/session/$session_uuid";
my $outcome_resp = $ua->get($outcome_url);

my $outcome = 'hangup';
my $transfer_target = '';

if ($outcome_resp->is_success) {
    my $odata = decode_json($outcome_resp->decoded_content);
    $outcome = $odata->{outcome} || 'hangup';
    $transfer_target = $odata->{transferTarget} || '';
    $AGI->verbose("AI-AGI: Outcome=$outcome, transfer=$transfer_target", 3);
} else {
    $AGI->verbose("AI-AGI: Could not fetch outcome: " . $outcome_resp->status_line, 2);
}

# ── Step 4: Act on outcome ────────────────────────────────────────────────

if ($outcome eq 'transfer' && $transfer_target) {
    # Set VICIdial transfer variables
    $AGI->set_variable('AI_TRANSFER', '1');
    $AGI->set_variable('AI_TRANSFER_NUMBER', $transfer_target);
    $AGI->set_variable('AI_OUTCOME', 'transfer');

    # Transfer the call — use Dial or redirect depending on your dialplan
    $AGI->verbose("AI-AGI: Transferring to $transfer_target", 3);
    $AGI->exec('Dial', "SIP/$transfer_target,60,tT");

} elsif ($outcome eq 'callback') {
    $AGI->set_variable('AI_OUTCOME', 'callback');
    $AGI->verbose("AI-AGI: Callback scheduled, hanging up", 3);
    $AGI->hangup();

} else {
    # hangup or unknown
    $AGI->set_variable('AI_OUTCOME', $outcome);
    $AGI->verbose("AI-AGI: Call ended ($outcome)", 3);
    $AGI->hangup();
}

exit 0;
