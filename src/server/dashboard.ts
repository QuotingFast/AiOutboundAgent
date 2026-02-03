export function getDashboardHtml(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Quoting Fast AI</title>
<style>
  :root {
    --bg: #0f1117;
    --surface: #1a1d27;
    --surface2: #232733;
    --border: #2e3345;
    --text: #e4e6ed;
    --text2: #9499ad;
    --accent: #6366f1;
    --accent-hover: #818cf8;
    --green: #22c55e;
    --red: #ef4444;
    --orange: #f59e0b;
    --cyan: #06b6d4;
    --radius: 10px;
  }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    background: var(--bg);
    color: var(--text);
    min-height: 100vh;
  }
  header {
    background: var(--surface);
    border-bottom: 1px solid var(--border);
    padding: 16px 32px;
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  header h1 {
    font-size: 18px;
    font-weight: 600;
    display: flex;
    align-items: center;
    gap: 10px;
  }
  header h1 span { color: var(--accent); }
  .status-dot {
    width: 8px; height: 8px;
    background: var(--green);
    border-radius: 50%;
    display: inline-block;
  }
  .tab-bar {
    background: var(--surface);
    border-bottom: 1px solid var(--border);
    display: flex;
    gap: 0;
    overflow-x: auto;
    padding: 0 16px;
  }
  .tab-bar button {
    padding: 12px 20px;
    border: none;
    background: transparent;
    color: var(--text2);
    font-size: 13px;
    font-weight: 500;
    cursor: pointer;
    font-family: inherit;
    border-bottom: 2px solid transparent;
    transition: all 0.15s;
    white-space: nowrap;
  }
  .tab-bar button:hover { color: var(--text); }
  .tab-bar button.active {
    color: var(--accent);
    border-bottom-color: var(--accent);
  }
  .tab-content { display: none; }
  .tab-content.active { display: block; }
  main {
    max-width: 1100px;
    margin: 0 auto;
    padding: 24px 16px 60px;
  }
  .card {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 24px;
    margin-bottom: 20px;
  }
  .card h2 {
    font-size: 15px;
    font-weight: 600;
    margin-bottom: 18px;
    color: var(--text);
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .card h2 .icon { font-size: 18px; }
  .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
  .grid-3 { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 16px; }
  .grid-4 { display: grid; grid-template-columns: 1fr 1fr 1fr 1fr; gap: 12px; }
  .full { grid-column: 1 / -1; }
  label {
    display: block;
    font-size: 12px;
    font-weight: 500;
    color: var(--text2);
    margin-bottom: 6px;
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }
  input, select, textarea {
    width: 100%;
    background: var(--surface2);
    border: 1px solid var(--border);
    border-radius: 6px;
    color: var(--text);
    padding: 10px 12px;
    font-size: 14px;
    font-family: inherit;
    outline: none;
    transition: border-color 0.2s;
  }
  input:focus, select:focus, textarea:focus {
    border-color: var(--accent);
  }
  textarea { resize: vertical; min-height: 200px; font-size: 13px; line-height: 1.5; }
  select { cursor: pointer; }
  .range-wrap {
    display: flex;
    align-items: center;
    gap: 12px;
  }
  .range-wrap input[type=range] {
    flex: 1;
    padding: 0;
    height: 6px;
    -webkit-appearance: none;
    background: var(--border);
    border-radius: 3px;
    border: none;
  }
  .range-wrap input[type=range]::-webkit-slider-thumb {
    -webkit-appearance: none;
    width: 16px; height: 16px;
    background: var(--accent);
    border-radius: 50%;
    cursor: pointer;
  }
  .range-val {
    font-size: 13px;
    font-weight: 600;
    color: var(--accent);
    min-width: 45px;
    text-align: right;
  }
  .btn {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 10px 20px;
    border: none;
    border-radius: 6px;
    font-size: 14px;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.15s;
    font-family: inherit;
  }
  .btn-primary { background: var(--accent); color: white; }
  .btn-primary:hover { background: var(--accent-hover); }
  .btn-secondary { background: var(--surface2); color: var(--text); border: 1px solid var(--border); }
  .btn-secondary:hover { background: var(--border); }
  .btn-green { background: var(--green); color: white; }
  .btn-green:hover { opacity: 0.9; }
  .btn-red { background: var(--red); color: white; }
  .btn-red:hover { opacity: 0.9; }
  .btn-sm { padding: 6px 12px; font-size: 12px; }
  .btn:disabled { opacity: 0.5; cursor: not-allowed; }
  .call-row { display: flex; gap: 12px; align-items: flex-end; }
  .call-row .field { flex: 1; }
  .toast {
    position: fixed;
    bottom: 24px;
    right: 24px;
    padding: 12px 20px;
    border-radius: 8px;
    font-size: 14px;
    font-weight: 500;
    color: white;
    z-index: 999;
    opacity: 0;
    transform: translateY(10px);
    transition: all 0.3s;
  }
  .toast.show { opacity: 1; transform: translateY(0); }
  .toast.success { background: var(--green); }
  .toast.error { background: var(--red); }
  .call-log {
    font-family: 'SF Mono', 'Fira Code', monospace;
    font-size: 12px;
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 12px;
    max-height: 180px;
    overflow-y: auto;
    line-height: 1.8;
    color: var(--text2);
  }
  .call-log .entry { padding: 2px 0; }
  .call-log .sid { color: var(--accent); }
  .call-log .ok { color: var(--green); }
  .call-log .err { color: var(--red); }
  .section-actions {
    display: flex;
    gap: 10px;
    margin-top: 18px;
    justify-content: flex-end;
  }
  .voice-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(170px, 1fr));
    gap: 10px;
  }
  .voice-card {
    background: var(--surface2);
    border: 2px solid var(--border);
    border-radius: 8px;
    padding: 12px;
    cursor: pointer;
    transition: all 0.15s;
    position: relative;
  }
  .voice-card:hover { border-color: var(--accent); }
  .voice-card.selected { border-color: var(--accent); background: rgba(99, 102, 241, 0.1); }
  .voice-card .vc-name { font-size: 14px; font-weight: 600; margin-bottom: 2px; }
  .voice-card .vc-desc { font-size: 11px; color: var(--text2); line-height: 1.3; }
  .voice-card .vc-tag { display: inline-block; font-size: 10px; padding: 1px 6px; border-radius: 3px; margin-top: 6px; }
  .voice-card .vc-tag.sales { background: rgba(34,197,94,0.15); color: var(--green); }
  .voice-card .vc-tag.neutral { background: rgba(148,153,173,0.15); color: var(--text2); }
  .vc-play {
    position: absolute; top: 10px; right: 10px;
    width: 28px; height: 28px; border-radius: 50%;
    border: 1px solid var(--border); background: var(--surface);
    color: var(--text); display: flex; align-items: center; justify-content: center;
    cursor: pointer; font-size: 12px; transition: all 0.15s;
  }
  .vc-play:hover { border-color: var(--accent); color: var(--accent); }
  .vc-play.loading { opacity: 0.5; cursor: wait; }
  .vc-check { display: none; position: absolute; bottom: 8px; right: 10px; font-size: 14px; color: var(--accent); }
  .voice-card.selected .vc-check { display: block; }
  .voice-card.disabled { opacity: 0.35; pointer-events: none; filter: grayscale(1); }
  .voice-card.disabled .vc-play { display: none; }
  .provider-toggle {
    display: flex; gap: 0; background: var(--surface2);
    border-radius: 8px; overflow: hidden; border: 1px solid var(--border);
  }
  .provider-toggle button {
    flex: 1; padding: 12px 20px; border: none; background: transparent;
    color: var(--text2); font-size: 14px; font-weight: 500; cursor: pointer;
    font-family: inherit; transition: all 0.15s;
    display: flex; align-items: center; justify-content: center; gap: 8px;
  }
  .provider-toggle button:hover { background: var(--border); }
  .provider-toggle button.active { background: var(--accent); color: white; }
  .provider-toggle button .prov-label { font-size: 14px; }
  .provider-toggle button .prov-sub { font-size: 11px; opacity: 0.7; }
  .el-settings { margin-top: 16px; }
  .el-settings .el-row { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 14px; }
  .stat-card {
    background: var(--surface2);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 16px;
    text-align: center;
  }
  .stat-card .stat-value {
    font-size: 28px;
    font-weight: 700;
    color: var(--accent);
    line-height: 1.2;
  }
  .stat-card .stat-label {
    font-size: 11px;
    color: var(--text2);
    text-transform: uppercase;
    letter-spacing: 0.5px;
    margin-top: 4px;
  }
  .stat-card.green .stat-value { color: var(--green); }
  .stat-card.red .stat-value { color: var(--red); }
  .stat-card.orange .stat-value { color: var(--orange); }
  .stat-card.cyan .stat-value { color: var(--cyan); }
  .data-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 12px;
  }
  .data-table th {
    text-align: left;
    color: var(--text2);
    padding: 8px;
    border-bottom: 1px solid var(--border);
    font-weight: 500;
    text-transform: uppercase;
    font-size: 11px;
    letter-spacing: 0.3px;
  }
  .data-table td {
    padding: 8px;
    border-bottom: 1px solid var(--border);
    color: var(--text);
  }
  .data-table tr:hover td { background: rgba(99,102,241,0.04); }
  .badge {
    display: inline-block;
    padding: 2px 8px;
    border-radius: 4px;
    font-size: 11px;
    font-weight: 500;
  }
  .badge-green { background: rgba(34,197,94,0.15); color: var(--green); }
  .badge-red { background: rgba(239,68,68,0.15); color: var(--red); }
  .badge-orange { background: rgba(245,158,11,0.15); color: var(--orange); }
  .badge-blue { background: rgba(99,102,241,0.15); color: var(--accent); }
  .badge-gray { background: rgba(148,153,173,0.15); color: var(--text2); }
  .empty-state {
    text-align: center;
    padding: 32px;
    color: var(--text2);
    font-size: 14px;
  }
  @media (max-width: 640px) {
    .grid, .grid-3, .grid-4, .el-settings .el-row { grid-template-columns: 1fr; }
    .call-row { flex-direction: column; }
    .voice-grid { grid-template-columns: 1fr 1fr; }
    main { padding: 16px 10px; }
    .provider-toggle { flex-direction: column; }
    .tab-bar { padding: 0 8px; }
    .tab-bar button { padding: 10px 14px; font-size: 12px; }
  }
