export function getDashboardHtml(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
<title>Quoting Fast AI</title>
<style>
  :root {
    --primary: #2563eb;
    --primary-light: #3b82f6;
    --primary-dark: #1d4ed8;
    --primary-bg: #eff6ff;
    --bg: #e8ecf4;
    --surface: #ffffff;
    --surface2: #f7f8fc;
    --border: #e4e8f0;
    --text: #1f2937;
    --text2: #6b7280;
    --accent: #2563eb;
    --accent-hover: #1d4ed8;
    --green: #22c55e;
    --red: #ef4444;
    --orange: #f59e0b;
    --cyan: #2bbcb3;
    --purple: #8b5cf6;
    --radius: 16px;
    --radius-sm: 10px;
    --sidebar-width: 250px;
    --shadow-3d: 0 1px 2px rgba(0,0,0,0.04), 0 4px 8px rgba(0,0,0,0.04), 0 12px 24px rgba(0,0,0,0.06), 0 24px 48px rgba(0,0,0,0.04);
    --shadow-3d-hover: 0 2px 4px rgba(0,0,0,0.04), 0 8px 16px rgba(0,0,0,0.06), 0 20px 40px rgba(0,0,0,0.08), 0 32px 64px rgba(0,0,0,0.06);
    --shadow-sidebar: 4px 0 16px rgba(0,0,0,0.04), 8px 0 32px rgba(0,0,0,0.02);
  }
  *, *::before, *::after { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    background: linear-gradient(145deg, #e8ecf4 0%, #dfe3ec 30%, #e2e6ef 60%, #ebeef5 100%);
    color: var(--text);
    min-height: 100vh;
    line-height: 1.5;
    overflow-x: hidden;
  }
  /* ── Floating Accent Blobs ── */
  .floating-accent { position: fixed; border-radius: 50%; pointer-events: none; z-index: -1; filter: blur(60px); opacity: 0.15; }
  .floating-accent.a1 { width: 400px; height: 400px; background: var(--primary); top: -100px; right: -100px; }
  .floating-accent.a2 { width: 300px; height: 300px; background: var(--purple); bottom: -50px; left: 200px; }
  .floating-accent.a3 { width: 250px; height: 250px; background: var(--green); bottom: 200px; right: 100px; opacity: 0.1; }
  /* ── Sidebar ── */
  .sidebar {
    position: fixed; top: 0; left: 0; width: var(--sidebar-width); height: 100vh;
    background: rgba(255,255,255,0.92); backdrop-filter: blur(20px); -webkit-backdrop-filter: blur(20px);
    border-right: 1px solid rgba(255,255,255,0.6); display: flex; flex-direction: column;
    z-index: 100; box-shadow: var(--shadow-sidebar); transition: transform 0.4s cubic-bezier(0.16, 1, 0.3, 1);
  }
  .sidebar-header { padding: 22px 20px; border-bottom: 1px solid rgba(0,0,0,0.06); display: flex; align-items: center; gap: 12px; }
  .sidebar-logo { width: 38px; height: 38px; border-radius: 12px; overflow: hidden; display: flex; align-items: center; justify-content: center; box-shadow: 0 4px 12px rgba(37,99,235,0.35); flex-shrink: 0; }
  .sidebar-logo img { width: 100%; height: 100%; object-fit: cover; }
  .sidebar-title { font-size: 17px; font-weight: 700; color: var(--text); letter-spacing: -0.02em; }
  .sidebar-nav { flex: 1; padding: 12px 12px; overflow-y: auto; }
  .nav-section-label { font-size: 10px; font-weight: 700; color: #9ca3af; text-transform: uppercase; letter-spacing: 0.08em; padding: 10px 12px 6px; margin-top: 8px; }
  .nav-item {
    display: flex; align-items: center; gap: 12px; padding: 10px 12px; border-radius: var(--radius-sm);
    color: var(--text2); font-size: 14px; font-weight: 500; cursor: pointer; transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1);
    text-decoration: none; margin-bottom: 2px; border: none; background: none; width: 100%; text-align: left; font-family: inherit;
  }
  .nav-item:hover { background: rgba(0,0,0,0.04); color: var(--text); transform: translateX(3px); }
  .nav-item.active { background: var(--primary); color: #fff; font-weight: 600; box-shadow: 0 4px 12px rgba(37,99,235,0.3); transform: translateX(0); }
  .nav-item .nav-icon { width: 20px; height: 20px; flex-shrink: 0; display: inline-flex; align-items: center; font-size: 16px; }
  .nav-item .nav-badge { margin-left: auto; background: var(--red); color: #fff; font-size: 11px; font-weight: 600; padding: 2px 7px; border-radius: 10px; line-height: 1.4; box-shadow: 0 2px 6px rgba(239,68,68,0.35); }
  .sidebar-footer { padding: 16px; border-top: 1px solid rgba(0,0,0,0.06); display: flex; align-items: center; gap: 12px; }
  .sidebar-avatar { width: 36px; height: 36px; border-radius: 50%; background: linear-gradient(135deg, var(--primary-light), var(--purple)); display: flex; align-items: center; justify-content: center; color: #fff; font-weight: 600; font-size: 13px; box-shadow: 0 3px 8px rgba(37,99,235,0.25); flex-shrink: 0; }
  .sidebar-user-info { flex: 1; min-width: 0; }
  .sidebar-user-name { font-size: 13px; font-weight: 600; color: var(--text); }
  .sidebar-user-role { font-size: 12px; color: var(--text2); }
  .sidebar-overlay { display: none; position: fixed; inset: 0; background: rgba(0,0,0,0.2); backdrop-filter: blur(4px); z-index: 99; }
  .sidebar-overlay.show { display: block; }
  /* ── Main + Topbar ── */
  .main-wrapper { margin-left: var(--sidebar-width); min-height: 100vh; }
  .topbar {
    position: sticky; top: 0; background: rgba(255,255,255,0.72); backdrop-filter: blur(20px); -webkit-backdrop-filter: blur(20px);
    border-bottom: 1px solid rgba(255,255,255,0.5); padding: 0 32px; height: 66px;
    display: flex; align-items: center; justify-content: space-between; z-index: 50;
  }
  .topbar-left { display: flex; align-items: center; gap: 16px; }
  .menu-toggle { display: none; background: none; border: none; cursor: pointer; padding: 6px; color: var(--text2); font-size: 20px; }
  .page-title { font-size: 22px; font-weight: 800; color: var(--text); letter-spacing: -0.02em; }
  .topbar-right { display: flex; align-items: center; gap: 10px; }
  .topbar-status { display: flex; align-items: center; gap: 8px; font-size: 13px; color: var(--text2); padding: 7px 14px; background: rgba(255,255,255,0.6); border-radius: 12px; box-shadow: 0 1px 3px rgba(0,0,0,0.04); }
  .status-dot { width: 8px; height: 8px; background: var(--green); border-radius: 50%; display: inline-block; box-shadow: 0 0 8px rgba(34,197,94,0.5); }
  /* ── Tab content ── */
  .tab-content { display: none; }
  .tab-content.active { display: block; }
  main { max-width: 1200px; margin: 0 auto; padding: 28px 32px 60px; }
  /* ── Cards ── */
  .card {
    background: rgba(255,255,255,0.88); backdrop-filter: blur(16px); -webkit-backdrop-filter: blur(16px);
    border: 1px solid rgba(255,255,255,0.7); border-radius: var(--radius); padding: 28px; margin-bottom: 20px;
    box-shadow: var(--shadow-3d); transition: all 0.4s cubic-bezier(0.16, 1, 0.3, 1); position: relative; overflow: hidden;
  }
  .card::before { content: ''; position: absolute; top: 0; left: 0; right: 0; height: 1px; background: linear-gradient(90deg, transparent, rgba(255,255,255,0.9), transparent); z-index: 1; }
  .card:hover { box-shadow: var(--shadow-3d-hover); transform: translateY(-2px); }
  .card h2 { font-size: 16px; font-weight: 700; margin-bottom: 18px; color: var(--text); display: flex; align-items: center; gap: 8px; letter-spacing: -0.01em; }
  .card h2 .icon { font-size: 18px; }
  .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
  .grid-3 { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 16px; }
  .grid-4 { display: grid; grid-template-columns: 1fr 1fr 1fr 1fr; gap: 12px; }
  .full { grid-column: 1 / -1; }
  label { display: block; font-size: 12px; font-weight: 600; color: var(--text2); margin-bottom: 6px; text-transform: uppercase; letter-spacing: 0.5px; }
  input, select, textarea {
    width: 100%; background: rgba(255,255,255,0.7); border: 1.5px solid rgba(0,0,0,0.08); border-radius: var(--radius-sm);
    color: var(--text); padding: 11px 14px; font-size: 14px; font-family: inherit; outline: none;
    transition: border-color 0.2s, box-shadow 0.2s; box-shadow: 0 1px 3px rgba(0,0,0,0.04);
  }
  input:focus, select:focus, textarea:focus { border-color: var(--primary-light); box-shadow: 0 0 0 4px rgba(37,99,235,0.1), 0 2px 8px rgba(0,0,0,0.06); background: #fff; }
  textarea { resize: vertical; min-height: 200px; font-size: 13px; line-height: 1.5; }
  select { cursor: pointer; }
  .range-wrap { display: flex; align-items: center; gap: 12px; }
  .range-wrap input[type=range] { flex: 1; padding: 0; height: 6px; -webkit-appearance: none; background: #e0e4ec; border-radius: 3px; border: none; box-shadow: none; }
  .range-wrap input[type=range]::-webkit-slider-thumb { -webkit-appearance: none; width: 18px; height: 18px; background: var(--primary); border-radius: 50%; cursor: pointer; box-shadow: 0 2px 6px rgba(37,99,235,0.3); }
  .range-val { font-size: 13px; font-weight: 600; color: var(--primary); min-width: 45px; text-align: right; }
  .btn {
    display: inline-flex; align-items: center; gap: 6px; padding: 10px 22px; border: 1px solid rgba(0,0,0,0.08);
    border-radius: var(--radius-sm); font-size: 14px; font-weight: 600; cursor: pointer;
    transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1); font-family: inherit; background: rgba(255,255,255,0.8);
    color: var(--text); box-shadow: 0 1px 3px rgba(0,0,0,0.04);
  }
  .btn:hover { background: #fff; box-shadow: 0 4px 12px rgba(0,0,0,0.08); transform: translateY(-1px); }
  .btn-primary { background: linear-gradient(135deg, var(--primary), var(--primary-dark)); color: white; border-color: transparent; box-shadow: 0 4px 12px rgba(37,99,235,0.3); }
  .btn-primary:hover { box-shadow: 0 6px 20px rgba(37,99,235,0.4); transform: translateY(-2px); }
  .btn-secondary { background: rgba(255,255,255,0.8); color: var(--text); border: 1.5px solid rgba(0,0,0,0.08); }
  .btn-secondary:hover { background: #fff; box-shadow: 0 4px 12px rgba(0,0,0,0.08); }
  .btn-green { background: linear-gradient(135deg, var(--green), #16a34a); color: white; border-color: transparent; box-shadow: 0 3px 10px rgba(34,197,94,0.3); }
  .btn-green:hover { box-shadow: 0 5px 16px rgba(34,197,94,0.4); transform: translateY(-1px); }
  .btn-red { background: linear-gradient(135deg, var(--red), #dc2626); color: white; border-color: transparent; box-shadow: 0 3px 10px rgba(239,68,68,0.25); }
  .btn-red:hover { box-shadow: 0 5px 16px rgba(239,68,68,0.35); transform: translateY(-1px); }
  .btn-sm { padding: 7px 14px; font-size: 12px; border-radius: 8px; }
  .btn:disabled { opacity: 0.5; cursor: not-allowed; }
  .call-row { display: flex; gap: 12px; align-items: flex-end; }
  .call-row .field { flex: 1; }
  .toast {
    position: fixed; bottom: 24px; right: 24px; padding: 14px 24px; border-radius: 12px;
    font-size: 14px; font-weight: 600; color: white; z-index: 9999; opacity: 0;
    transform: translateY(10px); transition: all 0.3s; box-shadow: 0 8px 24px rgba(0,0,0,0.15);
  }
  .toast.show { opacity: 1; transform: translateY(0); }
  .toast.success { background: var(--green); }
  .toast.error { background: var(--red); }
  .call-log {
    font-family: 'SF Mono', 'Fira Code', monospace; font-size: 12px;
    background: rgba(255,255,255,0.6); border: 1.5px solid rgba(0,0,0,0.06); border-radius: var(--radius-sm);
    padding: 14px; max-height: 180px; overflow-y: auto; line-height: 1.8; color: var(--text2);
  }
  .call-log .entry { padding: 2px 0; }
  .call-log .sid { color: var(--primary); }
  .call-log .ok { color: var(--green); }
  .call-log .err { color: var(--red); }
  .section-actions { display: flex; gap: 10px; margin-top: 18px; justify-content: flex-end; }
  .voice-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(170px, 1fr)); gap: 10px; }
  .voice-card {
    background: rgba(255,255,255,0.8); border: 2px solid rgba(0,0,0,0.06); border-radius: 12px;
    padding: 14px; cursor: pointer; transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1);
    position: relative; box-shadow: 0 1px 4px rgba(0,0,0,0.04);
  }
  .voice-card:hover { border-color: var(--primary); box-shadow: 0 4px 16px rgba(37,99,235,0.12); transform: translateY(-2px); }
  .voice-card.selected { border-color: var(--primary); background: rgba(37,99,235,0.06); box-shadow: 0 4px 16px rgba(37,99,235,0.15); }
  .voice-card .vc-name { font-size: 14px; font-weight: 600; margin-bottom: 2px; }
  .voice-card .vc-desc { font-size: 11px; color: var(--text2); line-height: 1.3; }
  .voice-card .vc-tag { display: inline-block; font-size: 10px; padding: 2px 8px; border-radius: 6px; margin-top: 6px; font-weight: 600; }
  .voice-card .vc-tag.sales { background: rgba(34,197,94,0.12); color: var(--green); }
  .voice-card .vc-tag.neutral { background: rgba(107,114,128,0.1); color: var(--text2); }
  .vc-play {
    position: absolute; top: 10px; right: 10px; width: 28px; height: 28px; border-radius: 50%;
    border: 1.5px solid rgba(0,0,0,0.08); background: rgba(255,255,255,0.9);
    color: var(--text2); display: flex; align-items: center; justify-content: center;
    cursor: pointer; font-size: 12px; transition: all 0.2s; box-shadow: 0 1px 3px rgba(0,0,0,0.05);
  }
  .vc-play:hover { border-color: var(--primary); color: var(--primary); background: rgba(37,99,235,0.05); }
  .vc-play.loading { opacity: 0.5; cursor: wait; }
  .vc-check { display: none; position: absolute; bottom: 8px; right: 10px; font-size: 14px; color: var(--primary); }
  .voice-card.selected .vc-check { display: block; }
  .voice-card.disabled { opacity: 0.35; pointer-events: none; filter: grayscale(1); }
  .voice-card.disabled .vc-play { display: none; }
  .provider-toggle {
    display: flex; gap: 0; background: rgba(255,255,255,0.7); border-radius: 12px; overflow: hidden;
    border: 1px solid rgba(0,0,0,0.06); box-shadow: 0 1px 4px rgba(0,0,0,0.06), inset 0 1px 0 rgba(255,255,255,0.8);
  }
  .provider-toggle button {
    flex: 1; padding: 12px 20px; border: none; background: transparent;
    color: var(--text2); font-size: 14px; font-weight: 600; cursor: pointer;
    font-family: inherit; transition: all 0.2s;
    display: flex; align-items: center; justify-content: center; gap: 8px;
  }
  .provider-toggle button:hover { background: rgba(0,0,0,0.04); }
  .provider-toggle button.active { background: var(--primary); color: white; box-shadow: 0 2px 8px rgba(37,99,235,0.3); }
  .provider-toggle button .prov-label { font-size: 14px; }
  .provider-toggle button .prov-sub { font-size: 11px; opacity: 0.7; }
  .el-settings { margin-top: 16px; }
  .el-settings .el-row { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 14px; }
  .stat-card {
    background: rgba(255,255,255,0.85); backdrop-filter: blur(12px); border: 1px solid rgba(255,255,255,0.6);
    border-radius: var(--radius); padding: 20px 16px; text-align: center;
    box-shadow: var(--shadow-3d); transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1);
  }
  .stat-card:hover { transform: translateY(-4px); box-shadow: var(--shadow-3d-hover); }
  .stat-card .stat-value { font-size: 30px; font-weight: 800; color: var(--primary); line-height: 1.2; }
  .stat-card .stat-label { font-size: 11px; color: var(--text2); text-transform: uppercase; letter-spacing: 0.5px; margin-top: 6px; font-weight: 600; }
  .stat-card.green .stat-value { color: var(--green); }
  .stat-card.red .stat-value { color: var(--red); }
  .stat-card.orange .stat-value { color: var(--orange); }
  .stat-card.cyan .stat-value { color: var(--cyan); }
  .stat-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 12px; }
  .data-table { width: 100%; border-collapse: collapse; font-size: 12px; }
  .data-table th {
    text-align: left; color: var(--text2); padding: 10px 12px; border-bottom: 2px solid rgba(0,0,0,0.06);
    font-weight: 700; text-transform: uppercase; font-size: 11px; letter-spacing: 0.06em; background: rgba(0,0,0,0.02);
  }
  .data-table td { padding: 10px 12px; border-bottom: 1px solid rgba(0,0,0,0.04); color: var(--text); }
  .data-table tr:hover td { background: rgba(37,99,235,0.03); }
  .badge { display: inline-block; padding: 3px 10px; border-radius: 8px; font-size: 11px; font-weight: 600; }
  .badge-green { background: rgba(34,197,94,0.12); color: #16a34a; }
  .badge-red { background: rgba(239,68,68,0.12); color: var(--red); }
  .badge-orange { background: rgba(245,158,11,0.12); color: #d97706; }
  .badge-blue { background: rgba(37,99,235,0.1); color: var(--primary); }
  .badge-gray { background: rgba(107,114,128,0.1); color: var(--text2); }
  .empty-state { text-align: center; padding: 40px; color: var(--text2); font-size: 14px; background: rgba(255,255,255,0.5); border-radius: 12px; }
  ::-webkit-scrollbar { width: 6px; height: 6px; }
  ::-webkit-scrollbar-track { background: transparent; }
  ::-webkit-scrollbar-thumb { background: #d0d5e0; border-radius: 3px; }
  ::-webkit-scrollbar-thumb:hover { background: #b0b8c8; }
  ::selection { background: rgba(37,99,235,0.15); }
  /* ── Entrance Animations ── */
  @keyframes floatUp { from { opacity: 0; transform: translateY(20px); } to { opacity: 1; transform: translateY(0); } }
  @keyframes slideIn { from { opacity: 0; transform: translateX(-20px); } to { opacity: 1; transform: translateX(0); } }
  .card { animation: floatUp 0.6s cubic-bezier(0.16, 1, 0.3, 1) backwards; }
  .sidebar .nav-item { animation: slideIn 0.4s cubic-bezier(0.16, 1, 0.3, 1) backwards; }
  .sidebar .nav-item:nth-child(1) { animation-delay: 0.05s; }
  .sidebar .nav-item:nth-child(2) { animation-delay: 0.1s; }
  .sidebar .nav-item:nth-child(3) { animation-delay: 0.15s; }
  .sidebar .nav-item:nth-child(4) { animation-delay: 0.2s; }
  .sidebar .nav-item:nth-child(5) { animation-delay: 0.25s; }
  .sidebar .nav-item:nth-child(6) { animation-delay: 0.3s; }
  .sidebar .nav-item:nth-child(7) { animation-delay: 0.35s; }
  .sidebar .nav-item:nth-child(8) { animation-delay: 0.4s; }
  .sidebar .nav-item:nth-child(9) { animation-delay: 0.45s; }
  /* ── Responsive ── */
  @media (max-width: 900px) {
    .sidebar { transform: translateX(-100%); }
    .sidebar.open { transform: translateX(0); }
    .main-wrapper { margin-left: 0; }
    .menu-toggle { display: flex; }
  }
  @media (max-width: 640px) {
    .grid, .grid-3, .grid-4, .el-settings .el-row { grid-template-columns: 1fr; }
    .call-row { flex-direction: column; }
    .voice-grid { grid-template-columns: 1fr 1fr; }
    main { padding: 16px 10px; }
    .provider-toggle { flex-direction: column; }
    .topbar { padding: 0 16px; }
  }
</style>
</head>
<body>
<!-- Floating Accent Blobs -->
<div class="floating-accent a1"></div>
<div class="floating-accent a2"></div>
<div class="floating-accent a3"></div>

<!-- Sidebar Overlay (mobile) -->
<div class="sidebar-overlay" id="sidebarOverlay"></div>

<!-- Sidebar -->
<aside class="sidebar" id="sidebar">
  <div class="sidebar-header">
    <div class="sidebar-logo"><img src="https://quotingfast.com/qflogo1.png" alt="QF"></div>
    <span class="sidebar-title">Quoting Fast AI</span>
  </div>
  <nav class="sidebar-nav">
    <div class="nav-section-label">Operations</div>
    <button class="nav-item active" onclick="switchTab('campaigns')">
      <span class="nav-icon">&#128640;</span> Campaigns
    </button>
    <button class="nav-item" onclick="switchTab('calls')">
      <span class="nav-icon">&#128222;</span> Calls
    </button>
    <button class="nav-item" onclick="switchTab('recordings')">
      <span class="nav-icon">&#127908;</span> Recordings
    </button>
    <div class="nav-section-label">Insights</div>
    <button class="nav-item" onclick="switchTab('analytics')">
      <span class="nav-icon">&#128200;</span> Analytics
      <span class="nav-badge" id="analyticsBadge" style="display:none"></span>
    </button>
    <button class="nav-item" onclick="switchTab('monitoring')">
      <span class="nav-icon">&#128994;</span> Monitoring
    </button>
    <div class="nav-section-label">Management</div>
    <button class="nav-item" onclick="switchTab('compliance')">
      <span class="nav-icon">&#128274;</span> Compliance
    </button>
    <button class="nav-item" onclick="switchTab('leads')">
      <span class="nav-icon">&#128101;</span> Leads
    </button>
    <button class="nav-item" onclick="switchTab('sms')">
      <span class="nav-icon">&#128172;</span> SMS
    </button>
    <div class="nav-section-label">System</div>
    <button class="nav-item" onclick="switchTab('settings')">
      <span class="nav-icon">&#9881;</span> Settings
    </button>
  </nav>
  <div class="sidebar-footer">
    <div class="sidebar-avatar">QF</div>
    <div class="sidebar-user-info">
      <div class="sidebar-user-name">Admin</div>
      <div class="sidebar-user-role">Administrator</div>
    </div>
  </div>
</aside>

<!-- Main Content -->
<div class="main-wrapper">
  <!-- Top Bar -->
  <header class="topbar">
    <div class="topbar-left">
      <button class="menu-toggle" id="menuToggle">&#9776;</button>
      <h1 class="page-title" id="pageTitle">Campaigns</h1>
    </div>
    <div class="topbar-right">
      <div class="topbar-status">
        <span class="status-dot"></span> Connected
      </div>
    </div>
  </header>

<main>

<!-- CAMPAIGNS TAB -->
<div class="tab-content active" id="tab-campaigns">
  <div style="display:flex;gap:16px;margin-bottom:20px;align-items:center">
    <div style="display:flex;gap:8px">
      <button class="btn btn-primary campaign-toggle active" id="toggleConsumer" onclick="selectCampaignView('campaign-consumer-auto')" style="background:linear-gradient(135deg,#3B82F6,#2563EB);box-shadow:0 4px 14px rgba(59,130,246,0.35)">Consumer Auto</button>
      <button class="btn btn-secondary campaign-toggle" id="toggleAgency" onclick="selectCampaignView('campaign-agency-dev')" style="border-color:#8B5CF6;color:#8B5CF6">Agency Dev</button>
    </div>
    <div style="flex:1"></div>
    <div style="display:flex;gap:8px">
      <button class="btn btn-sm btn-secondary" onclick="loadCampaignFlags()">Feature Flags</button>
      <button class="btn btn-sm btn-secondary" onclick="loadEnforcementLog()">Enforcement Log</button>
    </div>
  </div>

  <!-- Campaign Overview Cards -->
  <div class="grid" id="campaignOverview">
    <div class="card" style="background:linear-gradient(145deg,#ffffff 0%,#f0f7ff 100%);border-left:4px solid #3B82F6;box-shadow:0 8px 32px rgba(59,130,246,0.08)">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
        <h2 style="margin:0"><span style="background:#3B82F6;color:white;padding:3px 10px;border-radius:6px;font-size:11px;margin-right:8px">CONSUMER</span> Auto Insurance Leads</h2>
        <label style="display:flex;align-items:center;gap:8px;margin:0;cursor:pointer"><input type="checkbox" id="consumerActive" onchange="toggleCampaignActive('campaign-consumer-auto',this.checked)" checked> <span style="font-size:12px;font-weight:600">Active</span></label>
      </div>
      <p style="font-size:13px;color:var(--text2);margin-bottom:16px">Calls consumers who requested a quote. Qualifies and transfers to licensed insurance agents.</p>
      <div class="grid-4" style="gap:8px">
        <div style="text-align:center;padding:12px;background:rgba(59,130,246,0.05);border-radius:10px"><div style="font-size:20px;font-weight:700;color:#3B82F6" id="consumerCalls">0</div><div style="font-size:11px;color:var(--text2)">Calls Today</div></div>
        <div style="text-align:center;padding:12px;background:rgba(34,197,94,0.05);border-radius:10px"><div style="font-size:20px;font-weight:700;color:#22c55e" id="consumerTransfers">0</div><div style="font-size:11px;color:var(--text2)">Transfers</div></div>
        <div style="text-align:center;padding:12px;background:rgba(245,158,11,0.05);border-radius:10px"><div style="font-size:20px;font-weight:700;color:#f59e0b" id="consumerCallbacks">0</div><div style="font-size:11px;color:var(--text2)">Callbacks</div></div>
        <div style="text-align:center;padding:12px;background:rgba(43,188,179,0.05);border-radius:10px"><div style="font-size:20px;font-weight:700;color:#2bbcb3" id="consumerSms">0</div><div style="font-size:11px;color:var(--text2)">SMS Sent</div></div>
      </div>
    </div>
    <div class="card" style="background:linear-gradient(145deg,#ffffff 0%,#f5f0ff 100%);border-left:4px solid #8B5CF6;box-shadow:0 8px 32px rgba(139,92,246,0.08)">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
        <h2 style="margin:0"><span style="background:#8B5CF6;color:white;padding:3px 10px;border-radius:6px;font-size:11px;margin-right:8px">AGENCY</span> Agency Development</h2>
        <label style="display:flex;align-items:center;gap:8px;margin:0;cursor:pointer"><input type="checkbox" id="agencyActive" onchange="toggleCampaignActive('campaign-agency-dev',this.checked)" checked> <span style="font-size:12px;font-weight:600">Active</span></label>
      </div>
      <p style="font-size:13px;color:var(--text2);margin-bottom:16px">Calls insurance agencies. Promotes Quoting Fast lead generation services. Books meetings or transfers decision makers.</p>
      <div class="grid-4" style="gap:8px">
        <div style="text-align:center;padding:12px;background:rgba(139,92,246,0.05);border-radius:10px"><div style="font-size:20px;font-weight:700;color:#8B5CF6" id="agencyCalls">0</div><div style="font-size:11px;color:var(--text2)">Calls Today</div></div>
        <div style="text-align:center;padding:12px;background:rgba(34,197,94,0.05);border-radius:10px"><div style="font-size:20px;font-weight:700;color:#22c55e" id="agencyMeetings">0</div><div style="font-size:11px;color:var(--text2)">Meetings</div></div>
        <div style="text-align:center;padding:12px;background:rgba(245,158,11,0.05);border-radius:10px"><div style="font-size:20px;font-weight:700;color:#f59e0b" id="agencyCallbacks">0</div><div style="font-size:11px;color:var(--text2)">Callbacks</div></div>
        <div style="text-align:center;padding:12px;background:rgba(43,188,179,0.05);border-radius:10px"><div style="font-size:20px;font-weight:700;color:#2bbcb3" id="agencySms">0</div><div style="font-size:11px;color:var(--text2)">SMS Sent</div></div>
      </div>
    </div>
  </div>

  <!-- Campaign Config Panel -->
  <div class="card" id="campaignConfigPanel" style="box-shadow:0 8px 32px rgba(0,0,0,0.06);border-radius:16px">
    <h2 id="campaignConfigTitle">Campaign Configuration</h2>

    <!-- AI Profile Section -->
    <div style="margin-bottom:20px">
      <h3 style="font-size:14px;font-weight:700;color:var(--text);margin-bottom:12px;display:flex;align-items:center;gap:8px">AI Agent Profile</h3>
      <div class="grid">
        <div><label>Agent Name</label><input type="text" id="campAgentName" placeholder="Alex"></div>
        <div><label>Company Name</label><input type="text" id="campCompanyName" placeholder="Affordable Auto Rates"></div>
      </div>
      <div style="margin-top:12px"><label>System Prompt</label><textarea id="campSystemPrompt" style="min-height:120px"></textarea></div>
    </div>

    <!-- Voice Section (Card-style selector) -->
    <div style="margin-bottom:20px">
      <h3 style="font-size:14px;font-weight:700;color:var(--text);margin-bottom:12px">Voice Selection</h3>
      <div style="display:flex;gap:8px;margin-bottom:12px">
        <button class="btn btn-sm" id="campProvOpenai" onclick="setCampProvider('openai')">OpenAI</button>
        <button class="btn btn-sm" id="campProvElevenlabs" onclick="setCampProvider('elevenlabs')">ElevenLabs</button>
        <button class="btn btn-sm" id="campProvDeepseek" onclick="setCampProvider('deepseek')">DeepSeek</button>
      </div>
      <div id="campVoiceCards" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:10px;max-height:300px;overflow-y:auto;padding:4px"></div>
    </div>

    <!-- Features Section -->
    <div style="margin-bottom:20px">
      <h3 style="font-size:14px;font-weight:700;color:var(--text);margin-bottom:12px">Feature Toggles</h3>
      <div class="grid-3" style="gap:10px">
        <label style="display:flex;align-items:center;gap:8px;padding:10px;background:var(--surface2);border-radius:10px;cursor:pointer"><input type="checkbox" id="campScheduledCallbacks"> <span style="font-size:13px">Scheduled Callbacks</span></label>
        <label style="display:flex;align-items:center;gap:8px;padding:10px;background:var(--surface2);border-radius:10px;cursor:pointer"><input type="checkbox" id="campAutoDialNewLeads"> <span style="font-size:13px">Auto-Dial New Leads</span></label>
        <label style="display:flex;align-items:center;gap:8px;padding:10px;background:var(--surface2);border-radius:10px;cursor:pointer"><input type="checkbox" id="campVoicemailDrop"> <span style="font-size:13px">Voicemail Drop</span></label>
        <label style="display:flex;align-items:center;gap:8px;padding:10px;background:var(--surface2);border-radius:10px;cursor:pointer"><input type="checkbox" id="campSmsFollowUps"> <span style="font-size:13px">SMS Follow-ups</span></label>
        <label style="display:flex;align-items:center;gap:8px;padding:10px;background:var(--surface2);border-radius:10px;cursor:pointer"><input type="checkbox" id="campEmailFollowUps"> <span style="font-size:13px">Email Follow-ups</span></label>
        <label style="display:flex;align-items:center;gap:8px;padding:10px;background:var(--surface2);border-radius:10px;cursor:pointer"><input type="checkbox" id="campInboundEnabled"> <span style="font-size:13px">Inbound Calls</span></label>
      </div>
    </div>

    <!-- Transfer Routing -->
    <div style="margin-bottom:20px">
      <h3 style="font-size:14px;font-weight:700;color:var(--text);margin-bottom:12px">Transfer Routing</h3>
      <div id="campTransferRoutes"></div>
    </div>

    <!-- DID Mapping -->
    <div style="margin-bottom:20px">
      <h3 style="font-size:14px;font-weight:700;color:var(--text);margin-bottom:12px">Assigned Phone Numbers (DIDs)</h3>
      <div id="campDidList" style="margin-bottom:10px"></div>
      <div style="display:flex;gap:8px">
        <input type="text" id="campNewDid" placeholder="+18005551234" style="max-width:200px">
        <button class="btn btn-sm btn-primary" onclick="addCampaignDid()">Add DID</button>
      </div>
    </div>

    <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:20px">
      <button class="btn btn-primary" onclick="saveCampaignConfig()">Save Campaign Config</button>
    </div>
  </div>

  <!-- Feature Flags Panel (hidden by default) -->
  <div class="card" id="featureFlagsPanel" style="display:none;box-shadow:0 8px 32px rgba(0,0,0,0.06)">
    <h2>Feature Flags</h2>
    <div class="grid" id="featureFlagsGrid" style="gap:10px"></div>
  </div>

  <!-- Enforcement Log Panel (hidden by default) -->
  <div class="card" id="enforcementLogPanel" style="display:none;box-shadow:0 8px 32px rgba(0,0,0,0.06)">
    <h2>Enforcement Log (Last 50)</h2>
    <div id="enforcementLogContent" style="max-height:400px;overflow-y:auto;font-family:monospace;font-size:12px"></div>
  </div>

  <!-- Campaign SMS Templates -->
  <div class="card" style="box-shadow:0 8px 32px rgba(0,0,0,0.06)">
    <h2>Campaign SMS Templates</h2>
    <div id="campSmsTemplates"></div>
  </div>
</div>

<!-- CALLS TAB -->
<div class="tab-content" id="tab-calls">
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
      <div class="field">
        <label>Campaign</label>
        <select id="callCampaign" style="padding:8px 10px;border-radius:8px;border:1px solid var(--border);background:var(--card);color:var(--text);font-size:13px">
          <option value="campaign-consumer-auto">Consumer Auto</option>
          <option value="campaign-agency-dev">Agency Dev</option>
        </select>
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

<!-- RECORDINGS TAB -->
<div class="tab-content" id="tab-recordings">
  <div class="card">
    <h2><span class="icon">&#127908;</span> Call Recordings <button class="btn btn-secondary btn-sm" style="margin-left:auto" onclick="loadRecordings()">Refresh</button></h2>
    <div id="recordingsTable"><div class="empty-state">Loading...</div></div>
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
    <div style="display:flex;gap:12px;margin-bottom:16px;flex-wrap:wrap;align-items:center">
      <input type="text" id="leadSearch" placeholder="Search name, phone, state..." style="flex:1;min-width:200px" onkeyup="if(event.key==='Enter')searchLeadsUI()">
      <button class="btn btn-secondary btn-sm" onclick="searchLeadsUI()">Search</button>
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
      <button class="btn btn-secondary btn-sm" onclick="exportLeads()">Export CSV</button>
      <button class="btn btn-secondary btn-sm" onclick="document.getElementById('csvImportFile').click()">Import CSV</button>
      <input type="file" id="csvImportFile" accept=".csv" style="display:none" onchange="importLeadsCSV(this)">
    </div>
    <div id="leadsTable"><div class="empty-state">Loading...</div></div>
    <div id="leadsPagination" style="display:flex;gap:8px;margin-top:12px;justify-content:center"></div>
  </div>

  <div class="card">
    <h2><span class="icon">&#128222;</span> Scheduled Callbacks
      <button class="btn btn-secondary btn-sm" style="margin-left:auto" onclick="loadCallbacks()">Refresh</button>
      <button class="btn btn-primary btn-sm" style="margin-left:8px" onclick="showScheduleCallbackForm()">Schedule New</button>
    </h2>
    <div id="callbackScheduleForm" style="display:none;margin-bottom:16px;padding:12px;background:var(--surface2);border-radius:var(--radius)">
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr auto;gap:8px;align-items:end">
        <div><label style="font-size:11px">Phone</label><input type="text" id="cbPhone" placeholder="+1..."></div>
        <div><label style="font-size:11px">Name</label><input type="text" id="cbName" placeholder="Lead name"></div>
        <div><label style="font-size:11px">Date/Time</label><input type="datetime-local" id="cbDateTime"></div>
        <button class="btn btn-primary btn-sm" onclick="scheduleNewCallback()">Schedule</button>
      </div>
      <div style="margin-top:8px"><label style="font-size:11px">Reason</label><input type="text" id="cbReason" placeholder="Optional reason"></div>
    </div>
    <div id="callbacksList"><div class="empty-state">Loading...</div></div>
  </div>
</div>

<!-- SMS TAB -->
<div class="tab-content" id="tab-sms">
  <div class="card">
    <h2><span class="icon">&#128172;</span> Send SMS</h2>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px">
      <div><label>Phone</label><input type="text" id="smsPhone" placeholder="+1..."></div>
      <div><label>Template</label>
        <select id="smsTemplate" onchange="loadSmsTemplate()">
          <option value="">-- Custom Message --</option>
        </select>
      </div>
    </div>
    <div><label>Message</label><textarea id="smsBody" placeholder="Type your message..." style="min-height:80px"></textarea></div>
    <div style="margin-top:8px"><button class="btn btn-primary" onclick="sendSmsUI()">Send SMS</button></div>
  </div>

  <div class="card">
    <h2><span class="icon">&#128196;</span> SMS Templates <button class="btn btn-secondary btn-sm" style="margin-left:auto" onclick="loadSmsTemplates()">Refresh</button></h2>
    <div id="smsTemplatesList"><div class="empty-state">Loading...</div></div>
  </div>

  <div class="card">
    <h2><span class="icon">&#128203;</span> SMS Log <button class="btn btn-secondary btn-sm" style="margin-left:auto" onclick="loadSmsLog()">Refresh</button></h2>
    <div id="smsLogTable"><div class="empty-state">Loading...</div></div>
  </div>

  <div class="card">
    <h2><span class="icon">&#128200;</span> SMS Stats</h2>
    <div id="smsStats" class="stat-grid"></div>
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
      <div style="font-size:11px;color:var(--text2);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:8px;font-weight:500">Female Voices</div>
      <div class="voice-grid" id="dsVoiceGrid">
        <div class="voice-card ds-vc" data-dsvoice="EXAVITQu4vr4xnSDxMaL" onclick="selectDsVoice('EXAVITQu4vr4xnSDxMaL')">
          <button class="vc-play" onclick="event.stopPropagation();previewElVoice('EXAVITQu4vr4xnSDxMaL',this)" title="Preview">&#9654;</button>
          <div class="vc-name">Sarah</div><div class="vc-desc">Mature, reassuring, confident</div>
          <span class="vc-tag sales">Sales</span><span class="vc-check">&#10003;</span>
        </div>
        <div class="voice-card ds-vc" data-dsvoice="cgSgspJ2msm6clMCkdW9" onclick="selectDsVoice('cgSgspJ2msm6clMCkdW9')">
          <button class="vc-play" onclick="event.stopPropagation();previewElVoice('cgSgspJ2msm6clMCkdW9',this)" title="Preview">&#9654;</button>
          <div class="vc-name">Jessica</div><div class="vc-desc">Playful, bright, warm</div>
          <span class="vc-tag sales">Sales</span><span class="vc-check">&#10003;</span>
        </div>
        <div class="voice-card ds-vc" data-dsvoice="hpp4J3VqNfWAUOO0d1Us" onclick="selectDsVoice('hpp4J3VqNfWAUOO0d1Us')">
          <button class="vc-play" onclick="event.stopPropagation();previewElVoice('hpp4J3VqNfWAUOO0d1Us',this)" title="Preview">&#9654;</button>
          <div class="vc-name">Bella</div><div class="vc-desc">Professional, bright, warm</div>
          <span class="vc-tag sales">Sales</span><span class="vc-check">&#10003;</span>
        </div>
        <div class="voice-card ds-vc" data-dsvoice="FGY2WhTYpPnrIDTdsKH5" onclick="selectDsVoice('FGY2WhTYpPnrIDTdsKH5')">
          <button class="vc-play" onclick="event.stopPropagation();previewElVoice('FGY2WhTYpPnrIDTdsKH5',this)" title="Preview">&#9654;</button>
          <div class="vc-name">Laura</div><div class="vc-desc">Enthusiastic, quirky, sunny</div>
          <span class="vc-tag neutral">Versatile</span><span class="vc-check">&#10003;</span>
        </div>
        <div class="voice-card ds-vc" data-dsvoice="XrExE9yKIg1WjnnlVkGX" onclick="selectDsVoice('XrExE9yKIg1WjnnlVkGX')">
          <button class="vc-play" onclick="event.stopPropagation();previewElVoice('XrExE9yKIg1WjnnlVkGX',this)" title="Preview">&#9654;</button>
          <div class="vc-name">Matilda</div><div class="vc-desc">Knowledgeable, professional</div>
          <span class="vc-tag sales">Sales</span><span class="vc-check">&#10003;</span>
        </div>
      </div>
      <div style="font-size:11px;color:var(--text2);text-transform:uppercase;letter-spacing:0.5px;margin:16px 0 8px;font-weight:500">Male Voices</div>
      <div class="voice-grid">
        <div class="voice-card ds-vc" data-dsvoice="cjVigY5qzO86Huf0OWal" onclick="selectDsVoice('cjVigY5qzO86Huf0OWal')">
          <button class="vc-play" onclick="event.stopPropagation();previewElVoice('cjVigY5qzO86Huf0OWal',this)" title="Preview">&#9654;</button>
          <div class="vc-name">Eric</div><div class="vc-desc">Smooth, trustworthy</div>
          <span class="vc-tag sales">Sales</span><span class="vc-check">&#10003;</span>
        </div>
        <div class="voice-card ds-vc" data-dsvoice="iP95p4xoKVk53GoZ742B" onclick="selectDsVoice('iP95p4xoKVk53GoZ742B')">
          <button class="vc-play" onclick="event.stopPropagation();previewElVoice('iP95p4xoKVk53GoZ742B',this)" title="Preview">&#9654;</button>
          <div class="vc-name">Chris</div><div class="vc-desc">Charming, down-to-earth</div>
          <span class="vc-tag sales">Sales</span><span class="vc-check">&#10003;</span>
        </div>
        <div class="voice-card ds-vc" data-dsvoice="CwhRBWXzGAHq8TQ4Fs17" onclick="selectDsVoice('CwhRBWXzGAHq8TQ4Fs17')">
          <button class="vc-play" onclick="event.stopPropagation();previewElVoice('CwhRBWXzGAHq8TQ4Fs17',this)" title="Preview">&#9654;</button>
          <div class="vc-name">Roger</div><div class="vc-desc">Laid-back, casual, resonant</div>
          <span class="vc-tag sales">Sales</span><span class="vc-check">&#10003;</span>
        </div>
        <div class="voice-card ds-vc" data-dsvoice="bIHbv24MWmeRgasZH58o" onclick="selectDsVoice('bIHbv24MWmeRgasZH58o')">
          <button class="vc-play" onclick="event.stopPropagation();previewElVoice('bIHbv24MWmeRgasZH58o',this)" title="Preview">&#9654;</button>
          <div class="vc-name">Will</div><div class="vc-desc">Relaxed, optimistic, chill</div>
          <span class="vc-tag sales">Sales</span><span class="vc-check">&#10003;</span>
        </div>
        <div class="voice-card ds-vc" data-dsvoice="nPczCjzI2devNBz1zQrb" onclick="selectDsVoice('nPczCjzI2devNBz1zQrb')">
          <button class="vc-play" onclick="event.stopPropagation();previewElVoice('nPczCjzI2devNBz1zQrb',this)" title="Preview">&#9654;</button>
          <div class="vc-name">Brian</div><div class="vc-desc">Deep, resonant, comforting</div>
          <span class="vc-tag sales">Sales</span><span class="vc-check">&#10003;</span>
        </div>
        <div class="voice-card ds-vc" data-dsvoice="TX3LPaxmHKxFdv7VOQHJ" onclick="selectDsVoice('TX3LPaxmHKxFdv7VOQHJ')">
          <button class="vc-play" onclick="event.stopPropagation();previewElVoice('TX3LPaxmHKxFdv7VOQHJ',this)" title="Preview">&#9654;</button>
          <div class="vc-name">Liam</div><div class="vc-desc">Energetic, warm, youthful</div>
          <span class="vc-tag neutral">Versatile</span><span class="vc-check">&#10003;</span>
        </div>
        <div class="voice-card ds-vc" data-dsvoice="pNInz6obpgDQGcFmaJgB" onclick="selectDsVoice('pNInz6obpgDQGcFmaJgB')">
          <button class="vc-play" onclick="event.stopPropagation();previewElVoice('pNInz6obpgDQGcFmaJgB',this)" title="Preview">&#9654;</button>
          <div class="vc-name">Adam</div><div class="vc-desc">Dominant, firm, confident</div>
          <span class="vc-tag neutral">Versatile</span><span class="vc-check">&#10003;</span>
        </div>
        <div class="voice-card ds-vc" data-dsvoice="pqHfZKP75CvOlQylNhV4" onclick="selectDsVoice('pqHfZKP75CvOlQylNhV4')">
          <button class="vc-play" onclick="event.stopPropagation();previewElVoice('pqHfZKP75CvOlQylNhV4',this)" title="Preview">&#9654;</button>
          <div class="vc-name">Bill</div><div class="vc-desc">Wise, mature, balanced</div>
          <span class="vc-tag sales">Sales</span><span class="vc-check">&#10003;</span>
        </div>
        <div class="voice-card ds-vc" data-dsvoice="N2lVS1w4EtoT3dr4eOWO" onclick="selectDsVoice('N2lVS1w4EtoT3dr4eOWO')">
          <button class="vc-play" onclick="event.stopPropagation();previewElVoice('N2lVS1w4EtoT3dr4eOWO',this)" title="Preview">&#9654;</button>
          <div class="vc-name">Callum</div><div class="vc-desc">Husky, gravelly, edgy</div>
          <span class="vc-tag neutral">Versatile</span><span class="vc-check">&#10003;</span>
        </div>
        <div class="voice-card ds-vc" data-dsvoice="SOYHLrjzK2X1ezoPC6cr" onclick="selectDsVoice('SOYHLrjzK2X1ezoPC6cr')">
          <button class="vc-play" onclick="event.stopPropagation();previewElVoice('SOYHLrjzK2X1ezoPC6cr',this)" title="Preview">&#9654;</button>
          <div class="vc-name">Harry</div><div class="vc-desc">Fierce, animated, youthful</div>
          <span class="vc-tag neutral">Versatile</span><span class="vc-check">&#10003;</span>
        </div>
      </div>
      <div style="font-size:11px;color:var(--text2);text-transform:uppercase;letter-spacing:0.5px;margin:16px 0 8px;font-weight:500">Neutral Voices</div>
      <div class="voice-grid">
        <div class="voice-card ds-vc" data-dsvoice="SAz9YHcvj6GT2YYXdXww" onclick="selectDsVoice('SAz9YHcvj6GT2YYXdXww')">
          <button class="vc-play" onclick="event.stopPropagation();previewElVoice('SAz9YHcvj6GT2YYXdXww',this)" title="Preview">&#9654;</button>
          <div class="vc-name">River</div><div class="vc-desc">Relaxed, neutral, calm</div>
          <span class="vc-tag sales">Sales</span><span class="vc-check">&#10003;</span>
        </div>
      </div>
      <div style="font-size:11px;color:var(--text2);text-transform:uppercase;letter-spacing:0.5px;margin:16px 0 8px;font-weight:500">Southern Voices</div>
      <div class="voice-grid">
        <div class="voice-card ds-vc" data-dsvoice="S2fYVrVpl5QYHVJ1LkgT" onclick="selectDsVoice('S2fYVrVpl5QYHVJ1LkgT')">
          <button class="vc-play" onclick="event.stopPropagation();previewElVoice('S2fYVrVpl5QYHVJ1LkgT',this)" title="Preview">&#9654;</button>
          <div class="vc-name">Daisy Mae</div><div class="vc-desc">Southern drawl, charming</div>
          <span class="vc-tag neutral">Southern</span><span class="vc-check">&#10003;</span>
        </div>
        <div class="voice-card ds-vc" data-dsvoice="WXOyQFCgL1KW7Rv9Fln0" onclick="selectDsVoice('WXOyQFCgL1KW7Rv9Fln0')">
          <button class="vc-play" onclick="event.stopPropagation();previewElVoice('WXOyQFCgL1KW7Rv9Fln0',this)" title="Preview">&#9654;</button>
          <div class="vc-name">Outbound Caller</div><div class="vc-desc">Clear, slight southern</div>
          <span class="vc-tag sales">Southern</span><span class="vc-check">&#10003;</span>
        </div>
        <div class="voice-card ds-vc" data-dsvoice="c4TutCiAuWP4vwb1xebb" onclick="selectDsVoice('c4TutCiAuWP4vwb1xebb')">
          <button class="vc-play" onclick="event.stopPropagation();previewElVoice('c4TutCiAuWP4vwb1xebb',this)" title="Preview">&#9654;</button>
          <div class="vc-name">Annie-Beth</div><div class="vc-desc">Sweet, southern belle</div>
          <span class="vc-tag neutral">Southern</span><span class="vc-check">&#10003;</span>
        </div>
        <div class="voice-card ds-vc" data-dsvoice="8kvxG72xUMYnIFhZYwWj" onclick="selectDsVoice('8kvxG72xUMYnIFhZYwWj')">
          <button class="vc-play" onclick="event.stopPropagation();previewElVoice('8kvxG72xUMYnIFhZYwWj',this)" title="Preview">&#9654;</button>
          <div class="vc-name">Billy Bob</div><div class="vc-desc">Passionate, warm</div>
          <span class="vc-tag neutral">Southern</span><span class="vc-check">&#10003;</span>
        </div>
        <div class="voice-card ds-vc" data-dsvoice="Bj9UqZbhQsanLzgalpEG" onclick="selectDsVoice('Bj9UqZbhQsanLzgalpEG')">
          <button class="vc-play" onclick="event.stopPropagation();previewElVoice('Bj9UqZbhQsanLzgalpEG',this)" title="Preview">&#9654;</button>
          <div class="vc-name">Austin</div><div class="vc-desc">Deep, gravelly, Texas</div>
          <span class="vc-tag neutral">Southern</span><span class="vc-check">&#10003;</span>
        </div>
        <div class="voice-card ds-vc" data-dsvoice="DwEFbvGTcJhAk9eY9m0f" onclick="selectDsVoice('DwEFbvGTcJhAk9eY9m0f')">
          <button class="vc-play" onclick="event.stopPropagation();previewElVoice('DwEFbvGTcJhAk9eY9m0f',this)" title="Preview">&#9654;</button>
          <div class="vc-name">Southern Mike</div><div class="vc-desc">Deep, smooth southern</div>
          <span class="vc-tag sales">Southern</span><span class="vc-check">&#10003;</span>
        </div>
      </div>
      <div style="font-size:11px;color:var(--text2);text-transform:uppercase;letter-spacing:0.5px;margin:16px 0 8px;font-weight:500">Your Library &ndash; Female</div>
      <div class="voice-grid">
        <div class="voice-card ds-vc" data-dsvoice="56AoDkrOh6qfVPDXZ7Pt" onclick="selectDsVoice('56AoDkrOh6qfVPDXZ7Pt')">
          <button class="vc-play" onclick="event.stopPropagation();previewElVoice('56AoDkrOh6qfVPDXZ7Pt',this)" title="Preview">&#9654;</button>
          <div class="vc-name">Cassidy</div><div class="vc-desc">Warm, professional</div>
          <span class="vc-tag sales">Pro</span><span class="vc-check">&#10003;</span>
        </div>
        <div class="voice-card ds-vc" data-dsvoice="5l5f8iK3YPeGga21rQIX" onclick="selectDsVoice('5l5f8iK3YPeGga21rQIX')">
          <button class="vc-play" onclick="event.stopPropagation();previewElVoice('5l5f8iK3YPeGga21rQIX',this)" title="Preview">&#9654;</button>
          <div class="vc-name">Adeline</div><div class="vc-desc">Friendly, engaging</div>
          <span class="vc-tag sales">Pro</span><span class="vc-check">&#10003;</span>
        </div>
        <div class="voice-card ds-vc" data-dsvoice="5u41aNhyCU6hXOykdSKco" onclick="selectDsVoice('5u41aNhyCU6hXOykdSKco')">
          <button class="vc-play" onclick="event.stopPropagation();previewElVoice('5u41aNhyCU6hXOykdSKco',this)" title="Preview">&#9654;</button>
          <div class="vc-name">Carol</div><div class="vc-desc">Mature, wise, warm</div>
          <span class="vc-tag neutral">Pro</span><span class="vc-check">&#10003;</span>
        </div>
        <div class="voice-card ds-vc" data-dsvoice="PoHUWWWMHFrA8z7Q88pu" onclick="selectDsVoice('PoHUWWWMHFrA8z7Q88pu')">
          <button class="vc-play" onclick="event.stopPropagation();previewElVoice('PoHUWWWMHFrA8z7Q88pu',this)" title="Preview">&#9654;</button>
          <div class="vc-name">Miranda</div><div class="vc-desc">Young, dynamic, clear</div>
          <span class="vc-tag sales">Pro</span><span class="vc-check">&#10003;</span>
        </div>
        <div class="voice-card ds-vc" data-dsvoice="uYXf8XasLslADfZ2MB4u" onclick="selectDsVoice('uYXf8XasLslADfZ2MB4u')">
          <button class="vc-play" onclick="event.stopPropagation();previewElVoice('uYXf8XasLslADfZ2MB4u',this)" title="Preview">&#9654;</button>
          <div class="vc-name">Hope</div><div class="vc-desc">Bright, young, upbeat</div>
          <span class="vc-tag sales">Pro</span><span class="vc-check">&#10003;</span>
        </div>
        <div class="voice-card ds-vc" data-dsvoice="oWjuL7HSoaEJRMDMP3HD" onclick="selectDsVoice('oWjuL7HSoaEJRMDMP3HD')">
          <button class="vc-play" onclick="event.stopPropagation();previewElVoice('oWjuL7HSoaEJRMDMP3HD',this)" title="Preview">&#9654;</button>
          <div class="vc-name">Lina</div><div class="vc-desc">Dominican accent, warm</div>
          <span class="vc-tag neutral">Pro</span><span class="vc-check">&#10003;</span>
        </div>
      </div>
      <div style="font-size:11px;color:var(--text2);text-transform:uppercase;letter-spacing:0.5px;margin:16px 0 8px;font-weight:500">Your Library &ndash; Male</div>
      <div class="voice-grid">
        <div class="voice-card ds-vc" data-dsvoice="1SM7GgM6IMuvQlz2BwM3" onclick="selectDsVoice('1SM7GgM6IMuvQlz2BwM3')">
          <button class="vc-play" onclick="event.stopPropagation();previewElVoice('1SM7GgM6IMuvQlz2BwM3',this)" title="Preview">&#9654;</button>
          <div class="vc-name">Mark ConvoAI</div><div class="vc-desc">Conversational, natural</div>
          <span class="vc-tag sales">Pro</span><span class="vc-check">&#10003;</span>
        </div>
        <div class="voice-card ds-vc" data-dsvoice="1cvhXKE3uxgoijz9BMLU" onclick="selectDsVoice('1cvhXKE3uxgoijz9BMLU')">
          <button class="vc-play" onclick="event.stopPropagation();previewElVoice('1cvhXKE3uxgoijz9BMLU',this)" title="Preview">&#9654;</button>
          <div class="vc-name">Marcus Jackson</div><div class="vc-desc">Smooth, confident</div>
          <span class="vc-tag sales">Pro</span><span class="vc-check">&#10003;</span>
        </div>
        <div class="voice-card ds-vc" data-dsvoice="46Gz2MoWgXGvpJ9yRzmw" onclick="selectDsVoice('46Gz2MoWgXGvpJ9yRzmw')">
          <button class="vc-play" onclick="event.stopPropagation();previewElVoice('46Gz2MoWgXGvpJ9yRzmw',this)" title="Preview">&#9654;</button>
          <div class="vc-name">Leo</div><div class="vc-desc">Concierge, polished</div>
          <span class="vc-tag sales">Pro</span><span class="vc-check">&#10003;</span>
        </div>
        <div class="voice-card ds-vc" data-dsvoice="68RUZBDjLe2YBQvv8zFx" onclick="selectDsVoice('68RUZBDjLe2YBQvv8zFx')">
          <button class="vc-play" onclick="event.stopPropagation();previewElVoice('68RUZBDjLe2YBQvv8zFx',this)" title="Preview">&#9654;</button>
          <div class="vc-name">Kal Jones</div><div class="vc-desc">Steady, professional</div>
          <span class="vc-tag sales">Pro</span><span class="vc-check">&#10003;</span>
        </div>
        <div class="voice-card ds-vc" data-dsvoice="ChO6kqkVouUn0s7HMunx" onclick="selectDsVoice('ChO6kqkVouUn0s7HMunx')">
          <button class="vc-play" onclick="event.stopPropagation();previewElVoice('ChO6kqkVouUn0s7HMunx',this)" title="Preview">&#9654;</button>
          <div class="vc-name">Pete</div><div class="vc-desc">Direct, friendly</div>
          <span class="vc-tag neutral">Pro</span><span class="vc-check">&#10003;</span>
        </div>
        <div class="voice-card ds-vc" data-dsvoice="DTKMou8ccj1ZaWGBiotd" onclick="selectDsVoice('DTKMou8ccj1ZaWGBiotd')">
          <button class="vc-play" onclick="event.stopPropagation();previewElVoice('DTKMou8ccj1ZaWGBiotd',this)" title="Preview">&#9654;</button>
          <div class="vc-name">Jamahal</div><div class="vc-desc">Northeast, articulate</div>
          <span class="vc-tag neutral">Pro</span><span class="vc-check">&#10003;</span>
        </div>
        <div class="voice-card ds-vc" data-dsvoice="FYZl5JbWOAm6O1fPKAOu" onclick="selectDsVoice('FYZl5JbWOAm6O1fPKAOu')">
          <button class="vc-play" onclick="event.stopPropagation();previewElVoice('FYZl5JbWOAm6O1fPKAOu',this)" title="Preview">&#9654;</button>
          <div class="vc-name">Matt Schmitz</div><div class="vc-desc">Clear, authoritative</div>
          <span class="vc-tag sales">Pro</span><span class="vc-check">&#10003;</span>
        </div>
        <div class="voice-card ds-vc" data-dsvoice="HfjqMQ0GHcNkhBWnIhy3" onclick="selectDsVoice('HfjqMQ0GHcNkhBWnIhy3')">
          <button class="vc-play" onclick="event.stopPropagation();previewElVoice('HfjqMQ0GHcNkhBWnIhy3',this)" title="Preview">&#9654;</button>
          <div class="vc-name">Hayden</div><div class="vc-desc">Confident, warm</div>
          <span class="vc-tag sales">Pro</span><span class="vc-check">&#10003;</span>
        </div>
        <div class="voice-card ds-vc" data-dsvoice="UgBBYS2sOqTuMpoF3BR0" onclick="selectDsVoice('UgBBYS2sOqTuMpoF3BR0')">
          <button class="vc-play" onclick="event.stopPropagation();previewElVoice('UgBBYS2sOqTuMpoF3BR0',this)" title="Preview">&#9654;</button>
          <div class="vc-name">Mark Natural</div><div class="vc-desc">Young, natural, easy</div>
          <span class="vc-tag sales">Pro</span><span class="vc-check">&#10003;</span>
        </div>
        <div class="voice-card ds-vc" data-dsvoice="Ybqj6CIlqb6M85s9Bl4n" onclick="selectDsVoice('Ybqj6CIlqb6M85s9Bl4n')">
          <button class="vc-play" onclick="event.stopPropagation();previewElVoice('Ybqj6CIlqb6M85s9Bl4n',this)" title="Preview">&#9654;</button>
          <div class="vc-name">Jamal</div><div class="vc-desc">Strong, engaging</div>
          <span class="vc-tag sales">Pro</span><span class="vc-check">&#10003;</span>
        </div>
        <div class="voice-card ds-vc" data-dsvoice="Z9hrfEHGU3dykHntWvIY" onclick="selectDsVoice('Z9hrfEHGU3dykHntWvIY')">
          <button class="vc-play" onclick="event.stopPropagation();previewElVoice('Z9hrfEHGU3dykHntWvIY',this)" title="Preview">&#9654;</button>
          <div class="vc-name">David Ashby</div><div class="vc-desc">Authoritative, deep</div>
          <span class="vc-tag sales">Pro</span><span class="vc-check">&#10003;</span>
        </div>
        <div class="voice-card ds-vc" data-dsvoice="c6SfcYrb2t09NHXiT80T" onclick="selectDsVoice('c6SfcYrb2t09NHXiT80T')">
          <button class="vc-play" onclick="event.stopPropagation();previewElVoice('c6SfcYrb2t09NHXiT80T',this)" title="Preview">&#9654;</button>
          <div class="vc-name">Jarnathan</div><div class="vc-desc">Unique, distinctive</div>
          <span class="vc-tag neutral">Pro</span><span class="vc-check">&#10003;</span>
        </div>
        <div class="voice-card ds-vc" data-dsvoice="f5HLTX707KIM4SzJYzSz" onclick="selectDsVoice('f5HLTX707KIM4SzJYzSz')">
          <button class="vc-play" onclick="event.stopPropagation();previewElVoice('f5HLTX707KIM4SzJYzSz',this)" title="Preview">&#9654;</button>
          <div class="vc-name">Hey Its Brad</div><div class="vc-desc">Young, casual, chill</div>
          <span class="vc-tag neutral">Pro</span><span class="vc-check">&#10003;</span>
        </div>
        <div class="voice-card ds-vc" data-dsvoice="gOkFV1JMCt0G0n9xmBwV" onclick="selectDsVoice('gOkFV1JMCt0G0n9xmBwV')">
          <button class="vc-play" onclick="event.stopPropagation();previewElVoice('gOkFV1JMCt0G0n9xmBwV',this)" title="Preview">&#9654;</button>
          <div class="vc-name">W. L. Oxley</div><div class="vc-desc">Mature, distinguished</div>
          <span class="vc-tag sales">Pro</span><span class="vc-check">&#10003;</span>
        </div>
        <div class="voice-card ds-vc" data-dsvoice="gfRt6Z3Z8aTbpLfexQ7N" onclick="selectDsVoice('gfRt6Z3Z8aTbpLfexQ7N')">
          <button class="vc-play" onclick="event.stopPropagation();previewElVoice('gfRt6Z3Z8aTbpLfexQ7N',this)" title="Preview">&#9654;</button>
          <div class="vc-name">Boyd</div><div class="vc-desc">Grounded, reliable</div>
          <span class="vc-tag neutral">Pro</span><span class="vc-check">&#10003;</span>
        </div>
        <div class="voice-card ds-vc" data-dsvoice="rYW2LlWtM70M5vc3HBtm" onclick="selectDsVoice('rYW2LlWtM70M5vc3HBtm')">
          <button class="vc-play" onclick="event.stopPropagation();previewElVoice('rYW2LlWtM70M5vc3HBtm',this)" title="Preview">&#9654;</button>
          <div class="vc-name">Sam Chang</div><div class="vc-desc">Young, clear, crisp</div>
          <span class="vc-tag sales">Pro</span><span class="vc-check">&#10003;</span>
        </div>
        <div class="voice-card ds-vc" data-dsvoice="s3TPKV1kjDlVtZbl4Ksh" onclick="selectDsVoice('s3TPKV1kjDlVtZbl4Ksh')">
          <button class="vc-play" onclick="event.stopPropagation();previewElVoice('s3TPKV1kjDlVtZbl4Ksh',this)" title="Preview">&#9654;</button>
          <div class="vc-name">Adam Authentic</div><div class="vc-desc">Young, authentic</div>
          <span class="vc-tag sales">Pro</span><span class="vc-check">&#10003;</span>
        </div>
        <div class="voice-card ds-vc" data-dsvoice="pwMBn0SsmN1220Aorv15" onclick="selectDsVoice('pwMBn0SsmN1220Aorv15')">
          <button class="vc-play" onclick="event.stopPropagation();previewElVoice('pwMBn0SsmN1220Aorv15',this)" title="Preview">&#9654;</button>
          <div class="vc-name">Matt Hyper</div><div class="vc-desc">Hyper-conversational</div>
          <span class="vc-tag sales">Pro</span><span class="vc-check">&#10003;</span>
        </div>
        <div class="voice-card ds-vc" data-dsvoice="vBKc2FfBKJfcZNyEt1n6" onclick="selectDsVoice('vBKc2FfBKJfcZNyEt1n6')">
          <button class="vc-play" onclick="event.stopPropagation();previewElVoice('vBKc2FfBKJfcZNyEt1n6',this)" title="Preview">&#9654;</button>
          <div class="vc-name">Finn</div><div class="vc-desc">Young, energetic</div>
          <span class="vc-tag neutral">Pro</span><span class="vc-check">&#10003;</span>
        </div>
        <div class="voice-card ds-vc" data-dsvoice="yl2ZDV1MzN4HbQJbMihG" onclick="selectDsVoice('yl2ZDV1MzN4HbQJbMihG')">
          <button class="vc-play" onclick="event.stopPropagation();previewElVoice('yl2ZDV1MzN4HbQJbMihG',this)" title="Preview">&#9654;</button>
          <div class="vc-name">Alex</div><div class="vc-desc">Young, relatable</div>
          <span class="vc-tag neutral">Pro</span><span class="vc-check">&#10003;</span>
        </div>
        <div class="voice-card ds-vc" data-dsvoice="jn34bTlmmOgOJU9XfPuy" onclick="selectDsVoice('jn34bTlmmOgOJU9XfPuy')">
          <button class="vc-play" onclick="event.stopPropagation();previewElVoice('jn34bTlmmOgOJU9XfPuy',this)" title="Preview">&#9654;</button>
          <div class="vc-name">Steve</div><div class="vc-desc">Friendly, easygoing</div>
          <span class="vc-tag neutral">Pro</span><span class="vc-check">&#10003;</span>
        </div>
        <div class="voice-card ds-vc" data-dsvoice="kdVjFjOXaqExaDvXZECX" onclick="selectDsVoice('kdVjFjOXaqExaDvXZECX')">
          <button class="vc-play" onclick="event.stopPropagation();previewElVoice('kdVjFjOXaqExaDvXZECX',this)" title="Preview">&#9654;</button>
          <div class="vc-name">Burt</div><div class="vc-desc">Young, punchy</div>
          <span class="vc-tag neutral">Pro</span><span class="vc-check">&#10003;</span>
        </div>
        <div class="voice-card ds-vc" data-dsvoice="CVRACyqNcQefTlxMj9bt" onclick="selectDsVoice('CVRACyqNcQefTlxMj9bt')">
          <button class="vc-play" onclick="event.stopPropagation();previewElVoice('CVRACyqNcQefTlxMj9bt',this)" title="Preview">&#9654;</button>
          <div class="vc-name">Lamar Lincoln</div><div class="vc-desc">Young, dynamic</div>
          <span class="vc-tag sales">Pro</span><span class="vc-check">&#10003;</span>
        </div>
        <div class="voice-card ds-vc" data-dsvoice="r4iCyrmUEMCbsi7eGtf8" onclick="selectDsVoice('r4iCyrmUEMCbsi7eGtf8')">
          <button class="vc-play" onclick="event.stopPropagation();previewElVoice('r4iCyrmUEMCbsi7eGtf8',this)" title="Preview">&#9654;</button>
          <div class="vc-name">Voice of America</div><div class="vc-desc">Rich, broadcast</div>
          <span class="vc-tag sales">Pro</span><span class="vc-check">&#10003;</span>
        </div>
        <div class="voice-card ds-vc" data-dsvoice="rWyjfFeMZ6PxkHqD3wGC" onclick="selectDsVoice('rWyjfFeMZ6PxkHqD3wGC')">
          <button class="vc-play" onclick="event.stopPropagation();previewElVoice('rWyjfFeMZ6PxkHqD3wGC',this)" title="Preview">&#9654;</button>
          <div class="vc-name">Tyrese Tate</div><div class="vc-desc">Young, vibrant</div>
          <span class="vc-tag neutral">Pro</span><span class="vc-check">&#10003;</span>
        </div>
        <div class="voice-card ds-vc" data-dsvoice="Z7HhYXzYeRsQk3RnXqiG" onclick="selectDsVoice('Z7HhYXzYeRsQk3RnXqiG')">
          <button class="vc-play" onclick="event.stopPropagation();previewElVoice('Z7HhYXzYeRsQk3RnXqiG',this)" title="Preview">&#9654;</button>
          <div class="vc-name">Attank</div><div class="vc-desc">African accent, warm</div>
          <span class="vc-tag neutral">Pro</span><span class="vc-check">&#10003;</span>
        </div>
        <div class="voice-card ds-vc" data-dsvoice="1THll2MhJjluQYaSQxDr" onclick="selectDsVoice('1THll2MhJjluQYaSQxDr')">
          <button class="vc-play" onclick="event.stopPropagation();previewElVoice('1THll2MhJjluQYaSQxDr',this)" title="Preview">&#9654;</button>
          <div class="vc-name">Sanchez</div><div class="vc-desc">Spanish accent, warm</div>
          <span class="vc-tag neutral">Pro</span><span class="vc-check">&#10003;</span>
        </div>
        <div class="voice-card ds-vc" data-dsvoice="NFJlRMNv6b8kbunXwjHC" onclick="selectDsVoice('NFJlRMNv6b8kbunXwjHC')">
          <button class="vc-play" onclick="event.stopPropagation();previewElVoice('NFJlRMNv6b8kbunXwjHC',this)" title="Preview">&#9654;</button>
          <div class="vc-name">Luis Plata</div><div class="vc-desc">Colombian, friendly</div>
          <span class="vc-tag neutral">Pro</span><span class="vc-check">&#10003;</span>
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
            <input type="range" id="dsStability" min="0" max="1" step="0.05" value="0.62">
            <span class="range-val" id="dsStabilityVal">0.62</span>
          </div>
        </div>
        <div>
          <label>Similarity Boost (0.0 - 1.0)</label>
          <div class="range-wrap">
            <input type="range" id="dsSimilarityBoost" min="0" max="1" step="0.05" value="0.82">
            <span class="range-val" id="dsSimilarityBoostVal">0.82</span>
          </div>
        </div>
      </div>
    </div>

    <div id="elevenlabsVoiceSection" class="el-settings">
      <label>ElevenLabs Voice</label>
      <input type="hidden" id="elevenlabsVoiceId" value="">
      <div style="font-size:11px;color:var(--text2);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:8px;font-weight:500">Female Voices</div>
      <div class="voice-grid" id="elVoiceGrid">
        <div class="voice-card el-vc" data-elvoice="EXAVITQu4vr4xnSDxMaL" onclick="selectElVoice('EXAVITQu4vr4xnSDxMaL')">
          <button class="vc-play" onclick="event.stopPropagation();previewElVoice('EXAVITQu4vr4xnSDxMaL',this)" title="Preview">&#9654;</button>
          <div class="vc-name">Sarah</div><div class="vc-desc">Mature, reassuring, confident</div>
          <span class="vc-tag sales">Sales</span><span class="vc-check">&#10003;</span>
        </div>
        <div class="voice-card el-vc" data-elvoice="cgSgspJ2msm6clMCkdW9" onclick="selectElVoice('cgSgspJ2msm6clMCkdW9')">
          <button class="vc-play" onclick="event.stopPropagation();previewElVoice('cgSgspJ2msm6clMCkdW9',this)" title="Preview">&#9654;</button>
          <div class="vc-name">Jessica</div><div class="vc-desc">Playful, bright, warm</div>
          <span class="vc-tag sales">Sales</span><span class="vc-check">&#10003;</span>
        </div>
        <div class="voice-card el-vc" data-elvoice="hpp4J3VqNfWAUOO0d1Us" onclick="selectElVoice('hpp4J3VqNfWAUOO0d1Us')">
          <button class="vc-play" onclick="event.stopPropagation();previewElVoice('hpp4J3VqNfWAUOO0d1Us',this)" title="Preview">&#9654;</button>
          <div class="vc-name">Bella</div><div class="vc-desc">Professional, bright, warm</div>
          <span class="vc-tag sales">Sales</span><span class="vc-check">&#10003;</span>
        </div>
        <div class="voice-card el-vc" data-elvoice="FGY2WhTYpPnrIDTdsKH5" onclick="selectElVoice('FGY2WhTYpPnrIDTdsKH5')">
          <button class="vc-play" onclick="event.stopPropagation();previewElVoice('FGY2WhTYpPnrIDTdsKH5',this)" title="Preview">&#9654;</button>
          <div class="vc-name">Laura</div><div class="vc-desc">Enthusiastic, quirky, sunny</div>
          <span class="vc-tag neutral">Versatile</span><span class="vc-check">&#10003;</span>
        </div>
        <div class="voice-card el-vc" data-elvoice="XrExE9yKIg1WjnnlVkGX" onclick="selectElVoice('XrExE9yKIg1WjnnlVkGX')">
          <button class="vc-play" onclick="event.stopPropagation();previewElVoice('XrExE9yKIg1WjnnlVkGX',this)" title="Preview">&#9654;</button>
          <div class="vc-name">Matilda</div><div class="vc-desc">Knowledgeable, professional</div>
          <span class="vc-tag sales">Sales</span><span class="vc-check">&#10003;</span>
        </div>
      </div>
      <div style="font-size:11px;color:var(--text2);text-transform:uppercase;letter-spacing:0.5px;margin:16px 0 8px;font-weight:500">Male Voices</div>
      <div class="voice-grid">
        <div class="voice-card el-vc" data-elvoice="cjVigY5qzO86Huf0OWal" onclick="selectElVoice('cjVigY5qzO86Huf0OWal')">
          <button class="vc-play" onclick="event.stopPropagation();previewElVoice('cjVigY5qzO86Huf0OWal',this)" title="Preview">&#9654;</button>
          <div class="vc-name">Eric</div><div class="vc-desc">Smooth, trustworthy</div>
          <span class="vc-tag sales">Sales</span><span class="vc-check">&#10003;</span>
        </div>
        <div class="voice-card el-vc" data-elvoice="iP95p4xoKVk53GoZ742B" onclick="selectElVoice('iP95p4xoKVk53GoZ742B')">
          <button class="vc-play" onclick="event.stopPropagation();previewElVoice('iP95p4xoKVk53GoZ742B',this)" title="Preview">&#9654;</button>
          <div class="vc-name">Chris</div><div class="vc-desc">Charming, down-to-earth</div>
          <span class="vc-tag sales">Sales</span><span class="vc-check">&#10003;</span>
        </div>
        <div class="voice-card el-vc" data-elvoice="CwhRBWXzGAHq8TQ4Fs17" onclick="selectElVoice('CwhRBWXzGAHq8TQ4Fs17')">
          <button class="vc-play" onclick="event.stopPropagation();previewElVoice('CwhRBWXzGAHq8TQ4Fs17',this)" title="Preview">&#9654;</button>
          <div class="vc-name">Roger</div><div class="vc-desc">Laid-back, casual, resonant</div>
          <span class="vc-tag sales">Sales</span><span class="vc-check">&#10003;</span>
        </div>
        <div class="voice-card el-vc" data-elvoice="bIHbv24MWmeRgasZH58o" onclick="selectElVoice('bIHbv24MWmeRgasZH58o')">
          <button class="vc-play" onclick="event.stopPropagation();previewElVoice('bIHbv24MWmeRgasZH58o',this)" title="Preview">&#9654;</button>
          <div class="vc-name">Will</div><div class="vc-desc">Relaxed, optimistic, chill</div>
          <span class="vc-tag sales">Sales</span><span class="vc-check">&#10003;</span>
        </div>
        <div class="voice-card el-vc" data-elvoice="nPczCjzI2devNBz1zQrb" onclick="selectElVoice('nPczCjzI2devNBz1zQrb')">
          <button class="vc-play" onclick="event.stopPropagation();previewElVoice('nPczCjzI2devNBz1zQrb',this)" title="Preview">&#9654;</button>
          <div class="vc-name">Brian</div><div class="vc-desc">Deep, resonant, comforting</div>
          <span class="vc-tag sales">Sales</span><span class="vc-check">&#10003;</span>
        </div>
        <div class="voice-card el-vc" data-elvoice="TX3LPaxmHKxFdv7VOQHJ" onclick="selectElVoice('TX3LPaxmHKxFdv7VOQHJ')">
          <button class="vc-play" onclick="event.stopPropagation();previewElVoice('TX3LPaxmHKxFdv7VOQHJ',this)" title="Preview">&#9654;</button>
          <div class="vc-name">Liam</div><div class="vc-desc">Energetic, warm, youthful</div>
          <span class="vc-tag neutral">Versatile</span><span class="vc-check">&#10003;</span>
        </div>
        <div class="voice-card el-vc" data-elvoice="pNInz6obpgDQGcFmaJgB" onclick="selectElVoice('pNInz6obpgDQGcFmaJgB')">
          <button class="vc-play" onclick="event.stopPropagation();previewElVoice('pNInz6obpgDQGcFmaJgB',this)" title="Preview">&#9654;</button>
          <div class="vc-name">Adam</div><div class="vc-desc">Dominant, firm, confident</div>
          <span class="vc-tag neutral">Versatile</span><span class="vc-check">&#10003;</span>
        </div>
        <div class="voice-card el-vc" data-elvoice="pqHfZKP75CvOlQylNhV4" onclick="selectElVoice('pqHfZKP75CvOlQylNhV4')">
          <button class="vc-play" onclick="event.stopPropagation();previewElVoice('pqHfZKP75CvOlQylNhV4',this)" title="Preview">&#9654;</button>
          <div class="vc-name">Bill</div><div class="vc-desc">Wise, mature, balanced</div>
          <span class="vc-tag sales">Sales</span><span class="vc-check">&#10003;</span>
        </div>
        <div class="voice-card el-vc" data-elvoice="N2lVS1w4EtoT3dr4eOWO" onclick="selectElVoice('N2lVS1w4EtoT3dr4eOWO')">
          <button class="vc-play" onclick="event.stopPropagation();previewElVoice('N2lVS1w4EtoT3dr4eOWO',this)" title="Preview">&#9654;</button>
          <div class="vc-name">Callum</div><div class="vc-desc">Husky, gravelly, edgy</div>
          <span class="vc-tag neutral">Versatile</span><span class="vc-check">&#10003;</span>
        </div>
        <div class="voice-card el-vc" data-elvoice="SOYHLrjzK2X1ezoPC6cr" onclick="selectElVoice('SOYHLrjzK2X1ezoPC6cr')">
          <button class="vc-play" onclick="event.stopPropagation();previewElVoice('SOYHLrjzK2X1ezoPC6cr',this)" title="Preview">&#9654;</button>
          <div class="vc-name">Harry</div><div class="vc-desc">Fierce, animated, youthful</div>
          <span class="vc-tag neutral">Versatile</span><span class="vc-check">&#10003;</span>
        </div>
      </div>
      <div style="font-size:11px;color:var(--text2);text-transform:uppercase;letter-spacing:0.5px;margin:16px 0 8px;font-weight:500">Neutral Voices</div>
      <div class="voice-grid">
        <div class="voice-card el-vc" data-elvoice="SAz9YHcvj6GT2YYXdXww" onclick="selectElVoice('SAz9YHcvj6GT2YYXdXww')">
          <button class="vc-play" onclick="event.stopPropagation();previewElVoice('SAz9YHcvj6GT2YYXdXww',this)" title="Preview">&#9654;</button>
          <div class="vc-name">River</div><div class="vc-desc">Relaxed, neutral, calm</div>
          <span class="vc-tag sales">Sales</span><span class="vc-check">&#10003;</span>
        </div>
      </div>
      <div style="font-size:11px;color:var(--text2);text-transform:uppercase;letter-spacing:0.5px;margin:16px 0 8px;font-weight:500">Southern Voices</div>
      <div class="voice-grid">
        <div class="voice-card el-vc" data-elvoice="S2fYVrVpl5QYHVJ1LkgT" onclick="selectElVoice('S2fYVrVpl5QYHVJ1LkgT')">
          <button class="vc-play" onclick="event.stopPropagation();previewElVoice('S2fYVrVpl5QYHVJ1LkgT',this)" title="Preview">&#9654;</button>
          <div class="vc-name">Daisy Mae</div><div class="vc-desc">Southern drawl, charming</div>
          <span class="vc-tag neutral">Southern</span><span class="vc-check">&#10003;</span>
        </div>
        <div class="voice-card el-vc" data-elvoice="WXOyQFCgL1KW7Rv9Fln0" onclick="selectElVoice('WXOyQFCgL1KW7Rv9Fln0')">
          <button class="vc-play" onclick="event.stopPropagation();previewElVoice('WXOyQFCgL1KW7Rv9Fln0',this)" title="Preview">&#9654;</button>
          <div class="vc-name">Outbound Caller</div><div class="vc-desc">Clear, slight southern</div>
          <span class="vc-tag sales">Southern</span><span class="vc-check">&#10003;</span>
        </div>
        <div class="voice-card el-vc" data-elvoice="c4TutCiAuWP4vwb1xebb" onclick="selectElVoice('c4TutCiAuWP4vwb1xebb')">
          <button class="vc-play" onclick="event.stopPropagation();previewElVoice('c4TutCiAuWP4vwb1xebb',this)" title="Preview">&#9654;</button>
          <div class="vc-name">Annie-Beth</div><div class="vc-desc">Sweet, southern belle</div>
          <span class="vc-tag neutral">Southern</span><span class="vc-check">&#10003;</span>
        </div>
        <div class="voice-card el-vc" data-elvoice="8kvxG72xUMYnIFhZYwWj" onclick="selectElVoice('8kvxG72xUMYnIFhZYwWj')">
          <button class="vc-play" onclick="event.stopPropagation();previewElVoice('8kvxG72xUMYnIFhZYwWj',this)" title="Preview">&#9654;</button>
          <div class="vc-name">Billy Bob</div><div class="vc-desc">Passionate, warm</div>
          <span class="vc-tag neutral">Southern</span><span class="vc-check">&#10003;</span>
        </div>
        <div class="voice-card el-vc" data-elvoice="Bj9UqZbhQsanLzgalpEG" onclick="selectElVoice('Bj9UqZbhQsanLzgalpEG')">
          <button class="vc-play" onclick="event.stopPropagation();previewElVoice('Bj9UqZbhQsanLzgalpEG',this)" title="Preview">&#9654;</button>
          <div class="vc-name">Austin</div><div class="vc-desc">Deep, gravelly, Texas</div>
          <span class="vc-tag neutral">Southern</span><span class="vc-check">&#10003;</span>
        </div>
        <div class="voice-card el-vc" data-elvoice="DwEFbvGTcJhAk9eY9m0f" onclick="selectElVoice('DwEFbvGTcJhAk9eY9m0f')">
          <button class="vc-play" onclick="event.stopPropagation();previewElVoice('DwEFbvGTcJhAk9eY9m0f',this)" title="Preview">&#9654;</button>
          <div class="vc-name">Southern Mike</div><div class="vc-desc">Deep, smooth southern</div>
          <span class="vc-tag sales">Southern</span><span class="vc-check">&#10003;</span>
        </div>
      </div>
      <div style="font-size:11px;color:var(--text2);text-transform:uppercase;letter-spacing:0.5px;margin:16px 0 8px;font-weight:500">Your Library &ndash; Female</div>
      <div class="voice-grid">
        <div class="voice-card el-vc" data-elvoice="56AoDkrOh6qfVPDXZ7Pt" onclick="selectElVoice('56AoDkrOh6qfVPDXZ7Pt')">
          <button class="vc-play" onclick="event.stopPropagation();previewElVoice('56AoDkrOh6qfVPDXZ7Pt',this)" title="Preview">&#9654;</button>
          <div class="vc-name">Cassidy</div><div class="vc-desc">Warm, professional</div>
          <span class="vc-tag sales">Pro</span><span class="vc-check">&#10003;</span>
        </div>
        <div class="voice-card el-vc" data-elvoice="5l5f8iK3YPeGga21rQIX" onclick="selectElVoice('5l5f8iK3YPeGga21rQIX')">
          <button class="vc-play" onclick="event.stopPropagation();previewElVoice('5l5f8iK3YPeGga21rQIX',this)" title="Preview">&#9654;</button>
          <div class="vc-name">Adeline</div><div class="vc-desc">Friendly, engaging</div>
          <span class="vc-tag sales">Pro</span><span class="vc-check">&#10003;</span>
        </div>
        <div class="voice-card el-vc" data-elvoice="5u41aNhyCU6hXOykdSKco" onclick="selectElVoice('5u41aNhyCU6hXOykdSKco')">
          <button class="vc-play" onclick="event.stopPropagation();previewElVoice('5u41aNhyCU6hXOykdSKco',this)" title="Preview">&#9654;</button>
          <div class="vc-name">Carol</div><div class="vc-desc">Mature, wise, warm</div>
          <span class="vc-tag neutral">Pro</span><span class="vc-check">&#10003;</span>
        </div>
        <div class="voice-card el-vc" data-elvoice="PoHUWWWMHFrA8z7Q88pu" onclick="selectElVoice('PoHUWWWMHFrA8z7Q88pu')">
          <button class="vc-play" onclick="event.stopPropagation();previewElVoice('PoHUWWWMHFrA8z7Q88pu',this)" title="Preview">&#9654;</button>
          <div class="vc-name">Miranda</div><div class="vc-desc">Young, dynamic, clear</div>
          <span class="vc-tag sales">Pro</span><span class="vc-check">&#10003;</span>
        </div>
        <div class="voice-card el-vc" data-elvoice="uYXf8XasLslADfZ2MB4u" onclick="selectElVoice('uYXf8XasLslADfZ2MB4u')">
          <button class="vc-play" onclick="event.stopPropagation();previewElVoice('uYXf8XasLslADfZ2MB4u',this)" title="Preview">&#9654;</button>
          <div class="vc-name">Hope</div><div class="vc-desc">Bright, young, upbeat</div>
          <span class="vc-tag sales">Pro</span><span class="vc-check">&#10003;</span>
        </div>
        <div class="voice-card el-vc" data-elvoice="oWjuL7HSoaEJRMDMP3HD" onclick="selectElVoice('oWjuL7HSoaEJRMDMP3HD')">
          <button class="vc-play" onclick="event.stopPropagation();previewElVoice('oWjuL7HSoaEJRMDMP3HD',this)" title="Preview">&#9654;</button>
          <div class="vc-name">Lina</div><div class="vc-desc">Dominican accent, warm</div>
          <span class="vc-tag neutral">Pro</span><span class="vc-check">&#10003;</span>
        </div>
      </div>
      <div style="font-size:11px;color:var(--text2);text-transform:uppercase;letter-spacing:0.5px;margin:16px 0 8px;font-weight:500">Your Library &ndash; Male</div>
      <div class="voice-grid">
        <div class="voice-card el-vc" data-elvoice="1SM7GgM6IMuvQlz2BwM3" onclick="selectElVoice('1SM7GgM6IMuvQlz2BwM3')">
          <button class="vc-play" onclick="event.stopPropagation();previewElVoice('1SM7GgM6IMuvQlz2BwM3',this)" title="Preview">&#9654;</button>
          <div class="vc-name">Mark ConvoAI</div><div class="vc-desc">Conversational, natural</div>
          <span class="vc-tag sales">Pro</span><span class="vc-check">&#10003;</span>
        </div>
        <div class="voice-card el-vc" data-elvoice="1cvhXKE3uxgoijz9BMLU" onclick="selectElVoice('1cvhXKE3uxgoijz9BMLU')">
          <button class="vc-play" onclick="event.stopPropagation();previewElVoice('1cvhXKE3uxgoijz9BMLU',this)" title="Preview">&#9654;</button>
          <div class="vc-name">Marcus Jackson</div><div class="vc-desc">Smooth, confident</div>
          <span class="vc-tag sales">Pro</span><span class="vc-check">&#10003;</span>
        </div>
        <div class="voice-card el-vc" data-elvoice="46Gz2MoWgXGvpJ9yRzmw" onclick="selectElVoice('46Gz2MoWgXGvpJ9yRzmw')">
          <button class="vc-play" onclick="event.stopPropagation();previewElVoice('46Gz2MoWgXGvpJ9yRzmw',this)" title="Preview">&#9654;</button>
          <div class="vc-name">Leo</div><div class="vc-desc">Concierge, polished</div>
          <span class="vc-tag sales">Pro</span><span class="vc-check">&#10003;</span>
        </div>
        <div class="voice-card el-vc" data-elvoice="68RUZBDjLe2YBQvv8zFx" onclick="selectElVoice('68RUZBDjLe2YBQvv8zFx')">
          <button class="vc-play" onclick="event.stopPropagation();previewElVoice('68RUZBDjLe2YBQvv8zFx',this)" title="Preview">&#9654;</button>
          <div class="vc-name">Kal Jones</div><div class="vc-desc">Steady, professional</div>
          <span class="vc-tag sales">Pro</span><span class="vc-check">&#10003;</span>
        </div>
        <div class="voice-card el-vc" data-elvoice="ChO6kqkVouUn0s7HMunx" onclick="selectElVoice('ChO6kqkVouUn0s7HMunx')">
          <button class="vc-play" onclick="event.stopPropagation();previewElVoice('ChO6kqkVouUn0s7HMunx',this)" title="Preview">&#9654;</button>
          <div class="vc-name">Pete</div><div class="vc-desc">Direct, friendly</div>
          <span class="vc-tag neutral">Pro</span><span class="vc-check">&#10003;</span>
        </div>
        <div class="voice-card el-vc" data-elvoice="DTKMou8ccj1ZaWGBiotd" onclick="selectElVoice('DTKMou8ccj1ZaWGBiotd')">
          <button class="vc-play" onclick="event.stopPropagation();previewElVoice('DTKMou8ccj1ZaWGBiotd',this)" title="Preview">&#9654;</button>
          <div class="vc-name">Jamahal</div><div class="vc-desc">Northeast, articulate</div>
          <span class="vc-tag neutral">Pro</span><span class="vc-check">&#10003;</span>
        </div>
        <div class="voice-card el-vc" data-elvoice="FYZl5JbWOAm6O1fPKAOu" onclick="selectElVoice('FYZl5JbWOAm6O1fPKAOu')">
          <button class="vc-play" onclick="event.stopPropagation();previewElVoice('FYZl5JbWOAm6O1fPKAOu',this)" title="Preview">&#9654;</button>
          <div class="vc-name">Matt Schmitz</div><div class="vc-desc">Clear, authoritative</div>
          <span class="vc-tag sales">Pro</span><span class="vc-check">&#10003;</span>
        </div>
        <div class="voice-card el-vc" data-elvoice="HfjqMQ0GHcNkhBWnIhy3" onclick="selectElVoice('HfjqMQ0GHcNkhBWnIhy3')">
          <button class="vc-play" onclick="event.stopPropagation();previewElVoice('HfjqMQ0GHcNkhBWnIhy3',this)" title="Preview">&#9654;</button>
          <div class="vc-name">Hayden</div><div class="vc-desc">Confident, warm</div>
          <span class="vc-tag sales">Pro</span><span class="vc-check">&#10003;</span>
        </div>
        <div class="voice-card el-vc" data-elvoice="UgBBYS2sOqTuMpoF3BR0" onclick="selectElVoice('UgBBYS2sOqTuMpoF3BR0')">
          <button class="vc-play" onclick="event.stopPropagation();previewElVoice('UgBBYS2sOqTuMpoF3BR0',this)" title="Preview">&#9654;</button>
          <div class="vc-name">Mark Natural</div><div class="vc-desc">Young, natural, easy</div>
          <span class="vc-tag sales">Pro</span><span class="vc-check">&#10003;</span>
        </div>
        <div class="voice-card el-vc" data-elvoice="Ybqj6CIlqb6M85s9Bl4n" onclick="selectElVoice('Ybqj6CIlqb6M85s9Bl4n')">
          <button class="vc-play" onclick="event.stopPropagation();previewElVoice('Ybqj6CIlqb6M85s9Bl4n',this)" title="Preview">&#9654;</button>
          <div class="vc-name">Jamal</div><div class="vc-desc">Strong, engaging</div>
          <span class="vc-tag sales">Pro</span><span class="vc-check">&#10003;</span>
        </div>
        <div class="voice-card el-vc" data-elvoice="Z9hrfEHGU3dykHntWvIY" onclick="selectElVoice('Z9hrfEHGU3dykHntWvIY')">
          <button class="vc-play" onclick="event.stopPropagation();previewElVoice('Z9hrfEHGU3dykHntWvIY',this)" title="Preview">&#9654;</button>
          <div class="vc-name">David Ashby</div><div class="vc-desc">Authoritative, deep</div>
          <span class="vc-tag sales">Pro</span><span class="vc-check">&#10003;</span>
        </div>
        <div class="voice-card el-vc" data-elvoice="c6SfcYrb2t09NHXiT80T" onclick="selectElVoice('c6SfcYrb2t09NHXiT80T')">
          <button class="vc-play" onclick="event.stopPropagation();previewElVoice('c6SfcYrb2t09NHXiT80T',this)" title="Preview">&#9654;</button>
          <div class="vc-name">Jarnathan</div><div class="vc-desc">Unique, distinctive</div>
          <span class="vc-tag neutral">Pro</span><span class="vc-check">&#10003;</span>
        </div>
        <div class="voice-card el-vc" data-elvoice="f5HLTX707KIM4SzJYzSz" onclick="selectElVoice('f5HLTX707KIM4SzJYzSz')">
          <button class="vc-play" onclick="event.stopPropagation();previewElVoice('f5HLTX707KIM4SzJYzSz',this)" title="Preview">&#9654;</button>
          <div class="vc-name">Hey Its Brad</div><div class="vc-desc">Young, casual, chill</div>
          <span class="vc-tag neutral">Pro</span><span class="vc-check">&#10003;</span>
        </div>
        <div class="voice-card el-vc" data-elvoice="gOkFV1JMCt0G0n9xmBwV" onclick="selectElVoice('gOkFV1JMCt0G0n9xmBwV')">
          <button class="vc-play" onclick="event.stopPropagation();previewElVoice('gOkFV1JMCt0G0n9xmBwV',this)" title="Preview">&#9654;</button>
          <div class="vc-name">W. L. Oxley</div><div class="vc-desc">Mature, distinguished</div>
          <span class="vc-tag sales">Pro</span><span class="vc-check">&#10003;</span>
        </div>
        <div class="voice-card el-vc" data-elvoice="gfRt6Z3Z8aTbpLfexQ7N" onclick="selectElVoice('gfRt6Z3Z8aTbpLfexQ7N')">
          <button class="vc-play" onclick="event.stopPropagation();previewElVoice('gfRt6Z3Z8aTbpLfexQ7N',this)" title="Preview">&#9654;</button>
          <div class="vc-name">Boyd</div><div class="vc-desc">Grounded, reliable</div>
          <span class="vc-tag neutral">Pro</span><span class="vc-check">&#10003;</span>
        </div>
        <div class="voice-card el-vc" data-elvoice="rYW2LlWtM70M5vc3HBtm" onclick="selectElVoice('rYW2LlWtM70M5vc3HBtm')">
          <button class="vc-play" onclick="event.stopPropagation();previewElVoice('rYW2LlWtM70M5vc3HBtm',this)" title="Preview">&#9654;</button>
          <div class="vc-name">Sam Chang</div><div class="vc-desc">Young, clear, crisp</div>
          <span class="vc-tag sales">Pro</span><span class="vc-check">&#10003;</span>
        </div>
        <div class="voice-card el-vc" data-elvoice="s3TPKV1kjDlVtZbl4Ksh" onclick="selectElVoice('s3TPKV1kjDlVtZbl4Ksh')">
          <button class="vc-play" onclick="event.stopPropagation();previewElVoice('s3TPKV1kjDlVtZbl4Ksh',this)" title="Preview">&#9654;</button>
          <div class="vc-name">Adam Authentic</div><div class="vc-desc">Young, authentic</div>
          <span class="vc-tag sales">Pro</span><span class="vc-check">&#10003;</span>
        </div>
        <div class="voice-card el-vc" data-elvoice="pwMBn0SsmN1220Aorv15" onclick="selectElVoice('pwMBn0SsmN1220Aorv15')">
          <button class="vc-play" onclick="event.stopPropagation();previewElVoice('pwMBn0SsmN1220Aorv15',this)" title="Preview">&#9654;</button>
          <div class="vc-name">Matt Hyper</div><div class="vc-desc">Hyper-conversational</div>
          <span class="vc-tag sales">Pro</span><span class="vc-check">&#10003;</span>
        </div>
        <div class="voice-card el-vc" data-elvoice="vBKc2FfBKJfcZNyEt1n6" onclick="selectElVoice('vBKc2FfBKJfcZNyEt1n6')">
          <button class="vc-play" onclick="event.stopPropagation();previewElVoice('vBKc2FfBKJfcZNyEt1n6',this)" title="Preview">&#9654;</button>
          <div class="vc-name">Finn</div><div class="vc-desc">Young, energetic</div>
          <span class="vc-tag neutral">Pro</span><span class="vc-check">&#10003;</span>
        </div>
        <div class="voice-card el-vc" data-elvoice="yl2ZDV1MzN4HbQJbMihG" onclick="selectElVoice('yl2ZDV1MzN4HbQJbMihG')">
          <button class="vc-play" onclick="event.stopPropagation();previewElVoice('yl2ZDV1MzN4HbQJbMihG',this)" title="Preview">&#9654;</button>
          <div class="vc-name">Alex</div><div class="vc-desc">Young, relatable</div>
          <span class="vc-tag neutral">Pro</span><span class="vc-check">&#10003;</span>
        </div>
        <div class="voice-card el-vc" data-elvoice="jn34bTlmmOgOJU9XfPuy" onclick="selectElVoice('jn34bTlmmOgOJU9XfPuy')">
          <button class="vc-play" onclick="event.stopPropagation();previewElVoice('jn34bTlmmOgOJU9XfPuy',this)" title="Preview">&#9654;</button>
          <div class="vc-name">Steve</div><div class="vc-desc">Friendly, easygoing</div>
          <span class="vc-tag neutral">Pro</span><span class="vc-check">&#10003;</span>
        </div>
        <div class="voice-card el-vc" data-elvoice="kdVjFjOXaqExaDvXZECX" onclick="selectElVoice('kdVjFjOXaqExaDvXZECX')">
          <button class="vc-play" onclick="event.stopPropagation();previewElVoice('kdVjFjOXaqExaDvXZECX',this)" title="Preview">&#9654;</button>
          <div class="vc-name">Burt</div><div class="vc-desc">Young, punchy</div>
          <span class="vc-tag neutral">Pro</span><span class="vc-check">&#10003;</span>
        </div>
        <div class="voice-card el-vc" data-elvoice="CVRACyqNcQefTlxMj9bt" onclick="selectElVoice('CVRACyqNcQefTlxMj9bt')">
          <button class="vc-play" onclick="event.stopPropagation();previewElVoice('CVRACyqNcQefTlxMj9bt',this)" title="Preview">&#9654;</button>
          <div class="vc-name">Lamar Lincoln</div><div class="vc-desc">Young, dynamic</div>
          <span class="vc-tag sales">Pro</span><span class="vc-check">&#10003;</span>
        </div>
        <div class="voice-card el-vc" data-elvoice="r4iCyrmUEMCbsi7eGtf8" onclick="selectElVoice('r4iCyrmUEMCbsi7eGtf8')">
          <button class="vc-play" onclick="event.stopPropagation();previewElVoice('r4iCyrmUEMCbsi7eGtf8',this)" title="Preview">&#9654;</button>
          <div class="vc-name">Voice of America</div><div class="vc-desc">Rich, broadcast</div>
          <span class="vc-tag sales">Pro</span><span class="vc-check">&#10003;</span>
        </div>
        <div class="voice-card el-vc" data-elvoice="rWyjfFeMZ6PxkHqD3wGC" onclick="selectElVoice('rWyjfFeMZ6PxkHqD3wGC')">
          <button class="vc-play" onclick="event.stopPropagation();previewElVoice('rWyjfFeMZ6PxkHqD3wGC',this)" title="Preview">&#9654;</button>
          <div class="vc-name">Tyrese Tate</div><div class="vc-desc">Young, vibrant</div>
          <span class="vc-tag neutral">Pro</span><span class="vc-check">&#10003;</span>
        </div>
        <div class="voice-card el-vc" data-elvoice="Z7HhYXzYeRsQk3RnXqiG" onclick="selectElVoice('Z7HhYXzYeRsQk3RnXqiG')">
          <button class="vc-play" onclick="event.stopPropagation();previewElVoice('Z7HhYXzYeRsQk3RnXqiG',this)" title="Preview">&#9654;</button>
          <div class="vc-name">Attank</div><div class="vc-desc">African accent, warm</div>
          <span class="vc-tag neutral">Pro</span><span class="vc-check">&#10003;</span>
        </div>
        <div class="voice-card el-vc" data-elvoice="1THll2MhJjluQYaSQxDr" onclick="selectElVoice('1THll2MhJjluQYaSQxDr')">
          <button class="vc-play" onclick="event.stopPropagation();previewElVoice('1THll2MhJjluQYaSQxDr',this)" title="Preview">&#9654;</button>
          <div class="vc-name">Sanchez</div><div class="vc-desc">Spanish accent, warm</div>
          <span class="vc-tag neutral">Pro</span><span class="vc-check">&#10003;</span>
        </div>
        <div class="voice-card el-vc" data-elvoice="NFJlRMNv6b8kbunXwjHC" onclick="selectElVoice('NFJlRMNv6b8kbunXwjHC')">
          <button class="vc-play" onclick="event.stopPropagation();previewElVoice('NFJlRMNv6b8kbunXwjHC',this)" title="Preview">&#9654;</button>
          <div class="vc-name">Luis Plata</div><div class="vc-desc">Colombian, friendly</div>
          <span class="vc-tag neutral">Pro</span><span class="vc-check">&#10003;</span>
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
            <input type="range" id="elevenlabsStability" min="0" max="1" step="0.05" value="0.62">
            <span class="range-val" id="elevenlabsStabilityVal">0.62</span>
          </div>
        </div>
        <div>
          <label>Similarity Boost (0.0 - 1.0)</label>
          <div class="range-wrap">
            <input type="range" id="elevenlabsSimilarityBoost" min="0" max="1" step="0.05" value="0.82">
            <span class="range-val" id="elevenlabsSimilarityBoostVal">0.82</span>
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
          <option value="gpt-realtime">gpt-realtime</option>
          <option value="gpt-realtime-mini">gpt-realtime-mini</option>
        </select>
      </div>
      <div>
        <label>Temperature</label>
        <div class="range-wrap">
          <input type="range" id="temperature" min="0" max="1" step="0.05" value="0.8">
          <span class="range-val" id="temperatureVal">0.80</span>
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
          <input type="range" id="vadThreshold" min="0.3" max="1.0" step="0.05" value="0.9">
          <span class="range-val" id="vadThresholdVal">0.90</span>
        </div>
      </div>
      <div>
        <label>Silence Duration (ms)</label>
        <input type="number" id="silenceDurationMs" value="950" min="200" max="2000" step="50">
      </div>
      <div>
        <label>Prefix Padding (ms)</label>
        <input type="number" id="prefixPaddingMs" value="300" min="100" max="1000" step="50">
      </div>
      <div>
        <label>Barge-in Debounce (ms)</label>
        <input type="number" id="bargeInDebounceMs" value="350" min="50" max="1000" step="25">
      </div>
      <div>
        <label>Echo Suppression (ms)</label>
        <input type="number" id="echoSuppressionMs" value="200" min="0" max="500" step="25">
      </div>
      <div>
        <label>Max Response Tokens</label>
        <input type="number" id="maxResponseTokens" value="275" min="30" max="500" step="10">
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
    <textarea id="systemPromptOverride" placeholder="Leave empty for default prompt..." oninput="updatePromptCounter()"></textarea>
    <div id="promptCounter" style="font-size:11px;color:var(--text2);margin-top:4px;margin-bottom:8px"></div>
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

  <!-- Audio & Call Settings -->
  <div class="card">
    <h2><span class="icon">&#127925;</span> Audio &amp; Call Settings</h2>
    <div class="grid">
      <div>
        <label>Background Noise</label>
        <div style="display:flex;align-items:center;gap:10px">
          <input type="checkbox" id="backgroundNoiseEnabled" style="width:auto">
          <span style="font-size:13px;color:var(--text2)">Mix office ambiance into calls</span>
        </div>
      </div>
      <div>
        <label>Noise Volume</label>
        <div class="range-wrap">
          <input type="range" id="backgroundNoiseVolume" min="0.01" max="0.30" step="0.01" value="0.12">
          <span class="range-val" id="backgroundNoiseVolumeVal">0.12</span>
        </div>
      </div>
      <div>
        <label>Voicemail Detection (AMD)</label>
        <div style="display:flex;align-items:center;gap:10px">
          <input type="checkbox" id="amdEnabled" style="width:auto">
          <span style="font-size:13px;color:var(--text2)">Detect answering machines</span>
        </div>
      </div>
      <div>
        <label>AMD Action</label>
        <select id="amdAction" style="width:auto">
          <option value="hangup">Hang Up (save cost)</option>
          <option value="leave_message">Leave Voicemail</option>
        </select>
      </div>
      <div>
        <label>Max Call Duration (sec)</label>
        <input type="number" id="maxCallDurationSec" value="180" min="0" max="3600" step="30">
        <span style="font-size:11px;color:var(--text2)">0 = unlimited (default: 180 = 3 min)</span>
      </div>
      <div>
        <label>Duration Warn %</label>
        <input type="number" id="callDurationWarnPct" value="80" min="0" max="100" step="5">
      </div>
      <div>
        <label>Silence Timeout (sec)</label>
        <input type="number" id="silenceTimeoutSec" value="30" min="0" max="120" step="5">
        <span style="font-size:11px;color:var(--text2)">0 = disabled. Disconnect after dead air (default: 30)</span>
      </div>
    </div>
  </div>

  <!-- SMS Settings -->
  <div class="card">
    <h2><span class="icon">&#128172;</span> SMS Settings</h2>
    <div class="grid">
      <div>
        <label>SMS Enabled</label>
        <div style="display:flex;align-items:center;gap:10px">
          <input type="checkbox" id="smsEnabled" style="width:auto">
          <span style="font-size:13px;color:var(--text2)">Enable SMS features</span>
        </div>
      </div>
      <div>
        <label>Auto-SMS Triggers</label>
        <div style="display:flex;flex-direction:column;gap:6px">
          <label style="font-size:12px;display:flex;align-items:center;gap:6px"><input type="checkbox" id="autoSmsOnMissedCall" style="width:auto"> On missed call</label>
          <label style="font-size:12px;display:flex;align-items:center;gap:6px"><input type="checkbox" id="autoSmsOnCallback" style="width:auto"> On callback scheduled</label>
          <label style="font-size:12px;display:flex;align-items:center;gap:6px"><input type="checkbox" id="autoSmsOnTransfer" style="width:auto"> After transfer</label>
          <label style="font-size:12px;display:flex;align-items:center;gap:6px"><input type="checkbox" id="autoSmsOnTextRequest" style="width:auto"> On "text me instead"</label>
        </div>
      </div>
    </div>
  </div>

  <!-- Compliance & Retry Settings -->
  <div class="card">
    <h2><span class="icon">&#128737;</span> Compliance &amp; Retry</h2>
    <div class="grid">
      <div>
        <label>TCPA Override</label>
        <div style="display:flex;align-items:center;gap:10px">
          <input type="checkbox" id="tcpaOverride" style="width:auto">
          <span style="font-size:13px;color:var(--text2)">Bypass time-of-day restrictions</span>
        </div>
      </div>
      <div>
        <label>Auto-DNC on Verbal Request</label>
        <div style="display:flex;align-items:center;gap:10px">
          <input type="checkbox" id="autoDncEnabled" style="width:auto" checked>
          <span style="font-size:13px;color:var(--text2)">Auto-add to DNC when caller says "stop calling"</span>
        </div>
      </div>
      <div>
        <label>Max Calls/Phone/Day</label>
        <input type="number" id="maxCallsPerPhonePerDay" value="3" min="0" max="20">
        <span style="font-size:11px;color:var(--text2)">0 = unlimited</span>
      </div>
      <div>
        <label>Auto-Retry Failed Calls</label>
        <div style="display:flex;align-items:center;gap:10px">
          <input type="checkbox" id="autoRetryEnabled" style="width:auto">
          <span style="font-size:13px;color:var(--text2)">Retry no-answer calls</span>
        </div>
      </div>
      <div>
        <label>Max Retry Attempts</label>
        <input type="number" id="autoRetryMaxAttempts" value="3" min="1" max="10">
      </div>
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
</div><!-- /main-wrapper -->

<div class="toast" id="toast"></div>

<script>
// ── Sidebar Toggle ──
var sidebarEl = document.getElementById('sidebar');
var overlayEl = document.getElementById('sidebarOverlay');
var toggleEl = document.getElementById('menuToggle');
var sidebarToggling = false;
toggleEl.addEventListener('click', function(e) {
  e.stopPropagation();
  if (sidebarToggling) return;
  sidebarToggling = true;
  var isOpen = sidebarEl.classList.contains('open');
  if (isOpen) { sidebarEl.classList.remove('open'); overlayEl.classList.remove('show'); }
  else { sidebarEl.classList.add('open'); overlayEl.classList.add('show'); }
  setTimeout(function() { sidebarToggling = false; }, 300);
});
overlayEl.addEventListener('click', function() { sidebarEl.classList.remove('open'); overlayEl.classList.remove('show'); });

// ── Tab/Page titles ──
var TAB_TITLES = { campaigns:'Campaigns', calls:'Calls', recordings:'Recordings', analytics:'Analytics', monitoring:'Monitoring', compliance:'Compliance', leads:'Leads', sms:'SMS', settings:'Settings' };

// ── Tabs ──
function switchTab(name) {
  document.querySelectorAll('.tab-content').forEach(function(el) { el.classList.remove('active'); });
  document.querySelectorAll('.sidebar .nav-item').forEach(function(el) { el.classList.remove('active'); });
  var tab = document.getElementById('tab-' + name);
  if (tab) tab.classList.add('active');
  document.querySelectorAll('.sidebar .nav-item').forEach(function(btn) {
    if (btn.getAttribute('onclick') && btn.getAttribute('onclick').indexOf("'" + name + "'") > -1) btn.classList.add('active');
  });
  // Update page title in topbar
  var titleEl = document.getElementById('pageTitle');
  if (titleEl && TAB_TITLES[name]) titleEl.textContent = TAB_TITLES[name];
  // Close mobile sidebar
  sidebarEl.classList.remove('open');
  overlayEl.classList.remove('show');
  // Load tab data
  if (name === 'campaigns') { loadCampaignConfig(currentCampaignId); loadCampaignStats(); }
  if (name === 'recordings') loadRecordings();
  if (name === 'analytics') loadAnalytics();
  if (name === 'monitoring') loadMonitoring();
  if (name === 'compliance') { loadDnc(); loadAuditLog(); }
  if (name === 'leads') { loadLeads(); loadCallbacks(); }
  if (name === 'sms') { loadSmsLog(); loadSmsTemplates(); loadSmsStats(); }
}

// ── Settings ──
var SETTINGS_FIELDS = [
  'voiceProvider','voice','realtimeModel','temperature','vadThreshold','silenceDurationMs',
  'prefixPaddingMs','bargeInDebounceMs','echoSuppressionMs','maxResponseTokens',
  'agentName','companyName','systemPromptOverride','inboundPromptOverride','allstateNumber','nonAllstateNumber',
  'elevenlabsVoiceId','elevenlabsModelId','elevenlabsStability','elevenlabsSimilarityBoost',
  'deepseekModel','backgroundNoiseVolume','amdAction','maxCallDurationSec','callDurationWarnPct','silenceTimeoutSec',
  'maxCallsPerPhonePerDay','autoRetryMaxAttempts'
];
var CHECKBOX_FIELDS = [
  'backgroundNoiseEnabled','amdEnabled','smsEnabled','autoSmsOnMissedCall',
  'autoSmsOnCallback','autoSmsOnTransfer','autoSmsOnTextRequest','tcpaOverride',
  'autoDncEnabled','autoRetryEnabled'
];
var NUMBER_FIELDS = [
  'temperature','vadThreshold','silenceDurationMs','prefixPaddingMs',
  'bargeInDebounceMs','echoSuppressionMs','maxResponseTokens',
  'elevenlabsStability','elevenlabsSimilarityBoost','backgroundNoiseVolume',
  'maxCallDurationSec','callDurationWarnPct','silenceTimeoutSec','maxCallsPerPhonePerDay','autoRetryMaxAttempts'
];
var MODEL_VOICES = {
  'gpt-realtime': ['alloy','ash','ballad','coral','echo','sage','shimmer','verse','marin','cedar'],
  'gpt-realtime-mini': ['alloy','ash','ballad','coral','echo','sage','shimmer','verse','marin','cedar'],
};
var ALL_VOICES = ['alloy','ash','ballad','coral','echo','sage','shimmer','verse','marin','cedar'];

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
function formatPhone(phone) {
  if (!phone) return '--';
  var digits = String(phone).replace(/\\D/g, '');
  if (digits.length === 10) return '+1' + digits;
  if (digits.length === 11 && digits[0] === '1') return '+' + digits;
  if (String(phone).indexOf('+') === 0) return phone;
  return '+1' + digits;
}
function resolveVoiceName(voice) {
  if (!voice) return '--';
  // Check EL_VOICES lookup (defined later, but available at call time)
  if (typeof EL_VOICES !== 'undefined' && EL_VOICES[voice]) return EL_VOICES[voice];
  // Check for deepseek+el: prefix
  if (voice.indexOf('deepseek+el:') === 0) {
    var elId = voice.substring(12);
    if (typeof EL_VOICES !== 'undefined' && EL_VOICES[elId]) return EL_VOICES[elId] + ' (DeepSeek)';
  }
  return voice;
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
    // Load checkbox fields
    for (var ci = 0; ci < CHECKBOX_FIELDS.length; ci++) {
      var cbEl = document.getElementById(CHECKBOX_FIELDS[ci]);
      if (cbEl) cbEl.checked = !!s[CHECKBOX_FIELDS[ci]];
    }
    updatePromptCounter();
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
    // Save checkbox fields
    for (var ci2 = 0; ci2 < CHECKBOX_FIELDS.length; ci2++) {
      var cbEl2 = document.getElementById(CHECKBOX_FIELDS[ci2]);
      if (cbEl2) body[CHECKBOX_FIELDS[ci2]] = cbEl2.checked;
    }
    // Validation
    var vad = parseFloat(body.vadThreshold);
    if (vad < 0 || vad > 1) { toast('VAD threshold must be 0-1', 'error'); return; }
    if (body.backgroundNoiseVolume < 0 || body.backgroundNoiseVolume > 0.5) { toast('Noise volume must be 0-0.5', 'error'); return; }
    if (body.maxCallDurationSec < 0) { toast('Max duration cannot be negative', 'error'); return; }
    if (body.callDurationWarnPct < 0 || body.callDurationWarnPct > 100) { toast('Warn % must be 0-100', 'error'); return; }
    if (body.maxCallsPerPhonePerDay < 0) { toast('Rate limit cannot be negative', 'error'); return; }
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
  var campaignId = document.getElementById('callCampaign').value;
  if (!to) { toast('Enter a phone number', 'error'); return; }
  var btn = document.getElementById('callBtn');
  btn.disabled = true; btn.textContent = 'Calling...';
  try {
    var res = await fetch('/call/start', {
      method: 'POST', headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ to: to, from: from || undefined, lead: { first_name: name, state: state }, campaign_id: campaignId }),
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

function updatePromptCounter() {
  var text = document.getElementById('systemPromptOverride').value;
  var chars = text.length;
  var words = text.trim() ? text.trim().split(/\\s+/).length : 0;
  document.getElementById('promptCounter').textContent = chars + ' characters / ' + words + ' words';
}
async function loadDefaultPrompt() {
  try { var res = await fetch('/api/default-prompt'); var d = await res.json(); document.getElementById('systemPromptOverride').value = d.prompt; updatePromptCounter(); toast('Loaded', 'success'); }
  catch (e) { toast('Failed', 'error'); }
}
function clearPrompt() { if (!confirm('Clear the entire system prompt? This cannot be undone.')) return; document.getElementById('systemPromptOverride').value = ''; updatePromptCounter(); toast('Cleared', 'success'); }

function copyWebhookUrl() {
  var url = document.getElementById('inboundWebhookUrl').value;
  var btn = event && event.target ? event.target : null;
  function onCopied() {
    toast('Copied to clipboard!', 'success');
    if (btn) { var orig = btn.textContent; btn.textContent = 'Copied!'; setTimeout(function() { btn.textContent = orig; }, 2000); }
  }
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(url).then(onCopied).catch(function() {
      // Fallback for non-HTTPS contexts
      var ta = document.createElement('textarea'); ta.value = url; ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); onCopied(); } catch (e) { toast('Copy failed', 'error'); }
      document.body.removeChild(ta);
    });
  } else {
    var ta = document.createElement('textarea'); ta.value = url; ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); onCopied(); } catch (e) { toast('Copy failed', 'error'); }
    document.body.removeChild(ta);
  }
}

async function loadCallHistory() {
  try {
    var res = await fetch('/api/calls');
    var calls = await res.json();
    var recRes = await fetch('/api/recordings');
    var recData = await recRes.json();
    var recs = recData.recordings || [];
    var recMap = {};
    for (var r = 0; r < recs.length; r++) { recMap[recs[r].callSid] = recs[r]; }
    var el = document.getElementById('callHistory');
    if (!calls.length) { el.innerHTML = '<div class="empty-state">No calls yet</div>'; return; }
    var totalCost = 0;
    var html = '<table class="data-table"><tr><th>Time</th><th>To</th><th>Lead</th><th>Provider</th><th>Voice</th><th>Agent</th><th>Duration</th><th>Est. Cost</th></tr>';
    for (var i = 0; i < calls.length; i++) {
      var c = calls[i]; var t = new Date(c.timestamp).toLocaleString(); var s = c.settings;
      var rec = recMap[c.callSid];
      var dur = rec ? rec.durationSec : 0;
      var durStr = dur ? dur + 's' : '--';
      var cost = dur ? (dur / 60) * 0.014 : 0;
      totalCost += cost;
      var costStr = cost > 0 ? '$' + cost.toFixed(3) : '--';
      html += '<tr><td style="font-size:11px">' + t + '</td><td style="font-family:monospace;font-size:11px">' + formatPhone(c.to) + '</td><td>' + c.leadName + '</td>'
        + '<td>' + (s.voiceProvider || 'openai') + '</td><td style="color:var(--accent)">' + resolveVoiceName(s.voice) + '</td><td>' + s.agentName + '</td>'
        + '<td>' + durStr + '</td><td style="color:#4ade80">' + costStr + '</td></tr>';
    }
    html += '</table>';
    if (totalCost > 0) html += '<div style="margin-top:8px;font-size:12px;color:var(--text2)">Twilio telecom cost: <span style="color:#4ade80;font-weight:600">$' + totalCost.toFixed(3) + '</span></div>';
    el.innerHTML = html;
  } catch (e) { document.getElementById('callHistory').innerHTML = '<span class="err">Failed</span>'; }
}

// ── Recordings ──
async function loadRecordings() {
  try {
    var res = await fetch('/api/recordings/enriched');
    var data = await res.json();
    var el = document.getElementById('recordingsTable');
    var recordings = data.recordings || [];
    if (!recordings.length) { el.innerHTML = '<div class="empty-state">No recordings yet.<br><span style="font-size:12px;color:var(--text2)">Ensure RECORDING_ENABLED=true in your settings and the Twilio recording-status webhook is configured at: <code>' + location.origin + '/twilio/recording-status</code></span></div>'; return; }
    var totalCost = 0;
    var html = '<table class="data-table"><tr><th>Time</th><th>Phone</th><th>Lead</th><th>Disposition</th><th>Duration</th><th>Source</th><th>Est. Cost</th><th>Play</th></tr>';
    for (var i = 0; i < recordings.length; i++) {
      var r = recordings[i];
      var t = new Date(r.timestamp).toLocaleString();
      var dur = r.durationSec + 's';
      var cost = (r.durationSec / 60) * 0.014;
      totalCost += cost;
      var costStr = '$' + cost.toFixed(3);
      var playUrl = r.callSid ? '/api/recordings/' + r.callSid + '/audio' : '';
      var db = r.disposition === 'transferred' ? 'badge-green' : r.disposition === 'not_interested' ? 'badge-red' : 'badge-gray';
      html += '<tr>'
        + '<td style="font-size:11px">' + t + '</td>'
        + '<td style="font-family:monospace;font-size:11px">' + formatPhone(r.phone) + '</td>'
        + '<td>' + (r.leadName || '--') + '</td>'
        + '<td><span class="badge ' + db + '">' + (r.disposition || '--') + '</span></td>'
        + '<td>' + dur + '</td>'
        + '<td>' + r.source + '</td>'
        + '<td style="color:#4ade80">' + costStr + '</td>'
        + '<td>' + (playUrl ? '<audio controls preload="none" style="height:30px;max-width:200px"><source src="' + playUrl + '" type="audio/mpeg"></audio>' : '--') + '</td>'
        + '</tr>';
    }
    html += '</table>';
    html += '<div style="margin-top:8px;font-size:12px;color:var(--text2)">Total Twilio cost: <span style="color:#4ade80;font-weight:600">$' + totalCost.toFixed(3) + '</span> (' + recordings.length + ' recordings)</div>';
    el.innerHTML = html;
  } catch (e) { document.getElementById('recordingsTable').innerHTML = '<span class="err">Failed to load recordings</span>'; }
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

var EL_VOICES = {'EXAVITQu4vr4xnSDxMaL':'Sarah','cgSgspJ2msm6clMCkdW9':'Jessica','hpp4J3VqNfWAUOO0d1Us':'Bella','FGY2WhTYpPnrIDTdsKH5':'Laura','XrExE9yKIg1WjnnlVkGX':'Matilda','cjVigY5qzO86Huf0OWal':'Eric','iP95p4xoKVk53GoZ742B':'Chris','CwhRBWXzGAHq8TQ4Fs17':'Roger','bIHbv24MWmeRgasZH58o':'Will','nPczCjzI2devNBz1zQrb':'Brian','TX3LPaxmHKxFdv7VOQHJ':'Liam','pNInz6obpgDQGcFmaJgB':'Adam','pqHfZKP75CvOlQylNhV4':'Bill','N2lVS1w4EtoT3dr4eOWO':'Callum','SOYHLrjzK2X1ezoPC6cr':'Harry','SAz9YHcvj6GT2YYXdXww':'River','S2fYVrVpl5QYHVJ1LkgT':'Daisy Mae','WXOyQFCgL1KW7Rv9Fln0':'Outbound Caller','c4TutCiAuWP4vwb1xebb':'Annie-Beth','8kvxG72xUMYnIFhZYwWj':'Billy Bob','Bj9UqZbhQsanLzgalpEG':'Austin','DwEFbvGTcJhAk9eY9m0f':'Southern Mike','56AoDkrOh6qfVPDXZ7Pt':'Cassidy','5l5f8iK3YPeGga21rQIX':'Adeline','5u41aNhyCU6hXOykdSKco':'Carol','PoHUWWWMHFrA8z7Q88pu':'Miranda','uYXf8XasLslADfZ2MB4u':'Hope','oWjuL7HSoaEJRMDMP3HD':'Lina','1SM7GgM6IMuvQlz2BwM3':'Mark ConvoAI','1cvhXKE3uxgoijz9BMLU':'Marcus Jackson','46Gz2MoWgXGvpJ9yRzmw':'Leo','68RUZBDjLe2YBQvv8zFx':'Kal Jones','ChO6kqkVouUn0s7HMunx':'Pete','DTKMou8ccj1ZaWGBiotd':'Jamahal','FYZl5JbWOAm6O1fPKAOu':'Matt Schmitz','HfjqMQ0GHcNkhBWnIhy3':'Hayden','UgBBYS2sOqTuMpoF3BR0':'Mark Natural','Ybqj6CIlqb6M85s9Bl4n':'Jamal','Z9hrfEHGU3dykHntWvIY':'David Ashby','c6SfcYrb2t09NHXiT80T':'Jarnathan','f5HLTX707KIM4SzJYzSz':'Hey Its Brad','gOkFV1JMCt0G0n9xmBwV':'W. L. Oxley','gfRt6Z3Z8aTbpLfexQ7N':'Boyd','rYW2LlWtM70M5vc3HBtm':'Sam Chang','s3TPKV1kjDlVtZbl4Ksh':'Adam Authentic','pwMBn0SsmN1220Aorv15':'Matt Hyper','vBKc2FfBKJfcZNyEt1n6':'Finn','yl2ZDV1MzN4HbQJbMihG':'Alex','jn34bTlmmOgOJU9XfPuy':'Steve','kdVjFjOXaqExaDvXZECX':'Burt','CVRACyqNcQefTlxMj9bt':'Lamar Lincoln','r4iCyrmUEMCbsi7eGtf8':'Voice of America','rWyjfFeMZ6PxkHqD3wGC':'Tyrese Tate','Z7HhYXzYeRsQk3RnXqiG':'Attank','1THll2MhJjluQYaSQxDr':'Sanchez','NFJlRMNv6b8kbunXwjHC':'Luis Plata'};

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
      + '<div class="stat-card orange"><div class="stat-value">$' + summary.totalCostUsd + '</div><div class="stat-label">Total Cost (AI + Telecom)</div></div>';
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
    // Update analytics badge with dropped call count
    var badgeEl = document.getElementById('analyticsBadge');
    var dropped = (summary.outcomes || {}).dropped || 0;
    if (dropped > 0) { badgeEl.textContent = dropped; badgeEl.style.display = ''; badgeEl.title = dropped + ' dropped call(s)'; }
    else { badgeEl.style.display = 'none'; }
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
      + '<div class="stat-card ' + sc + '"><div class="stat-value">' + health.utilization + '% <span class="badge badge-' + sc + '" style="font-size:10px;vertical-align:middle">' + health.status.toUpperCase() + '</span></div><div class="stat-label">Utilization</div></div>';
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
    if (isNaN(max) || max < 1) { toast('Must be at least 1', 'error'); return; }
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
  if (!phone) { toast('Enter a phone number', 'error'); return; }
  var digits = phone.replace(/\\D/g, '');
  if (digits.length < 10) { toast('Invalid phone number — must be at least 10 digits', 'error'); return; }
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
  if (!state) { toast('Enter a state code', 'error'); return; }
  var res = await fetch('/api/compliance/time-check?state=' + encodeURIComponent(state));
  var data = await res.json();
  var el = document.getElementById('tcpaResult');
  var warn = data.stateValid === false ? '<span class="badge badge-orange">INVALID STATE</span> ' : '';
  if (data.allowed) el.innerHTML = warn + '<span class="badge badge-green">ALLOWED</span> ' + data.localTime + ' (' + data.timezone + ')' + (data.reason ? ' <span style="font-size:11px;color:var(--orange)">' + data.reason + '</span>' : '');
  else el.innerHTML = warn + '<span class="badge badge-red">BLOCKED</span> ' + (data.reason || 'Outside window') + ' (' + data.timezone + ')';
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
var leadsCurrentPage = 1;
async function loadLeads(page) {
  leadsCurrentPage = page || 1;
  try {
    var disp = document.getElementById('leadFilter').value;
    var query = document.getElementById('leadSearch').value.trim();
    var url = '/api/leads/search?limit=20&page=' + leadsCurrentPage;
    if (disp) url += '&disposition=' + disp;
    if (query) url += '&q=' + encodeURIComponent(query);
    var res = await fetch(url);
    var data = await res.json();
    var leads = data.leads || [];
    var el = document.getElementById('leadsTable');
    if (!leads.length) { el.innerHTML = '<div class="empty-state">No leads found' + (data.total ? ' (' + data.total + ' total)' : '') + '.<br><span style="font-size:12px;color:var(--text2)">Leads are created from web form submissions, CSV imports, or the API.</span></div>'; document.getElementById('leadsPagination').innerHTML=''; return; }
    var html = '<table class="data-table"><tr><th>Phone</th><th>Name</th><th>State</th><th>Disposition</th><th>Score</th><th>Calls</th><th>Last Contact</th><th>Tags</th></tr>';
    for (var i = 0; i < leads.length; i++) {
      var l = leads[i];
      var db = l.disposition === 'transferred' ? 'badge-green' : (l.disposition === 'not_interested' || l.disposition === 'dnc') ? 'badge-red' : l.disposition === 'callback' ? 'badge-orange' : 'badge-gray';
      var tags = (l.tags||[]).slice(0,3).map(function(t){return '<span class="badge badge-blue">' + t + '</span>';}).join(' ');
      html += '<tr style="cursor:pointer" onclick="showLeadDetail(\\'' + l.phone + '\\')">'
        + '<td style="font-family:monospace">' + l.phone + '</td><td>' + l.name + '</td><td>' + (l.state||'--') + '</td>'
        + '<td><span class="badge ' + db + '">' + l.disposition + '</span></td>'
        + '<td style="color:var(--accent)">' + (l.score || '--') + '</td>'
        + '<td>' + l.totalCalls + '</td>'
        + '<td style="font-size:11px">' + (l.lastContactedAt ? new Date(l.lastContactedAt).toLocaleString() : '--') + '</td><td>' + (tags||'--') + '</td></tr>';
    }
    el.innerHTML = html + '</table><div style="margin-top:4px;font-size:12px;color:var(--text2)">' + data.total + ' total leads</div>';
    // Pagination
    var pagEl = document.getElementById('leadsPagination');
    if (data.pages > 1) {
      var ph = '';
      for (var p = 1; p <= data.pages; p++) {
        ph += '<button class="btn btn-sm ' + (p === data.page ? 'btn-primary' : 'btn-secondary') + '" onclick="loadLeads(' + p + ')">' + p + '</button>';
      }
      pagEl.innerHTML = ph;
    } else { pagEl.innerHTML = ''; }
  } catch (e) { document.getElementById('leadsTable').innerHTML = '<div class="empty-state">Failed</div>'; }
}
function searchLeadsUI() { loadLeads(1); }
async function showLeadDetail(phone) {
  try {
    var res = await fetch('/api/leads/' + encodeURIComponent(phone) + '/detail');
    if (!res.ok) { toast('Lead not found', 'error'); return; }
    var d = await res.json();
    var html = '<div style="position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(30,42,58,0.4);backdrop-filter:blur(4px);z-index:1000;display:flex;align-items:center;justify-content:center" onclick="if(event.target===this)this.remove()">';
    html += '<div style="background:var(--surface);border-radius:16px;padding:28px;max-width:700px;width:90%;max-height:85vh;overflow-y:auto;box-shadow:0 20px 60px rgba(0,0,0,0.15)">';
    html += '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px"><h2>' + d.name + '</h2><button class="btn btn-secondary btn-sm" onclick="this.closest(\\'div[style*=fixed]\\').remove()">Close</button></div>';
    html += '<div class="stat-grid" style="margin-bottom:16px">';
    html += '<div class="stat-card"><div class="stat-value">' + d.phone + '</div><div class="stat-label">Phone</div></div>';
    html += '<div class="stat-card"><div class="stat-value">' + (d.state||'--') + '</div><div class="stat-label">State</div></div>';
    html += '<div class="stat-card"><div class="stat-value">' + d.score + '</div><div class="stat-label">Score</div></div>';
    html += '<div class="stat-card"><div class="stat-value">' + d.disposition + '</div><div class="stat-label">Disposition</div></div>';
    html += '</div>';
    // Call History
    if (d.callHistory && d.callHistory.length) {
      html += '<h3 style="margin-bottom:8px">Call History (' + d.callHistory.length + ')</h3>';
      html += '<table class="data-table" style="margin-bottom:16px"><tr><th>Time</th><th>Duration</th><th>Outcome</th><th>Score</th><th>Recording</th></tr>';
      for (var i = 0; i < d.callHistory.length; i++) {
        var c = d.callHistory[i];
        var dur = c.durationMs ? Math.round(c.durationMs/1000) + 's' : '--';
        html += '<tr><td style="font-size:11px">' + new Date(c.timestamp).toLocaleString() + '</td><td>' + dur + '</td><td>' + c.outcome + '</td><td>' + (c.score||'--') + '</td>';
        html += '<td>' + (c.recording ? '<audio controls preload="none" style="height:28px;max-width:160px"><source src="' + c.recording.url + '" type="audio/mpeg"></audio>' : '--') + '</td></tr>';
      }
      html += '</table>';
    }
    // SMS History
    if (d.smsHistory && d.smsHistory.length) {
      html += '<h3 style="margin-bottom:8px">SMS History (' + d.smsHistory.length + ')</h3>';
      html += '<table class="data-table" style="margin-bottom:16px"><tr><th>Time</th><th>Dir</th><th>Message</th><th>Status</th></tr>';
      for (var j = 0; j < Math.min(d.smsHistory.length, 20); j++) {
        var s = d.smsHistory[j];
        var dirBadge = s.direction === 'inbound' ? 'badge-blue' : 'badge-green';
        html += '<tr><td style="font-size:11px">' + new Date(s.timestamp).toLocaleString() + '</td>';
        html += '<td><span class="badge ' + dirBadge + '">' + s.direction + '</span></td>';
        html += '<td style="font-size:12px;max-width:300px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + s.body + '</td>';
        html += '<td>' + s.status + '</td></tr>';
      }
      html += '</table>';
    }
    // Web Form Data (customFields from webhook)
    if (d.customFields && Object.keys(d.customFields).length > 0) {
      var cf = d.customFields;
      html += '<h3 style="margin-bottom:8px">Web Form Data</h3>';
      html += '<div style="background:var(--surface2);border-radius:8px;padding:12px;margin-bottom:16px;font-size:12px">';
      // Contact info
      if (cf.contact) {
        html += '<div style="margin-bottom:10px"><strong style="color:var(--accent)">Contact</strong><div class="stat-grid" style="margin-top:6px;grid-template-columns:repeat(auto-fill,minmax(140px,1fr))">';
        var contactFields = [['Name', (cf.contact.firstName||'') + ' ' + (cf.contact.lastName||'')], ['Email', cf.contact.email], ['State', cf.contact.state], ['City', cf.contact.city], ['Zip', cf.contact.zipCode], ['Address', cf.contact.address]];
        for (var ci = 0; ci < contactFields.length; ci++) { if (contactFields[ci][1]) html += '<div><span style="color:var(--text2)">' + contactFields[ci][0] + ':</span> ' + contactFields[ci][1] + '</div>'; }
        html += '</div></div>';
      }
      // Drivers
      if (cf.drivers && cf.drivers.length) {
        html += '<div style="margin-bottom:10px"><strong style="color:var(--accent)">Drivers (' + cf.drivers.length + ')</strong>';
        for (var di = 0; di < cf.drivers.length; di++) {
          var dr = cf.drivers[di];
          html += '<div style="margin-top:6px;padding:6px;background:var(--surface);border-radius:6px">';
          html += '<div style="font-weight:600;margin-bottom:4px">Driver ' + dr.driverNumber + ': ' + (dr.name || 'N/A') + '</div>';
          var driverFields = [['DOB', dr.birthDate], ['Marital', dr.maritalStatus], ['Occupation', dr.occupation], ['Education', dr.education], ['Gender', dr.gender], ['Relationship', dr.relationship], ['License', dr.licenseStatus], ['SR-22', dr.sr22 ? 'Yes' : '']];
          html += '<div style="display:flex;flex-wrap:wrap;gap:8px">';
          for (var df = 0; df < driverFields.length; df++) { if (driverFields[df][1]) html += '<span><span style="color:var(--text2)">' + driverFields[df][0] + ':</span> ' + driverFields[df][1] + '</span>'; }
          html += '</div></div>';
        }
        html += '</div>';
      }
      // Vehicles
      if (cf.vehicles && cf.vehicles.length) {
        html += '<div style="margin-bottom:10px"><strong style="color:var(--accent)">Vehicles (' + cf.vehicles.length + ')</strong>';
        for (var vi = 0; vi < cf.vehicles.length; vi++) {
          var veh = cf.vehicles[vi];
          html += '<div style="margin-top:6px;padding:6px;background:var(--surface);border-radius:6px">';
          html += '<div style="font-weight:600;margin-bottom:4px">Vehicle ' + veh.vehicleNumber + ': ' + [veh.year, veh.make, veh.model].filter(Boolean).join(' ') + '</div>';
          var vehFields = [['VIN', veh.vin], ['Annual Miles', veh.annualMiles], ['Primary Use', veh.primaryUse], ['Ownership', veh.ownership], ['Trim', veh.trim], ['Body', veh.bodyStyle]];
          html += '<div style="display:flex;flex-wrap:wrap;gap:8px">';
          for (var vf = 0; vf < vehFields.length; vf++) { if (vehFields[vf][1]) html += '<span><span style="color:var(--text2)">' + vehFields[vf][0] + ':</span> ' + vehFields[vf][1] + '</span>'; }
          html += '</div></div>';
        }
        html += '</div>';
      }
      // Current Policy
      if (cf.currentPolicy) {
        html += '<div style="margin-bottom:10px"><strong style="color:var(--accent)">Current Policy</strong><div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:6px">';
        var cpFields = [['Insurer', cf.currentPolicy.insurer], ['Coverage', cf.currentPolicy.coverageType], ['Since', cf.currentPolicy.insuredSince], ['Expires', cf.currentPolicy.expirationDate], ['BI', cf.currentPolicy.bodilyInjury], ['PD', cf.currentPolicy.propertyDamage]];
        for (var cpi = 0; cpi < cpFields.length; cpi++) { if (cpFields[cpi][1]) html += '<span><span style="color:var(--text2)">' + cpFields[cpi][0] + ':</span> ' + cpFields[cpi][1] + '</span>'; }
        html += '</div></div>';
      }
      // Requested Policy
      if (cf.requestedPolicy) {
        html += '<div style="margin-bottom:10px"><strong style="color:var(--accent)">Requested Policy</strong><div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:6px">';
        var rpFields = [['Coverage', cf.requestedPolicy.coverageType], ['BI', cf.requestedPolicy.bodilyInjury], ['PD', cf.requestedPolicy.propertyDamage], ['Deductible', cf.requestedPolicy.deductible], ['Comp Ded', cf.requestedPolicy.comprehensiveDeductible], ['Coll Ded', cf.requestedPolicy.collisionDeductible]];
        for (var rpi = 0; rpi < rpFields.length; rpi++) { if (rpFields[rpi][1]) html += '<span><span style="color:var(--text2)">' + rpFields[rpi][0] + ':</span> ' + rpFields[rpi][1] + '</span>'; }
        html += '</div></div>';
      }
      // Lead meta
      var metaFields = [['Lead ID', cf.leadId], ['Campaign', cf.campaignId], ['Sell Price', cf.sellPrice ? '$' + cf.sellPrice : ''], ['TCPA', cf.tcpaCompliant ? 'Yes' : ''], ['Timestamp', cf.timestamp]];
      var hasMeta = metaFields.some(function(m) { return !!m[1]; });
      if (hasMeta) {
        html += '<div style="margin-bottom:6px"><strong style="color:var(--accent)">Lead Meta</strong><div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:6px">';
        for (var mi = 0; mi < metaFields.length; mi++) { if (metaFields[mi][1]) html += '<span><span style="color:var(--text2)">' + metaFields[mi][0] + ':</span> ' + metaFields[mi][1] + '</span>'; }
        html += '</div></div>';
      }
      html += '</div>';
    }
    // Notes
    if (d.notes && d.notes.length) {
      html += '<h3 style="margin-bottom:8px">Notes</h3><div style="font-size:12px;color:var(--text2);margin-bottom:16px">';
      for (var k = 0; k < d.notes.length; k++) { html += '<div style="padding:4px 0;border-bottom:1px solid var(--border)">' + d.notes[k] + '</div>'; }
      html += '</div>';
    }
    // Tags
    if (d.tags && d.tags.length) {
      html += '<div style="margin-bottom:12px">';
      for (var ti = 0; ti < d.tags.length; ti++) { html += '<span class="badge badge-blue" style="margin-right:4px">' + d.tags[ti] + '</span>'; }
      html += '</div>';
    }
    html += '</div></div>';
    document.body.insertAdjacentHTML('beforeend', html);
  } catch (e) { toast('Failed to load lead detail', 'error'); }
}
function exportLeads() {
  window.open('/api/leads/export', '_blank');
  toast('Downloading CSV...', 'success');
}
function importLeadsCSV(input) {
  var file = input.files[0];
  if (!file) return;
  var reader = new FileReader();
  reader.onload = async function(e) {
    try {
      var res = await fetch('/api/leads/import', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ csv: e.target.result }) });
      var data = await res.json();
      toast('Imported ' + data.imported + ' leads (' + data.skipped + ' skipped)', data.errors.length ? 'error' : 'success');
      loadLeads();
    } catch (err) { toast('Import failed', 'error'); }
  };
  reader.readAsText(file);
  input.value = '';
}
async function loadCallbacks() {
  try {
    var res = await fetch('/api/callbacks');
    var cbs = await res.json();
    var el = document.getElementById('callbacksList');
    if (!cbs.length) { el.innerHTML = '<div class="empty-state">No callbacks scheduled</div>'; return; }
    var html = '<table class="data-table"><tr><th>Phone</th><th>Name</th><th>Scheduled</th><th>Status</th><th>Attempts</th><th>Action</th></tr>';
    for (var i = 0; i < cbs.length; i++) {
      var cb = cbs[i];
      var sb = cb.status === 'completed' ? 'badge-green' : cb.status === 'failed' ? 'badge-red' : cb.status === 'dialing' ? 'badge-orange' : 'badge-blue';
      html += '<tr><td style="font-family:monospace">' + cb.phone + '</td><td>' + cb.leadName + '</td>'
        + '<td>' + new Date(cb.scheduledAt).toLocaleString() + '</td>'
        + '<td><span class="badge ' + sb + '">' + cb.status + '</span></td>'
        + '<td>' + cb.attempts + '/' + cb.maxAttempts + '</td>'
        + '<td>' + (cb.status === 'pending' ? '<button class="btn btn-secondary btn-sm" onclick="cancelCb(\\'' + cb.id + '\\')">Cancel</button>' : (cb.result || '--')) + '</td></tr>';
    }
    el.innerHTML = html + '</table>';
  } catch (e) { document.getElementById('callbacksList').innerHTML = '<div class="empty-state">Failed</div>'; }
}
function showScheduleCallbackForm() {
  var form = document.getElementById('callbackScheduleForm');
  form.style.display = form.style.display === 'none' ? 'block' : 'none';
}
async function scheduleNewCallback() {
  var phone = document.getElementById('cbPhone').value.trim();
  var name = document.getElementById('cbName').value.trim() || 'Unknown';
  var dateTime = document.getElementById('cbDateTime').value;
  var reason = document.getElementById('cbReason').value.trim();
  if (!phone || !dateTime) { toast('Phone and date/time required', 'error'); return; }
  try {
    var res = await fetch('/api/callbacks/schedule', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ phone: phone, leadName: name, scheduledAt: new Date(dateTime).toISOString(), reason: reason }) });
    if (res.ok) { toast('Callback scheduled', 'success'); loadCallbacks(); document.getElementById('callbackScheduleForm').style.display = 'none'; }
    else toast('Failed', 'error');
  } catch (e) { toast('Failed', 'error'); }
}
async function cancelCb(id) {
  try {
    await fetch('/api/callbacks/' + id, { method: 'DELETE' });
    toast('Cancelled', 'success');
    loadCallbacks();
  } catch (e) { toast('Failed', 'error'); }
}

// ── SMS ──
async function loadSmsLog() {
  try {
    var res = await fetch('/api/sms/log?limit=50');
    var logs = await res.json();
    var el = document.getElementById('smsLogTable');
    if (!logs.length) { el.innerHTML = '<div class="empty-state">No SMS messages yet</div>'; return; }
    var html = '<table class="data-table"><tr><th>Time</th><th>Phone</th><th>Dir</th><th>Message</th><th>Status</th><th>Trigger</th></tr>';
    for (var i = 0; i < logs.length; i++) {
      var s = logs[i];
      var dirBadge = s.direction === 'inbound' ? 'badge-blue' : 'badge-green';
      var stBadge = s.status === 'failed' ? 'badge-red' : s.status === 'sent' || s.status === 'delivered' ? 'badge-green' : 'badge-gray';
      html += '<tr><td style="font-size:11px">' + new Date(s.timestamp).toLocaleString() + '</td>';
      html += '<td style="font-family:monospace;font-size:11px">' + s.phone + '</td>';
      html += '<td><span class="badge ' + dirBadge + '">' + s.direction + '</span></td>';
      html += '<td style="font-size:12px;max-width:300px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + s.body + '</td>';
      html += '<td><span class="badge ' + stBadge + '">' + s.status + '</span></td>';
      html += '<td style="font-size:11px;color:var(--text2)">' + (s.triggerReason || '--') + '</td></tr>';
    }
    el.innerHTML = html + '</table>';
  } catch (e) { document.getElementById('smsLogTable').innerHTML = '<div class="empty-state">Failed</div>'; }
}
var smsTemplatesData = [];
async function loadSmsTemplates() {
  try {
    var res = await fetch('/api/sms/templates');
    smsTemplatesData = await res.json();
    var el = document.getElementById('smsTemplatesList');
    var selEl = document.getElementById('smsTemplate');
    // Update select dropdown
    selEl.innerHTML = '<option value="">-- Custom Message --</option>';
    for (var i = 0; i < smsTemplatesData.length; i++) {
      var t = smsTemplatesData[i];
      selEl.innerHTML += '<option value="' + t.id + '">' + t.name + ' (' + t.category + ')</option>';
    }
    // Show templates list
    if (!smsTemplatesData.length) { el.innerHTML = '<div class="empty-state">No templates</div>'; return; }
    var html = '<table class="data-table"><tr><th>Name</th><th>Category</th><th>Body</th><th>Active</th></tr>';
    for (var j = 0; j < smsTemplatesData.length; j++) {
      var tp = smsTemplatesData[j];
      html += '<tr><td>' + tp.name + '</td><td><span class="badge badge-blue">' + tp.category + '</span></td>';
      html += '<td style="font-size:12px;max-width:400px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + tp.body + '</td>';
      html += '<td><span class="badge ' + (tp.active ? 'badge-green' : 'badge-gray') + '">' + (tp.active ? 'Yes' : 'No') + '</span></td></tr>';
    }
    el.innerHTML = html + '</table>';
  } catch (e) { document.getElementById('smsTemplatesList').innerHTML = '<div class="empty-state">Failed</div>'; }
}
function loadSmsTemplate() {
  var id = document.getElementById('smsTemplate').value;
  if (!id) { document.getElementById('smsBody').value = ''; return; }
  var tpl = smsTemplatesData.find(function(t) { return t.id === id; });
  if (tpl) document.getElementById('smsBody').value = tpl.body;
}
async function sendSmsUI() {
  var phone = document.getElementById('smsPhone').value.trim();
  var body = document.getElementById('smsBody').value.trim();
  if (!phone || !body) { toast('Phone and message required', 'error'); return; }
  try {
    var res = await fetch('/api/sms/send', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ phone: phone, body: body }) });
    var data = await res.json();
    if (res.ok) { toast('SMS sent!', 'success'); document.getElementById('smsBody').value = ''; loadSmsLog(); }
    else toast(data.error || 'Failed', 'error');
  } catch (e) { toast('Failed to send SMS', 'error'); }
}
async function loadSmsStats() {
  try {
    var res = await fetch('/api/sms/stats');
    var data = await res.json();
    document.getElementById('smsStats').innerHTML =
      '<div class="stat-card"><div class="stat-value">' + data.total + '</div><div class="stat-label">Total</div></div>'
      + '<div class="stat-card green"><div class="stat-value">' + data.sent + '</div><div class="stat-label">Sent</div></div>'
      + '<div class="stat-card cyan"><div class="stat-value">' + data.received + '</div><div class="stat-label">Received</div></div>'
      + '<div class="stat-card red"><div class="stat-value">' + data.failed + '</div><div class="stat-label">Failed</div></div>';
  } catch (e) { document.getElementById('smsStats').innerHTML = '<div class="empty-state">Failed</div>'; }
}

