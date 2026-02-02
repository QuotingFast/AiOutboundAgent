export function getDashboardHtml(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>AI Outbound Agent</title>
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
  main {
    max-width: 960px;
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
  .btn-primary {
    background: var(--accent);
    color: white;
  }
  .btn-primary:hover { background: var(--accent-hover); }
  .btn-secondary {
    background: var(--surface2);
    color: var(--text);
    border: 1px solid var(--border);
  }
  .btn-secondary:hover { background: var(--border); }
  .btn-green { background: var(--green); color: white; }
  .btn-green:hover { opacity: 0.9; }
  .btn-red { background: var(--red); color: white; }
  .btn-red:hover { opacity: 0.9; }
  .btn:disabled { opacity: 0.5; cursor: not-allowed; }
  .call-row {
    display: flex;
    gap: 12px;
    align-items: flex-end;
  }
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
  .voice-card.selected {
    border-color: var(--accent);
    background: rgba(99, 102, 241, 0.1);
  }
  .voice-card .vc-name {
    font-size: 14px;
    font-weight: 600;
    margin-bottom: 2px;
  }
  .voice-card .vc-desc {
    font-size: 11px;
    color: var(--text2);
    line-height: 1.3;
  }
  .voice-card .vc-tag {
    display: inline-block;
    font-size: 10px;
    padding: 1px 6px;
    border-radius: 3px;
    margin-top: 6px;
  }
  .voice-card .vc-tag.sales { background: rgba(34,197,94,0.15); color: var(--green); }
  .voice-card .vc-tag.neutral { background: rgba(148,153,173,0.15); color: var(--text2); }
  .vc-play {
    position: absolute;
    top: 10px;
    right: 10px;
    width: 28px;
    height: 28px;
    border-radius: 50%;
    border: 1px solid var(--border);
    background: var(--surface);
    color: var(--text);
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    font-size: 12px;
    transition: all 0.15s;
  }
  .vc-play:hover { border-color: var(--accent); color: var(--accent); }
  .vc-play.loading { opacity: 0.5; cursor: wait; }
  .vc-check {
    display: none;
    position: absolute;
    bottom: 8px;
    right: 10px;
    font-size: 14px;
    color: var(--accent);
  }
  .voice-card.selected .vc-check { display: block; }
  .voice-card.disabled {
    opacity: 0.35;
    pointer-events: none;
    filter: grayscale(1);
  }
  .voice-card.disabled .vc-play { display: none; }
  .provider-toggle {
    display: flex;
    gap: 0;
    background: var(--surface2);
    border-radius: 8px;
    overflow: hidden;
    border: 1px solid var(--border);
  }
  .provider-toggle button {
    flex: 1;
    padding: 12px 20px;
    border: none;
    background: transparent;
    color: var(--text2);
    font-size: 14px;
    font-weight: 500;
    cursor: pointer;
    font-family: inherit;
    transition: all 0.15s;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
  }
  .provider-toggle button:hover { background: var(--border); }
  .provider-toggle button.active {
    background: var(--accent);
    color: white;
  }
  .provider-toggle button .prov-label { font-size: 14px; }
  .provider-toggle button .prov-sub { font-size: 11px; opacity: 0.7; }
  .el-settings { margin-top: 16px; }
  .el-settings .el-row { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 14px; }
  @media (max-width: 640px) {
    .grid, .grid-3, .el-settings .el-row { grid-template-columns: 1fr; }
    .call-row { flex-direction: column; }
    .voice-grid { grid-template-columns: 1fr 1fr; }
    main { padding: 16px 10px; }
    .provider-toggle { flex-direction: column; }
  }
</style>
</head>
<body>
<header>
  <h1><span>AI</span> Outbound Agent</h1>
  <div style="display:flex;align-items:center;gap:8px;font-size:13px;color:var(--text2)">
    <span class="status-dot"></span> Connected
  </div>
</header>

<main>
  <!-- Quick Call -->
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

  <!-- Call History -->
  <div class="card">
    <h2><span class="icon">&#128203;</span> Recent Calls <button class="btn btn-secondary" style="margin-left:auto;padding:6px 12px;font-size:12px" onclick="loadCallHistory()">Refresh</button></h2>
    <div id="callHistory" style="font-size:13px;color:var(--text2)">Loading...</div>
  </div>

  <!-- Voice Provider -->
  <div class="card">
    <h2><span class="icon">&#127908;</span> Voice Provider</h2>
    <input type="hidden" id="voiceProvider" value="openai">
    <div class="provider-toggle">
      <button id="provOpenai" class="active" onclick="setProvider('openai')">
        <span class="prov-label">OpenAI Realtime</span>
        <span class="prov-sub">(speech-to-speech)</span>
      </button>
      <button id="provElevenlabs" onclick="setProvider('elevenlabs')">
        <span class="prov-label">ElevenLabs</span>
        <span class="prov-sub">(TTS via ElevenLabs)</span>
      </button>
    </div>

    <!-- OpenAI voice cards (shown when OpenAI selected) -->
    <div id="openaiVoiceSection" style="margin-top:16px">
    <label>OpenAI Voice</label>
    <input type="hidden" id="voice" value="coral">
    <div class="voice-grid" id="voiceGrid">
      <div class="voice-card" data-voice="coral" onclick="selectVoice('coral')">
        <button class="vc-play" onclick="event.stopPropagation();previewVoice('coral',this)" title="Preview">&#9654;</button>
        <div class="vc-name">Coral</div>
        <div class="vc-desc">Friendly, upbeat</div>
        <span class="vc-tag sales">Sales</span>
        <span class="vc-check">&#10003;</span>
      </div>
      <div class="voice-card" data-voice="sage" onclick="selectVoice('sage')">
        <button class="vc-play" onclick="event.stopPropagation();previewVoice('sage',this)" title="Preview">&#9654;</button>
        <div class="vc-name">Sage</div>
        <div class="vc-desc">Calm, thoughtful</div>
        <span class="vc-tag sales">Sales</span>
        <span class="vc-check">&#10003;</span>
      </div>
      <div class="voice-card" data-voice="ballad" onclick="selectVoice('ballad')">
        <button class="vc-play" onclick="event.stopPropagation();previewVoice('ballad',this)" title="Preview">&#9654;</button>
        <div class="vc-name">Ballad</div>
        <div class="vc-desc">Warm, expressive</div>
        <span class="vc-tag sales">Sales</span>
        <span class="vc-check">&#10003;</span>
      </div>
      <div class="voice-card" data-voice="ash" onclick="selectVoice('ash')">
        <button class="vc-play" onclick="event.stopPropagation();previewVoice('ash',this)" title="Preview">&#9654;</button>
        <div class="vc-name">Ash</div>
        <div class="vc-desc">Warm, conversational</div>
        <span class="vc-tag neutral">Versatile</span>
        <span class="vc-check">&#10003;</span>
      </div>
      <div class="voice-card" data-voice="verse" onclick="selectVoice('verse')">
        <button class="vc-play" onclick="event.stopPropagation();previewVoice('verse',this)" title="Preview">&#9654;</button>
        <div class="vc-name">Verse</div>
        <div class="vc-desc">Articulate, clear</div>
        <span class="vc-tag neutral">Versatile</span>
        <span class="vc-check">&#10003;</span>
      </div>
      <div class="voice-card" data-voice="alloy" onclick="selectVoice('alloy')">
        <button class="vc-play" onclick="event.stopPropagation();previewVoice('alloy',this)" title="Preview">&#9654;</button>
        <div class="vc-name">Alloy</div>
        <div class="vc-desc">Neutral, balanced</div>
        <span class="vc-tag neutral">Versatile</span>
        <span class="vc-check">&#10003;</span>
      </div>
      <div class="voice-card" data-voice="echo" onclick="selectVoice('echo')">
        <button class="vc-play" onclick="event.stopPropagation();previewVoice('echo',this)" title="Preview">&#9654;</button>
        <div class="vc-name">Echo</div>
        <div class="vc-desc">Deep, steady</div>
        <span class="vc-tag neutral">Versatile</span>
        <span class="vc-check">&#10003;</span>
      </div>
      <div class="voice-card" data-voice="shimmer" onclick="selectVoice('shimmer')">
        <button class="vc-play" onclick="event.stopPropagation();previewVoice('shimmer',this)" title="Preview">&#9654;</button>
        <div class="vc-name">Shimmer</div>
        <div class="vc-desc">Bright, energetic</div>
        <span class="vc-tag neutral">Versatile</span>
        <span class="vc-check">&#10003;</span>
      </div>
    </div>
    </div>

    <!-- ElevenLabs settings (shown when ElevenLabs selected) -->
    <div id="elevenlabsVoiceSection" class="el-settings" style="display:none">
      <label>ElevenLabs Voice</label>
      <input type="hidden" id="elevenlabsVoiceId" value="">
      <div class="voice-grid" id="elVoiceGrid">
        <div class="voice-card el-vc" data-elvoice="21m00Tcm4TlvDq8ikWAM" onclick="selectElVoice('21m00Tcm4TlvDq8ikWAM')">
          <button class="vc-play" onclick="event.stopPropagation();previewElVoice('21m00Tcm4TlvDq8ikWAM',this)" title="Preview">&#9654;</button>
          <div class="vc-name">Rachel</div>
          <div class="vc-desc">Calm, warm female</div>
          <span class="vc-tag sales">Sales</span>
          <span class="vc-check">&#10003;</span>
        </div>
        <div class="voice-card el-vc" data-elvoice="EXAVITQu4vr4xnSDxMaL" onclick="selectElVoice('EXAVITQu4vr4xnSDxMaL')">
          <button class="vc-play" onclick="event.stopPropagation();previewElVoice('EXAVITQu4vr4xnSDxMaL',this)" title="Preview">&#9654;</button>
          <div class="vc-name">Bella</div>
          <div class="vc-desc">Soft, friendly female</div>
          <span class="vc-tag sales">Sales</span>
          <span class="vc-check">&#10003;</span>
        </div>
        <div class="voice-card el-vc" data-elvoice="AZnzlk1XvdvUeBnXmlld" onclick="selectElVoice('AZnzlk1XvdvUeBnXmlld')">
          <button class="vc-play" onclick="event.stopPropagation();previewElVoice('AZnzlk1XvdvUeBnXmlld',this)" title="Preview">&#9654;</button>
          <div class="vc-name">Domi</div>
          <div class="vc-desc">Confident, assertive female</div>
          <span class="vc-tag sales">Sales</span>
          <span class="vc-check">&#10003;</span>
        </div>
        <div class="voice-card el-vc" data-elvoice="MF3mGyEYCl7XYWbV9V6O" onclick="selectElVoice('MF3mGyEYCl7XYWbV9V6O')">
          <button class="vc-play" onclick="event.stopPropagation();previewElVoice('MF3mGyEYCl7XYWbV9V6O',this)" title="Preview">&#9654;</button>
          <div class="vc-name">Elli</div>
          <div class="vc-desc">Expressive, emotional female</div>
          <span class="vc-tag neutral">Versatile</span>
          <span class="vc-check">&#10003;</span>
        </div>
        <div class="voice-card el-vc" data-elvoice="ErXwobaYiN019PkySvjV" onclick="selectElVoice('ErXwobaYiN019PkySvjV')">
          <button class="vc-play" onclick="event.stopPropagation();previewElVoice('ErXwobaYiN019PkySvjV',this)" title="Preview">&#9654;</button>
          <div class="vc-name">Antoni</div>
          <div class="vc-desc">Warm, conversational male</div>
          <span class="vc-tag sales">Sales</span>
          <span class="vc-check">&#10003;</span>
        </div>
        <div class="voice-card el-vc" data-elvoice="TxGEqnHWrfWFTfGW9XjX" onclick="selectElVoice('TxGEqnHWrfWFTfGW9XjX')">
          <button class="vc-play" onclick="event.stopPropagation();previewElVoice('TxGEqnHWrfWFTfGW9XjX',this)" title="Preview">&#9654;</button>
          <div class="vc-name">Josh</div>
          <div class="vc-desc">Deep, friendly male</div>
          <span class="vc-tag neutral">Versatile</span>
          <span class="vc-check">&#10003;</span>
        </div>
        <div class="voice-card el-vc" data-elvoice="VR6AewLTigWG4xSOukaG" onclick="selectElVoice('VR6AewLTigWG4xSOukaG')">
          <button class="vc-play" onclick="event.stopPropagation();previewElVoice('VR6AewLTigWG4xSOukaG',this)" title="Preview">&#9654;</button>
          <div class="vc-name">Arnold</div>
          <div class="vc-desc">Crisp, confident male</div>
          <span class="vc-tag neutral">Versatile</span>
          <span class="vc-check">&#10003;</span>
        </div>
        <div class="voice-card el-vc" data-elvoice="pNInz6obpgDQGcFmaJgB" onclick="selectElVoice('pNInz6obpgDQGcFmaJgB')">
          <button class="vc-play" onclick="event.stopPropagation();previewElVoice('pNInz6obpgDQGcFmaJgB',this)" title="Preview">&#9654;</button>
          <div class="vc-name">Adam</div>
          <div class="vc-desc">Deep, authoritative male</div>
          <span class="vc-tag neutral">Versatile</span>
          <span class="vc-check">&#10003;</span>
        </div>
      </div>
      <div style="margin-top:14px;padding-top:14px;border-top:1px solid var(--border)">
        <label>Custom Voice ID (optional — overrides card selection)</label>
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
      <p style="font-size:12px;color:var(--text2);margin-top:4px">
        These are ElevenLabs premade voices. You can also paste a custom Voice ID from your ElevenLabs library above.
        OpenAI Realtime still handles speech recognition and conversation logic.
      </p>
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
        <label>Temperature (beta only)</label>
        <div class="range-wrap">
          <input type="range" id="temperature" min="0" max="1" step="0.05" value="0.7">
          <span class="range-val" id="temperatureVal">0.70</span>
        </div>
      </div>
    </div>
  </div>

  <!-- VAD & Barge-in -->
  <div class="card">
    <h2><span class="icon">&#127897;</span> VAD &amp; Barge-in</h2>
    <div class="grid">
      <div>
        <label>VAD Threshold (0.0 - 1.0)</label>
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
        <input type="text" id="agentName" value="Sarah">
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
      Leave empty to use the default prompt template (recommended). Or paste a custom prompt below.
      Use <code style="background:var(--surface2);padding:2px 6px;border-radius:3px">{{first_name}}</code>,
      <code style="background:var(--surface2);padding:2px 6px;border-radius:3px">{{state}}</code>,
      <code style="background:var(--surface2);padding:2px 6px;border-radius:3px">{{current_insurer}}</code> as placeholders.
    </p>
    <textarea id="systemPromptOverride" placeholder="Leave empty for default prompt..."></textarea>
    <div class="section-actions">
      <button class="btn btn-secondary" onclick="loadDefaultPrompt()">Load Default</button>
      <button class="btn btn-secondary" onclick="clearPrompt()">Clear (Use Default)</button>
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

  <!-- Save -->
  <div style="display:flex;justify-content:flex-end;gap:12px">
    <button class="btn btn-secondary" onclick="loadSettings()">Revert</button>
    <button class="btn btn-primary" id="saveBtn" onclick="saveSettings()">Save All Settings</button>
  </div>
</main>

<div class="toast" id="toast"></div>

<script>
const SETTINGS_FIELDS = [
  'voiceProvider','voice','realtimeModel','temperature','vadThreshold','silenceDurationMs',
  'prefixPaddingMs','bargeInDebounceMs','echoSuppressionMs','maxResponseTokens',
  'agentName','companyName','systemPromptOverride','allstateNumber','nonAllstateNumber',
  'elevenlabsVoiceId','elevenlabsModelId','elevenlabsStability','elevenlabsSimilarityBoost'
];
const NUMBER_FIELDS = [
  'temperature','vadThreshold','silenceDurationMs','prefixPaddingMs',
  'bargeInDebounceMs','echoSuppressionMs','maxResponseTokens',
  'elevenlabsStability','elevenlabsSimilarityBoost'
];

// Voice-model compatibility map
const MODEL_VOICES = {
  'gpt-4o-realtime-preview': ['alloy','ash','ballad','coral','echo','sage','shimmer','verse'],
  'gpt-4o-mini-realtime-preview': ['alloy','ash','ballad','coral','echo','sage','shimmer','verse'],
};
const ALL_VOICES = ['alloy','ash','ballad','coral','echo','sage','shimmer','verse'];

function getCompatibleVoices() {
  const model = document.getElementById('realtimeModel').value;
  return MODEL_VOICES[model] || ALL_VOICES;
}

function setProvider(provider) {
  document.getElementById('voiceProvider').value = provider;
  document.getElementById('provOpenai').classList.toggle('active', provider === 'openai');
  document.getElementById('provElevenlabs').classList.toggle('active', provider === 'elevenlabs');
  document.getElementById('openaiVoiceSection').style.display = provider === 'openai' ? '' : 'none';
  document.getElementById('elevenlabsVoiceSection').style.display = provider === 'elevenlabs' ? '' : 'none';
}

function updateVoiceAvailability() {
  const allowed = getCompatibleVoices();
  const currentVoice = document.getElementById('voice').value;
  let needsSwitch = !allowed.includes(currentVoice);

  document.querySelectorAll('#voiceGrid .voice-card').forEach(c => {
    const v = c.dataset.voice;
    if (allowed.includes(v)) {
      c.classList.remove('disabled');
    } else {
      c.classList.add('disabled');
      if (c.classList.contains('selected')) c.classList.remove('selected');
    }
  });

  // If current voice is now incompatible, auto-select first available
  if (needsSwitch) {
    selectVoice(allowed[0]);
    toast('Voice switched to ' + allowed[0] + ' (incompatible with selected model)', 'error');
  }
}

function toast(msg, type) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className = 'toast ' + type + ' show';
  setTimeout(() => el.classList.remove('show'), 3000);
}

async function loadSettings() {
  try {
    const res = await fetch('/api/settings');
    if (!res.ok) { toast('Failed to load settings: ' + res.status, 'error'); return; }
    const s = await res.json();
    console.log('[Dashboard] Loaded settings:', s);

    for (const key of SETTINGS_FIELDS) {
      const el = document.getElementById(key);
      if (!el) { console.warn('[Dashboard] No element for:', key); continue; }
      if (el.type === 'range') {
        el.value = s[key];
        const valEl = document.getElementById(key + 'Val');
        if (valEl) valEl.textContent = parseFloat(s[key]).toFixed(2);
      } else {
        el.value = s[key] ?? '';
      }
    }

    // Set voice provider toggle
    if (s.voiceProvider) setProvider(s.voiceProvider);

    // Highlight the selected voice card and update availability
    updateVoiceAvailability();
    if (s.voice) selectVoice(s.voice);

    // Sync ElevenLabs voice card selection
    syncElVoiceSelection();

    // Map call form fields from settings
    if (s.defaultToNumber) document.getElementById('callTo').value = s.defaultToNumber;
    if (s.defaultFromNumber) document.getElementById('callFrom').value = s.defaultFromNumber;

    toast('Settings loaded', 'success');
  } catch (e) {
    console.error('[Dashboard] Load error:', e);
    toast('Failed to load settings', 'error');
  }
}

async function saveSettings() {
  const provider = document.getElementById('voiceProvider').value;

  // Validate voice-model compatibility before saving (only for OpenAI provider)
  if (provider === 'openai') {
    const allowed = getCompatibleVoices();
    const selectedVoice = document.getElementById('voice').value;
    if (!allowed.includes(selectedVoice)) {
      toast('Voice "' + selectedVoice + '" is not compatible with the selected model. Pick a different voice.', 'error');
      return;
    }
  }

  // Validate ElevenLabs voice ID is set when using ElevenLabs
  if (provider === 'elevenlabs') {
    const customId = document.getElementById('elCustomVoiceId').value.trim();
    const hiddenId = document.getElementById('elevenlabsVoiceId').value.trim();
    // Custom field overrides card selection
    if (customId) document.getElementById('elevenlabsVoiceId').value = customId;
    const finalId = customId || hiddenId;
    if (!finalId) {
      toast('Select an ElevenLabs voice or enter a custom Voice ID', 'error');
      return;
    }
  }

  const btn = document.getElementById('saveBtn');
  btn.disabled = true;
  btn.textContent = 'Saving...';

  try {
    const body = {};

    // Collect all settings fields
    for (const key of SETTINGS_FIELDS) {
      const el = document.getElementById(key);
      if (!el) continue;
      let val = el.value;
      if (NUMBER_FIELDS.includes(key)) val = parseFloat(val);
      body[key] = val;
    }

    // Map call form phone numbers into settings
    const callTo = document.getElementById('callTo').value.trim();
    const callFrom = document.getElementById('callFrom').value.trim();
    if (callTo) body.defaultToNumber = callTo;
    if (callFrom) body.defaultFromNumber = callFrom;

    console.log('[Dashboard] Saving settings:', body);

    const res = await fetch('/api/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const errText = await res.text();
      console.error('[Dashboard] Save failed:', res.status, errText);
      toast('Save failed: ' + res.status, 'error');
      return;
    }

    const saved = await res.json();
    console.log('[Dashboard] Saved successfully:', saved);
    toast('Settings saved — next call will use new settings', 'success');
  } catch (e) {
    console.error('[Dashboard] Save error:', e);
    toast('Save failed: ' + e.message, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Save All Settings';
  }
}

async function makeCall() {
  const to = document.getElementById('callTo').value.trim();
  const from = document.getElementById('callFrom').value.trim();
  const name = document.getElementById('callName').value.trim() || 'there';
  const state = document.getElementById('callState').value.trim() || 'FL';

  if (!to) { toast('Enter a phone number', 'error'); return; }

  const btn = document.getElementById('callBtn');
  btn.disabled = true;
  btn.textContent = 'Calling...';

  try {
    const payload = {
      to: to,
      from: from || undefined,
      lead: { first_name: name, state: state },
    };
    console.log('[Dashboard] Making call:', payload);

    const res = await fetch('/call/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    const data = await res.json();
    console.log('[Dashboard] Call response:', data);

    if (res.ok) {
      addLog('Call started: <span class="sid">' + data.call_sid + '</span> <span class="ok">queued</span>');
      toast('Call sent!', 'success');
    } else {
      addLog('<span class="err">Error: ' + (data.error || res.statusText) + '</span>');
      toast('Call failed: ' + (data.error || res.statusText), 'error');
    }
  } catch (e) {
    console.error('[Dashboard] Call error:', e);
    addLog('<span class="err">Network error: ' + e.message + '</span>');
    toast('Call failed: ' + e.message, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Call';
  }
}

function addLog(html) {
  const log = document.getElementById('callLog');
  const time = new Date().toLocaleTimeString();
  const entry = document.createElement('div');
  entry.className = 'entry';
  entry.innerHTML = '<span style="color:var(--text2)">' + time + '</span> ' + html;
  if (log.children.length === 1 && log.children[0].textContent.includes('will appear')) {
    log.innerHTML = '';
  }
  log.appendChild(entry);
  log.scrollTop = log.scrollHeight;
}

async function loadDefaultPrompt() {
  try {
    const res = await fetch('/api/default-prompt');
    const data = await res.json();
    document.getElementById('systemPromptOverride').value = data.prompt;
    toast('Default prompt loaded into editor', 'success');
  } catch (e) {
    toast('Failed to load default prompt', 'error');
  }
}

function clearPrompt() {
  document.getElementById('systemPromptOverride').value = '';
  toast('Prompt cleared — will use built-in default', 'success');
}

async function loadCallHistory() {
  try {
    const res = await fetch('/api/calls');
    const calls = await res.json();
    const el = document.getElementById('callHistory');
    if (!calls.length) {
      el.innerHTML = '<div style="color:var(--text2)">No calls yet since last deploy. Make a call and refresh.</div>';
      return;
    }
    let html = '<table style="width:100%;border-collapse:collapse;font-size:12px">';
    html += '<tr style="text-align:left;color:var(--text2);border-bottom:1px solid var(--border)">'
      + '<th style="padding:6px 8px">Time</th>'
      + '<th style="padding:6px 8px">To</th>'
      + '<th style="padding:6px 8px">Lead</th>'
      + '<th style="padding:6px 8px">Provider</th>'
      + '<th style="padding:6px 8px">Voice</th>'
      + '<th style="padding:6px 8px">VAD</th>'
      + '<th style="padding:6px 8px">Silence</th>'
      + '<th style="padding:6px 8px">Debounce</th>'
      + '<th style="padding:6px 8px">Echo</th>'
      + '<th style="padding:6px 8px">Tokens</th>'
      + '<th style="padding:6px 8px">Agent</th>'
      + '</tr>';
    for (const c of calls) {
      const t = new Date(c.timestamp).toLocaleString();
      const s = c.settings;
      html += '<tr style="border-bottom:1px solid var(--border)">'
        + '<td style="padding:6px 8px;color:var(--text2)">' + t + '</td>'
        + '<td style="padding:6px 8px">' + c.to + '</td>'
        + '<td style="padding:6px 8px">' + c.leadName + '</td>'
        + '<td style="padding:6px 8px">' + (s.voiceProvider || 'openai') + '</td>'
        + '<td style="padding:6px 8px;color:var(--accent)">' + s.voice + '</td>'
        + '<td style="padding:6px 8px">' + s.vadThreshold + '</td>'
        + '<td style="padding:6px 8px">' + s.silenceDurationMs + 'ms</td>'
        + '<td style="padding:6px 8px">' + s.bargeInDebounceMs + 'ms</td>'
        + '<td style="padding:6px 8px">' + s.echoSuppressionMs + 'ms</td>'
        + '<td style="padding:6px 8px">' + s.maxResponseTokens + '</td>'
        + '<td style="padding:6px 8px">' + s.agentName + '</td>'
        + '</tr>';
    }
    html += '</table>';
    el.innerHTML = html;
  } catch (e) {
    document.getElementById('callHistory').innerHTML = '<span class="err">Failed to load</span>';
  }
}

// --- Voice preview ---
let currentAudio = null;
let currentPlayBtn = null;

function selectVoice(voice) {
  document.getElementById('voice').value = voice;
  document.querySelectorAll('.voice-card').forEach(c => {
    c.classList.toggle('selected', c.dataset.voice === voice);
  });
}

async function previewVoice(voice, btn) {
  // Stop any currently playing preview
  if (currentAudio) {
    currentAudio.pause();
    currentAudio.currentTime = 0;
    if (currentPlayBtn) currentPlayBtn.innerHTML = '&#9654;';
  }

  // If clicking the same one that's playing, just stop
  if (currentPlayBtn === btn && currentAudio && !currentAudio.paused) {
    currentAudio = null;
    currentPlayBtn = null;
    return;
  }

  btn.classList.add('loading');
  btn.innerHTML = '...';

  try {
    const audio = new Audio('/api/voice-preview/' + voice);
    audio.addEventListener('canplaythrough', () => {
      btn.classList.remove('loading');
      btn.innerHTML = '&#9724;'; // Stop icon while playing
      audio.play();
    }, { once: true });
    audio.addEventListener('ended', () => {
      btn.innerHTML = '&#9654;';
      currentAudio = null;
      currentPlayBtn = null;
    });
    audio.addEventListener('error', () => {
      btn.classList.remove('loading');
      btn.innerHTML = '&#9654;';
      toast('Preview failed for ' + voice, 'error');
    });
    currentAudio = audio;
    currentPlayBtn = btn;
    audio.load();
  } catch (e) {
    btn.classList.remove('loading');
    btn.innerHTML = '&#9654;';
    toast('Preview failed: ' + e.message, 'error');
  }
}

// --- ElevenLabs voice selection & preview ---
const EL_VOICES = {
  '21m00Tcm4TlvDq8ikWAM': 'Rachel',
  'EXAVITQu4vr4xnSDxMaL': 'Bella',
  'AZnzlk1XvdvUeBnXmlld': 'Domi',
  'MF3mGyEYCl7XYWbV9V6O': 'Elli',
  'ErXwobaYiN019PkySvjV': 'Antoni',
  'TxGEqnHWrfWFTfGW9XjX': 'Josh',
  'VR6AewLTigWG4xSOukaG': 'Arnold',
  'pNInz6obpgDQGcFmaJgB': 'Adam',
};

function selectElVoice(voiceId) {
  document.getElementById('elevenlabsVoiceId').value = voiceId;
  document.getElementById('elCustomVoiceId').value = '';
  document.querySelectorAll('.el-vc').forEach(c => {
    c.classList.toggle('selected', c.dataset.elvoice === voiceId);
  });
}

function syncElVoiceSelection() {
  const voiceId = document.getElementById('elevenlabsVoiceId').value;
  const customEl = document.getElementById('elCustomVoiceId');
  if (EL_VOICES[voiceId]) {
    // Known premade voice — select the card
    document.querySelectorAll('.el-vc').forEach(c => {
      c.classList.toggle('selected', c.dataset.elvoice === voiceId);
    });
    customEl.value = '';
  } else if (voiceId) {
    // Custom voice ID — deselect all cards, show in custom field
    document.querySelectorAll('.el-vc').forEach(c => c.classList.remove('selected'));
    customEl.value = voiceId;
  }
}

// Custom voice ID input: when typed, update the hidden field and deselect cards
document.getElementById('elCustomVoiceId').addEventListener('input', function() {
  const val = this.value.trim();
  if (val) {
    document.getElementById('elevenlabsVoiceId').value = val;
    document.querySelectorAll('.el-vc').forEach(c => c.classList.remove('selected'));
  }
});

async function previewElVoice(voiceId, btn) {
  if (currentAudio) {
    currentAudio.pause();
    currentAudio.currentTime = 0;
    if (currentPlayBtn) currentPlayBtn.innerHTML = '&#9654;';
  }

  if (currentPlayBtn === btn && currentAudio && !currentAudio.paused) {
    currentAudio = null;
    currentPlayBtn = null;
    return;
  }

  btn.classList.add('loading');
  btn.innerHTML = '...';

  try {
    const audio = new Audio('/api/elevenlabs-voice-preview/' + voiceId);
    audio.addEventListener('canplaythrough', () => {
      btn.classList.remove('loading');
      btn.innerHTML = '&#9724;';
      audio.play();
    }, { once: true });
    audio.addEventListener('ended', () => {
      btn.innerHTML = '&#9654;';
      currentAudio = null;
      currentPlayBtn = null;
    });
    audio.addEventListener('error', () => {
      btn.classList.remove('loading');
      btn.innerHTML = '&#9654;';
      toast('Preview failed for ElevenLabs voice', 'error');
    });
    currentAudio = audio;
    currentPlayBtn = btn;
    audio.load();
  } catch (e) {
    btn.classList.remove('loading');
    btn.innerHTML = '&#9654;';
    toast('Preview failed: ' + e.message, 'error');
  }
}

// Range slider live values
document.querySelectorAll('input[type=range]').forEach(el => {
  el.addEventListener('input', () => {
    const valEl = document.getElementById(el.id + 'Val');
    if (valEl) valEl.textContent = parseFloat(el.value).toFixed(2);
  });
});

// Load on page ready
loadSettings();
loadCallHistory();
</script>
</body>
</html>`;
}