</style>
</head>
<body>
<header>
  <h1><img src="https://quotingfast.com/qflogo1.png" alt="Quoting Fast" style="height:32px;vertical-align:middle;margin-right:8px">Quoting Fast AI</h1>
  <div style="display:flex;align-items:center;gap:8px;font-size:13px;color:var(--text2)">
    <span class="status-dot"></span> Connected
  </div>
</header>

<div class="tab-bar">
  <button class="active" onclick="switchTab('calls')">Calls</button>
  <button onclick="switchTab('analytics')">Analytics</button>
  <button onclick="switchTab('monitoring')">Monitoring</button>
  <button onclick="switchTab('compliance')">Compliance</button>
  <button onclick="switchTab('leads')">Leads</button>
  <button onclick="switchTab('settings')">Settings</button>
</div>

<main>

<!-- CALLS TAB -->
<div class="tab-content active" id="tab-calls">
  <div class="card">
    <h2><span class="icon">&#128222;</span> Quick Call</h2>
    <div class="call-row">
      <div class="field">
        <label>To Number</label>
        <input type="text" id="callTo" placeholder="+19547905093">
      </div>
      <div class="field">
        <label>From Number</label>
        <input type="text" id="callFrom" placeholder="+18557702370">
      </div>
      <div class="field">
        <label>Lead Name</label>
        <input type="text" id="callName" value="Justin">
      </div>
      <div class="field">
        <label>Lead State</label>
        <input type="text" id="callState" value="FL" style="max-width:80px">
      </div>
      <button class="btn btn-green" id="callBtn" onclick="makeCall()">Call</button>
    </div>
    <div class="call-log" id="callLog" style="margin-top:14px">
      <div class="entry" style="color:var(--text2)">Call log will appear here...</div>
    </div>
  </div>

  <div class="card">
    <h2><span class="icon">&#128203;</span> Recent Calls <button class="btn btn-secondary btn-sm" style="margin-left:auto" onclick="loadCallHistory()">Refresh</button></h2>
    <div id="callHistory" style="font-size:13px;color:var(--text2)">Loading...</div>
  </div>
</div>

<!-- ANALYTICS TAB -->
<div class="tab-content" id="tab-analytics">
  <div class="card">
    <h2><span class="icon">&#128200;</span> Summary</h2>
    <div class="grid-4" id="analyticsSummary">
      <div class="stat-card"><div class="stat-value">--</div><div class="stat-label">Total Calls</div></div>
      <div class="stat-card green"><div class="stat-value">--%</div><div class="stat-label">Transfer Rate</div></div>
      <div class="stat-card cyan"><div class="stat-value">--ms</div><div class="stat-label">Avg Latency</div></div>
      <div class="stat-card orange"><div class="stat-value">$--</div><div class="stat-label">Total Cost</div></div>
    </div>
  </div>

  <div class="card">
    <h2><span class="icon">&#128202;</span> Outcomes</h2>
    <div class="grid-4" id="analyticsOutcomes">
      <div class="stat-card green"><div class="stat-value">0</div><div class="stat-label">Transferred</div></div>
      <div class="stat-card"><div class="stat-value">0</div><div class="stat-label">Ended</div></div>
      <div class="stat-card red"><div class="stat-value">0</div><div class="stat-label">Dropped</div></div>
      <div class="stat-card cyan"><div class="stat-value">0</div><div class="stat-label">Avg Score</div></div>
    </div>
  </div>

  <div class="card">
    <h2><span class="icon">&#128196;</span> Call Analytics <button class="btn btn-secondary btn-sm" style="margin-left:auto" onclick="loadAnalytics()">Refresh</button></h2>
    <div id="analyticsTable"><div class="empty-state">Loading...</div></div>
  </div>
</div>

<!-- MONITORING TAB -->
<div class="tab-content" id="tab-monitoring">
  <div class="card">
    <h2><span class="icon">&#128994;</span> System Health <button class="btn btn-secondary btn-sm" style="margin-left:auto" onclick="loadMonitoring()">Refresh</button></h2>
    <div class="grid-4" id="systemHealth">
      <div class="stat-card"><div class="stat-value">0</div><div class="stat-label">Active Sessions</div></div>
      <div class="stat-card"><div class="stat-value">10</div><div class="stat-label">Max Sessions</div></div>
      <div class="stat-card"><div class="stat-value">0</div><div class="stat-label">Queue Size</div></div>
      <div class="stat-card green"><div class="stat-value">0%</div><div class="stat-label">Utilization</div></div>
    </div>
  </div>

  <div class="card">
    <h2><span class="icon">&#128260;</span> Active Sessions</h2>
    <div id="activeSessions"><div class="empty-state">No active sessions</div></div>
  </div>

  <div class="card">
    <h2><span class="icon">&#128218;</span> Call Queue</h2>
    <div id="callQueue"><div class="empty-state">Queue is empty</div></div>
  </div>

  <div class="card">
    <h2><span class="icon">&#9881;</span> Concurrency</h2>
    <div style="display:flex;gap:12px;align-items:flex-end">
      <div style="flex:1">
        <label>Max Concurrent Calls</label>
        <input type="number" id="maxConcurrency" value="10" min="1" max="100">
      </div>
      <button class="btn btn-primary btn-sm" onclick="updateConcurrency()">Update</button>
    </div>
  </div>
</div>

<!-- COMPLIANCE TAB -->
<div class="tab-content" id="tab-compliance">
  <div class="card">
    <h2><span class="icon">&#128274;</span> Do Not Call List <button class="btn btn-secondary btn-sm" style="margin-left:auto" onclick="loadDnc()">Refresh</button></h2>
    <div style="display:flex;gap:12px;align-items:flex-end;margin-bottom:16px">
      <div style="flex:1">
        <label>Add Phone to DNC</label>
        <input type="text" id="dncPhone" placeholder="+15551234567">
      </div>
      <button class="btn btn-red btn-sm" onclick="addDnc()">Add to DNC</button>
    </div>
    <div id="dncList"><div class="empty-state">Loading...</div></div>
  </div>

  <div class="card">
    <h2><span class="icon">&#128336;</span> TCPA Time Check</h2>
    <div style="display:flex;gap:12px;align-items:flex-end">
      <div style="flex:1">
        <label>State Code</label>
        <input type="text" id="tcpaState" placeholder="FL" style="max-width:100px">
      </div>
      <button class="btn btn-secondary btn-sm" onclick="checkTcpa()">Check</button>
    </div>
    <div id="tcpaResult" style="margin-top:12px;font-size:13px;color:var(--text2)"></div>
  </div>

  <div class="card">
    <h2><span class="icon">&#128209;</span> Audit Log <button class="btn btn-secondary btn-sm" style="margin-left:auto" onclick="loadAuditLog()">Refresh</button></h2>
    <div id="auditLog"><div class="empty-state">Loading...</div></div>
  </div>
</div>

<!-- LEADS TAB -->
<div class="tab-content" id="tab-leads">
  <div class="card">
    <h2><span class="icon">&#128101;</span> Lead Memory <button class="btn btn-secondary btn-sm" style="margin-left:auto" onclick="loadLeads()">Refresh</button></h2>
    <div style="display:flex;gap:12px;margin-bottom:16px">
      <select id="leadFilter" onchange="loadLeads()" style="width:auto">
        <option value="">All Dispositions</option>
        <option value="new">New</option>
        <option value="contacted">Contacted</option>
        <option value="interested">Interested</option>
        <option value="transferred">Transferred</option>
        <option value="not_interested">Not Interested</option>
        <option value="callback">Callback</option>
        <option value="dnc">DNC</option>
      </select>
    </div>
    <div id="leadsTable"><div class="empty-state">Loading...</div></div>
  </div>

  <div class="card">
    <h2><span class="icon">&#128222;</span> Scheduled Callbacks <button class="btn btn-secondary btn-sm" style="margin-left:auto" onclick="loadCallbacks()">Refresh</button></h2>
    <div id="callbacksList"><div class="empty-state">Loading...</div></div>
  </div>
</div>