// ── Sliders ──
document.querySelectorAll('input[type=range]').forEach(function(el) {
  el.addEventListener('input', function() {
    var valEl = document.getElementById(el.id + 'Val');
    if (valEl) valEl.textContent = parseFloat(el.value).toFixed(2);
  });
});

// ── Campaign Stats ──
async function loadCampaignStats() {
  try {
    var r = await Promise.all([
      fetch('/api/analytics/history'),
      fetch('/api/callbacks'),
      fetch('/api/sms/log?limit=200')
    ]);
    var analytics = await r[0].json();
    var callbacks = await r[1].json();
    var smsLogs = await r[2].json();
    var today = new Date().toDateString();
    // Count calls per campaign from analytics (today only)
    var consumerCalls = 0, consumerTransfers = 0, agencyCalls = 0, agencyMeetings = 0;
    (analytics || []).forEach(function(a) {
      var isToday = a.startTime && new Date(a.startTime).toDateString() === today;
      if (!isToday) return;
      var tags = a.tags || [];
      var isCons = tags.indexOf('campaign:campaign-consumer-auto') > -1 || tags.indexOf('consumer') > -1;
      var isAgency = tags.indexOf('campaign:campaign-agency-dev') > -1 || tags.indexOf('agency') > -1;
      if (isCons) { consumerCalls++; if (a.outcome === 'transferred') consumerTransfers++; }
      else if (isAgency) { agencyCalls++; if (a.outcome === 'transferred') agencyMeetings++; }
      else { consumerCalls++; if (a.outcome === 'transferred') consumerTransfers++; }
    });
    // Count callbacks per campaign
    var consumerCallbacks = 0, agencyCallbacks = 0;
    (callbacks || []).forEach(function(cb) {
      if (cb.campaignId === 'campaign-agency-dev') agencyCallbacks++;
      else consumerCallbacks++;
    });
    // Count SMS per campaign (today only)
    var consumerSms = 0, agencySms = 0;
    (smsLogs || []).forEach(function(s) {
      var isToday = s.timestamp && new Date(s.timestamp).toDateString() === today;
      if (!isToday || s.direction !== 'outbound') return;
      if (s.campaignId === 'campaign-agency-dev') agencySms++;
      else consumerSms++;
    });
    document.getElementById('consumerCalls').textContent = consumerCalls;
    document.getElementById('consumerTransfers').textContent = consumerTransfers;
    document.getElementById('consumerCallbacks').textContent = consumerCallbacks;
    document.getElementById('consumerSms').textContent = consumerSms;
    document.getElementById('agencyCalls').textContent = agencyCalls;
    document.getElementById('agencyMeetings').textContent = agencyMeetings;
    document.getElementById('agencyCallbacks').textContent = agencyCallbacks;
    document.getElementById('agencySms').textContent = agencySms;
  } catch (e) { console.error('loadCampaignStats', e); }
}