<!-- SETTINGS TAB -->
<div class="tab-content" id="tab-settings">
  <!-- Voice Provider -->
  <div class="card">
    <h2><span class="icon">&#127908;</span> Voice Provider</h2>
    <input type="hidden" id="voiceProvider" value="elevenlabs">
    <div class="provider-toggle">
      <button id="provOpenai" onclick="setProvider('openai')">
        <span class="prov-label">OpenAI Realtime</span>
        <span class="prov-sub">(speech-to-speech)</span>
      </button>
      <button id="provElevenlabs" class="active" onclick="setProvider('elevenlabs')">
        <span class="prov-label">ElevenLabs</span>
        <span class="prov-sub">(OpenAI LLM + EL TTS)</span>
      </button>
      <button id="provDeepseek" onclick="setProvider('deepseek')">
        <span class="prov-label">DeepSeek</span>
        <span class="prov-sub">(DeepSeek LLM + EL TTS)</span>
      </button>
    </div>

    <div id="openaiVoiceSection" style="margin-top:16px;display:none">
    <label>OpenAI Voice</label>
    <input type="hidden" id="voice" value="coral">
    <div class="voice-grid" id="voiceGrid">
      <div class="voice-card" data-voice="coral" onclick="selectVoice('coral')">
        <button class="vc-play" onclick="event.stopPropagation();previewVoice('coral',this)" title="Preview">&#9654;</button>
        <div class="vc-name">Coral</div><div class="vc-desc">Friendly, upbeat</div>
        <span class="vc-tag sales">Sales</span><span class="vc-check">&#10003;</span>
      </div>
      <div class="voice-card" data-voice="sage" onclick="selectVoice('sage')">
        <button class="vc-play" onclick="event.stopPropagation();previewVoice('sage',this)" title="Preview">&#9654;</button>
        <div class="vc-name">Sage</div><div class="vc-desc">Calm, thoughtful</div>
        <span class="vc-tag sales">Sales</span><span class="vc-check">&#10003;</span>
      </div>
      <div class="voice-card" data-voice="ballad" onclick="selectVoice('ballad')">
        <button class="vc-play" onclick="event.stopPropagation();previewVoice('ballad',this)" title="Preview">&#9654;</button>
        <div class="vc-name">Ballad</div><div class="vc-desc">Warm, expressive</div>
        <span class="vc-tag sales">Sales</span><span class="vc-check">&#10003;</span>
      </div>
      <div class="voice-card" data-voice="ash" onclick="selectVoice('ash')">
        <button class="vc-play" onclick="event.stopPropagation();previewVoice('ash',this)" title="Preview">&#9654;</button>
        <div class="vc-name">Ash</div><div class="vc-desc">Warm, conversational</div>
        <span class="vc-tag neutral">Versatile</span><span class="vc-check">&#10003;</span>
      </div>
      <div class="voice-card" data-voice="verse" onclick="selectVoice('verse')">
        <button class="vc-play" onclick="event.stopPropagation();previewVoice('verse',this)" title="Preview">&#9654;</button>
        <div class="vc-name">Verse</div><div class="vc-desc">Articulate, clear</div>
        <span class="vc-tag neutral">Versatile</span><span class="vc-check">&#10003;</span>
      </div>
      <div class="voice-card" data-voice="alloy" onclick="selectVoice('alloy')">
        <button class="vc-play" onclick="event.stopPropagation();previewVoice('alloy',this)" title="Preview">&#9654;</button>
        <div class="vc-name">Alloy</div><div class="vc-desc">Neutral, balanced</div>
        <span class="vc-tag neutral">Versatile</span><span class="vc-check">&#10003;</span>
      </div>
      <div class="voice-card" data-voice="echo" onclick="selectVoice('echo')">
        <button class="vc-play" onclick="event.stopPropagation();previewVoice('echo',this)" title="Preview">&#9654;</button>
        <div class="vc-name">Echo</div><div class="vc-desc">Deep, steady</div>
        <span class="vc-tag neutral">Versatile</span><span class="vc-check">&#10003;</span>
      </div>
      <div class="voice-card" data-voice="shimmer" onclick="selectVoice('shimmer')">
        <button class="vc-play" onclick="event.stopPropagation();previewVoice('shimmer',this)" title="Preview">&#9654;</button>
        <div class="vc-name">Shimmer</div><div class="vc-desc">Bright, energetic</div>
        <span class="vc-tag neutral">Versatile</span><span class="vc-check">&#10003;</span>
      </div>
    </div>
    </div>

    <div id="deepseekVoiceSection" style="margin-top:16px;display:none">
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:14px">
        <div style="width:8px;height:8px;background:var(--green);border-radius:50%"></div>
        <span style="font-size:14px;font-weight:600;color:var(--text)">DeepSeek LLM</span>
        <span style="font-size:12px;color:var(--text2)">+</span>
        <span style="font-size:14px;font-weight:600;color:var(--text)">ElevenLabs TTS</span>
      </div>
      <div class="el-row">
        <div>
          <label>DeepSeek Model</label>
          <select id="deepseekModel">
            <option value="deepseek-chat">DeepSeek V3 (fast, affordable)</option>
            <option value="deepseek-reasoner">DeepSeek R1 (reasoning)</option>
          </select>
        </div>
        <div></div>
      </div>
      <p style="font-size:12px;color:var(--text2);margin-bottom:14px">
        DeepSeek handles the conversation intelligence. Pick an ElevenLabs voice below for speech output.
      </p>
      <label>Voice (ElevenLabs TTS)</label>
      <input type="hidden" id="dsElevenlabsVoiceId" value="">
      <div class="voice-grid" id="dsVoiceGrid">
        <div class="voice-card ds-vc" data-dsvoice="21m00Tcm4TlvDq8ikWAM" onclick="selectDsVoice('21m00Tcm4TlvDq8ikWAM')">
          <button class="vc-play" onclick="event.stopPropagation();previewElVoice('21m00Tcm4TlvDq8ikWAM',this)" title="Preview">&#9654;</button>
          <div class="vc-name">Rachel</div><div class="vc-desc">Calm, warm female</div>
          <span class="vc-tag sales">Sales</span><span class="vc-check">&#10003;</span>
        </div>
        <div class="voice-card ds-vc" data-dsvoice="EXAVITQu4vr4xnSDxMaL" onclick="selectDsVoice('EXAVITQu4vr4xnSDxMaL')">
          <button class="vc-play" onclick="event.stopPropagation();previewElVoice('EXAVITQu4vr4xnSDxMaL',this)" title="Preview">&#9654;</button>
          <div class="vc-name">Bella</div><div class="vc-desc">Soft, friendly female</div>
          <span class="vc-tag sales">Sales</span><span class="vc-check">&#10003;</span>
        </div>
        <div class="voice-card ds-vc" data-dsvoice="AZnzlk1XvdvUeBnXmlld" onclick="selectDsVoice('AZnzlk1XvdvUeBnXmlld')">
          <button class="vc-play" onclick="event.stopPropagation();previewElVoice('AZnzlk1XvdvUeBnXmlld',this)" title="Preview">&#9654;</button>
          <div class="vc-name">Domi</div><div class="vc-desc">Confident, assertive female</div>
          <span class="vc-tag sales">Sales</span><span class="vc-check">&#10003;</span>
        </div>
        <div class="voice-card ds-vc" data-dsvoice="MF3mGyEYCl7XYWbV9V6O" onclick="selectDsVoice('MF3mGyEYCl7XYWbV9V6O')">
          <button class="vc-play" onclick="event.stopPropagation();previewElVoice('MF3mGyEYCl7XYWbV9V6O',this)" title="Preview">&#9654;</button>
          <div class="vc-name">Elli</div><div class="vc-desc">Expressive, emotional female</div>
          <span class="vc-tag neutral">Versatile</span><span class="vc-check">&#10003;</span>
        </div>
        <div class="voice-card ds-vc" data-dsvoice="ErXwobaYiN019PkySvjV" onclick="selectDsVoice('ErXwobaYiN019PkySvjV')">
          <button class="vc-play" onclick="event.stopPropagation();previewElVoice('ErXwobaYiN019PkySvjV',this)" title="Preview">&#9654;</button>
          <div class="vc-name">Antoni</div><div class="vc-desc">Warm, conversational male</div>
          <span class="vc-tag sales">Sales</span><span class="vc-check">&#10003;</span>
        </div>
        <div class="voice-card ds-vc" data-dsvoice="TxGEqnHWrfWFTfGW9XjX" onclick="selectDsVoice('TxGEqnHWrfWFTfGW9XjX')">
          <button class="vc-play" onclick="event.stopPropagation();previewElVoice('TxGEqnHWrfWFTfGW9XjX',this)" title="Preview">&#9654;</button>
          <div class="vc-name">Josh</div><div class="vc-desc">Deep, friendly male</div>
          <span class="vc-tag neutral">Versatile</span><span class="vc-check">&#10003;</span>
        </div>
        <div class="voice-card ds-vc" data-dsvoice="VR6AewLTigWG4xSOukaG" onclick="selectDsVoice('VR6AewLTigWG4xSOukaG')">
          <button class="vc-play" onclick="event.stopPropagation();previewElVoice('VR6AewLTigWG4xSOukaG',this)" title="Preview">&#9654;</button>
          <div class="vc-name">Arnold</div><div class="vc-desc">Crisp, confident male</div>
          <span class="vc-tag neutral">Versatile</span><span class="vc-check">&#10003;</span>
        </div>
        <div class="voice-card ds-vc" data-dsvoice="pNInz6obpgDQGcFmaJgB" onclick="selectDsVoice('pNInz6obpgDQGcFmaJgB')">
          <button class="vc-play" onclick="event.stopPropagation();previewElVoice('pNInz6obpgDQGcFmaJgB',this)" title="Preview">&#9654;</button>
          <div class="vc-name">Adam</div><div class="vc-desc">Deep, authoritative male</div>
          <span class="vc-tag neutral">Versatile</span><span class="vc-check">&#10003;</span>
        </div>
        <div class="voice-card ds-vc" data-dsvoice="yoZ06aMxZJJ28mfd3POQ" onclick="selectDsVoice('yoZ06aMxZJJ28mfd3POQ')">
          <button class="vc-play" onclick="event.stopPropagation();previewElVoice('yoZ06aMxZJJ28mfd3POQ',this)" title="Preview">&#9654;</button>
          <div class="vc-name">Sam</div><div class="vc-desc">Raspy, natural male</div>
          <span class="vc-tag sales">Sales</span><span class="vc-check">&#10003;</span>
        </div>
        <div class="voice-card ds-vc" data-dsvoice="XB0fDUnXU5powFXDhCwa" onclick="selectDsVoice('XB0fDUnXU5powFXDhCwa')">
          <button class="vc-play" onclick="event.stopPropagation();previewElVoice('XB0fDUnXU5powFXDhCwa',this)" title="Preview">&#9654;</button>
          <div class="vc-name">Charlotte</div><div class="vc-desc">Warm, natural female</div>
          <span class="vc-tag sales">Sales</span><span class="vc-check">&#10003;</span>
        </div>
      </div>
      <div style="margin-top:14px;padding-top:14px;border-top:1px solid var(--border)">
        <label>Custom Voice ID (optional)</label>
        <input type="text" id="dsCustomVoiceId" placeholder="Paste a custom ElevenLabs Voice ID here">
      </div>
      <div class="el-row" style="margin-top:14px">
        <div>
          <label>ElevenLabs TTS Model</label>
          <select id="dsElevenlabsModelId">
            <option value="eleven_turbo_v2_5">Turbo v2.5 (fastest)</option>
            <option value="eleven_multilingual_v2">Multilingual v2</option>
            <option value="eleven_monolingual_v1">Monolingual v1</option>
          </select>
        </div>
        <div></div>
      </div>
      <div class="el-row">
        <div>
          <label>Stability (0.0 - 1.0)</label>
          <div class="range-wrap">
            <input type="range" id="dsStability" min="0" max="1" step="0.05" value="0.5">
            <span class="range-val" id="dsStabilityVal">0.50</span>
          </div>
        </div>
        <div>
          <label>Similarity Boost (0.0 - 1.0)</label>
          <div class="range-wrap">
            <input type="range" id="dsSimilarityBoost" min="0" max="1" step="0.05" value="0.75">
            <span class="range-val" id="dsSimilarityBoostVal">0.75</span>
          </div>
        </div>
      </div>
    </div>

    <div id="elevenlabsVoiceSection" class="el-settings">
      <label>ElevenLabs Voice</label>
      <input type="hidden" id="elevenlabsVoiceId" value="">
      <div style="font-size:11px;color:var(--text2);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:8px;font-weight:500">Female Voices</div>
      <div class="voice-grid" id="elVoiceGrid">
        <div class="voice-card el-vc" data-elvoice="21m00Tcm4TlvDq8ikWAM" onclick="selectElVoice('21m00Tcm4TlvDq8ikWAM')">
          <button class="vc-play" onclick="event.stopPropagation();previewElVoice('21m00Tcm4TlvDq8ikWAM',this)" title="Preview">&#9654;</button>
          <div class="vc-name">Rachel</div><div class="vc-desc">Calm, warm, natural</div>
          <span class="vc-tag sales">Sales</span><span class="vc-check">&#10003;</span>
        </div>
        <div class="voice-card el-vc" data-elvoice="EXAVITQu4vr4xnSDxMaL" onclick="selectElVoice('EXAVITQu4vr4xnSDxMaL')">
          <button class="vc-play" onclick="event.stopPropagation();previewElVoice('EXAVITQu4vr4xnSDxMaL',this)" title="Preview">&#9654;</button>
          <div class="vc-name">Sarah</div><div class="vc-desc">Soft, friendly, approachable</div>
          <span class="vc-tag sales">Sales</span><span class="vc-check">&#10003;</span>
        </div>
        <div class="voice-card el-vc" data-elvoice="AZnzlk1XvdvUeBnXmlld" onclick="selectElVoice('AZnzlk1XvdvUeBnXmlld')">
          <button class="vc-play" onclick="event.stopPropagation();previewElVoice('AZnzlk1XvdvUeBnXmlld',this)" title="Preview">&#9654;</button>
          <div class="vc-name">Domi</div><div class="vc-desc">Confident, assertive, strong</div>
          <span class="vc-tag sales">Sales</span><span class="vc-check">&#10003;</span>
        </div>
        <div class="voice-card el-vc" data-elvoice="MF3mGyEYCl7XYWbV9V6O" onclick="selectElVoice('MF3mGyEYCl7XYWbV9V6O')">
          <button class="vc-play" onclick="event.stopPropagation();previewElVoice('MF3mGyEYCl7XYWbV9V6O',this)" title="Preview">&#9654;</button>
          <div class="vc-name">Elli</div><div class="vc-desc">Expressive, emotional, youthful</div>
          <span class="vc-tag neutral">Versatile</span><span class="vc-check">&#10003;</span>
        </div>
        <div class="voice-card el-vc" data-elvoice="XrExE9yKIg1WjnnlVkGX" onclick="selectElVoice('XrExE9yKIg1WjnnlVkGX')">
          <button class="vc-play" onclick="event.stopPropagation();previewElVoice('XrExE9yKIg1WjnnlVkGX',this)" title="Preview">&#9654;</button>
          <div class="vc-name">Matilda</div><div class="vc-desc">Warm, friendly, storytelling</div>
          <span class="vc-tag sales">Sales</span><span class="vc-check">&#10003;</span>
        </div>
        <div class="voice-card el-vc" data-elvoice="pMsXgVXv3BLzUgSXRplE" onclick="selectElVoice('pMsXgVXv3BLzUgSXRplE')">
          <button class="vc-play" onclick="event.stopPropagation();previewElVoice('pMsXgVXv3BLzUgSXRplE',this)" title="Preview">&#9654;</button>
          <div class="vc-name">Serena</div><div class="vc-desc">Pleasant, interactive, engaging</div>
          <span class="vc-tag sales">Sales</span><span class="vc-check">&#10003;</span>
        </div>
        <div class="voice-card el-vc" data-elvoice="LcfcDJNUP1GQjkzn1xUU" onclick="selectElVoice('LcfcDJNUP1GQjkzn1xUU')">
          <button class="vc-play" onclick="event.stopPropagation();previewElVoice('LcfcDJNUP1GQjkzn1xUU',this)" title="Preview">&#9654;</button>
          <div class="vc-name">Emily</div><div class="vc-desc">Calm, gentle, reassuring</div>
          <span class="vc-tag neutral">Versatile</span><span class="vc-check">&#10003;</span>
        </div>
        <div class="voice-card el-vc" data-elvoice="jsCqWAovK2LkecY7zXl4" onclick="selectElVoice('jsCqWAovK2LkecY7zXl4')">
          <button class="vc-play" onclick="event.stopPropagation();previewElVoice('jsCqWAovK2LkecY7zXl4',this)" title="Preview">&#9654;</button>
          <div class="vc-name">Freya</div><div class="vc-desc">Expressive, lively, youthful</div>
          <span class="vc-tag neutral">Versatile</span><span class="vc-check">&#10003;</span>
        </div>
        <div class="voice-card el-vc" data-elvoice="oWAxZDx7w5VEj9dCyTzz" onclick="selectElVoice('oWAxZDx7w5VEj9dCyTzz')">
          <button class="vc-play" onclick="event.stopPropagation();previewElVoice('oWAxZDx7w5VEj9dCyTzz',this)" title="Preview">&#9654;</button>
          <div class="vc-name">Grace</div><div class="vc-desc">Southern, warm, personable</div>
          <span class="vc-tag sales">Sales</span><span class="vc-check">&#10003;</span>
        </div>
        <div class="voice-card el-vc" data-elvoice="piTKgcLEGmPE4e6mEKli" onclick="selectElVoice('piTKgcLEGmPE4e6mEKli')">
          <button class="vc-play" onclick="event.stopPropagation();previewElVoice('piTKgcLEGmPE4e6mEKli',this)" title="Preview">&#9654;</button>
          <div class="vc-name">Nicole</div><div class="vc-desc">Soft, intimate, whispery</div>
          <span class="vc-tag neutral">Versatile</span><span class="vc-check">&#10003;</span>
        </div>
      </div>
      <div style="font-size:11px;color:var(--text2);text-transform:uppercase;letter-spacing:0.5px;margin:16px 0 8px;font-weight:500">Male Voices</div>
      <div class="voice-grid">
        <div class="voice-card el-vc" data-elvoice="ErXwobaYiN019PkySvjV" onclick="selectElVoice('ErXwobaYiN019PkySvjV')">
          <button class="vc-play" onclick="event.stopPropagation();previewElVoice('ErXwobaYiN019PkySvjV',this)" title="Preview">&#9654;</button>
          <div class="vc-name">Antoni</div><div class="vc-desc">Warm, conversational, natural</div>
          <span class="vc-tag sales">Sales</span><span class="vc-check">&#10003;</span>
        </div>
        <div class="voice-card el-vc" data-elvoice="iP95p4xoKVk53GoZ742B" onclick="selectElVoice('iP95p4xoKVk53GoZ742B')">
          <button class="vc-play" onclick="event.stopPropagation();previewElVoice('iP95p4xoKVk53GoZ742B',this)" title="Preview">&#9654;</button>
          <div class="vc-name">Chris</div><div class="vc-desc">Casual, easy-going, friendly</div>
          <span class="vc-tag sales">Sales</span><span class="vc-check">&#10003;</span>
        </div>
        <div class="voice-card el-vc" data-elvoice="nPczCjzI2devNBz1zQrb" onclick="selectElVoice('nPczCjzI2devNBz1zQrb')">
          <button class="vc-play" onclick="event.stopPropagation();previewElVoice('nPczCjzI2devNBz1zQrb',this)" title="Preview">&#9654;</button>
          <div class="vc-name">Brian</div><div class="vc-desc">Deep, steady, trustworthy</div>
          <span class="vc-tag sales">Sales</span><span class="vc-check">&#10003;</span>
        </div>
        <div class="voice-card el-vc" data-elvoice="TxGEqnHWrfWFTfGW9XjX" onclick="selectElVoice('TxGEqnHWrfWFTfGW9XjX')">
          <button class="vc-play" onclick="event.stopPropagation();previewElVoice('TxGEqnHWrfWFTfGW9XjX',this)" title="Preview">&#9654;</button>
          <div class="vc-name">Josh</div><div class="vc-desc">Deep, friendly, engaging</div>
          <span class="vc-tag neutral">Versatile</span><span class="vc-check">&#10003;</span>
        </div>
        <div class="voice-card el-vc" data-elvoice="29vD33N1CtxCmqQRPOHJ" onclick="selectElVoice('29vD33N1CtxCmqQRPOHJ')">
          <button class="vc-play" onclick="event.stopPropagation();previewElVoice('29vD33N1CtxCmqQRPOHJ',this)" title="Preview">&#9654;</button>
          <div class="vc-name">Drew</div><div class="vc-desc">Professional, well-rounded, clear</div>
          <span class="vc-tag sales">Sales</span><span class="vc-check">&#10003;</span>
        </div>
        <div class="voice-card el-vc" data-elvoice="pqHfZKP75CvOlQylNhV4" onclick="selectElVoice('pqHfZKP75CvOlQylNhV4')">
          <button class="vc-play" onclick="event.stopPropagation();previewElVoice('pqHfZKP75CvOlQylNhV4',this)" title="Preview">&#9654;</button>
          <div class="vc-name">Bill</div><div class="vc-desc">Trustworthy, strong, authoritative</div>
          <span class="vc-tag sales">Sales</span><span class="vc-check">&#10003;</span>
        </div>
        <div class="voice-card el-vc" data-elvoice="TX3LPaxmHKxFdv7VOQHJ" onclick="selectElVoice('TX3LPaxmHKxFdv7VOQHJ')">
          <button class="vc-play" onclick="event.stopPropagation();previewElVoice('TX3LPaxmHKxFdv7VOQHJ',this)" title="Preview">&#9654;</button>
          <div class="vc-name">Liam</div><div class="vc-desc">Articulate, clear, polished</div>
          <span class="vc-tag sales">Sales</span><span class="vc-check">&#10003;</span>
        </div>
        <div class="voice-card el-vc" data-elvoice="VR6AewLTigWG4xSOukaG" onclick="selectElVoice('VR6AewLTigWG4xSOukaG')">
          <button class="vc-play" onclick="event.stopPropagation();previewElVoice('VR6AewLTigWG4xSOukaG',this)" title="Preview">&#9654;</button>
          <div class="vc-name">Arnold</div><div class="vc-desc">Crisp, confident, direct</div>
          <span class="vc-tag neutral">Versatile</span><span class="vc-check">&#10003;</span>
        </div>
        <div class="voice-card el-vc" data-elvoice="pNInz6obpgDQGcFmaJgB" onclick="selectElVoice('pNInz6obpgDQGcFmaJgB')">
          <button class="vc-play" onclick="event.stopPropagation();previewElVoice('pNInz6obpgDQGcFmaJgB',this)" title="Preview">&#9654;</button>
          <div class="vc-name">Adam</div><div class="vc-desc">Deep, authoritative, commanding</div>
          <span class="vc-tag neutral">Versatile</span><span class="vc-check">&#10003;</span>
        </div>
        <div class="voice-card el-vc" data-elvoice="yoZ06aMxZJJ28mfd3POQ" onclick="selectElVoice('yoZ06aMxZJJ28mfd3POQ')">
          <button class="vc-play" onclick="event.stopPropagation();previewElVoice('yoZ06aMxZJJ28mfd3POQ',this)" title="Preview">&#9654;</button>
          <div class="vc-name">Sam</div><div class="vc-desc">Raspy, youthful, laid-back</div>
          <span class="vc-tag neutral">Versatile</span><span class="vc-check">&#10003;</span>
        </div>
        <div class="voice-card el-vc" data-elvoice="g5CIjZEefAph4nQFvHAz" onclick="selectElVoice('g5CIjZEefAph4nQFvHAz')">
          <button class="vc-play" onclick="event.stopPropagation();previewElVoice('g5CIjZEefAph4nQFvHAz',this)" title="Preview">&#9654;</button>
          <div class="vc-name">Ethan</div><div class="vc-desc">Soft, gentle, calming</div>
          <span class="vc-tag neutral">Versatile</span><span class="vc-check">&#10003;</span>
        </div>
        <div class="voice-card el-vc" data-elvoice="GBv7mTt0atIp3Br8iCZE" onclick="selectElVoice('GBv7mTt0atIp3Br8iCZE')">
          <button class="vc-play" onclick="event.stopPropagation();previewElVoice('GBv7mTt0atIp3Br8iCZE',this)" title="Preview">&#9654;</button>
          <div class="vc-name">Thomas</div><div class="vc-desc">Calm, soothing, measured</div>
          <span class="vc-tag neutral">Versatile</span><span class="vc-check">&#10003;</span>
        </div>
        <div class="voice-card el-vc" data-elvoice="5Q0t7uMcjvnagumLfvZi" onclick="selectElVoice('5Q0t7uMcjvnagumLfvZi')">
          <button class="vc-play" onclick="event.stopPropagation();previewElVoice('5Q0t7uMcjvnagumLfvZi',this)" title="Preview">&#9654;</button>
          <div class="vc-name">Paul</div><div class="vc-desc">Broadcast, professional, clear</div>
          <span class="vc-tag neutral">Versatile</span><span class="vc-check">&#10003;</span>
        </div>
        <div class="voice-card el-vc" data-elvoice="flq6f7yk4E4fJM5XTYuZ" onclick="selectElVoice('flq6f7yk4E4fJM5XTYuZ')">
          <button class="vc-play" onclick="event.stopPropagation();previewElVoice('flq6f7yk4E4fJM5XTYuZ',this)" title="Preview">&#9654;</button>
          <div class="vc-name">Michael</div><div class="vc-desc">Mature, deep, experienced</div>
          <span class="vc-tag neutral">Versatile</span><span class="vc-check">&#10003;</span>
        </div>
        <div class="voice-card el-vc" data-elvoice="yoZ06aMxZJJ28mfd3POQ" onclick="selectElVoice('yoZ06aMxZJJ28mfd3POQ')">
          <button class="vc-play" onclick="event.stopPropagation();previewElVoice('yoZ06aMxZJJ28mfd3POQ',this)" title="Preview">&#9654;</button>
          <div class="vc-name">Sam</div><div class="vc-desc">Raspy, natural male</div>
          <span class="vc-tag sales">Sales</span><span class="vc-check">&#10003;</span>
        </div>
        <div class="voice-card el-vc" data-elvoice="XB0fDUnXU5powFXDhCwa" onclick="selectElVoice('XB0fDUnXU5powFXDhCwa')">
          <button class="vc-play" onclick="event.stopPropagation();previewElVoice('XB0fDUnXU5powFXDhCwa',this)" title="Preview">&#9654;</button>
          <div class="vc-name">Charlotte</div><div class="vc-desc">Warm, natural female</div>
          <span class="vc-tag sales">Sales</span><span class="vc-check">&#10003;</span>
        </div>
      </div>
      <div style="margin-top:14px;padding-top:14px;border-top:1px solid var(--border)">
        <label>Custom Voice ID (optional)</label>
        <input type="text" id="elCustomVoiceId" placeholder="Paste a custom ElevenLabs Voice ID here">
      </div>
      <div class="el-row" style="margin-top:14px">
        <div>
          <label>ElevenLabs Model</label>
          <select id="elevenlabsModelId">
            <option value="eleven_turbo_v2_5">Turbo v2.5 (fastest)</option>
            <option value="eleven_multilingual_v2">Multilingual v2</option>
            <option value="eleven_monolingual_v1">Monolingual v1</option>
          </select>
        </div>
        <div></div>
      </div>
      <div class="el-row">
        <div>
          <label>Stability (0.0 - 1.0)</label>
          <div class="range-wrap">
            <input type="range" id="elevenlabsStability" min="0" max="1" step="0.05" value="0.5">
            <span class="range-val" id="elevenlabsStabilityVal">0.50</span>
          </div>
        </div>
        <div>
          <label>Similarity Boost (0.0 - 1.0)</label>
          <div class="range-wrap">
            <input type="range" id="elevenlabsSimilarityBoost" min="0" max="1" step="0.05" value="0.75">
            <span class="range-val" id="elevenlabsSimilarityBoostVal">0.75</span>
          </div>
        </div>
      </div>
    </div>
  </div>

  <!-- Model -->
  <div class="card">
    <h2><span class="icon">&#129302;</span> Model</h2>
    <div class="grid">
      <div>
        <label>Realtime Model</label>
        <select id="realtimeModel" onchange="updateVoiceAvailability()">
          <option value="gpt-4o-realtime-preview">gpt-4o-realtime-preview</option>
          <option value="gpt-4o-mini-realtime-preview">gpt-4o-mini-realtime-preview</option>
        </select>
      </div>
      <div>
        <label>Temperature</label>
        <div class="range-wrap">
          <input type="range" id="temperature" min="0" max="1" step="0.05" value="0.7">
          <span class="range-val" id="temperatureVal">0.70</span>
        </div>
      </div>
    </div>
  </div>

  <!-- VAD -->
  <div class="card">
    <h2><span class="icon">&#127897;</span> VAD &amp; Barge-in</h2>
    <div class="grid">
      <div>
        <label>VAD Threshold</label>
        <div class="range-wrap">
          <input type="range" id="vadThreshold" min="0.3" max="1.0" step="0.05" value="0.75">
          <span class="range-val" id="vadThresholdVal">0.75</span>
        </div>
      </div>
      <div>
        <label>Silence Duration (ms)</label>
        <input type="number" id="silenceDurationMs" value="700" min="200" max="2000" step="50">
      </div>
      <div>
        <label>Prefix Padding (ms)</label>
        <input type="number" id="prefixPaddingMs" value="300" min="100" max="1000" step="50">
      </div>
      <div>
        <label>Barge-in Debounce (ms)</label>
        <input type="number" id="bargeInDebounceMs" value="250" min="50" max="1000" step="25">
      </div>
      <div>
        <label>Echo Suppression (ms)</label>
        <input type="number" id="echoSuppressionMs" value="100" min="0" max="500" step="25">
      </div>
      <div>
        <label>Max Response Tokens</label>
        <input type="number" id="maxResponseTokens" value="120" min="30" max="500" step="10">
      </div>
    </div>
  </div>

  <!-- Agent Persona -->
  <div class="card">
    <h2><span class="icon">&#129489;</span> Agent Persona</h2>
    <div class="grid">
      <div>
        <label>Agent Name</label>
        <input type="text" id="agentName" value="Alex">
      </div>
      <div>
        <label>Company Name</label>
        <input type="text" id="companyName" value="QuotingFast">
      </div>
    </div>
  </div>

  <!-- System Prompt -->
  <div class="card">
    <h2><span class="icon">&#128221;</span> System Prompt</h2>
    <p style="font-size:13px;color:var(--text2);margin-bottom:12px">
      Leave empty for default. Use <code style="background:var(--surface2);padding:2px 6px;border-radius:3px">{{first_name}}</code>,
      <code style="background:var(--surface2);padding:2px 6px;border-radius:3px">{{state}}</code>,
      <code style="background:var(--surface2);padding:2px 6px;border-radius:3px">{{current_insurer}}</code>.
    </p>
    <textarea id="systemPromptOverride" placeholder="Leave empty for default prompt..."></textarea>
    <div class="section-actions">
      <button class="btn btn-secondary" onclick="loadDefaultPrompt()">Load Default</button>
      <button class="btn btn-secondary" onclick="clearPrompt()">Clear</button>
    </div>
  </div>

  <!-- Inbound Calls -->
  <div class="card">
    <h2><span class="icon">&#128222;</span> Inbound Calls</h2>
    <div style="margin-bottom:14px">
      <label>Inbound Enabled</label>
      <div style="display:flex;align-items:center;gap:10px">
        <input type="checkbox" id="inboundEnabled" checked style="width:auto">
        <span style="font-size:13px;color:var(--text2)">Accept incoming calls to your Twilio number</span>
      </div>
    </div>
    <div style="margin-bottom:14px">
      <label>Twilio Webhook URL</label>
      <div style="display:flex;align-items:center;gap:8px">
        <input type="text" id="inboundWebhookUrl" readonly style="font-family:monospace;font-size:12px;color:var(--accent);background:var(--bg)">
        <button class="btn btn-secondary btn-sm" onclick="copyWebhookUrl()">Copy</button>
      </div>
      <div style="font-size:11px;color:var(--text2);margin-top:6px">Set this as the Voice webhook URL in your Twilio Console under Phone Numbers.</div>
    </div>
    <div>
      <label>Inbound System Prompt</label>
      <p style="font-size:12px;color:var(--text2);margin-bottom:8px">
        Override the inbound prompt. Use <code style="background:var(--surface2);padding:2px 6px;border-radius:3px">{{caller_number}}</code>,
        <code style="background:var(--surface2);padding:2px 6px;border-radius:3px">{{agent_name}}</code>,
        <code style="background:var(--surface2);padding:2px 6px;border-radius:3px">{{company_name}}</code>. Leave empty for default.
      </p>
      <textarea id="inboundPromptOverride" placeholder="Leave empty for default inbound prompt..." style="min-height:120px"></textarea>
    </div>
  </div>

  <!-- Transfer Numbers -->
  <div class="card">
    <h2><span class="icon">&#128260;</span> Transfer Numbers</h2>
    <div class="grid">
      <div>
        <label>Allstate Transfer Number</label>
        <input type="text" id="allstateNumber" placeholder="+1...">
      </div>
      <div>
        <label>Non-Allstate Transfer Number</label>
        <input type="text" id="nonAllstateNumber" placeholder="+1...">
      </div>
    </div>
  </div>

  <div style="display:flex;justify-content:flex-end;gap:12px">
    <button class="btn btn-secondary" onclick="loadSettings()">Revert</button>
    <button class="btn btn-primary" id="saveBtn" onclick="saveSettings()">Save All Settings</button>
  </div>
</div>

</main>

<div class="toast" id="toast"></div>

<script>
// ── Tabs ──
function switchTab(name) {
  document.querySelectorAll('.tab-content').forEach(el => el.classList.remove('active'));
  document.querySelectorAll('.tab-bar button').forEach(el => el.classList.remove('active'));
  var tab = document.getElementById('tab-' + name);
  if (tab) tab.classList.add('active');
  document.querySelectorAll('.tab-bar button').forEach(function(btn) {
    if (btn.getAttribute('onclick') && btn.getAttribute('onclick').indexOf("'" + name + "'") > -1) btn.classList.add('active');
  });
  if (name === 'analytics') loadAnalytics();
  if (name === 'monitoring') loadMonitoring();
  if (name === 'compliance') { loadDnc(); loadAuditLog(); }
  if (name === 'leads') { loadLeads(); loadCallbacks(); }
}

// ── Settings ──
var SETTINGS_FIELDS = [
  'voiceProvider','voice','realtimeModel','temperature','vadThreshold','silenceDurationMs',
  'prefixPaddingMs','bargeInDebounceMs','echoSuppressionMs','maxResponseTokens',
  'agentName','companyName','systemPromptOverride','inboundPromptOverride','allstateNumber','nonAllstateNumber',
  'elevenlabsVoiceId','elevenlabsModelId','elevenlabsStability','elevenlabsSimilarityBoost',
  'deepseekModel'
];
var NUMBER_FIELDS = [
  'temperature','vadThreshold','silenceDurationMs','prefixPaddingMs',
  'bargeInDebounceMs','echoSuppressionMs','maxResponseTokens',
  'elevenlabsStability','elevenlabsSimilarityBoost'
];
var MODEL_VOICES = {
  'gpt-4o-realtime-preview': ['alloy','ash','ballad','coral','echo','sage','shimmer','verse'],
  'gpt-4o-mini-realtime-preview': ['alloy','ash','ballad','coral','echo','sage','shimmer','verse'],
};
var ALL_VOICES = ['alloy','ash','ballad','coral','echo','sage','shimmer','verse'];