// ── Campaigns ──
var currentCampaignId = 'campaign-consumer-auto';
var campaignData = {};

function selectCampaignView(id) {
  currentCampaignId = id;
  var callCampaignEl = document.getElementById('callCampaign');
  if (callCampaignEl) callCampaignEl.value = id;
  document.getElementById('toggleConsumer').className = 'btn campaign-toggle ' + (id === 'campaign-consumer-auto' ? 'btn-primary active' : 'btn-secondary');
  document.getElementById('toggleAgency').className = 'btn campaign-toggle ' + (id === 'campaign-agency-dev' ? 'btn-primary active' : 'btn-secondary');
  if (id === 'campaign-consumer-auto') {
    document.getElementById('toggleConsumer').style.cssText = 'background:linear-gradient(135deg,#3B82F6,#2563EB);color:white;box-shadow:0 4px 14px rgba(59,130,246,0.35)';
    document.getElementById('toggleAgency').style.cssText = 'border-color:#8B5CF6;color:#8B5CF6';
  } else {
    document.getElementById('toggleAgency').style.cssText = 'background:linear-gradient(135deg,#8B5CF6,#7C3AED);color:white;box-shadow:0 4px 14px rgba(139,92,246,0.35)';
    document.getElementById('toggleConsumer').style.cssText = 'border-color:#3B82F6;color:#3B82F6';
  }
  loadCampaignConfig(id);
}