function getCompatibleVoices() {
  var model = document.getElementById('realtimeModel').value;
  return MODEL_VOICES[model] || ALL_VOICES;
}
function setProvider(provider) {
  document.getElementById('voiceProvider').value = provider;
  document.getElementById('provOpenai').classList.toggle('active', provider === 'openai');
  document.getElementById('provElevenlabs').classList.toggle('active', provider === 'elevenlabs');
  document.getElementById('provDeepseek').classList.toggle('active', provider === 'deepseek');
  document.getElementById('openaiVoiceSection').style.display = provider === 'openai' ? '' : 'none';
  document.getElementById('elevenlabsVoiceSection').style.display = provider === 'elevenlabs' ? '' : 'none';
  document.getElementById('deepseekVoiceSection').style.display = provider === 'deepseek' ? '' : 'none';
}
function updateVoiceAvailability() {
  var allowed = getCompatibleVoices();
  var cur = document.getElementById('voice').value;
  var needsSwitch = !allowed.includes(cur);
  document.querySelectorAll('#voiceGrid .voice-card').forEach(function(c) {
    var v = c.dataset.voice;
    if (allowed.includes(v)) c.classList.remove('disabled');
    else { c.classList.add('disabled'); c.classList.remove('selected'); }
  });
  if (needsSwitch) { selectVoice(allowed[0]); toast('Voice switched to ' + allowed[0], 'error'); }
}
function toast(msg, type) {
  var el = document.getElementById('toast');
  el.textContent = msg;
  el.className = 'toast ' + type + ' show';
  setTimeout(function() { el.classList.remove('show'); }, 3000);
}

async function loadSettings() {
  try {
    var res = await fetch('/api/settings');
    if (!res.ok) { toast('Failed to load', 'error'); return; }
    var s = await res.json();
    for (var i = 0; i < SETTINGS_FIELDS.length; i++) {
      var key = SETTINGS_FIELDS[i];
      var el = document.getElementById(key);
      if (!el) continue;
      if (el.type === 'range') {
        el.value = s[key];
        var valEl = document.getElementById(key + 'Val');
        if (valEl) valEl.textContent = parseFloat(s[key]).toFixed(2);
      } else { el.value = s[key] != null ? s[key] : ''; }
    }
    if (s.voiceProvider) setProvider(s.voiceProvider);
    updateVoiceAvailability();
    if (s.voice) selectVoice(s.voice);
    syncElVoiceSelection();
    // Sync DeepSeek voice section from shared ElevenLabs fields
    if (s.elevenlabsVoiceId) {
      document.getElementById('dsElevenlabsVoiceId').value = s.elevenlabsVoiceId;
      syncDsVoiceSelection();
    }
    if (s.elevenlabsModelId) document.getElementById('dsElevenlabsModelId').value = s.elevenlabsModelId;
    if (s.elevenlabsStability != null) { document.getElementById('dsStability').value = s.elevenlabsStability; var dsv = document.getElementById('dsStabilityVal'); if (dsv) dsv.textContent = parseFloat(s.elevenlabsStability).toFixed(2); }
    if (s.elevenlabsSimilarityBoost != null) { document.getElementById('dsSimilarityBoost').value = s.elevenlabsSimilarityBoost; var dss = document.getElementById('dsSimilarityBoostVal'); if (dss) dss.textContent = parseFloat(s.elevenlabsSimilarityBoost).toFixed(2); }
    if (s.deepseekModel) document.getElementById('deepseekModel').value = s.deepseekModel;
    if (s.defaultToNumber) document.getElementById('callTo').value = s.defaultToNumber;
    if (s.defaultFromNumber) document.getElementById('callFrom').value = s.defaultFromNumber;
    document.getElementById('inboundEnabled').checked = s.inboundEnabled !== false;
    document.getElementById('inboundWebhookUrl').value = location.origin + '/twilio/incoming';
    toast('Settings loaded', 'success');
  } catch (e) { toast('Failed to load settings', 'error'); }
}

async function saveSettings() {
  var provider = document.getElementById('voiceProvider').value;
  if (provider === 'openai') {
    var allowed = getCompatibleVoices();
    if (!allowed.includes(document.getElementById('voice').value)) { toast('Voice incompatible', 'error'); return; }
  }
  if (provider === 'elevenlabs') {
    var cid = document.getElementById('elCustomVoiceId').value.trim();
    var hid = document.getElementById('elevenlabsVoiceId').value.trim();
    if (cid) document.getElementById('elevenlabsVoiceId').value = cid;
    if (!cid && !hid) { toast('Select an ElevenLabs voice', 'error'); return; }
  }
  if (provider === 'deepseek') {
    // Sync DeepSeek voice settings to the shared ElevenLabs fields
    var dsCid = document.getElementById('dsCustomVoiceId').value.trim();
    var dsHid = document.getElementById('dsElevenlabsVoiceId').value.trim();
    var dsVoice = dsCid || dsHid;
    if (!dsVoice) { toast('Select a voice for DeepSeek', 'error'); return; }
    document.getElementById('elevenlabsVoiceId').value = dsVoice;
    document.getElementById('elevenlabsModelId').value = document.getElementById('dsElevenlabsModelId').value;
    document.getElementById('elevenlabsStability').value = document.getElementById('dsStability').value;
    document.getElementById('elevenlabsSimilarityBoost').value = document.getElementById('dsSimilarityBoost').value;
  }
  var btn = document.getElementById('saveBtn');
  btn.disabled = true; btn.textContent = 'Saving...';
  try {
    var body = {};
    for (var i = 0; i < SETTINGS_FIELDS.length; i++) {
      var key = SETTINGS_FIELDS[i];
      var el = document.getElementById(key);
      if (!el) continue;
      var val = el.value;
      if (NUMBER_FIELDS.includes(key)) val = parseFloat(val);
      body[key] = val;
    }
    body.inboundEnabled = document.getElementById('inboundEnabled').checked;
    var ct = document.getElementById('callTo').value.trim();
    var cf = document.getElementById('callFrom').value.trim();
    if (ct) body.defaultToNumber = ct;
    if (cf) body.defaultFromNumber = cf;
    var res = await fetch('/api/settings', { method: 'PUT', headers: {'Content-Type':'application/json'}, body: JSON.stringify(body) });
    if (!res.ok) { toast('Save failed', 'error'); return; }
    toast('Settings saved', 'success');
  } catch (e) { toast('Save failed', 'error'); }
  finally { btn.disabled = false; btn.textContent = 'Save All Settings'; }
}

// ── Calling ──
async function makeCall() {
  var to = document.getElementById('callTo').value.trim();
  var from = document.getElementById('callFrom').value.trim();
  var name = document.getElementById('callName').value.trim() || 'there';
  var state = document.getElementById('callState').value.trim() || 'FL';
  if (!to) { toast('Enter a phone number', 'error'); return; }
  var btn = document.getElementById('callBtn');
  btn.disabled = true; btn.textContent = 'Calling...';
  try {
    var res = await fetch('/call/start', {
      method: 'POST', headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ to: to, from: from || undefined, lead: { first_name: name, state: state } }),
    });
    var data = await res.json();
    if (res.ok) {
      addLog('Call started: <span class="sid">' + data.call_sid + '</span> <span class="ok">queued</span>');
      if (data.compliance_warnings && data.compliance_warnings.length) {
        addLog('<span style="color:var(--orange)">Warnings: ' + data.compliance_warnings.join(', ') + '</span>');
      }
      toast('Call sent!', 'success');
    } else {
      addLog('<span class="err">Error: ' + (data.error || res.statusText) + '</span>');
      if (data.reasons) addLog('<span class="err">' + data.reasons.join(', ') + '</span>');
      toast('Call failed', 'error');
    }
  } catch (e) { addLog('<span class="err">' + e.message + '</span>'); toast('Call failed', 'error'); }
  finally { btn.disabled = false; btn.textContent = 'Call'; }
}