async function loadCampaignConfig(id) {
  try {
    var res = await fetch('/api/campaigns/' + id);
    if (!res.ok) return;
    var c = await res.json();
    campaignData[id] = c;
    document.getElementById('campaignConfigTitle').textContent = c.name + ' Configuration';
    document.getElementById('campAgentName').value = c.aiProfile?.agentName || '';
    document.getElementById('campCompanyName').value = c.aiProfile?.companyName || '';
    var sysPrompt = c.aiProfile?.systemPrompt || '';
    if (!sysPrompt && c.type === 'consumer_auto_insurance') {
      try {
        var pRes = await fetch('/api/default-prompt');
        if (pRes.ok) { var pData = await pRes.json(); sysPrompt = pData.prompt || ''; }
      } catch (e) { console.error('Failed to load default prompt', e); }
    }
    document.getElementById('campSystemPrompt').value = sysPrompt;
    // Features
    document.getElementById('campScheduledCallbacks').checked = c.features?.scheduledCallbacks || false;
    document.getElementById('campAutoDialNewLeads').checked = c.features?.autoDialNewLeads || false;
    document.getElementById('campVoicemailDrop').checked = c.features?.voicemailDrop || false;
    document.getElementById('campSmsFollowUps').checked = c.features?.smsFollowUps || false;
    document.getElementById('campEmailFollowUps').checked = c.features?.emailFollowUps || false;
    document.getElementById('campInboundEnabled').checked = c.features?.inboundEnabled || false;
    // Voice
    setCampProvider(c.voiceConfig?.voiceProvider || 'elevenlabs');
    // Transfer routes
    renderTransferRoutes(c.transferRouting?.routes || []);
    // DIDs
    renderCampaignDids(c.assignedDids || []);
    // SMS Templates
    loadCampaignSmsTemplates(id);
    // Voices
    loadCampaignVoices(id, c.voiceConfig);
  } catch (e) { console.error('loadCampaignConfig', e); }
}