function addLog(html) {
  var log = document.getElementById('callLog');
  var time = new Date().toLocaleTimeString();
  var entry = document.createElement('div');
  entry.className = 'entry';
  entry.innerHTML = '<span style="color:var(--text2)">' + time + '</span> ' + html;
  if (log.children.length === 1 && log.children[0].textContent.indexOf('will appear') > -1) log.innerHTML = '';
  log.appendChild(entry);
  log.scrollTop = log.scrollHeight;
}

async function loadDefaultPrompt() {
  try { var res = await fetch('/api/default-prompt'); var d = await res.json(); document.getElementById('systemPromptOverride').value = d.prompt; toast('Loaded', 'success'); }
  catch (e) { toast('Failed', 'error'); }
}
function clearPrompt() { document.getElementById('systemPromptOverride').value = ''; toast('Cleared', 'success'); }

function copyWebhookUrl() {
  var url = document.getElementById('inboundWebhookUrl').value;
  navigator.clipboard.writeText(url).then(function() { toast('Copied!', 'success'); }).catch(function() { toast('Copy failed', 'error'); });
}

async function loadCallHistory() {
  try {
    var res = await fetch('/api/calls');
    var calls = await res.json();
    var el = document.getElementById('callHistory');
    if (!calls.length) { el.innerHTML = '<div class="empty-state">No calls yet</div>'; return; }
    var html = '<table class="data-table"><tr><th>Time</th><th>To</th><th>Lead</th><th>Provider</th><th>Voice</th><th>Agent</th></tr>';
    for (var i = 0; i < calls.length; i++) {
      var c = calls[i]; var t = new Date(c.timestamp).toLocaleString(); var s = c.settings;
      html += '<tr><td style="font-size:11px">' + t + '</td><td>' + c.to + '</td><td>' + c.leadName + '</td>'
        + '<td>' + (s.voiceProvider || 'openai') + '</td><td style="color:var(--accent)">' + s.voice + '</td><td>' + s.agentName + '</td></tr>';
    }
    el.innerHTML = html + '</table>';
  } catch (e) { document.getElementById('callHistory').innerHTML = '<span class="err">Failed</span>'; }
}

// ── Voice ──
var currentAudio = null;
var currentPlayBtn = null;

function selectVoice(voice) {
  document.getElementById('voice').value = voice;
  document.querySelectorAll('#voiceGrid .voice-card').forEach(function(c) { c.classList.toggle('selected', c.dataset.voice === voice); });
}

async function previewVoice(voice, btn) {
  if (currentAudio) { currentAudio.pause(); if (currentPlayBtn) currentPlayBtn.innerHTML = '&#9654;'; }
  btn.classList.add('loading'); btn.innerHTML = '...';
  try {
    var audio = new Audio('/api/voice-preview/' + voice);
    audio.addEventListener('canplaythrough', function() { btn.classList.remove('loading'); btn.innerHTML = '&#9724;'; audio.play(); }, { once: true });
    audio.addEventListener('ended', function() { btn.innerHTML = '&#9654;'; currentAudio = null; currentPlayBtn = null; });
    audio.addEventListener('error', function() { btn.classList.remove('loading'); btn.innerHTML = '&#9654;'; toast('Preview failed', 'error'); });
    currentAudio = audio; currentPlayBtn = btn; audio.load();
  } catch (e) { btn.classList.remove('loading'); btn.innerHTML = '&#9654;'; }
}

var EL_VOICES = {'21m00Tcm4TlvDq8ikWAM':'Rachel','EXAVITQu4vr4xnSDxMaL':'Sarah','AZnzlk1XvdvUeBnXmlld':'Domi','MF3mGyEYCl7XYWbV9V6O':'Elli','XrExE9yKIg1WjnnlVkGX':'Matilda','pMsXgVXv3BLzUgSXRplE':'Serena','LcfcDJNUP1GQjkzn1xUU':'Emily','jsCqWAovK2LkecY7zXl4':'Freya','oWAxZDx7w5VEj9dCyTzz':'Grace','piTKgcLEGmPE4e6mEKli':'Nicole','ErXwobaYiN019PkySvjV':'Antoni','iP95p4xoKVk53GoZ742B':'Chris','nPczCjzI2devNBz1zQrb':'Brian','TxGEqnHWrfWFTfGW9XjX':'Josh','29vD33N1CtxCmqQRPOHJ':'Drew','pqHfZKP75CvOlQylNhV4':'Bill','TX3LPaxmHKxFdv7VOQHJ':'Liam','VR6AewLTigWG4xSOukaG':'Arnold','pNInz6obpgDQGcFmaJgB':'Adam','yoZ06aMxZJJ28mfd3POQ':'Sam','g5CIjZEefAph4nQFvHAz':'Ethan','GBv7mTt0atIp3Br8iCZE':'Thomas','5Q0t7uMcjvnagumLfvZi':'Paul','flq6f7yk4E4fJM5XTYuZ':'Michael','XB0fDUnXU5powFXDhCwa':'Charlotte'};

function selectElVoice(voiceId) {
  document.getElementById('elevenlabsVoiceId').value = voiceId;
  document.getElementById('elCustomVoiceId').value = '';
  document.querySelectorAll('.el-vc').forEach(function(c) { c.classList.toggle('selected', c.dataset.elvoice === voiceId); });
}
function syncElVoiceSelection() {
  var voiceId = document.getElementById('elevenlabsVoiceId').value;
  var customEl = document.getElementById('elCustomVoiceId');
  if (EL_VOICES[voiceId]) {
    document.querySelectorAll('.el-vc').forEach(function(c) { c.classList.toggle('selected', c.dataset.elvoice === voiceId); });
    customEl.value = '';
  } else if (voiceId) {
    document.querySelectorAll('.el-vc').forEach(function(c) { c.classList.remove('selected'); });
    customEl.value = voiceId;
  }
}
document.getElementById('elCustomVoiceId').addEventListener('input', function() {
  var val = this.value.trim();
  if (val) { document.getElementById('elevenlabsVoiceId').value = val; document.querySelectorAll('.el-vc').forEach(function(c) { c.classList.remove('selected'); }); }
});

// ── DeepSeek Voice Selection ──
function selectDsVoice(voiceId) {
  document.getElementById('dsElevenlabsVoiceId').value = voiceId;
  document.getElementById('dsCustomVoiceId').value = '';
  document.querySelectorAll('.ds-vc').forEach(function(c) { c.classList.toggle('selected', c.dataset.dsvoice === voiceId); });
}
function syncDsVoiceSelection() {
  var voiceId = document.getElementById('dsElevenlabsVoiceId').value;
  var customEl = document.getElementById('dsCustomVoiceId');
  if (EL_VOICES[voiceId]) {
    document.querySelectorAll('.ds-vc').forEach(function(c) { c.classList.toggle('selected', c.dataset.dsvoice === voiceId); });
    customEl.value = '';
  } else if (voiceId) {
    document.querySelectorAll('.ds-vc').forEach(function(c) { c.classList.remove('selected'); });
    customEl.value = voiceId;
  }
}
document.getElementById('dsCustomVoiceId').addEventListener('input', function() {
  var val = this.value.trim();
  if (val) { document.getElementById('dsElevenlabsVoiceId').value = val; document.querySelectorAll('.ds-vc').forEach(function(c) { c.classList.remove('selected'); }); }
});

async function previewElVoice(voiceId, btn) {
  if (currentAudio) { currentAudio.pause(); if (currentPlayBtn) currentPlayBtn.innerHTML = '&#9654;'; }
  btn.classList.add('loading'); btn.innerHTML = '...';
  try {
    var audio = new Audio('/api/elevenlabs-voice-preview/' + voiceId);
    audio.addEventListener('canplaythrough', function() { btn.classList.remove('loading'); btn.innerHTML = '&#9724;'; audio.play(); }, { once: true });
    audio.addEventListener('ended', function() { btn.innerHTML = '&#9654;'; currentAudio = null; currentPlayBtn = null; });
    audio.addEventListener('error', function() { btn.classList.remove('loading'); btn.innerHTML = '&#9654;'; toast('Preview failed', 'error'); });
    currentAudio = audio; currentPlayBtn = btn; audio.load();
  } catch (e) { btn.classList.remove('loading'); btn.innerHTML = '&#9654;'; }
}

// ── Analytics ──
async function loadAnalytics() {
  try {
    var r = await Promise.all([fetch('/api/analytics/summary'), fetch('/api/analytics/history')]);
    var summary = await r[0].json();
    var history = await r[1].json();
    document.getElementById('analyticsSummary').innerHTML =
      '<div class="stat-card"><div class="stat-value">' + summary.totalCalls + '</div><div class="stat-label">Total Calls</div></div>'
      + '<div class="stat-card green"><div class="stat-value">' + summary.transferRate + '%</div><div class="stat-label">Transfer Rate</div></div>'
      + '<div class="stat-card cyan"><div class="stat-value">' + summary.avgLatencyMs + 'ms</div><div class="stat-label">Avg Latency</div></div>'
      + '<div class="stat-card orange"><div class="stat-value">$' + summary.totalCostUsd + '</div><div class="stat-label">Total Cost</div></div>';
    var o = summary.outcomes || {};
    document.getElementById('analyticsOutcomes').innerHTML =
      '<div class="stat-card green"><div class="stat-value">' + (o.transferred||0) + '</div><div class="stat-label">Transferred</div></div>'
      + '<div class="stat-card"><div class="stat-value">' + (o.ended||0) + '</div><div class="stat-label">Ended</div></div>'
      + '<div class="stat-card red"><div class="stat-value">' + (o.dropped||0) + '</div><div class="stat-label">Dropped</div></div>'
      + '<div class="stat-card cyan"><div class="stat-value">' + summary.avgScore + '</div><div class="stat-label">Avg Score</div></div>';
    var tEl = document.getElementById('analyticsTable');
    if (!history.length) { tEl.innerHTML = '<div class="empty-state">No analytics yet</div>'; return; }
    var html = '<table class="data-table"><tr><th>Call SID</th><th>Duration</th><th>Turns</th><th>Latency</th><th>Outcome</th><th>Score</th><th>Cost</th><th>Tags</th></tr>';
    for (var i = 0; i < Math.min(history.length, 50); i++) {
      var a = history[i];
      var dur = a.durationMs ? Math.round(a.durationMs/1000) + 's' : '--';
      var ob = a.outcome === 'transferred' ? 'badge-green' : a.outcome === 'dropped' ? 'badge-red' : 'badge-gray';
      var tags = (a.tags||[]).slice(0,3).map(function(t){return '<span class="badge badge-blue">' + t + '</span>';}).join(' ');
      html += '<tr><td style="color:var(--accent);font-family:monospace;font-size:11px">' + a.callSid.substring(0,16) + '</td>'
        + '<td>' + dur + '</td><td>' + a.turnCount + '</td><td>' + a.avgLatencyMs + 'ms</td>'
        + '<td><span class="badge ' + ob + '">' + a.outcome + '</span></td>'
        + '<td>' + (a.score != null ? a.score : '--') + '</td><td>$' + (a.costEstimate ? a.costEstimate.estimatedCostUsd : '--') + '</td><td>' + (tags||'--') + '</td></tr>';
    }
    tEl.innerHTML = html + '</table>';
  } catch (e) { document.getElementById('analyticsTable').innerHTML = '<div class="empty-state">Failed to load</div>'; }
}