function setCampProvider(provider) {
  ['openai','elevenlabs','deepseek'].forEach(function(p) {
    var btn = document.getElementById('campProv' + p.charAt(0).toUpperCase() + p.slice(1));
    if (btn) { btn.className = 'btn btn-sm ' + (p === provider ? 'btn-primary' : 'btn-secondary'); }
  });
}

async function loadCampaignVoices(campaignId, voiceConfig) {
  try {
    var res = await fetch('/api/voices/elevenlabs/campaign/' + campaignId);
    var data = await res.json();
    var container = document.getElementById('campVoiceCards');
    var selectedVoiceId = voiceConfig?.elevenlabsVoiceId || '';
    var html = '';
    (data.voices || []).forEach(function(v) {
      var selected = v.voice_id === selectedVoiceId;
      html += '<div class="voice-card-el' + (selected ? ' selected' : '') + '" data-voice-id="' + v.voice_id + '" onclick="selectCampVoice(this,\\'' + v.voice_id + '\\')" style="padding:12px;background:' + (selected ? 'linear-gradient(135deg,rgba(37,99,235,0.06),rgba(37,99,235,0.02))' : 'var(--surface2)') + ';border:2px solid ' + (selected ? 'var(--accent)' : 'var(--border)') + ';border-radius:12px;cursor:pointer;transition:all 0.2s;position:relative">'
        + '<div style="font-weight:600;font-size:13px;margin-bottom:4px">' + v.name + '</div>'
        + '<div style="font-size:11px;color:var(--text2)">' + (v.category || '') + '</div>'
        + (v.preview_url ? '<button class="btn btn-sm btn-secondary" style="position:absolute;top:8px;right:8px;padding:4px 8px" onclick="event.stopPropagation();playVoicePreview(\\'' + v.voice_id + '\\')">&#9654;</button>' : '')
        + '</div>';
    });
    container.innerHTML = html || '<div class="empty-state">No voices available</div>';
  } catch (e) { console.error('loadCampaignVoices', e); }
}

function selectCampVoice(el, voiceId) {
  document.querySelectorAll('#campVoiceCards .voice-card-el').forEach(function(c) {
    c.classList.remove('selected');
    c.style.border = '2px solid var(--border)';
    c.style.background = 'var(--surface2)';
  });
  el.classList.add('selected');
  el.style.border = '2px solid var(--accent)';
  el.style.background = 'linear-gradient(135deg,rgba(37,99,235,0.06),rgba(37,99,235,0.02))';
}

async function playVoicePreview(voiceId) {
  try {
    var audio = new Audio('/api/elevenlabs-voice-preview/' + voiceId);
    audio.play();
  } catch (e) { toast('Preview failed', 'error'); }
}

function renderTransferRoutes(routes) {
  var el = document.getElementById('campTransferRoutes');
  if (!routes.length) { el.innerHTML = '<div class="empty-state">No transfer routes configured</div>'; return; }
  var html = '';
  routes.forEach(function(r) {
    html += '<div style="display:flex;gap:10px;align-items:center;padding:10px;background:var(--surface2);border-radius:10px;margin-bottom:8px">'
      + '<div style="font-weight:600;font-size:13px;flex:1">' + r.name + '</div>'
      + '<input type="text" value="' + (r.destinationNumber || '') + '" placeholder="Transfer number" style="max-width:180px;font-size:12px" data-route-id="' + r.id + '" class="camp-route-number">'
      + '<span style="font-size:11px;color:var(--text2)">' + r.businessHoursStart + '-' + r.businessHoursEnd + '</span>'
      + '<span class="badge ' + (r.active ? 'badge-green' : 'badge-gray') + '">' + (r.active ? 'Active' : 'Off') + '</span>'
      + '</div>';
  });
  el.innerHTML = html;
}