// ── Monitoring ──
async function loadMonitoring() {
  try {
    var r = await Promise.all([fetch('/api/performance/health'), fetch('/api/performance/sessions'), fetch('/api/performance/queue')]);
    var health = await r[0].json();
    var sessions = await r[1].json();
    var queue = await r[2].json();
    var sc = health.status === 'healthy' ? 'green' : health.status === 'busy' ? 'orange' : 'red';
    document.getElementById('systemHealth').innerHTML =
      '<div class="stat-card"><div class="stat-value">' + health.activeSessions + '</div><div class="stat-label">Active</div></div>'
      + '<div class="stat-card"><div class="stat-value">' + health.maxSessions + '</div><div class="stat-label">Max</div></div>'
      + '<div class="stat-card"><div class="stat-value">' + health.queueSize + '</div><div class="stat-label">Queue</div></div>'
      + '<div class="stat-card ' + sc + '"><div class="stat-value">' + health.utilization + '%</div><div class="stat-label">' + health.status + '</div></div>';
    document.getElementById('maxConcurrency').value = sessions.max;
    var sEl = document.getElementById('activeSessions');
    if (!sessions.sessions.length) { sEl.innerHTML = '<div class="empty-state">No active sessions</div>'; }
    else {
      var html = '<table class="data-table"><tr><th>Call SID</th><th>Lead</th><th>Status</th><th>Duration</th></tr>';
      for (var i = 0; i < sessions.sessions.length; i++) {
        var s = sessions.sessions[i];
        var dur = Math.round((Date.now() - s.startTime)/1000);
        var b = s.status === 'active' ? 'badge-green' : 'badge-blue';
        html += '<tr><td style="font-family:monospace;font-size:11px">' + s.callSid.substring(0,16) + '</td><td>' + s.leadName + '</td>'
          + '<td><span class="badge ' + b + '">' + s.status + '</span></td><td>' + dur + 's</td></tr>';
      }
      sEl.innerHTML = html + '</table>';
    }
    var qEl = document.getElementById('callQueue');
    if (!queue.queue.length) { qEl.innerHTML = '<div class="empty-state">Queue is empty</div>'; }
    else {
      var html2 = '<table class="data-table"><tr><th>ID</th><th>To</th><th>Priority</th><th>Attempts</th></tr>';
      for (var j = 0; j < queue.queue.length; j++) {
        var q = queue.queue[j];
        html2 += '<tr><td style="font-family:monospace;font-size:11px">' + q.id + '</td><td>' + q.to + '</td><td>' + q.priority + '</td><td>' + q.attempts + '/' + q.maxAttempts + '</td></tr>';
      }
      qEl.innerHTML = html2 + '</table>';
    }
  } catch (e) { document.getElementById('systemHealth').innerHTML = '<div class="empty-state">Failed to load</div>'; }
}

async function updateConcurrency() {
  try {
    var max = parseInt(document.getElementById('maxConcurrency').value);
    var res = await fetch('/api/performance/concurrency', { method: 'PUT', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ max: max }) });
    if (res.ok) toast('Updated to ' + max, 'success'); else toast('Failed', 'error');
  } catch (e) { toast('Failed', 'error'); }
}

// ── Compliance ──
async function loadDnc() {
  try {
    var res = await fetch('/api/compliance/dnc');
    var data = await res.json();
    var el = document.getElementById('dncList');
    if (!data.list.length) { el.innerHTML = '<div class="empty-state">DNC list empty (' + data.count + ')</div>'; return; }
    var html = '<table class="data-table"><tr><th>Phone</th><th>Action</th></tr>';
    for (var i = 0; i < data.list.length; i++) {
      html += '<tr><td style="font-family:monospace">' + data.list[i] + '</td>'
        + '<td><button class="btn btn-secondary btn-sm" onclick="removeDnc(\\'' + data.list[i] + '\\')">Remove</button></td></tr>';
    }
    el.innerHTML = html + '</table><div style="margin-top:8px;font-size:12px;color:var(--text2)">' + data.count + ' numbers</div>';
  } catch (e) { document.getElementById('dncList').innerHTML = '<div class="empty-state">Failed</div>'; }
}
async function addDnc() {
  var phone = document.getElementById('dncPhone').value.trim();
  if (!phone) { toast('Enter number', 'error'); return; }
  await fetch('/api/compliance/dnc', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ phone: phone }) });
  document.getElementById('dncPhone').value = '';
  toast('Added to DNC', 'success');
  loadDnc();
}
async function removeDnc(phone) {
  await fetch('/api/compliance/dnc/' + encodeURIComponent(phone), { method: 'DELETE' });
  toast('Removed', 'success');
  loadDnc();
}
async function checkTcpa() {
  var state = document.getElementById('tcpaState').value.trim();
  var res = await fetch('/api/compliance/time-check?state=' + encodeURIComponent(state));
  var data = await res.json();
  var el = document.getElementById('tcpaResult');
  if (data.allowed) el.innerHTML = '<span class="badge badge-green">ALLOWED</span> ' + data.localTime + ' (' + data.timezone + ')';
  else el.innerHTML = '<span class="badge badge-red">BLOCKED</span> ' + (data.reason || 'Outside window') + ' (' + data.timezone + ')';
}
async function loadAuditLog() {
  try {
    var res = await fetch('/api/compliance/audit-log?limit=30');
    var data = await res.json();
    var el = document.getElementById('auditLog');
    if (!data.entries.length) { el.innerHTML = '<div class="empty-state">No entries</div>'; return; }
    var entries = data.entries.slice().reverse().slice(0, 30);
    var html = '<table class="data-table"><tr><th>Time</th><th>Action</th><th>Data</th><th>Hash</th></tr>';
    for (var i = 0; i < entries.length; i++) {
      var e = entries[i];
      var t = new Date(e.timestamp).toLocaleString();
      var d = JSON.stringify(e.data).substring(0, 80);
      html += '<tr><td style="font-size:11px">' + t + '</td><td><span class="badge badge-blue">' + e.action + '</span></td>'
        + '<td style="font-size:11px;color:var(--text2);max-width:300px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + d + '</td>'
        + '<td style="font-family:monospace;font-size:11px;color:var(--text2)">' + e.hash + '</td></tr>';
    }
    el.innerHTML = html + '</table><div style="margin-top:8px;font-size:12px;color:var(--text2)">' + data.total + ' total entries</div>';
  } catch (e) { document.getElementById('auditLog').innerHTML = '<div class="empty-state">Failed</div>'; }
}

// ── Leads ──
async function loadLeads() {
  try {
    var disp = document.getElementById('leadFilter').value;
    var url = disp ? '/api/leads?disposition=' + disp : '/api/leads';
    var res = await fetch(url);
    var data = await res.json();
    var leads = disp ? data : data.leads;
    var el = document.getElementById('leadsTable');
    if (!leads || !leads.length) { el.innerHTML = '<div class="empty-state">No leads' + (data.count ? ' (' + data.count + ' total)' : '') + '</div>'; return; }
    var html = '<table class="data-table"><tr><th>Phone</th><th>Name</th><th>State</th><th>Disposition</th><th>Calls</th><th>Last Contact</th><th>Tags</th></tr>';
    for (var i = 0; i < leads.length; i++) {
      var l = leads[i];
      var db = l.disposition === 'transferred' ? 'badge-green' : (l.disposition === 'not_interested' || l.disposition === 'dnc') ? 'badge-red' : l.disposition === 'callback' ? 'badge-orange' : 'badge-gray';
      var tags = (l.tags||[]).slice(0,3).map(function(t){return '<span class="badge badge-blue">' + t + '</span>';}).join(' ');
      html += '<tr><td style="font-family:monospace">' + l.phone + '</td><td>' + l.name + '</td><td>' + (l.state||'--') + '</td>'
        + '<td><span class="badge ' + db + '">' + l.disposition + '</span></td><td>' + l.totalCalls + '</td>'
        + '<td style="font-size:11px">' + (l.lastContactedAt ? new Date(l.lastContactedAt).toLocaleString() : '--') + '</td><td>' + (tags||'--') + '</td></tr>';
    }
    el.innerHTML = html + '</table>' + (!disp && data.count ? '<div style="margin-top:8px;font-size:12px;color:var(--text2)">' + data.count + ' total</div>' : '');
  } catch (e) { document.getElementById('leadsTable').innerHTML = '<div class="empty-state">Failed</div>'; }
}
async function loadCallbacks() {
  try {
    var res = await fetch('/api/leads/callbacks');
    var cbs = await res.json();
    var el = document.getElementById('callbacksList');
    if (!cbs.length) { el.innerHTML = '<div class="empty-state">No callbacks scheduled</div>'; return; }
    var html = '<table class="data-table"><tr><th>Phone</th><th>Name</th><th>Scheduled</th><th>Calls</th></tr>';
    for (var i = 0; i < cbs.length; i++) {
      var l = cbs[i];
      html += '<tr><td style="font-family:monospace">' + l.phone + '</td><td>' + l.name + '</td>'
        + '<td>' + (l.callbackScheduled ? new Date(l.callbackScheduled).toLocaleString() : '--') + '</td><td>' + l.totalCalls + '</td></tr>';
    }
    el.innerHTML = html + '</table>';
  } catch (e) { document.getElementById('callbacksList').innerHTML = '<div class="empty-state">Failed</div>'; }
}

// ── Sliders ──
document.querySelectorAll('input[type=range]').forEach(function(el) {
  el.addEventListener('input', function() {
    var valEl = document.getElementById(el.id + 'Val');
    if (valEl) valEl.textContent = parseFloat(el.value).toFixed(2);
  });
});

// ── Init ──
loadSettings();
loadCallHistory();
</script>
</body>
</html>`;
}