function renderCampaignDids(dids) {
  var el = document.getElementById('campDidList');
  if (!dids.length) { el.innerHTML = '<div style="font-size:12px;color:var(--text2)">No DIDs assigned</div>'; return; }
  var html = '';
  dids.forEach(function(did) {
    html += '<span style="display:inline-flex;align-items:center;gap:6px;padding:6px 12px;background:var(--surface2);border-radius:8px;margin:4px;font-size:13px;font-family:monospace">' + did + ' <button class="btn btn-sm btn-secondary" onclick="removeCampaignDid(\\'' + did + '\\')" style="padding:2px 6px;font-size:10px">x</button></span>';
  });
  el.innerHTML = html;
}

async function addCampaignDid() {
  var did = document.getElementById('campNewDid').value.trim();
  if (!did) return;
  try {
    await fetch('/api/did-mappings', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ did: did, campaignId: currentCampaignId }) });
    document.getElementById('campNewDid').value = '';
    toast('DID added', 'success');
    loadCampaignConfig(currentCampaignId);
  } catch (e) { toast('Failed', 'error'); }
}

async function removeCampaignDid(did) {
  try {
    await fetch('/api/did-mappings/' + encodeURIComponent(did), { method: 'DELETE' });
    toast('DID removed', 'success');
    loadCampaignConfig(currentCampaignId);
  } catch (e) { toast('Failed', 'error'); }
}

async function saveCampaignConfig() {
  var c = campaignData[currentCampaignId];
  if (!c) { toast('Load campaign first', 'error'); return; }
  var selectedVoice = document.querySelector('#campVoiceCards .voice-card-el.selected');
  var voiceId = selectedVoice ? selectedVoice.dataset.voiceId : c.voiceConfig.elevenlabsVoiceId;
  var routes = c.transferRouting.routes.map(function(r) {
    var input = document.querySelector('.camp-route-number[data-route-id="' + r.id + '"]');
    return Object.assign({}, r, { destinationNumber: input ? input.value : r.destinationNumber });
  });
  try {
    // Update AI profile
    await fetch('/api/campaigns/' + currentCampaignId + '/ai-profile', {
      method: 'PUT', headers: {'Content-Type':'application/json'},
      body: JSON.stringify({
        agentName: document.getElementById('campAgentName').value,
        companyName: document.getElementById('campCompanyName').value,
        systemPrompt: document.getElementById('campSystemPrompt').value,
      })
    });
    // Update features
    await fetch('/api/campaigns/' + currentCampaignId + '/features', {
      method: 'PUT', headers: {'Content-Type':'application/json'},
      body: JSON.stringify({
        scheduledCallbacks: document.getElementById('campScheduledCallbacks').checked,
        autoDialNewLeads: document.getElementById('campAutoDialNewLeads').checked,
        voicemailDrop: document.getElementById('campVoicemailDrop').checked,
        smsFollowUps: document.getElementById('campSmsFollowUps').checked,
        emailFollowUps: document.getElementById('campEmailFollowUps').checked,
        inboundEnabled: document.getElementById('campInboundEnabled').checked,
      })
    });
    // Update voice
    await fetch('/api/campaigns/' + currentCampaignId + '/voice', {
      method: 'PUT', headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ elevenlabsVoiceId: voiceId })
    });
    // Update transfer routing
    await fetch('/api/campaigns/' + currentCampaignId + '/transfer-routing', {
      method: 'PUT', headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ routes: routes })
    });
    toast('Campaign saved', 'success');
    loadCampaignConfig(currentCampaignId);
  } catch (e) { toast('Save failed: ' + e.message, 'error'); }
}

async function toggleCampaignActive(id, active) {
  try {
    await fetch('/api/campaigns/' + id + '/toggle', {
      method: 'PUT', headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ active: active })
    });
    toast(id + (active ? ' activated' : ' deactivated'), 'success');
  } catch (e) { toast('Failed', 'error'); }
}

async function loadCampaignFlags() {
  var panel = document.getElementById('featureFlagsPanel');
  panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
  if (panel.style.display === 'none') return;
  setTimeout(function() { panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); }, 350);
  try {
    var res = await fetch('/api/campaign-flags');
    var flags = await res.json();
    var grid = document.getElementById('featureFlagsGrid');
    var html = '';
    for (var key in flags) {
      html += '<label style="display:flex;align-items:center;gap:8px;padding:12px;background:var(--surface2);border-radius:10px;cursor:pointer">'
        + '<input type="checkbox" ' + (flags[key] ? 'checked' : '') + ' onchange="setCampaignFlag(\\'' + key + '\\',this.checked)">'
        + '<span style="font-size:13px;font-weight:600">' + key.replace(/_/g, ' ') + '</span></label>';
    }
    grid.innerHTML = html;
  } catch (e) { toast('Failed', 'error'); }
}

async function setCampaignFlag(key, value) {
  try {
    var body = {};
    body[key] = value;
    await fetch('/api/campaign-flags', { method: 'PUT', headers: {'Content-Type':'application/json'}, body: JSON.stringify(body) });
    toast(key + ' = ' + value, 'success');
  } catch (e) { toast('Failed', 'error'); }
}

async function loadEnforcementLog() {
  var panel = document.getElementById('enforcementLogPanel');
  panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
  if (panel.style.display === 'none') return;
  setTimeout(function() { panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); }, 350);
  try {
    var res = await fetch('/api/enforcement-log?limit=50');
    var logs = await res.json();
    var el = document.getElementById('enforcementLogContent');
    // Filter out page navigation noise (entries with no campaign and no phone)
    logs = logs.filter(function(log) { return log.campaignId || log.phone; });
    if (!logs.length) { el.innerHTML = '<div class="empty-state">No enforcement events</div>'; return; }
    var html = '<table class="data-table"><tr><th>Time</th><th>Event</th><th>Campaign</th><th>Phone</th><th>Action</th><th>Result</th><th>Reason</th></tr>';
    logs.forEach(function(log) {
      var badge = log.allowed ? 'badge-green' : 'badge-red';
      html += '<tr><td style="font-size:10px">' + new Date(log.timestamp).toLocaleTimeString() + '</td>'
        + '<td style="font-size:11px">' + log.eventType + '</td>'
        + '<td style="font-size:11px">' + (log.campaignId || '--') + '</td>'
        + '<td style="font-size:11px;font-family:monospace">' + (log.phone || '--') + '</td>'
        + '<td style="font-size:11px">' + log.action + '</td>'
        + '<td><span class="badge ' + badge + '">' + (log.allowed ? 'ALLOW' : 'DENY') + '</span></td>'
        + '<td style="font-size:11px;max-width:200px;overflow:hidden;text-overflow:ellipsis">' + log.reason + '</td></tr>';
    });
    el.innerHTML = html + '</table>';
  } catch (e) { toast('Failed', 'error'); }
}

async function loadCampaignSmsTemplates(id) {
  try {
    var res = await fetch('/api/campaigns/' + id + '/sms-templates');
    var templates = await res.json();
    var el = document.getElementById('campSmsTemplates');
    if (!templates.length) { el.innerHTML = '<div class="empty-state">No SMS templates for this campaign</div>'; return; }
    var html = '';
    templates.forEach(function(t) {
      html += '<div style="padding:12px;background:var(--surface2);border-radius:10px;margin-bottom:8px">'
        + '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">'
        + '<span style="font-weight:600;font-size:13px">' + t.name + '</span>'
        + '<span class="badge ' + (t.active ? 'badge-green' : 'badge-gray') + '">' + t.category + '</span>'
        + '</div>'
        + '<div style="font-size:12px;color:var(--text2);white-space:pre-wrap">' + t.body + '</div>'
        + '</div>';
    });
    el.innerHTML = html;
  } catch (e) { console.error('loadCampaignSmsTemplates', e); }
}

// ── Init ──
loadSettings();
loadCallHistory();
loadCampaignConfig('campaign-consumer-auto');
loadCampaignStats();
updatePromptCounter();
</script>
</body>
</html>`;
}
