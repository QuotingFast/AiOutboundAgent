/**
 * Quoting Fast — Command Center (LiveOps v2 dashboard)
 *
 * Single-file HTML document served for the operations command center.
 * NOTE: this whole document lives inside one template literal, so the
 * embedded client JavaScript deliberately uses ONLY string concatenation
 * (no template literals, no backslash escape sequences) to stay safe.
 */
export function getCommandCenterHtml(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Quoting Fast — Command Center</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.7/dist/chart.umd.min.js"></script>
<style>
  :root {
    --bg0: #07090f;
    --bg1: #0b0e17;
    --bg2: #0f131e;
    --panel: linear-gradient(180deg, rgba(255,255,255,0.032), rgba(255,255,255,0.012));
    --border: rgba(148,163,184,0.13);
    --border-strong: rgba(148,163,184,0.24);
    --text: #e7ebf5;
    --muted: #9aa4bc;
    --faint: #5c6680;
    --blue: #3b82f6;
    --green: #10b981;
    --amber: #f59e0b;
    --red: #ef4444;
    --mono: 'SF Mono', ui-monospace, 'Cascadia Code', Menlo, Consolas, monospace;
    --r: 14px;
    --r-sm: 9px;
    --side-w: 236px;
    --top-h: 60px;
  }
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  html { scrollbar-color: rgba(148,163,184,0.25) transparent; }
  body {
    font-family: 'Inter', system-ui, -apple-system, sans-serif;
    background: var(--bg0);
    color: var(--text);
    min-height: 100vh;
    line-height: 1.5;
    font-size: 14px;
    -webkit-font-smoothing: antialiased;
  }
  body::before {
    content: '';
    position: fixed; inset: 0; z-index: 0; pointer-events: none;
    background:
      radial-gradient(900px 480px at 12% -8%, rgba(59,130,246,0.10), transparent 60%),
      radial-gradient(760px 420px at 96% 4%, rgba(16,185,129,0.05), transparent 55%),
      radial-gradient(1100px 700px at 50% 118%, rgba(59,130,246,0.045), transparent 60%);
  }
  ::selection { background: rgba(59,130,246,0.35); }
  button { font-family: inherit; }
  a { color: var(--blue); text-decoration: none; }

  /* ── Sidebar ─────────────────────────────────────────── */
  .sidebar {
    position: fixed; top: 0; left: 0; bottom: 0; width: var(--side-w); z-index: 60;
    background: rgba(9,12,19,0.92);
    border-right: 1px solid var(--border);
    display: flex; flex-direction: column;
    backdrop-filter: blur(14px);
    transition: transform 0.28s cubic-bezier(0.2, 0.9, 0.3, 1);
  }
  .side-head { display: flex; align-items: center; gap: 11px; padding: 18px 18px 16px; border-bottom: 1px solid var(--border); }
  .logo-mark {
    width: 34px; height: 34px; border-radius: 10px; flex-shrink: 0;
    background: linear-gradient(135deg, #3b82f6 0%, #1d4ed8 60%, #10b981 160%);
    display: flex; align-items: center; justify-content: center;
    font-weight: 800; font-size: 13px; color: #fff; letter-spacing: -0.02em;
    box-shadow: 0 0 18px rgba(59,130,246,0.4), inset 0 1px 0 rgba(255,255,255,0.25);
  }
  .logo-name { font-size: 14px; font-weight: 700; letter-spacing: -0.01em; }
  .logo-sub { font-size: 10px; font-weight: 600; color: var(--blue); text-transform: uppercase; letter-spacing: 0.16em; margin-top: 1px; }
  .side-nav { flex: 1; overflow-y: auto; padding: 12px 10px; }
  .nav-label { font-size: 10px; font-weight: 700; color: var(--faint); text-transform: uppercase; letter-spacing: 0.14em; padding: 12px 12px 6px; }
  .nav-it {
    display: flex; align-items: center; gap: 11px; width: 100%;
    padding: 9px 12px; margin-bottom: 2px; border: 1px solid transparent; border-radius: var(--r-sm);
    background: none; color: var(--muted); font-size: 13.5px; font-weight: 500;
    cursor: pointer; text-align: left; transition: background 0.15s, color 0.15s;
  }
  .nav-it svg { width: 17px; height: 17px; flex-shrink: 0; opacity: 0.85; }
  .nav-it:hover { background: rgba(148,163,184,0.07); color: var(--text); }
  .nav-it.active {
    background: linear-gradient(90deg, rgba(59,130,246,0.16), rgba(59,130,246,0.05));
    border-color: rgba(59,130,246,0.32); color: #dbeafe; font-weight: 600;
  }
  .nav-it.active svg { color: var(--blue); opacity: 1; }
  .side-foot { padding: 14px 18px; border-top: 1px solid var(--border); font-size: 11px; color: var(--faint); display: flex; align-items: center; gap: 8px; }
  .side-foot .dot { width: 6px; height: 6px; }
  .scrim { display: none; position: fixed; inset: 0; z-index: 55; background: rgba(4,6,10,0.6); backdrop-filter: blur(3px); }
  .scrim.show { display: block; }

  /* ── Topbar / layout ─────────────────────────────────── */
  .main { margin-left: var(--side-w); min-height: 100vh; position: relative; z-index: 1; }
  .topbar {
    position: sticky; top: 0; z-index: 40; height: var(--top-h);
    display: flex; align-items: center; gap: 12px; padding: 0 22px;
    background: rgba(7,9,15,0.82); backdrop-filter: blur(14px);
    border-bottom: 1px solid var(--border);
  }
  .menu-btn { display: none; background: none; border: 1px solid var(--border); border-radius: 8px; color: var(--muted); font-size: 16px; padding: 4px 9px; cursor: pointer; }
  .page-title { font-size: 16px; font-weight: 700; letter-spacing: -0.015em; }
  .top-right { margin-left: auto; display: flex; align-items: center; gap: 9px; flex-wrap: wrap; }
  .top-link { font-size: 12px; color: var(--faint); padding: 5px 8px; border-radius: 7px; }
  .top-link:hover { color: var(--muted); background: rgba(148,163,184,0.07); }
  .live-pill {
    display: inline-flex; align-items: center; gap: 7px; padding: 5px 12px;
    border: 1px solid rgba(16,185,129,0.3); border-radius: 999px;
    background: rgba(16,185,129,0.08); font-size: 11px; font-weight: 700; letter-spacing: 0.1em; color: #6ee7b7;
  }
  .live-pill.down { border-color: rgba(245,158,11,0.35); background: rgba(245,158,11,0.08); color: #fcd34d; }
  .user-badge { display: inline-flex; align-items: center; gap: 8px; padding: 4px 11px 4px 5px; border: 1px solid var(--border); border-radius: 999px; background: rgba(148,163,184,0.05); }
  .user-avatar { width: 24px; height: 24px; border-radius: 50%; background: linear-gradient(135deg, var(--blue), #8b5cf6); display: flex; align-items: center; justify-content: center; font-size: 10px; font-weight: 700; color: #fff; }
  .user-name { font-size: 12px; font-weight: 600; }
  .user-role { font-size: 10px; color: var(--faint); text-transform: uppercase; letter-spacing: 0.08em; }

  .content { max-width: 1500px; margin: 0 auto; padding: 24px 26px 80px; }
  .tab { display: none; animation: fadeUp 0.25s ease; }
  .tab.active { display: block; }
  @keyframes fadeUp { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }

  /* ── Primitives ──────────────────────────────────────── */
  .dot { width: 8px; height: 8px; border-radius: 50%; display: inline-block; flex-shrink: 0; }
  .dot.green { background: var(--green); box-shadow: 0 0 8px rgba(16,185,129,0.7); animation: pulse 2.1s ease-in-out infinite; }
  .dot.blue { background: var(--blue); box-shadow: 0 0 8px rgba(59,130,246,0.7); }
  .dot.amber { background: var(--amber); box-shadow: 0 0 8px rgba(245,158,11,0.7); }
  .dot.red { background: var(--red); box-shadow: 0 0 8px rgba(239,68,68,0.7); }
  .dot.slate { background: var(--faint); }
  @keyframes pulse { 0%,100% { opacity: 1; } 50% { opacity: 0.45; } }

  .btn {
    display: inline-flex; align-items: center; gap: 7px; padding: 8px 15px;
    border: 1px solid var(--border-strong); border-radius: var(--r-sm);
    background: rgba(148,163,184,0.07); color: var(--text);
    font-size: 13px; font-weight: 600; cursor: pointer; white-space: nowrap;
    transition: background 0.15s, border-color 0.15s, transform 0.1s;
  }
  .btn:hover { background: rgba(148,163,184,0.14); }
  .btn:active { transform: translateY(1px); }
  .btn.primary { background: linear-gradient(180deg, #3b82f6, #2563eb); border-color: rgba(59,130,246,0.7); box-shadow: 0 0 16px rgba(59,130,246,0.25); }
  .btn.primary:hover { background: linear-gradient(180deg, #4f8ff8, #2f6ceb); }
  .btn.danger { background: rgba(239,68,68,0.12); border-color: rgba(239,68,68,0.45); color: #fca5a5; }
  .btn.danger:hover { background: rgba(239,68,68,0.22); }
  .btn.warn { background: rgba(245,158,11,0.12); border-color: rgba(245,158,11,0.45); color: #fcd34d; }
  .btn.ghost { background: transparent; border-color: var(--border); color: var(--muted); }
  .btn.ghost:hover { color: var(--text); border-color: var(--border-strong); }
  .btn.sm { padding: 5px 11px; font-size: 12px; }
  .btn.xs { padding: 3px 9px; font-size: 11px; border-radius: 7px; }
  .btn[disabled] { opacity: 0.5; pointer-events: none; }
  .icon-btn { background: none; border: none; color: var(--faint); font-size: 14px; cursor: pointer; padding: 4px 8px; border-radius: 7px; }
  .icon-btn:hover { color: var(--text); background: rgba(148,163,184,0.1); }

  .chip {
    display: inline-flex; align-items: center; gap: 5px; padding: 2px 9px;
    border-radius: 999px; font-size: 11px; font-weight: 600; letter-spacing: 0.02em;
    border: 1px solid var(--border); background: rgba(148,163,184,0.08); color: var(--muted);
    white-space: nowrap;
  }
  .chip.blue { background: rgba(59,130,246,0.12); border-color: rgba(59,130,246,0.35); color: #93c5fd; }
  .chip.green { background: rgba(16,185,129,0.12); border-color: rgba(16,185,129,0.35); color: #6ee7b7; }
  .chip.amber { background: rgba(245,158,11,0.12); border-color: rgba(245,158,11,0.35); color: #fcd34d; }
  .chip.red { background: rgba(239,68,68,0.12); border-color: rgba(239,68,68,0.35); color: #fca5a5; }
  .chip.mono { font-family: var(--mono); font-size: 10.5px; }
  .chip.click { cursor: pointer; }
  .chip.click:hover { border-color: var(--border-strong); color: var(--text); }
  .chip.click.on { background: rgba(59,130,246,0.16); border-color: rgba(59,130,246,0.5); color: #bfdbfe; }

  .panel {
    background: var(--panel); border: 1px solid var(--border); border-radius: var(--r);
    margin-bottom: 18px; overflow: hidden;
  }
  .panel-h {
    display: flex; align-items: center; gap: 10px; flex-wrap: wrap;
    padding: 13px 18px; border-bottom: 1px solid var(--border);
  }
  .panel-t { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.14em; color: var(--muted); display: flex; align-items: center; gap: 8px; }
  .panel-t::before { content: ''; width: 3px; height: 12px; border-radius: 2px; background: var(--blue); box-shadow: 0 0 8px rgba(59,130,246,0.6); }
  .panel-t.g::before { background: var(--green); box-shadow: 0 0 8px rgba(16,185,129,0.6); }
  .panel-t.a::before { background: var(--amber); box-shadow: 0 0 8px rgba(245,158,11,0.6); }
  .panel-t.r::before { background: var(--red); box-shadow: 0 0 8px rgba(239,68,68,0.6); }
  .panel-h .spacer { margin-left: auto; }
  .panel-b { padding: 16px 18px; }
  .panel-b.flush { padding: 0; }
  .panel-note { font-size: 12px; color: var(--faint); }

  /* ── KPI tiles ───────────────────────────────────────── */
  .kpi-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(158px, 1fr)); gap: 12px; margin-bottom: 20px; }
  .kpi {
    position: relative; overflow: hidden;
    background: var(--panel); border: 1px solid var(--border); border-radius: var(--r);
    padding: 14px 16px 13px;
  }
  .kpi::after { content: ''; position: absolute; left: 0; top: 0; bottom: 0; width: 2px; background: var(--kc, var(--blue)); opacity: 0.85; }
  .kpi::before { content: ''; position: absolute; left: -30px; top: -30px; width: 90px; height: 90px; border-radius: 50%; background: var(--kc, var(--blue)); opacity: 0.08; filter: blur(24px); }
  .kpi.b { --kc: #3b82f6; } .kpi.g { --kc: #10b981; } .kpi.a { --kc: #f59e0b; } .kpi.r { --kc: #ef4444; } .kpi.s { --kc: #64748b; }
  .kpi-l { font-size: 10.5px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.12em; color: var(--muted); margin-bottom: 6px; }
  .kpi-v { font-size: 27px; font-weight: 800; letter-spacing: -0.03em; font-variant-numeric: tabular-nums; line-height: 1.1; }
  .kpi-s { font-size: 11px; color: var(--faint); margin-top: 3px; }
  .kpi-v.pending { color: var(--faint); }

  /* ── Tables ──────────────────────────────────────────── */
  .tbl { width: 100%; border-collapse: collapse; font-size: 13px; }
  .tbl th { text-align: left; padding: 9px 16px; font-size: 10.5px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.1em; color: var(--faint); border-bottom: 1px solid var(--border); white-space: nowrap; }
  .tbl td { padding: 10px 16px; border-bottom: 1px solid rgba(148,163,184,0.07); vertical-align: middle; }
  .tbl tr:last-child td { border-bottom: none; }
  .tbl tr.rowhov:hover td { background: rgba(148,163,184,0.045); }
  .tbl .num { text-align: right; font-variant-numeric: tabular-nums; }
  .tbl th.num { text-align: right; }
  .mono { font-family: var(--mono); font-size: 12px; }
  .muted { color: var(--muted); }
  .faint { color: var(--faint); }
  .tiny { font-size: 11px; }
  .tbl-wrap { overflow-x: auto; }

  /* ── Bars, gauges, mini viz ──────────────────────────── */
  .bar { height: 6px; border-radius: 4px; background: rgba(148,163,184,0.12); overflow: hidden; }
  .bar > i { display: block; height: 100%; border-radius: 4px; background: linear-gradient(90deg, #2563eb, #3b82f6); width: 0; transition: width 0.7s cubic-bezier(0.2, 0.9, 0.3, 1); }
  .bar > i.g { background: linear-gradient(90deg, #059669, #10b981); }
  .bar > i.a { background: linear-gradient(90deg, #d97706, #f59e0b); }
  .bar > i.r { background: linear-gradient(90deg, #dc2626, #ef4444); }
  .minibar { display: flex; align-items: center; gap: 8px; margin: 4px 0; }
  .minibar .mb-l { width: 110px; font-size: 11px; color: var(--muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex-shrink: 0; }
  .minibar .bar { flex: 1; }
  .minibar .mb-v { width: 42px; text-align: right; font-size: 11px; font-variant-numeric: tabular-nums; color: var(--text); flex-shrink: 0; }
  .gauge-wrap { display: flex; align-items: center; gap: 18px; }
  .gauge { width: 108px; height: 108px; border-radius: 50%; position: relative; flex-shrink: 0; background: rgba(148,163,184,0.1); }
  .gauge::after { content: ''; position: absolute; inset: 11px; border-radius: 50%; background: #0c0f18; }
  .gauge .gauge-v { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; z-index: 1; font-size: 24px; font-weight: 800; letter-spacing: -0.03em; }
  .gauge .gauge-s { font-size: 9px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.12em; color: var(--faint); }

  /* ── Funnel ──────────────────────────────────────────── */
  .fstage { padding: 4px 0 2px; cursor: pointer; border-radius: 8px; }
  .fstage:hover .fs-label { color: var(--text); }
  .fs-top { display: flex; align-items: baseline; gap: 10px; margin-bottom: 5px; }
  .fs-label { font-size: 12.5px; font-weight: 600; color: var(--muted); transition: color 0.15s; }
  .fs-count { margin-left: auto; font-size: 14px; font-weight: 700; font-variant-numeric: tabular-nums; }
  .fs-bar { height: 26px; border-radius: 7px; background: rgba(148,163,184,0.07); overflow: hidden; position: relative; }
  .fs-bar > i {
    display: block; height: 100%; width: 0; border-radius: 7px;
    background: linear-gradient(90deg, rgba(37,99,235,0.9), rgba(59,130,246,0.55));
    box-shadow: 0 0 14px rgba(59,130,246,0.3);
    transition: width 0.9s cubic-bezier(0.2, 0.9, 0.3, 1);
  }
  .fs-conv { display: flex; align-items: center; gap: 8px; padding: 7px 0 7px 14px; font-size: 11px; color: var(--faint); }
  .fs-conv b { color: #93c5fd; font-variant-numeric: tabular-nums; }
  .fs-conv::before { content: ''; width: 1px; height: 14px; background: var(--border-strong); }

  /* ── Ticker ──────────────────────────────────────────── */
  .ticker { max-height: 430px; overflow-y: auto; }
  .tick-it {
    display: flex; align-items: center; gap: 10px; padding: 8px 16px;
    border-left: 2px solid var(--faint); border-bottom: 1px solid rgba(148,163,184,0.06);
    animation: tickIn 0.3s ease;
  }
  @keyframes tickIn { from { opacity: 0; transform: translateX(-8px); } to { opacity: 1; transform: none; } }
  .tick-it.blue { border-left-color: var(--blue); } .tick-it.green { border-left-color: var(--green); }
  .tick-it.amber { border-left-color: var(--amber); } .tick-it.red { border-left-color: var(--red); }
  .tick-type { font-family: var(--mono); font-size: 10.5px; font-weight: 600; }
  .tick-it.blue .tick-type { color: #93c5fd; } .tick-it.green .tick-type { color: #6ee7b7; }
  .tick-it.amber .tick-type { color: #fcd34d; } .tick-it.red .tick-type { color: #fca5a5; }
  .tick-meta { font-size: 11px; color: var(--faint); margin-left: auto; white-space: nowrap; }
  .tick-phone { font-family: var(--mono); font-size: 11px; color: var(--muted); }

  /* ── Layout grids ────────────────────────────────────── */
  .g2 { display: grid; grid-template-columns: minmax(0, 1.7fr) minmax(0, 1fr); gap: 18px; align-items: start; }
  .g2e { display: grid; grid-template-columns: 1fr 1fr; gap: 18px; align-items: start; }
  .g3 { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 18px; align-items: start; }
  .stack > .panel { margin-bottom: 18px; }
  @media (max-width: 1150px) { .g2, .g3 { grid-template-columns: 1fr; } }
  @media (max-width: 860px) { .g2e { grid-template-columns: 1fr; } }

  /* ── Forms ───────────────────────────────────────────── */
  .in {
    width: 100%; padding: 8px 11px; border-radius: var(--r-sm);
    border: 1px solid var(--border-strong); background: rgba(7,9,15,0.6);
    color: var(--text); font-size: 13px; font-family: inherit; outline: none;
    transition: border-color 0.15s, box-shadow 0.15s;
  }
  .in:focus { border-color: rgba(59,130,246,0.6); box-shadow: 0 0 0 3px rgba(59,130,246,0.15); }
  textarea.in { resize: vertical; min-height: 90px; font-family: var(--mono); font-size: 12px; line-height: 1.55; }
  select.in { appearance: none; }
  .fld { margin-bottom: 12px; }
  .fld-l { display: block; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.1em; color: var(--muted); margin-bottom: 5px; }
  .fld-row { display: flex; gap: 10px; }
  .fld-row > * { flex: 1; }
  .check { display: flex; align-items: center; gap: 8px; font-size: 13px; color: var(--text); cursor: pointer; }
  .check input { accent-color: var(--blue); width: 15px; height: 15px; }

  .switch { position: relative; width: 34px; height: 19px; border-radius: 999px; background: rgba(148,163,184,0.25); border: 1px solid var(--border-strong); cursor: pointer; transition: background 0.2s; flex-shrink: 0; }
  .switch::after { content: ''; position: absolute; top: 2px; left: 2px; width: 13px; height: 13px; border-radius: 50%; background: #cbd5e1; transition: transform 0.2s, background 0.2s; }
  .switch.on { background: rgba(16,185,129,0.45); border-color: rgba(16,185,129,0.6); }
  .switch.on::after { transform: translateX(15px); background: #fff; }

  /* ── Modal / drawer / toast ──────────────────────────── */
  .modal-back { position: fixed; inset: 0; z-index: 100; background: rgba(4,6,10,0.72); backdrop-filter: blur(4px); display: flex; align-items: flex-start; justify-content: center; padding: 8vh 18px 18px; overflow-y: auto; animation: fadeUp 0.18s ease; }
  .modal { width: 100%; max-width: 520px; background: #0d1119; border: 1px solid var(--border-strong); border-radius: 16px; box-shadow: 0 24px 70px rgba(0,0,0,0.6), 0 0 40px rgba(59,130,246,0.07); }
  .modal.wide { max-width: 700px; }
  .modal-h { display: flex; align-items: center; padding: 15px 18px; border-bottom: 1px solid var(--border); }
  .modal-title { font-size: 14px; font-weight: 700; flex: 1; }
  .modal-b { padding: 18px; max-height: 62vh; overflow-y: auto; }
  .modal-f { display: flex; justify-content: flex-end; gap: 9px; padding: 13px 18px; border-top: 1px solid var(--border); }
  .drawer-back { position: fixed; inset: 0; z-index: 95; background: rgba(4,6,10,0.55); backdrop-filter: blur(3px); }
  .drawer { position: fixed; top: 0; right: 0; bottom: 0; z-index: 96; width: min(480px, 94vw); background: #0c0f18; border-left: 1px solid var(--border-strong); box-shadow: -20px 0 60px rgba(0,0,0,0.55); display: flex; flex-direction: column; animation: drawerIn 0.24s cubic-bezier(0.2, 0.9, 0.3, 1); }
  @keyframes drawerIn { from { transform: translateX(40px); opacity: 0; } to { transform: none; opacity: 1; } }
  .drawer-h { display: flex; align-items: center; padding: 15px 18px; border-bottom: 1px solid var(--border); }
  .drawer-title { font-size: 13px; font-weight: 700; flex: 1; }
  .drawer-b { flex: 1; overflow-y: auto; padding: 16px 18px; }
  #toasts { position: fixed; bottom: 20px; right: 20px; z-index: 200; display: flex; flex-direction: column; gap: 8px; max-width: 340px; }
  .toast { padding: 11px 15px; border-radius: 11px; font-size: 13px; font-weight: 500; background: #101624; border: 1px solid rgba(59,130,246,0.4); box-shadow: 0 10px 30px rgba(0,0,0,0.5); animation: tickIn 0.25s ease; transition: opacity 0.3s, transform 0.3s; }
  .toast.error { border-color: rgba(239,68,68,0.5); background: #1a0f13; color: #fecaca; }
  .toast.ok { border-color: rgba(16,185,129,0.5); background: #0b1712; color: #a7f3d0; }
  .toast.out { opacity: 0; transform: translateX(14px); }

  /* ── Skeleton / empty states ─────────────────────────── */
  .skel { height: 15px; border-radius: 6px; margin: 11px 0; background: linear-gradient(90deg, rgba(148,163,184,0.08) 25%, rgba(148,163,184,0.17) 50%, rgba(148,163,184,0.08) 75%); background-size: 200% 100%; animation: shimmer 1.4s infinite linear; }
  @keyframes shimmer { from { background-position: 200% 0; } to { background-position: -200% 0; } }
  .empty { text-align: center; padding: 34px 18px; }
  .empty-ic { width: 40px; height: 40px; margin: 0 auto 12px; border-radius: 12px; border: 1px dashed var(--border-strong); display: flex; align-items: center; justify-content: center; color: var(--faint); font-size: 17px; }
  .empty-t { font-size: 13px; font-weight: 600; color: var(--muted); }
  .empty-s { font-size: 12px; color: var(--faint); margin-top: 3px; }

  /* ── Misc components ─────────────────────────────────── */
  .kv { display: grid; grid-template-columns: minmax(110px, auto) 1fr; gap: 4px 14px; font-size: 12.5px; }
  .kv dt { color: var(--faint); font-weight: 500; }
  .kv dd { color: var(--text); overflow-wrap: anywhere; }
  .stage-flow { display: flex; align-items: center; gap: 4px; flex-wrap: wrap; }
  .stage-sep { color: var(--faint); font-size: 10px; }
  .card-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(290px, 1fr)); gap: 14px; }
  .sub-card { background: rgba(148,163,184,0.04); border: 1px solid var(--border); border-radius: 11px; padding: 14px 15px; }
  .sub-card h4 { font-size: 13.5px; font-weight: 700; letter-spacing: -0.01em; }
  .divider { height: 1px; background: var(--border); margin: 13px 0; }
  .result-card { border-radius: 11px; padding: 14px 16px; border: 1px solid; margin-top: 12px; }
  .result-card.ok { background: rgba(16,185,129,0.07); border-color: rgba(16,185,129,0.4); }
  .result-card.bad { background: rgba(239,68,68,0.07); border-color: rgba(239,68,68,0.4); }
  .result-head { font-size: 14px; font-weight: 800; letter-spacing: 0.06em; }
  .result-card.ok .result-head { color: #6ee7b7; }
  .result-card.bad .result-head { color: #fca5a5; }
  .chip-row { display: flex; gap: 6px; flex-wrap: wrap; }
  .obj-row { border-bottom: 1px solid rgba(148,163,184,0.08); }
  .obj-head { display: flex; align-items: center; gap: 12px; padding: 12px 18px; cursor: pointer; }
  .obj-head:hover { background: rgba(148,163,184,0.045); }
  .obj-body { display: none; padding: 4px 18px 16px; background: rgba(7,9,15,0.4); }
  .obj-row.open .obj-body { display: block; }
  .caret { color: var(--faint); font-size: 10px; transition: transform 0.18s; }
  .obj-row.open .caret { transform: rotate(90deg); }
  .timeline-days { display: flex; height: 30px; border-radius: 8px; overflow: hidden; border: 1px solid var(--border); }
  .tl-seg { display: flex; align-items: center; justify-content: center; font-size: 10px; font-weight: 700; color: #dbeafe; border-right: 1px solid rgba(7,9,15,0.6); min-width: 24px; }
  pre.code { font-family: var(--mono); font-size: 11.5px; line-height: 1.55; background: rgba(7,9,15,0.65); border: 1px solid var(--border); border-radius: 9px; padding: 12px 14px; overflow-x: auto; color: #c8d2e8; white-space: pre-wrap; overflow-wrap: anywhere; }
  .canvas-box { position: relative; height: 240px; }

  /* ── Responsive ──────────────────────────────────────── */
  @media (max-width: 960px) {
    .sidebar { transform: translateX(-102%); }
    .sidebar.open { transform: none; }
    .main { margin-left: 0; }
    .menu-btn { display: inline-flex; }
    .content { padding: 18px 14px 70px; }
    .top-link, .user-role { display: none; }
  }
</style>
</head>
<body>

<!-- ══ Sidebar ══════════════════════════════════════════ -->
<aside class="sidebar" id="sidebar">
  <div class="side-head">
    <div class="logo-mark">QF</div>
    <div>
      <div class="logo-name">Quoting Fast</div>
      <div class="logo-sub">Command Center</div>
    </div>
  </div>
  <nav class="side-nav" id="sideNav">
    <div class="nav-label">Operations</div>
    <button class="nav-it active" data-tab="command">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></svg>
      Command Center</button>
    <button class="nav-it" data-tab="funnel">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 4h18l-7 8v6l-4 2v-8L3 4z"/></svg>
      Funnel</button>
    <button class="nav-it" data-tab="intel">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12h4l3-8 4 16 3-8h6"/></svg>
      Intelligence</button>
    <button class="nav-it" data-tab="transfers">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h13M13 3l4 4-4 4M20 17H7M11 13l-4 4 4 4"/></svg>
      Transfers</button>
    <div class="nav-label">Governance</div>
    <button class="nav-it" data-tab="compliance">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6l8-3z"/><path d="M9 12l2 2 4-4"/></svg>
      Compliance Center</button>
    <button class="nav-it" data-tab="config">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 8h10M18 8h2M4 16h2M10 16h10"/><circle cx="16" cy="8" r="2.5"/><circle cx="8" cy="16" r="2.5"/></svg>
      Config Studio</button>
    <button class="nav-it" data-tab="reports">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/></svg>
      Reports</button>
  </nav>
  <div class="side-foot"><span class="dot green"></span><span>LiveOps platform v2</span></div>
</aside>
<div class="scrim" id="scrim"></div>

<div class="main">

<!-- ══ Topbar ═══════════════════════════════════════════ -->
<header class="topbar">
  <button class="menu-btn" id="menuBtn" title="Menu">≡</button>
  <div class="page-title" id="pageTitle">Command Center</div>
  <div class="top-right">
    <span class="chip amber" id="reconnPill" hidden><span class="dot amber"></span>Reconnecting</span>
    <span class="live-pill" id="livePill"><span class="dot green" id="liveDot"></span><span id="liveTxt">LIVE</span></span>
    <button class="btn primary sm" id="quickCallBtn">Quick call</button>
    <button class="btn sm" id="pauseBtn">Pause</button>
    <a class="top-link" href="/dashboard/legacy">Legacy dashboard</a>
    <span class="user-badge" id="userBadge" hidden>
      <span class="user-avatar" id="userAvatar">·</span>
      <span>
        <span class="user-name" id="userName"></span>
        <span class="user-role" id="userRole"></span>
      </span>
    </span>
    <button class="btn ghost sm" id="logoutBtn" hidden>Log out</button>
  </div>
</header>

<main class="content">

<!-- ══ Tab: Command Center ══════════════════════════════ -->
<section class="tab active" id="tab-command">
  <div class="kpi-grid">
    <div class="kpi b"><div class="kpi-l">Attempts</div><div class="kpi-v pending" id="kAttempts">—</div><div class="kpi-s">dials today</div></div>
    <div class="kpi g"><div class="kpi-l">Answered</div><div class="kpi-v pending" id="kAnswered">—</div><div class="kpi-s">live connects</div></div>
    <div class="kpi b"><div class="kpi-l">Transfers in flight</div><div class="kpi-v pending" id="kTransfersFlight">—</div><div class="kpi-s" id="kTransfersToday">— completed today</div></div>
    <div class="kpi g"><div class="kpi-l">Buyer connects</div><div class="kpi-v pending" id="kConnects">—</div><div class="kpi-s">consumer + buyer bridged</div></div>
    <div class="kpi s"><div class="kpi-l">Callbacks pending</div><div class="kpi-v pending" id="kCallbacks">—</div><div class="kpi-s">scheduled</div></div>
    <div class="kpi r"><div class="kpi-l">Compliance blocks</div><div class="kpi-v pending" id="kBlocked">—</div><div class="kpi-s">outreach stopped</div></div>
    <div class="kpi a"><div class="kpi-l">Opt-outs</div><div class="kpi-v pending" id="kOptOuts">—</div><div class="kpi-s" id="kDncSub">— on DNC list</div></div>
    <div class="kpi b"><div class="kpi-l">SMS today</div><div class="kpi-v pending" id="kSms">—</div><div class="kpi-s">messages sent</div></div>
  </div>

  <div class="g2">
    <div class="stack">
      <div class="panel">
        <div class="panel-h"><div class="panel-t g">Active calls</div><span class="chip green" id="activeCallCount" hidden>0 live</span><div class="spacer"></div><span class="panel-note" id="queueNote"></span></div>
        <div class="panel-b flush tbl-wrap">
          <table class="tbl" id="activeCallsTbl" hidden>
            <thead><tr><th></th><th>Lead</th><th>Status</th><th class="num">Elapsed</th><th>Call SID</th></tr></thead>
            <tbody id="activeCallsBody"></tbody>
          </table>
          <div id="activeCallsEmpty"><div class="skel" style="margin:14px 18px"></div><div class="skel" style="margin:14px 18px"></div></div>
        </div>
      </div>

      <div class="panel">
        <div class="panel-h"><div class="panel-t g">Buyer availability</div><div class="spacer"></div><button class="btn ghost xs" id="buyerAvailRefresh">Refresh</button></div>
        <div class="panel-b" id="buyerAvail"><div class="skel"></div><div class="skel"></div><div class="skel"></div></div>
      </div>

      <div class="g2e">
        <div class="panel" style="margin-bottom:0">
          <div class="panel-h"><div class="panel-t">System health</div><span class="chip" id="sysStatusChip">…</span></div>
          <div class="panel-b" id="sysHealth"><div class="skel"></div><div class="skel"></div></div>
        </div>
        <div class="panel" style="margin-bottom:0">
          <div class="panel-h"><div class="panel-t">AI providers</div></div>
          <div class="panel-b" id="provHealth"><div class="skel"></div><div class="skel"></div></div>
        </div>
      </div>
    </div>

    <div class="stack">
      <div class="panel">
        <div class="panel-h"><div class="panel-t">Live event ticker</div><div class="spacer"></div><span class="panel-note" id="tickerSeq"></span></div>
        <div class="panel-b flush ticker" id="ticker">
          <div class="empty" id="tickerEmpty"><div class="empty-ic">≋</div><div class="empty-t">Listening for events</div><div class="empty-s">Platform events will stream in here live.</div></div>
        </div>
      </div>
      <div class="panel">
        <div class="panel-h"><div class="panel-t g">QA pulse</div></div>
        <div class="panel-b">
          <div class="gauge-wrap">
            <div class="gauge" id="qaGauge"><div class="gauge-v"><span id="qaGaugeVal">—</span><span class="gauge-s">avg score</span></div></div>
            <div>
              <div class="kpi-l">Pending review</div>
              <div class="kpi-v" id="qaPending" style="font-size:22px">—</div>
              <div class="kpi-s">flagged calls awaiting a human look</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</section>

<!-- ══ Tab: Funnel ══════════════════════════════════════ -->
<section class="tab" id="tab-funnel">
  <div class="g2">
    <div class="panel">
      <div class="panel-h">
        <div class="panel-t">Conversion funnel</div>
        <div class="spacer"></div>
        <div class="chip-row" id="funnelRange">
          <span class="chip click on" data-range="today">Today</span>
          <span class="chip click" data-range="7d">7d</span>
          <span class="chip click" data-range="30d">30d</span>
        </div>
      </div>
      <div class="panel-b" id="funnelStages"><div class="skel"></div><div class="skel"></div><div class="skel"></div><div class="skel"></div></div>
    </div>
    <div class="panel">
      <div class="panel-h"><div class="panel-t a">Leakage &amp; side flows</div></div>
      <div class="panel-b" id="funnelStats"><div class="skel"></div><div class="skel"></div></div>
    </div>
  </div>
  <div class="panel">
    <div class="panel-h">
      <div class="panel-t">Breakdown</div>
      <div class="chip-row" id="breakDims">
        <span class="chip click on" data-dim="source">Source</span>
        <span class="chip click" data-dim="state">State</span>
        <span class="chip click" data-dim="insurer">Insurer</span>
        <span class="chip click" data-dim="campaignId">Campaign</span>
      </div>
    </div>
    <div class="panel-b flush tbl-wrap" id="breakTable"><div class="skel" style="margin:14px 18px"></div><div class="skel" style="margin:14px 18px"></div></div>
  </div>
</section>

<!-- ══ Tab: Intelligence ════════════════════════════════ -->
<section class="tab" id="tab-intel">
  <div class="g2e">
    <div class="panel">
      <div class="panel-h"><div class="panel-t">QA dimensions</div><div class="spacer"></div><span class="panel-note" id="qaScoredNote"></span></div>
      <div class="panel-b">
        <div class="canvas-box"><canvas id="qaDimChart"></canvas></div>
      </div>
    </div>
    <div class="panel">
      <div class="panel-h"><div class="panel-t r">Top risk flags</div></div>
      <div class="panel-b" id="riskFlags"><div class="skel"></div><div class="skel"></div></div>
    </div>
  </div>
  <div class="panel">
    <div class="panel-h"><div class="panel-t a">Objection playbook</div><div class="spacer"></div><span class="panel-note">Live rebuttal experiments — variants A/B tested per objection</span></div>
    <div class="panel-b flush" id="objections"><div class="skel" style="margin:14px 18px"></div><div class="skel" style="margin:14px 18px"></div></div>
  </div>
  <div class="panel">
    <div class="panel-h"><div class="panel-t r">Flagged calls — review queue</div></div>
    <div class="panel-b" id="flaggedList"><div class="skel"></div><div class="skel"></div></div>
  </div>
</section>

<!-- ══ Tab: Transfers ═══════════════════════════════════ -->
<section class="tab" id="tab-transfers">
  <div class="panel">
    <div class="panel-h"><div class="panel-t">Transfer timeline</div><div class="spacer"></div><button class="btn ghost xs" id="transfersRefresh">Refresh</button></div>
    <div class="panel-b flush" id="transfersList"><div class="skel" style="margin:14px 18px"></div><div class="skel" style="margin:14px 18px"></div></div>
  </div>
  <div class="panel">
    <div class="panel-h"><div class="panel-t g">Buyer manager</div><div class="spacer"></div><button class="btn primary sm" id="addBuyerBtn">Add buyer</button></div>
    <div class="panel-b"><div class="card-grid" id="buyerCards"><div class="skel"></div></div></div>
  </div>
</section>

<!-- ══ Tab: Compliance ══════════════════════════════════ -->
<section class="tab" id="tab-compliance">
  <div class="kpi-grid">
    <div class="kpi r"><div class="kpi-l">Blocked today</div><div class="kpi-v pending" id="cBlocked">—</div><div class="kpi-s">policy engine stops</div></div>
    <div class="kpi a"><div class="kpi-l">DNC list</div><div class="kpi-v pending" id="cDnc">—</div><div class="kpi-s">suppressed numbers</div></div>
    <div class="kpi a"><div class="kpi-l">Opt-outs today</div><div class="kpi-v pending" id="cOptOuts">—</div><div class="kpi-s">STOP + verbal</div></div>
    <div class="kpi g"><div class="kpi-l">Ledger integrity</div><div class="kpi-v" id="cLedger" style="font-size:17px;padding-top:5px">Checking…</div><div class="kpi-s" id="cLedgerSub">hash-chained event log</div></div>
  </div>
  <div class="g3">
    <div class="panel">
      <div class="panel-h"><div class="panel-t r">Blocked outreach</div></div>
      <div class="panel-b flush ticker" id="blockedFeed"><div class="skel" style="margin:14px 18px"></div></div>
    </div>
    <div class="panel">
      <div class="panel-h"><div class="panel-t a">STOP messages</div></div>
      <div class="panel-b flush ticker" id="stopFeed"><div class="skel" style="margin:14px 18px"></div></div>
    </div>
    <div class="panel">
      <div class="panel-h"><div class="panel-t a">DNC additions</div></div>
      <div class="panel-b flush ticker" id="dncFeed"><div class="skel" style="margin:14px 18px"></div></div>
    </div>
  </div>
  <div class="g2e">
    <div class="panel">
      <div class="panel-h"><div class="panel-t">Policy editor</div><div class="spacer"></div><button class="btn primary sm" id="policySave">Save policy</button></div>
      <div class="panel-b" id="policyForm"><div class="skel"></div><div class="skel"></div></div>
    </div>
    <div class="stack">
      <div class="panel">
        <div class="panel-h"><div class="panel-t">Policy tester</div></div>
        <div class="panel-b">
          <div class="fld-row">
            <div class="fld"><label class="fld-l">Channel</label><select class="in" id="ptChannel"><option value="call">call</option><option value="sms">sms</option></select></div>
            <div class="fld"><label class="fld-l">Phone</label><input class="in" id="ptPhone" placeholder="+15551234567"></div>
            <div class="fld"><label class="fld-l">State</label><input class="in" id="ptState" placeholder="TX" maxlength="2"></div>
          </div>
          <button class="btn primary sm" id="ptRun">Evaluate</button>
          <div id="ptResult"></div>
        </div>
      </div>
      <div class="panel">
        <div class="panel-h"><div class="panel-t">Compliance export &amp; suppressions</div></div>
        <div class="panel-b">
          <div class="fld-row" style="align-items:flex-end">
            <div class="fld" style="margin-bottom:0"><label class="fld-l">Phone number</label><input class="in" id="expPhone" placeholder="+15551234567"></div>
            <button class="btn sm" id="expBtn" style="flex:0 0 auto">Export package</button>
          </div>
          <div class="divider"></div>
          <div class="fld-l" style="margin-bottom:8px">Suppression list</div>
          <div id="suppressions" class="ticker" style="max-height:220px"><div class="skel"></div></div>
        </div>
      </div>
    </div>
  </div>
</section>

<!-- ══ Tab: Config Studio ═══════════════════════════════ -->
<section class="tab" id="tab-config">
  <div class="panel">
    <div class="panel-h"><div class="panel-t">Agent profiles</div><div class="spacer"></div><span class="panel-note">Runtime persona &amp; behavior presets</span></div>
    <div class="panel-b"><div class="card-grid" id="profileCards"><div class="skel"></div></div></div>
  </div>
  <div class="panel">
    <div class="panel-h"><div class="panel-t">Cadence plans</div><div class="spacer"></div><button class="btn primary sm" id="newPlanBtn">New plan</button></div>
    <div class="panel-b" id="cadencePlans"><div class="skel"></div></div>
  </div>
  <div class="g2e">
    <div class="panel">
      <div class="panel-h"><div class="panel-t g">Callback phrase tester</div></div>
      <div class="panel-b">
        <div class="fld"><label class="fld-l">What the consumer said</label><input class="in" id="cbText" placeholder="call me back tomorrow after lunch"></div>
        <div class="fld-row">
          <div class="fld"><label class="fld-l">State</label><input class="in" id="cbState" placeholder="CA" maxlength="2"></div>
          <div class="fld"><label class="fld-l">Phone</label><input class="in" id="cbPhone" placeholder="+15551234567"></div>
        </div>
        <button class="btn primary sm" id="cbRun">Parse</button>
        <div id="cbResult"></div>
      </div>
    </div>
    <div class="stack">
      <div class="panel" id="flagsPanel">
        <div class="panel-h"><div class="panel-t">Feature flags</div></div>
        <div class="panel-b" id="flagsList"><div class="skel"></div></div>
      </div>
      <div class="panel">
        <div class="panel-h"><div class="panel-t a">Sandbox</div></div>
        <div class="panel-b">
          <div class="panel-note" style="margin-bottom:10px">Seed the platform with realistic demo leads, calls, transfers and QA scores. Admin only.</div>
          <button class="btn warn sm" id="demoSeedBtn">Seed demo data</button>
        </div>
      </div>
    </div>
  </div>
</section>

<!-- ══ Tab: Reports ═════════════════════════════════════ -->
<section class="tab" id="tab-reports">
  <div class="panel">
    <div class="panel-h"><div class="panel-t">Daily flash</div><div class="spacer"></div><span class="panel-note" id="flashDate"></span></div>
    <div class="panel-b"><div class="kpi-grid" style="margin-bottom:0" id="flashGrid"><div class="skel"></div></div></div>
  </div>
  <div class="g2">
    <div class="panel">
      <div class="panel-h"><div class="panel-t">14-day trend — attempts vs buyer connects</div></div>
      <div class="panel-b"><div class="canvas-box" style="height:260px"><canvas id="trendChart"></canvas></div></div>
    </div>
    <div class="panel">
      <div class="panel-h"><div class="panel-t g">Buyer performance</div></div>
      <div class="panel-b flush tbl-wrap" id="buyerPerf"><div class="skel" style="margin:14px 18px"></div></div>
    </div>
  </div>
  <div class="panel">
    <div class="panel-h">
      <div class="panel-t">Events explorer</div>
      <div class="chip-row" id="evChips">
        <span class="chip click on" data-pre="">All</span>
        <span class="chip click" data-pre="lead.">lead.*</span>
        <span class="chip click" data-pre="call.">call.*</span>
        <span class="chip click" data-pre="transfer.">transfer.*</span>
        <span class="chip click" data-pre="policy.">policy.*</span>
        <span class="chip click" data-pre="sms.">sms.*</span>
        <span class="chip click" data-pre="dnc.">dnc.*</span>
      </div>
      <div class="spacer"></div>
      <input class="in" id="evFilter" placeholder="Filter by phone / SID / text" style="width:220px">
      <button class="btn ghost xs" id="evRefresh">Refresh</button>
    </div>
    <div class="panel-b flush tbl-wrap" id="evExplorer"><div class="skel" style="margin:14px 18px"></div></div>
  </div>
  <div class="panel">
    <div class="panel-h"><div class="panel-t a">Export compliance package</div></div>
    <div class="panel-b">
      <div class="fld-row" style="align-items:flex-end;max-width:460px">
        <div class="fld" style="margin-bottom:0"><label class="fld-l">Phone number</label><input class="in" id="repExpPhone" placeholder="+15551234567"></div>
        <button class="btn sm" id="repExpBtn" style="flex:0 0 auto">Download</button>
      </div>
    </div>
  </div>
</section>

</main>
</div>

<div id="toasts"></div>
<div id="modalRoot"></div>
<div id="drawerRoot"></div>

<script>
(function () {
  'use strict';

  /* ════════════════════════════════════════════════════════
     0. State
     ════════════════════════════════════════════════════════ */
  var state = {
    snapshot: null,
    ticker: [],
    paused: false,
    connected: false,
    es: null,
    pollTimer: null,
    reconnectTimer: null,
    charts: {},
    funnelRange: 'today',
    funnelData: null,
    breakDim: 'source',
    evPrefix: '',
    evCache: [],
    buyersCache: [],
    campaignsCache: null,
    tickCount: 0
  };

  var STAGE_TYPES = ['lead.received', 'call.attempted', 'call.answered', 'call.correct_party',
    'call.qualified', 'transfer.offered', 'transfer.accepted_by_consumer', 'transfer.initiated', 'transfer.connected'];
  var TRANSFER_STAGES = ['initiated', 'buyer_ringing', 'buyer_answered', 'consumer_connected', 'completed'];

  /* ════════════════════════════════════════════════════════
     1. Tiny DOM / format utilities
     ════════════════════════════════════════════════════════ */
  function byId(id) { return document.getElementById(id); }

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined && text !== null) n.textContent = String(text);
    return n;
  }

  function esc(s) {
    if (s === null || s === undefined) return '';
    return String(s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function fmt(n) {
    var v = Number(n);
    if (n === null || n === undefined || isNaN(v)) return '0';
    return v.toLocaleString();
  }

  function pct(v, digits) {
    var n = Number(v);
    if (isNaN(n)) return '—';
    if (n > 0 && n <= 1) n = n * 100;
    return n.toFixed(digits === undefined ? 1 : digits) + '%';
  }

  function pad2(n) { return (n < 10 ? '0' : '') + n; }

  function relTime(t) {
    if (!t) return '';
    var ms = Date.now() - new Date(t).getTime();
    if (!isFinite(ms)) return '';
    if (ms < 0) ms = 0;
    var s = Math.floor(ms / 1000);
    if (s < 10) return 'just now';
    if (s < 60) return s + 's ago';
    var m = Math.floor(s / 60);
    if (m < 60) return m + 'm ago';
    var h = Math.floor(m / 60);
    if (h < 24) return h + 'h ago';
    return Math.floor(h / 24) + 'd ago';
  }

  function elapsedStr(start) {
    var s = Math.max(0, Math.floor((Date.now() - new Date(start).getTime()) / 1000));
    if (!isFinite(s)) return '—';
    var m = Math.floor(s / 60), sec = s % 60;
    if (m >= 60) return Math.floor(m / 60) + ':' + pad2(m % 60) + ':' + pad2(sec);
    return m + ':' + pad2(sec);
  }

  function durStr(sec) {
    if (sec === null || sec === undefined || !isFinite(sec)) return '';
    if (sec < 60) return Math.round(sec) + 's';
    return Math.floor(sec / 60) + 'm ' + Math.round(sec % 60) + 's';
  }

  function uptimeStr(sec) {
    if (!sec && sec !== 0) return '—';
    var d = Math.floor(sec / 86400), h = Math.floor((sec % 86400) / 3600), m = Math.floor((sec % 3600) / 60);
    if (d > 0) return d + 'd ' + h + 'h';
    if (h > 0) return h + 'h ' + m + 'm';
    return m + 'm';
  }

  function asList(d, key) {
    if (Array.isArray(d)) return d;
    if (d && Array.isArray(d[key])) return d[key];
    if (d && Array.isArray(d.items)) return d.items;
    if (d && Array.isArray(d.rows)) return d.rows;
    if (d && Array.isArray(d.data)) return d.data;
    return [];
  }

  function animateNumber(node, target) {
    if (!node) return;
    target = Number(target) || 0;
    var cur = Number(node.dataset.v || 0);
    node.classList.remove('pending');
    if (cur === target) { node.textContent = fmt(target); return; }
    node.dataset.v = String(target);
    var startTs = null, from = cur, diff = target - cur, dur = 550;
    function step(ts) {
      if (startTs === null) startTs = ts;
      var p = Math.min(1, (ts - startTs) / dur);
      p = 1 - Math.pow(1 - p, 3);
      node.textContent = fmt(Math.round(from + diff * p));
      if (p < 1) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
  }

  function skel(container, n) {
    if (!container) return;
    container.innerHTML = '';
    for (var i = 0; i < (n || 3); i++) container.appendChild(el('div', 'skel'));
  }

  function emptyState(title, sub, icon) {
    var w = el('div', 'empty');
    w.appendChild(el('div', 'empty-ic', icon || '◌'));
    w.appendChild(el('div', 'empty-t', title));
    if (sub) w.appendChild(el('div', 'empty-s', sub));
    return w;
  }

  /* ════════════════════════════════════════════════════════
     2. API helper — 401 → /login, errors → toast
     ════════════════════════════════════════════════════════ */
  function api(path, opts) {
    opts = opts || {};
    var init = { method: opts.method || 'GET', headers: {}, credentials: 'same-origin' };
    if (opts.body !== undefined) {
      init.headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }
    return fetch(path, init).then(function (res) {
      if (res.status === 401) {
        window.location = '/login';
        throw new Error('unauthorized');
      }
      return res.text().then(function (txt) {
        var data = null;
        if (txt) { try { data = JSON.parse(txt); } catch (e) { data = null; } }
        if (!res.ok) {
          var msg = (data && (data.error || data.message)) || ('Request failed (' + res.status + ')');
          if (!opts.quiet) toast(msg, 'error');
          var err = new Error(msg);
          err.status = res.status;
          throw err;
        }
        return data;
      });
    });
  }

  /* ════════════════════════════════════════════════════════
     3. Toast / modal / drawer systems
     ════════════════════════════════════════════════════════ */
  function toast(msg, kind) {
    var wrap = byId('toasts');
    var t = el('div', 'toast ' + (kind || 'info'), msg);
    wrap.appendChild(t);
    setTimeout(function () {
      t.classList.add('out');
      setTimeout(function () { if (t.parentNode) t.parentNode.removeChild(t); }, 320);
    }, 3800);
  }

  function closeModal() { byId('modalRoot').innerHTML = ''; }

  function openModal(title, body, actions, wide) {
    closeModal();
    var back = el('div', 'modal-back');
    var m = el('div', 'modal' + (wide ? ' wide' : ''));
    var h = el('div', 'modal-h');
    h.appendChild(el('div', 'modal-title', title));
    var x = el('button', 'icon-btn', '✕');
    x.onclick = closeModal;
    h.appendChild(x);
    m.appendChild(h);
    var b = el('div', 'modal-b');
    if (typeof body === 'string') b.textContent = body; else if (body) b.appendChild(body);
    m.appendChild(b);
    if (actions && actions.length) {
      var f = el('div', 'modal-f');
      actions.forEach(function (a) {
        var btn = el('button', 'btn sm ' + (a.cls || 'ghost'), a.label);
        btn.onclick = a.onClick;
        f.appendChild(btn);
      });
      m.appendChild(f);
    }
    back.appendChild(m);
    back.addEventListener('mousedown', function (e) { if (e.target === back) closeModal(); });
    byId('modalRoot').appendChild(back);
  }

  function closeDrawer() { byId('drawerRoot').innerHTML = ''; }

  function openDrawer(title, body) {
    closeDrawer();
    var root = byId('drawerRoot');
    var back = el('div', 'drawer-back');
    back.onclick = closeDrawer;
    var d = el('div', 'drawer');
    var h = el('div', 'drawer-h');
    h.appendChild(el('div', 'drawer-title', title));
    var x = el('button', 'icon-btn', '✕');
    x.onclick = closeDrawer;
    h.appendChild(x);
    d.appendChild(h);
    var b = el('div', 'drawer-b');
    if (typeof body === 'string') b.textContent = body; else if (body) b.appendChild(body);
    d.appendChild(b);
    root.appendChild(back);
    root.appendChild(d);
    return b;
  }

  function fld(labelText, inputNode) {
    var w = el('div', 'fld');
    var l = el('label', 'fld-l', labelText);
    w.appendChild(l);
    w.appendChild(inputNode);
    return w;
  }

  function input(id, value, placeholder, type) {
    var i = el('input', 'in');
    if (id) i.id = id;
    if (type) i.type = type;
    if (placeholder) i.placeholder = placeholder;
    if (value !== undefined && value !== null) i.value = String(value);
    return i;
  }

  function chipNode(text, color) {
    return el('span', 'chip' + (color ? ' ' + color : ''), text);
  }

  /* Render an arbitrary object as a nested key/value block (safe, textContent only) */
  function renderKV(obj, depth) {
    depth = depth || 0;
    var wrap = el('div');
    if (obj === null || obj === undefined) { wrap.appendChild(el('div', 'faint tiny', '—')); return wrap; }
    if (typeof obj !== 'object') { wrap.appendChild(el('div', 'mono', String(obj))); return wrap; }
    var dl = el('dl', 'kv');
    Object.keys(obj).forEach(function (k) {
      var v = obj[k];
      var dt = el('dt', null, humanize(k));
      var dd = el('dd');
      if (v === null || v === undefined || v === '') {
        dd.appendChild(el('span', 'faint', '—'));
      } else if (Array.isArray(v)) {
        if (!v.length) { dd.appendChild(el('span', 'faint', 'none')); }
        else if (typeof v[0] === 'object') { v.forEach(function (it) { dd.appendChild(renderKV(it, depth + 1)); }); }
        else {
          var row = el('div', 'chip-row');
          v.forEach(function (it) { row.appendChild(chipNode(String(it))); });
          dd.appendChild(row);
        }
      } else if (typeof v === 'object') {
        if (depth < 4) dd.appendChild(renderKV(v, depth + 1));
        else dd.appendChild(el('span', 'mono tiny', JSON.stringify(v)));
      } else if (typeof v === 'boolean') {
        dd.appendChild(chipNode(v ? 'yes' : 'no', v ? 'green' : 'red'));
      } else {
        dd.textContent = String(v);
      }
      dl.appendChild(dt);
      dl.appendChild(dd);
    });
    wrap.appendChild(dl);
    return wrap;
  }

  function humanize(k) {
    var out = String(k).replace(/_/g, ' ').replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase();
    return out.charAt(0).toUpperCase() + out.slice(1);
  }

  /* ════════════════════════════════════════════════════════
     4. Navigation shell
     ════════════════════════════════════════════════════════ */
  var TAB_TITLES = {
    command: 'Command Center', funnel: 'Funnel', intel: 'Intelligence',
    transfers: 'Transfers', compliance: 'Compliance Center', config: 'Config Studio', reports: 'Reports'
  };
  var TAB_LOADERS = {
    funnel: loadFunnelTab, intel: loadIntelTab, transfers: loadTransfersTab,
    compliance: loadComplianceTab, config: loadConfigTab, reports: loadReportsTab
  };

  function switchTab(name) {
    var navItems = document.querySelectorAll('.nav-it');
    for (var i = 0; i < navItems.length; i++) {
      navItems[i].classList.toggle('active', navItems[i].getAttribute('data-tab') === name);
    }
    var tabs = document.querySelectorAll('.tab');
    for (var j = 0; j < tabs.length; j++) {
      tabs[j].classList.toggle('active', tabs[j].id === 'tab-' + name);
    }
    byId('pageTitle').textContent = TAB_TITLES[name] || name;
    byId('sidebar').classList.remove('open');
    byId('scrim').classList.remove('show');
    if (TAB_LOADERS[name]) TAB_LOADERS[name]();
  }

  function bindShell() {
    byId('sideNav').addEventListener('click', function (e) {
      var btn = e.target.closest('.nav-it');
      if (btn) switchTab(btn.getAttribute('data-tab'));
    });
    byId('menuBtn').onclick = function () {
      byId('sidebar').classList.add('open');
      byId('scrim').classList.add('show');
    };
    byId('scrim').onclick = function () {
      byId('sidebar').classList.remove('open');
      byId('scrim').classList.remove('show');
    };
    byId('quickCallBtn').onclick = openQuickCall;
    byId('pauseBtn').onclick = togglePause;
    byId('logoutBtn').onclick = function () {
      api('/api/v2/auth/logout', { method: 'POST', quiet: true })
        .catch(function () { /* ignore */ })
        .then(function () { window.location = '/login'; });
    };
    byId('buyerAvailRefresh').onclick = loadBuyerAvail;
  }

  /* ════════════════════════════════════════════════════════
     5. Auth badge
     ════════════════════════════════════════════════════════ */
  function loadAuth() {
    api('/api/v2/auth/me', { quiet: true }).then(function (d) {
      if (!d) return;
      var u = d.user || d;
      var name = u && (u.username || u.name || u.email);
      var enabled = d.enabled !== false && d.authEnabled !== false && !!name;
      if (!enabled) return;
      byId('userBadge').hidden = false;
      byId('logoutBtn').hidden = false;
      byId('userName').textContent = String(name);
      byId('userRole').textContent = String(u.role || '');
      byId('userAvatar').textContent = String(name).slice(0, 1).toUpperCase();
    }).catch(function () { /* auth disabled or endpoint missing — keep hidden */ });
  }

  /* ════════════════════════════════════════════════════════
     6. Pause / resume master control
     ════════════════════════════════════════════════════════ */
  function setPaused(p) {
    state.paused = !!p;
    var btn = byId('pauseBtn');
    if (state.paused) {
      btn.textContent = 'Resume outbound';
      btn.className = 'btn warn sm';
      byId('liveTxt').textContent = 'PAUSED';
      byId('livePill').classList.add('down');
    } else {
      btn.textContent = 'Pause outbound';
      btn.className = 'btn sm';
      if (state.connected) {
        byId('liveTxt').textContent = 'LIVE';
        byId('livePill').classList.remove('down');
      }
    }
  }

  function togglePause() {
    api('/api/settings/toggle-pause', { method: 'POST', body: {} }).then(function (d) {
      if (d && typeof d.paused === 'boolean') {
        setPaused(d.paused);
        toast(d.paused ? 'Outbound paused' : 'Outbound resumed', 'ok');
        return;
      }
      return api('/api/settings', { quiet: true }).then(function (s) {
        var p = !!(s && (s.autoProcessingPaused || (s.settings && s.settings.autoProcessingPaused)));
        setPaused(p);
        toast(p ? 'Outbound paused' : 'Outbound resumed', 'ok');
      });
    }).catch(function () { /* toast already shown */ });
  }

  function loadPauseState() {
    api('/api/settings', { quiet: true }).then(function (s) {
      setPaused(!!(s && (s.autoProcessingPaused || (s.settings && s.settings.autoProcessingPaused))));
    }).catch(function () { setPaused(false); });
  }

  /* ════════════════════════════════════════════════════════
     7. Quick call
     ════════════════════════════════════════════════════════ */
  function openQuickCall() {
    var body = el('div');
    var to = input('qcTo', '', '+15551234567', 'tel');
    var from = input('qcFrom', '', 'optional caller ID', 'tel');
    var fname = input('qcFirst', '', 'First name');
    var st = input('qcState', '', 'TX');
    st.maxLength = 2;
    body.appendChild(fld('To (required)', to));
    body.appendChild(fld('From', from));
    var row = el('div', 'fld-row');
    var f1 = fld('Lead first name', fname); f1.style.flex = '1';
    var f2 = fld('State', st); f2.style.flex = '1';
    row.appendChild(f1); row.appendChild(f2);
    body.appendChild(row);
    openModal('Quick outbound call', body, [
      { label: 'Cancel', onClick: closeModal },
      {
        label: 'Start call', cls: 'primary', onClick: function () {
          var num = to.value.trim();
          if (!num) { toast('A destination number is required', 'error'); return; }
          var payload = { to: num, lead: { first_name: fname.value.trim() || 'there', state: st.value.trim().toUpperCase() } };
          if (from.value.trim()) payload.from = from.value.trim();
          api('/call/start', { method: 'POST', body: payload }).then(function () {
            closeModal();
            toast('Call started to ' + num, 'ok');
          }).catch(function () { /* toast shown */ });
        }
      }
    ]);
  }

  /* ════════════════════════════════════════════════════════
     8. Live stream (SSE) with polling fallback
     ════════════════════════════════════════════════════════ */
  function setConnected(on) {
    state.connected = on;
    byId('reconnPill').hidden = on;
    if (on) {
      if (!state.paused) {
        byId('liveTxt').textContent = 'LIVE';
        byId('livePill').classList.remove('down');
      }
      byId('liveDot').className = 'dot green';
      stopPolling();
    } else {
      byId('liveTxt').textContent = 'RECONNECTING';
      byId('livePill').classList.add('down');
      byId('liveDot').className = 'dot amber';
    }
  }

  function connectStream() {
    if (state.es) { try { state.es.close(); } catch (e) { /* noop */ } state.es = null; }
    if (typeof EventSource === 'undefined') { startPolling(); return; }
    var es;
    try { es = new EventSource('/api/v2/stream'); } catch (e) { startPolling(); return; }
    state.es = es;
    es.addEventListener('snapshot', function (ev) {
      try {
        var snap = JSON.parse(ev.data);
        setConnected(true);
        applySnapshot(snap);
      } catch (e) { /* malformed frame */ }
    });
    es.addEventListener('platform', function (ev) {
      try {
        var pe = JSON.parse(ev.data);
        pushTicker(pe);
        bumpKpi(pe);
      } catch (e) { /* malformed frame */ }
    });
    es.onopen = function () { setConnected(true); };
    es.onerror = function () {
      try { es.close(); } catch (e) { /* noop */ }
      state.es = null;
      setConnected(false);
      startPolling();
      if (state.reconnectTimer) clearTimeout(state.reconnectTimer);
      state.reconnectTimer = setTimeout(connectStream, 30000);
    };
  }

  function startPolling() {
    if (state.pollTimer) return;
    var poll = function () {
      api('/api/v2/liveops', { quiet: true })
        .then(function (snap) { if (snap) applySnapshot(snap); })
        .catch(function () { /* stay in reconnecting state */ });
    };
    poll();
    state.pollTimer = setInterval(poll, 10000);
  }

  function stopPolling() {
    if (state.pollTimer) { clearInterval(state.pollTimer); state.pollTimer = null; }
  }

  /* ════════════════════════════════════════════════════════
     9. Snapshot → Command Center
     ════════════════════════════════════════════════════════ */
  function applySnapshot(s) {
    state.snapshot = s;
    animateNumber(byId('kAttempts'), s.attemptsToday);
    animateNumber(byId('kAnswered'), s.answeredToday);
    animateNumber(byId('kTransfersFlight'), s.transfersInFlight);
    animateNumber(byId('kConnects'), s.connectsToday);
    animateNumber(byId('kCallbacks'), s.callbacksPending);
    animateNumber(byId('kBlocked'), s.blockedToday);
    animateNumber(byId('kOptOuts'), s.optOutsToday);
    animateNumber(byId('kSms'), s.smsToday);
    byId('kTransfersToday').textContent = fmt(s.transfersToday) + ' completed today';
    byId('kDncSub').textContent = fmt(s.dncCount) + ' on DNC list';
    /* compliance tab mirrors */
    animateNumber(byId('cBlocked'), s.blockedToday);
    animateNumber(byId('cDnc'), s.dncCount);
    animateNumber(byId('cOptOuts'), s.optOutsToday);
    if (s.ledger && s.ledger.seq !== undefined) {
      byId('tickerSeq').textContent = 'seq ' + fmt(s.ledger.seq);
    }
    setPaused(!!s.paused);
    renderActiveCalls(s.activeCalls || []);
    renderSystemHealth(s);
    renderProviders(s.providerHealth);
    renderQaGauge(s.qa);
  }

  function renderActiveCalls(calls) {
    var tbl = byId('activeCallsTbl');
    var body = byId('activeCallsBody');
    var emptyBox = byId('activeCallsEmpty');
    var countChip = byId('activeCallCount');
    byId('queueNote').textContent = state.snapshot ? ('queue depth ' + fmt(state.snapshot.queueDepth)) : '';
    if (!calls.length) {
      tbl.hidden = true;
      countChip.hidden = true;
      emptyBox.innerHTML = '';
      emptyBox.appendChild(emptyState('No active calls', 'The dialer is idle — new calls appear here the moment they ring.', '☎'));
      return;
    }
    countChip.hidden = false;
    countChip.textContent = calls.length + ' live';
    emptyBox.innerHTML = '';
    tbl.hidden = false;
    body.innerHTML = '';
    calls.forEach(function (c) {
      var tr = el('tr', 'rowhov');
      var td0 = el('td');
      td0.style.width = '26px';
      td0.appendChild(el('span', 'dot green'));
      tr.appendChild(td0);
      tr.appendChild(el('td', null, c.leadName || 'Unknown lead'));
      var tdS = el('td');
      var stStr = String(c.status || 'live');
      var stCls = stStr.indexOf('transfer') >= 0 ? 'blue' : (stStr.indexOf('ring') >= 0 ? 'amber' : 'green');
      tdS.appendChild(chipNode(stStr, stCls));
      tr.appendChild(tdS);
      var tdE = el('td', 'num mono');
      tdE.setAttribute('data-started', c.startedAt || '');
      tdE.textContent = c.startedAt ? elapsedStr(c.startedAt) : '—';
      tr.appendChild(tdE);
      tr.appendChild(el('td', 'mono faint tiny', c.callSid ? String(c.callSid).slice(-10) : ''));
      body.appendChild(tr);
    });
  }

  function renderSystemHealth(s) {
    var h = (s && s.systemHealth) || {};
    var box = byId('sysHealth');
    box.innerHTML = '';
    var chipEl = byId('sysStatusChip');
    var stat = String(h.status || 'unknown').toLowerCase();
    chipEl.textContent = stat;
    chipEl.className = 'chip ' + (stat === 'healthy' || stat === 'ok' ? 'green' : (stat === 'degraded' || stat === 'warning' ? 'amber' : (stat === 'unknown' ? '' : 'red')));
    var util = Number(h.utilizationPct || 0);
    var mb = el('div', 'minibar');
    mb.appendChild(el('div', 'mb-l', 'Utilization'));
    var bar = el('div', 'bar');
    var fill = el('i', util > 85 ? 'r' : (util > 60 ? 'a' : 'g'));
    bar.appendChild(fill);
    mb.appendChild(bar);
    mb.appendChild(el('div', 'mb-v', Math.round(util) + '%'));
    box.appendChild(mb);
    requestAnimationFrame(function () { fill.style.width = Math.min(100, util) + '%'; });
    var dl = el('dl', 'kv');
    dl.style.marginTop = '10px';
    var rows = [
      ['Sessions', fmt(h.activeSessions) + ' / ' + fmt(h.maxSessions)],
      ['Queue size', fmt(h.queueSize)],
      ['Campaigns active', fmt(s.campaignsActive)],
      ['Uptime', uptimeStr(h.uptimeSec)]
    ];
    rows.forEach(function (r) {
      dl.appendChild(el('dt', null, r[0]));
      dl.appendChild(el('dd', 'mono', r[1]));
    });
    box.appendChild(dl);
  }

  function renderProviders(ph) {
    var box = byId('provHealth');
    box.innerHTML = '';
    var provs = (ph && ph.providers) || [];
    if (!provs.length) {
      box.appendChild(emptyState('No providers registered', 'AI voice providers will report health here.', '◈'));
      return;
    }
    provs.forEach(function (p) {
      var row = el('div');
      row.style.cssText = 'display:flex;align-items:center;gap:10px;padding:7px 0;border-bottom:1px solid rgba(148,163,184,0.07)';
      var stat = String(p.status || '').toLowerCase();
      var dotCls = !p.enabled ? 'slate' : (stat === 'healthy' || stat === 'ok' ? 'green' : (stat === 'degraded' ? 'amber' : 'red'));
      row.appendChild(el('span', 'dot ' + dotCls));
      var info = el('div');
      info.style.flex = '1';
      info.style.minWidth = '0';
      var nm = el('div', null, p.name || p.id);
      nm.style.cssText = 'font-size:13px;font-weight:600';
      info.appendChild(nm);
      info.appendChild(el('div', 'faint tiny mono', String(p.model || '')));
      row.appendChild(info);
      if (ph.activeProvider === p.id) row.appendChild(chipNode('active', 'blue'));
      var stats = el('div');
      stats.style.textAlign = 'right';
      stats.appendChild(el('div', 'mono tiny', fmt(p.avgLatencyMs) + ' ms'));
      stats.appendChild(el('div', 'faint tiny', fmt(p.failureCount) + ' fails'));
      row.appendChild(stats);
      box.appendChild(row);
    });
  }

  function renderQaGauge(qa) {
    var avg = qa ? Number(qa.avgOverall) : NaN;
    var valEl = byId('qaGaugeVal');
    var gauge = byId('qaGauge');
    if (isNaN(avg)) {
      valEl.textContent = '—';
      gauge.style.background = 'rgba(148,163,184,0.1)';
    } else {
      var frac = avg <= 5 ? avg / 5 : avg / 100;
      frac = Math.max(0, Math.min(1, frac));
      var color = frac >= 0.75 ? '#10b981' : (frac >= 0.5 ? '#f59e0b' : '#ef4444');
      valEl.textContent = avg <= 5 ? avg.toFixed(2) : Math.round(avg) + '';
      valEl.style.color = color;
      gauge.style.background = 'conic-gradient(' + color + ' 0turn, ' + color + ' ' + frac.toFixed(3) + 'turn, rgba(148,163,184,0.12) ' + frac.toFixed(3) + 'turn)';
    }
    var pend = byId('qaPending');
    pend.textContent = qa ? fmt(qa.pendingReview) : '—';
  }

  /* ════════════════════════════════════════════════════════
     10. Live ticker + optimistic KPI bumps
     ════════════════════════════════════════════════════════ */
  function typeColor(t) {
    t = String(t || '');
    if (t.indexOf('policy.blocked') === 0) return 'red';
    if (t.indexOf('dnc') === 0 || t === 'sms.stop') return 'amber';
    if (t === 'call.answered') return 'green';
    if (t.indexOf('transfer.') === 0) return 'blue';
    if (t.indexOf('call.') === 0) return 'green';
    return '';
  }

  function pushTicker(evt) {
    if (!evt || !evt.type) return;
    state.ticker.unshift(evt);
    if (state.ticker.length > 50) state.ticker.length = 50;
    var box = byId('ticker');
    var emptyBox = byId('tickerEmpty');
    if (emptyBox) emptyBox.remove();
    var it = el('div', 'tick-it ' + typeColor(evt.type));
    it.appendChild(el('span', 'tick-type', evt.type));
    if (evt.phone) it.appendChild(el('span', 'tick-phone', evt.phone));
    var meta = el('span', 'tick-meta', relTime(evt.at) || 'just now');
    meta.setAttribute('data-at', evt.at || new Date().toISOString());
    it.appendChild(meta);
    box.insertBefore(it, box.firstChild);
    while (box.children.length > 50) box.removeChild(box.lastChild);
    if (evt.seq !== undefined) byId('tickerSeq').textContent = 'seq ' + fmt(evt.seq);
  }

  var KPI_BUMP = {
    'call.attempted': 'kAttempts',
    'call.answered': 'kAnswered',
    'transfer.initiated': 'kTransfersFlight',
    'transfer.connected': 'kConnects',
    'policy.blocked': 'kBlocked',
    'sms.stop': 'kOptOuts',
    'sms.sent': 'kSms',
    'callback.scheduled': 'kCallbacks'
  };

  function bumpKpi(evt) {
    var id = KPI_BUMP[evt.type];
    if (!id) return;
    var node = byId(id);
    if (!node) return;
    animateNumber(node, Number(node.dataset.v || 0) + 1);
  }

  /* ════════════════════════════════════════════════════════
     11. Buyer availability (Command Center)
     ════════════════════════════════════════════════════════ */
  function loadBuyerAvail() {
    var box = byId('buyerAvail');
    skel(box, 3);
    api('/api/v2/buyers', { quiet: true }).then(function (d) {
      var buyers = asList(d, 'buyers');
      state.buyersCache = buyers;
      if (!buyers.length) {
        box.innerHTML = '';
        box.appendChild(emptyState('No buyers configured', 'Add transfer buyers in the Transfers tab to route live consumers.', '⇄'));
        return null;
      }
      return Promise.all(buyers.map(function (b) {
        return api('/api/v2/buyers/' + encodeURIComponent(b.id) + '/evaluate', { quiet: true })
          .catch(function () { return null; })
          .then(function (ev) { return { buyer: b, ev: ev }; });
      })).then(function (rows) {
        box.innerHTML = '';
        rows.forEach(function (r) {
          var ev = r.ev || {};
          var eligible = ev.eligible === true || (ev.eligible === undefined && ev.blocked !== true);
          var reasons = ev.reasons || ev.blocks || [];
          var row = el('div');
          row.style.cssText = 'display:flex;align-items:center;gap:12px;padding:9px 0;border-bottom:1px solid rgba(148,163,184,0.07)';
          row.appendChild(el('span', 'dot ' + (eligible ? 'green' : 'red')));
          var info = el('div');
          info.style.flex = '1';
          var nm = el('div', null, r.buyer.name || r.buyer.id);
          nm.style.cssText = 'font-size:13px;font-weight:600';
          info.appendChild(nm);
          if (!eligible && reasons.length) {
            info.appendChild(el('div', 'faint tiny', reasons.map(function (x) {
              return typeof x === 'object' ? (x.reason || x.code || JSON.stringify(x)) : String(x);
            }).join(' · ')));
          } else {
            info.appendChild(el('div', 'faint tiny', r.buyer.routeTag ? 'route: ' + r.buyer.routeTag : 'ready for transfers'));
          }
          row.appendChild(info);
          var tCount = ev.transfersToday !== undefined ? ev.transfersToday : r.buyer.transfersToday;
          if (tCount !== undefined) row.appendChild(el('span', 'mono tiny muted', fmt(tCount) + ' today'));
          row.appendChild(chipNode(eligible ? 'Eligible' : 'Blocked', eligible ? 'green' : 'red'));
          box.appendChild(row);
        });
      });
    }).catch(function () {
      box.innerHTML = '';
      box.appendChild(emptyState('Buyer service unavailable', 'Could not load buyer routing state.', '!'));
    });
  }

  /* ════════════════════════════════════════════════════════
     12. Charts plumbing
     ════════════════════════════════════════════════════════ */
  function canvasRestore(id) {
    var cv = byId(id);
    if (cv) return cv;
    var boxes = document.querySelectorAll('[data-canvas-id="' + id + '"]');
    if (!boxes.length) return null;
    boxes[0].innerHTML = '';
    cv = document.createElement('canvas');
    cv.id = id;
    boxes[0].appendChild(cv);
    return cv;
  }

  function canvasEmpty(id, title, sub) {
    if (state.charts[id]) { state.charts[id].destroy(); delete state.charts[id]; }
    var cv = byId(id);
    if (!cv) return;
    var box = cv.parentElement;
    box.setAttribute('data-canvas-id', id);
    box.innerHTML = '';
    box.appendChild(emptyState(title, sub, '◫'));
  }

  function makeChart(id, cfg) {
    if (typeof Chart === 'undefined') return;
    if (state.charts[id]) { state.charts[id].destroy(); delete state.charts[id]; }
    var cv = canvasRestore(id);
    if (!cv) return;
    if (cv.parentElement) cv.parentElement.setAttribute('data-canvas-id', id);
    state.charts[id] = new Chart(cv, cfg);
  }

  function darkScales(hideX) {
    return {
      x: { grid: { display: false }, border: { color: 'rgba(148,163,184,0.15)' }, ticks: { color: '#5c6680', font: { size: 10 }, display: !hideX } },
      y: { beginAtZero: true, grid: { color: 'rgba(148,163,184,0.07)' }, border: { display: false }, ticks: { color: '#5c6680', font: { size: 10 }, maxTicksLimit: 5 } }
    };
  }

  /* ════════════════════════════════════════════════════════
     13. Funnel tab
     ════════════════════════════════════════════════════════ */
  function sinceFor(range) {
    var d = new Date();
    if (range === 'today') d.setHours(0, 0, 0, 0);
    else if (range === '7d') d.setDate(d.getDate() - 7);
    else d.setDate(d.getDate() - 30);
    return d.toISOString();
  }

  function bindChipGroup(containerId, attr, onPick) {
    var box = byId(containerId);
    if (!box) return;
    box.addEventListener('click', function (e) {
      var chip = e.target.closest('.chip');
      if (!chip || !box.contains(chip)) return;
      var all = box.querySelectorAll('.chip');
      for (var i = 0; i < all.length; i++) all[i].classList.remove('on');
      chip.classList.add('on');
      onPick(chip.getAttribute(attr) || '');
    });
  }

  function loadFunnelTab() { loadFunnel(); loadBreakdown(state.breakDim); }

  function loadFunnel() {
    var box = byId('funnelStages');
    skel(box, 6);
    api('/api/v2/funnel?since=' + encodeURIComponent(sinceFor(state.funnelRange)), { quiet: true }).then(function (f) {
      state.funnelData = f;
      box.innerHTML = '';
      var stages = (f && f.stages) || [];
      if (!stages.length) {
        box.appendChild(emptyState('No funnel data yet', 'Once leads arrive and dialing begins, conversion stages fill in here.', '▤'));
        renderFunnelStats(f);
        return;
      }
      var max = 0;
      stages.forEach(function (s) { max = Math.max(max, Number(s.count) || 0); });
      stages.forEach(function (s, i) {
        if (i > 0) {
          var conv = el('div', 'fs-conv');
          conv.appendChild(el('span', null, 'stage conversion '));
          conv.appendChild(el('b', null, pct(s.conversionFromPrev)));
          box.appendChild(conv);
        }
        var st = el('div', 'fstage');
        st.title = 'Click to inspect raw events';
        var top = el('div', 'fs-top');
        top.appendChild(el('span', 'fs-label', s.label || s.key));
        top.appendChild(el('span', 'fs-count', fmt(s.count)));
        st.appendChild(top);
        var bar = el('div', 'fs-bar');
        var fill = el('i');
        bar.appendChild(fill);
        st.appendChild(bar);
        st.onclick = (function (stage, idx) { return function () { openStageDrawer(stage, idx); }; })(s, i);
        box.appendChild(st);
        var w = max > 0 ? Math.max(1.5, (Number(s.count) || 0) / max * 100) : 1.5;
        setTimeout(function () { fill.style.width = w + '%'; }, 40 + i * 55);
      });
      renderFunnelStats(f);
    }).catch(function () {
      box.innerHTML = '';
      box.appendChild(emptyState('Funnel unavailable', 'Could not reach /api/v2/funnel.', '!'));
    });
  }

  function renderFunnelStats(f) {
    var box = byId('funnelStats');
    box.innerHTML = '';
    if (!f) { box.appendChild(emptyState('No data', 'Side-flow stats appear once events are recorded.')); return; }
    var rows = [
      ['Compliance blocked', f.blocked, 'red'],
      ['Opt-outs', f.optOuts, 'amber'],
      ['SMS sent', f.smsSent, 'blue'],
      ['Callbacks scheduled', f.callbacksScheduled, 'green']
    ];
    rows.forEach(function (r) {
      var row = el('div');
      row.style.cssText = 'display:flex;align-items:center;gap:10px;padding:10px 0;border-bottom:1px solid rgba(148,163,184,0.07)';
      row.appendChild(el('span', 'dot ' + r[2]));
      var lab = el('span', null, r[0]);
      lab.style.flex = '1';
      row.appendChild(lab);
      var v = el('span', 'mono', fmt(r[1]));
      v.style.fontWeight = '700';
      row.appendChild(v);
      box.appendChild(row);
    });
    if (f.since) {
      var note = el('div', 'faint tiny');
      note.style.marginTop = '10px';
      note.textContent = 'Window: ' + new Date(f.since).toLocaleString() + ' → ' + (f.until ? new Date(f.until).toLocaleString() : 'now');
      box.appendChild(note);
    }
  }

  function openStageDrawer(stage, idx) {
    var type = STAGE_TYPES.indexOf(stage.key) >= 0 ? stage.key : (STAGE_TYPES[idx] || stage.key);
    var body = openDrawer((stage.label || stage.key) + ' — raw events');
    skel(body, 5);
    api('/api/v2/events?type=' + encodeURIComponent(type) + '&limit=50', { quiet: true }).then(function (d) {
      var events = asList(d, 'events');
      body.innerHTML = '';
      var head = el('div', 'chip-row');
      head.style.marginBottom = '12px';
      head.appendChild(chipNode(type, 'blue'));
      head.appendChild(chipNode(events.length + ' events'));
      body.appendChild(head);
      if (!events.length) {
        body.appendChild(emptyState('No events of this type yet', 'They will land here as the platform emits them.'));
        return;
      }
      events.forEach(function (evt) {
        var card = el('div', 'sub-card');
        card.style.marginBottom = '9px';
        var top = el('div');
        top.style.cssText = 'display:flex;align-items:center;gap:9px;margin-bottom:5px';
        if (evt.phone) top.appendChild(el('span', 'mono', evt.phone));
        if (evt.callSid) top.appendChild(el('span', 'faint tiny mono', '…' + String(evt.callSid).slice(-8)));
        var when = el('span', 'faint tiny', relTime(evt.at));
        when.style.marginLeft = 'auto';
        top.appendChild(when);
        card.appendChild(top);
        if (evt.data && Object.keys(evt.data).length) {
          var pre = el('pre', 'code', JSON.stringify(evt.data, null, 2));
          pre.style.marginTop = '4px';
          card.appendChild(pre);
        }
        body.appendChild(card);
      });
    }).catch(function () {
      body.innerHTML = '';
      body.appendChild(emptyState('Events unavailable', 'Could not load the raw event feed.'));
    });
  }

  function loadBreakdown(dim) {
    var box = byId('breakTable');
    box.innerHTML = '';
    box.appendChild(el('div', 'skel')).style.margin = '14px 18px';
    api('/api/v2/breakdown/' + encodeURIComponent(dim), { quiet: true }).then(function (d) {
      var rows = asList(d, 'rows');
      box.innerHTML = '';
      if (!rows.length) {
        box.appendChild(emptyState('Nothing to break down yet', 'Lead and call activity by ' + dim + ' will appear here.', '▦'));
        return;
      }
      rows.sort(function (a, b) { return (Number(b.leads) || 0) - (Number(a.leads) || 0); });
      var tbl = el('table', 'tbl');
      var thead = el('thead');
      var hr = el('tr');
      [humanize(dim), 'Leads', 'Attempts', 'Answered', 'Qualified', 'Transfers', 'Connects', 'Transfer rate'].forEach(function (h, i) {
        hr.appendChild(el('th', i === 0 ? '' : 'num', h));
      });
      thead.appendChild(hr);
      tbl.appendChild(thead);
      var tbody = el('tbody');
      rows.forEach(function (r) {
        var tr = el('tr', 'rowhov');
        var keyVal = r.key !== undefined ? r.key : (r.value !== undefined ? r.value : (r.name !== undefined ? r.name : r[dim]));
        tr.appendChild(el('td', null, keyVal === undefined || keyVal === null || keyVal === '' ? '(unknown)' : String(keyVal)));
        ['leads', 'attempts', 'answered', 'qualified', 'transfers', 'connects'].forEach(function (k) {
          tr.appendChild(el('td', 'num mono', fmt(r[k])));
        });
        var rateTd = el('td', 'num mono');
        rateTd.textContent = r.transferRate === undefined ? '—' : pct(r.transferRate);
        tr.appendChild(rateTd);
        tbody.appendChild(tr);
      });
      tbl.appendChild(tbody);
      box.appendChild(tbl);
    }).catch(function () {
      box.innerHTML = '';
      box.appendChild(emptyState('Breakdown unavailable', 'Could not reach /api/v2/breakdown/' + dim + '.'));
    });
  }

  /* ════════════════════════════════════════════════════════
     14. Intelligence tab
     ════════════════════════════════════════════════════════ */
  function loadIntelTab() {
    api('/api/v2/intelligence', { quiet: true }).then(function (d) {
      d = d || {};
      renderQaPanel(d.qa || {});
      renderRiskFlags(d.qa || {});
      renderObjections(d.objections || []);
      renderFlagged(d.recentFlagged || []);
    }).catch(function () {
      byId('objections').innerHTML = '';
      byId('objections').appendChild(emptyState('Intelligence unavailable', 'Could not reach /api/v2/intelligence.'));
    });
  }

  function renderQaPanel(qa) {
    byId('qaScoredNote').textContent = fmt(qa.scored) + ' scored · avg ' + (qa.avgOverall !== undefined ? Number(qa.avgOverall).toFixed(1) : '—') + ' · ' + fmt(qa.flagged) + ' flagged';
    var dims = qa.dimensionAverages || {};
    var labels = Object.keys(dims);
    if (!labels.length) {
      canvasEmpty('qaDimChart', 'No QA scores yet', 'Dimension averages appear after calls are scored.');
      return;
    }
    makeChart('qaDimChart', {
      type: 'bar',
      data: {
        labels: labels.map(humanize),
        datasets: [{
          data: labels.map(function (k) { return Number(dims[k]) || 0; }),
          backgroundColor: 'rgba(59,130,246,0.45)',
          borderColor: '#3b82f6',
          borderWidth: 1,
          borderRadius: 5,
          maxBarThickness: 42
        }]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: darkScales(false)
      }
    });
  }

  function renderRiskFlags(qa) {
    var box = byId('riskFlags');
    box.innerHTML = '';
    var flags = qa.topRiskFlags || [];
    if (!flags.length) {
      box.appendChild(emptyState('No risk flags', 'A clean sheet — the QA engine found nothing to worry about.', '✓'));
      return;
    }
    var max = 0;
    flags.forEach(function (f) { max = Math.max(max, Number(f.count) || 0); });
    flags.forEach(function (f) {
      var mb = el('div', 'minibar');
      mb.appendChild(el('div', 'mb-l', f.flag));
      var bar = el('div', 'bar');
      var fill = el('i', 'r');
      bar.appendChild(fill);
      mb.appendChild(bar);
      mb.appendChild(el('div', 'mb-v', fmt(f.count)));
      box.appendChild(mb);
      var w = max ? (Number(f.count) || 0) / max * 100 : 0;
      setTimeout(function () { fill.style.width = w + '%'; }, 60);
    });
  }

  function renderObjections(objs) {
    var box = byId('objections');
    box.innerHTML = '';
    if (!objs.length) {
      box.appendChild(emptyState('No objections logged yet', 'When consumers push back, objections and rebuttal experiments show up here.', '❝'));
      return;
    }
    objs.sort(function (a, b) { return (Number(b.occurrences) || 0) - (Number(a.occurrences) || 0); });
    var maxOcc = 0;
    objs.forEach(function (o) { maxOcc = Math.max(maxOcc, Number(o.occurrences) || 0); });
    objs.forEach(function (o) {
      var row = el('div', 'obj-row');
      var head = el('div', 'obj-head');
      head.appendChild(el('span', 'caret', '▶'));
      var lab = el('div');
      lab.style.cssText = 'flex:1;min-width:0';
      var nm = el('div', null, o.label || o.code);
      nm.style.cssText = 'font-size:13.5px;font-weight:600';
      lab.appendChild(nm);
      lab.appendChild(el('div', 'faint tiny mono', o.code));
      head.appendChild(lab);
      var occ = el('div');
      occ.style.cssText = 'width:160px;flex-shrink:0';
      var occTop = el('div', 'tiny muted', fmt(o.occurrences) + ' occurrences');
      occ.appendChild(occTop);
      var bar = el('div', 'bar');
      var fill = el('i', 'a');
      bar.appendChild(fill);
      occ.appendChild(bar);
      head.appendChild(occ);
      setTimeout(function () { fill.style.width = (maxOcc ? (Number(o.occurrences) || 0) / maxOcc * 100 : 0) + '%'; }, 60);
      var adv = el('div');
      adv.style.cssText = 'width:110px;text-align:right;flex-shrink:0';
      adv.appendChild(el('div', null, pct(o.advanceRate)));
      adv.appendChild(el('div', 'faint tiny', 'advance rate'));
      head.appendChild(adv);
      if (o.bestVariantId) head.appendChild(chipNode('best: ' + o.bestVariantId, 'green'));
      row.appendChild(head);

      var bodyBox = el('div', 'obj-body');
      var variants = o.variants || [];
      if (variants.length) {
        var wrap = el('div', 'tbl-wrap');
        var tbl = el('table', 'tbl');
        var thr = el('tr');
        ['Variant', 'Status', 'Uses', 'Advanced', 'Transfers', 'Callbacks', 'Opt-outs', 'Hangups', ''].forEach(function (h, i) {
          thr.appendChild(el('th', i > 1 && i < 8 ? 'num' : '', h));
        });
        var thead = el('thead');
        thead.appendChild(thr);
        tbl.appendChild(thead);
        var tb = el('tbody');
        variants.forEach(function (v) {
          var tr = el('tr', 'rowhov');
          var vd = el('td');
          var vid = el('div', 'mono tiny', v.id + (v.version !== undefined ? ' · v' + v.version : ''));
          vd.appendChild(vid);
          var txt = String(v.text || '');
          var short = txt.length > 90 ? txt.slice(0, 87) + '…' : txt;
          var t = el('div', 'muted tiny', short);
          t.title = txt;
          vd.appendChild(t);
          tr.appendChild(vd);
          var sd = el('td');
          var isActive = String(v.status || '') === 'active';
          sd.appendChild(chipNode(v.status || 'unknown', isActive ? 'green' : ''));
          tr.appendChild(sd);
          ['uses', 'advanced', 'transfers', 'callbacks', 'optOuts', 'hangups'].forEach(function (k) {
            tr.appendChild(el('td', 'num mono', fmt(v[k])));
          });
          var act = el('td');
          var tog = el('button', 'btn ghost xs', isActive ? 'Pause' : 'Activate');
          tog.onclick = function () {
            api('/api/v2/rebuttals/' + encodeURIComponent(o.code) + '/variants/' + encodeURIComponent(v.id), {
              method: 'PUT', body: { status: isActive ? 'paused' : 'active' }
            }).then(function () {
              toast('Variant ' + (isActive ? 'paused' : 'activated'), 'ok');
              loadIntelTab();
            }).catch(function () { /* toast shown */ });
          };
          act.appendChild(tog);
          tr.appendChild(act);
          tb.appendChild(tr);
        });
        tbl.appendChild(tb);
        wrap.appendChild(tbl);
        bodyBox.appendChild(wrap);
      } else {
        bodyBox.appendChild(el('div', 'faint tiny', 'No rebuttal variants yet — add the first one below.'));
      }
      var addRow = el('div', 'fld-row');
      addRow.style.marginTop = '11px';
      var addIn = input(null, '', 'New rebuttal variant text…');
      addRow.appendChild(addIn);
      var addBtn = el('button', 'btn primary sm', 'Add variant');
      addBtn.style.flex = '0 0 auto';
      addBtn.onclick = function () {
        var text = addIn.value.trim();
        if (!text) { toast('Variant text is required', 'error'); return; }
        api('/api/v2/rebuttals/' + encodeURIComponent(o.code) + '/variants', { method: 'POST', body: { text: text } })
          .then(function () { toast('Variant added to experiment', 'ok'); loadIntelTab(); })
          .catch(function () { /* toast shown */ });
      };
      addRow.appendChild(addBtn);
      bodyBox.appendChild(addRow);
      row.appendChild(bodyBox);
      head.onclick = function (e) {
        if (e.target.closest('button')) return;
        row.classList.toggle('open');
      };
      box.appendChild(row);
    });
  }

  function renderFlagged(list) {
    var box = byId('flaggedList');
    box.innerHTML = '';
    if (!list.length) {
      box.appendChild(emptyState('Review queue is clear', 'No flagged calls waiting — the QA engine will queue anything risky here.', '✓'));
      return;
    }
    var grid = el('div', 'card-grid');
    list.forEach(function (q) {
      var id = q.id || q.qaId || q.scoreId;
      var overall = Number(q.overall !== undefined ? q.overall : (q.avgOverall !== undefined ? q.avgOverall : q.score));
      var dims = q.dimensions || q.dimensionScores || {};
      var flags = q.riskFlags || q.flags || [];
      var card = el('div', 'sub-card');
      var top = el('div');
      top.style.cssText = 'display:flex;align-items:center;gap:10px;margin-bottom:8px';
      var score = el('div', null, isNaN(overall) ? '—' : (overall <= 5 ? overall.toFixed(1) : Math.round(overall)));
      var frac = isNaN(overall) ? 0 : (overall <= 5 ? overall / 5 : overall / 100);
      score.style.cssText = 'font-size:22px;font-weight:800;color:' + (frac >= 0.75 ? '#10b981' : (frac >= 0.5 ? '#f59e0b' : '#ef4444'));
      top.appendChild(score);
      var meta = el('div');
      meta.style.flex = '1';
      meta.appendChild(el('div', 'mono tiny', q.callSid ? '…' + String(q.callSid).slice(-10) : 'call'));
      meta.appendChild(el('div', 'faint tiny', relTime(q.at || q.scoredAt || q.createdAt)));
      top.appendChild(meta);
      var rev = el('button', 'btn primary xs', 'Review');
      rev.onclick = function () { openReviewModal(id, q); };
      top.appendChild(rev);
      card.appendChild(top);
      if (flags.length) {
        var fr = el('div', 'chip-row');
        fr.style.marginBottom = '8px';
        flags.forEach(function (f) { fr.appendChild(chipNode(String(f), 'amber')); });
        card.appendChild(fr);
      }
      Object.keys(dims).slice(0, 5).forEach(function (k) {
        var v = Number(dims[k]) || 0;
        var f2 = v <= 5 ? v / 5 : v / 100;
        var mb = el('div', 'minibar');
        mb.appendChild(el('div', 'mb-l', humanize(k)));
        var bar = el('div', 'bar');
        var fill = el('i', f2 >= 0.75 ? 'g' : (f2 >= 0.5 ? 'a' : 'r'));
        bar.appendChild(fill);
        mb.appendChild(bar);
        mb.appendChild(el('div', 'mb-v', v <= 5 ? v.toFixed(1) : Math.round(v) + ''));
        card.appendChild(mb);
        setTimeout(function () { fill.style.width = Math.min(100, f2 * 100) + '%'; }, 60);
      });
      grid.appendChild(card);
    });
    box.appendChild(grid);
  }

  function openReviewModal(id, q) {
    var body = el('div');
    body.appendChild(el('div', 'panel-note', 'Mark this flagged call as reviewed and leave a note for the audit trail.'));
    var ta = el('textarea', 'in');
    ta.placeholder = 'Review note (what you checked, outcome, coaching needed…)';
    var w = fld('Note', ta);
    w.style.marginTop = '12px';
    body.appendChild(w);
    openModal('Review flagged call', body, [
      { label: 'Cancel', onClick: closeModal },
      {
        label: 'Mark reviewed', cls: 'primary', onClick: function () {
          if (!id) { toast('Missing QA score id', 'error'); return; }
          api('/api/v2/qa/' + encodeURIComponent(id) + '/review', { method: 'POST', body: { note: ta.value.trim() } })
            .then(function () { closeModal(); toast('Call marked as reviewed', 'ok'); loadIntelTab(); })
            .catch(function () { /* toast shown */ });
        }
      }
    ]);
  }

  /* ════════════════════════════════════════════════════════
     15. Transfers tab
     ════════════════════════════════════════════════════════ */
  var STAGE_SHORT = { initiated: 'init', buyer_ringing: 'ringing', buyer_answered: 'buyer up', consumer_connected: 'bridged', completed: 'done', failed: 'failed' };

  function loadTransfersTab() { loadTransfers(); loadBuyerCards(); }

  function loadTransfers() {
    var box = byId('transfersList');
    box.innerHTML = '';
    var s1 = el('div', 'skel'); s1.style.margin = '14px 18px'; box.appendChild(s1);
    api('/api/v2/transfers?limit=100', { quiet: true }).then(function (d) {
      var list = asList(d, 'transfers');
      box.innerHTML = '';
      if (!list.length) {
        box.appendChild(emptyState('No transfers yet today', 'When the agent hands a qualified consumer to a buyer, the full timeline lands here.', '⇄'));
        return;
      }
      var wrap = el('div', 'tbl-wrap');
      var tbl = el('table', 'tbl');
      var thead = el('thead');
      var hr = el('tr');
      ['Buyer', 'Consumer', 'Pipeline', 'Status', 'Age', ''].forEach(function (h) { hr.appendChild(el('th', null, h)); });
      thead.appendChild(hr);
      tbl.appendChild(thead);
      var tb = el('tbody');
      list.forEach(function (t) {
        var tr = el('tr', 'rowhov');
        var bd = el('td');
        var bn = el('div', null, t.buyerName || '(unrouted)');
        bn.style.fontWeight = '600';
        bd.appendChild(bn);
        bd.appendChild(el('div', 'faint tiny mono', t.callSid ? '…' + String(t.callSid).slice(-8) : ''));
        tr.appendChild(bd);
        tr.appendChild(el('td', 'mono', t.phone || '—'));
        var flowTd = el('td');
        flowTd.appendChild(buildStageFlow(t));
        tr.appendChild(flowTd);
        var stTd = el('td');
        var cur = String(t.currentStage || '');
        var cls = cur === 'completed' ? 'green' : (cur === 'failed' ? 'red' : 'blue');
        var chip = chipNode(STAGE_SHORT[cur] || cur || 'pending', cls);
        if (cur === 'failed' && t.failureReason) chip.title = t.failureReason;
        stTd.appendChild(chip);
        if (cur === 'failed' && t.failureReason) stTd.appendChild(el('div', 'faint tiny', t.failureReason));
        tr.appendChild(stTd);
        tr.appendChild(el('td', 'faint tiny', relTime(t.createdAt)));
        var actTd = el('td');
        if (t.hasPacket) {
          var pb = el('button', 'btn ghost xs', 'View packet');
          pb.onclick = function () { openPacketDrawer(t); };
          actTd.appendChild(pb);
        }
        tr.appendChild(actTd);
        tb.appendChild(tr);
      });
      tbl.appendChild(tb);
      wrap.appendChild(tbl);
      box.appendChild(wrap);
    }).catch(function () {
      box.innerHTML = '';
      box.appendChild(emptyState('Transfers unavailable', 'Could not reach /api/v2/transfers.'));
    });
  }

  function buildStageFlow(t) {
    var flow = el('div', 'stage-flow');
    var stages = t.stages || {};
    var prevTs = null;
    var any = false;
    TRANSFER_STAGES.forEach(function (key) {
      var ts = stages[key];
      if (!ts) return;
      if (any) flow.appendChild(el('span', 'stage-sep', '→'));
      any = true;
      var label = STAGE_SHORT[key] || key;
      var dur = null;
      if (prevTs) dur = (new Date(ts).getTime() - new Date(prevTs).getTime()) / 1000;
      var text = label + (dur !== null && isFinite(dur) && dur >= 0 ? ' +' + durStr(dur) : '');
      var c = chipNode(text, key === 'completed' ? 'green' : 'blue');
      c.title = new Date(ts).toLocaleTimeString();
      flow.appendChild(c);
      prevTs = ts;
    });
    if (stages.failed) {
      if (any) flow.appendChild(el('span', 'stage-sep', '→'));
      var fc = chipNode('failed', 'red');
      fc.title = t.failureReason || '';
      flow.appendChild(fc);
      any = true;
    }
    if (!any) flow.appendChild(el('span', 'faint tiny', 'no stage data'));
    return flow;
  }

  function openPacketDrawer(t) {
    var body = openDrawer('Handoff packet — ' + (t.buyerName || t.id));
    skel(body, 5);
    api('/api/v2/transfers/' + encodeURIComponent(t.id) + '/packet', { quiet: true }).then(function (p) {
      body.innerHTML = '';
      if (!p) { body.appendChild(emptyState('Packet empty', 'No structured handoff data was recorded for this transfer.')); return; }
      var head = el('div', 'chip-row');
      head.style.marginBottom = '14px';
      head.appendChild(chipNode(t.buyerName || 'buyer', 'blue'));
      if (t.phone) head.appendChild(chipNode(t.phone, 'mono'));
      body.appendChild(head);
      body.appendChild(renderKV(p));
    }).catch(function () {
      body.innerHTML = '';
      body.appendChild(emptyState('Packet unavailable', 'Could not load the handoff packet.'));
    });
  }

  /* ── Buyer manager ─────────────────────────────────────── */
  function loadBuyerCards() {
    var box = byId('buyerCards');
    box.innerHTML = '';
    box.appendChild(el('div', 'skel'));
    api('/api/v2/buyers', { quiet: true }).then(function (d) {
      var buyers = asList(d, 'buyers');
      state.buyersCache = buyers;
      box.innerHTML = '';
      if (!buyers.length) {
        box.appendChild(emptyState('No buyers yet', 'Add your first transfer buyer to start routing live consumers.', '+'));
        return;
      }
      buyers.forEach(function (b) {
        var card = el('div', 'sub-card');
        var top = el('div');
        top.style.cssText = 'display:flex;align-items:center;gap:9px;margin-bottom:9px';
        var h4 = el('h4', null, b.name || b.id);
        h4.style.flex = '1';
        top.appendChild(h4);
        top.appendChild(chipNode(b.active === false ? 'inactive' : 'active', b.active === false ? '' : 'green'));
        card.appendChild(top);
        var dl = el('dl', 'kv');
        var rows = [
          ['Destination', b.destinationNumber || '—'],
          ['Priority', b.priority !== undefined ? String(b.priority) : '—'],
          ['Daily cap', b.dailyCap !== undefined ? fmt(b.dailyCap) : '—'],
          ['Route tag', b.routeTag || '—'],
          ['Hours', typeof b.hours === 'object' && b.hours ? JSON.stringify(b.hours) : (b.hours || '—')]
        ];
        rows.forEach(function (r) {
          dl.appendChild(el('dt', null, r[0]));
          dl.appendChild(el('dd', 'mono tiny', r[1]));
        });
        card.appendChild(dl);
        if (Array.isArray(b.states) && b.states.length) {
          var sr = el('div', 'chip-row');
          sr.style.margin = '9px 0 0';
          b.states.slice(0, 12).forEach(function (s) { sr.appendChild(chipNode(s)); });
          if (b.states.length > 12) sr.appendChild(chipNode('+' + (b.states.length - 12) + ' more'));
          card.appendChild(sr);
        }
        var acts = el('div');
        acts.style.cssText = 'display:flex;gap:8px;margin-top:12px';
        var edit = el('button', 'btn ghost xs', 'Edit');
        edit.onclick = function () { buyerModal(b); };
        acts.appendChild(edit);
        var del = el('button', 'btn danger xs', 'Delete');
        del.onclick = function () {
          if (!window.confirm('Delete buyer "' + (b.name || b.id) + '"? Transfers will no longer route to them.')) return;
          api('/api/v2/buyers/' + encodeURIComponent(b.id), { method: 'DELETE' }).then(function () {
            toast('Buyer deleted', 'ok');
            loadBuyerCards();
            loadBuyerAvail();
          }).catch(function () { /* toast shown */ });
        };
        acts.appendChild(del);
        card.appendChild(acts);
        box.appendChild(card);
      });
    }).catch(function () {
      box.innerHTML = '';
      box.appendChild(emptyState('Buyers unavailable', 'Could not reach /api/v2/buyers.'));
    });
  }

  function buyerModal(b) {
    var isNew = !b;
    b = b || {};
    var body = el('div');
    var name = input(null, b.name || '', 'Acme Insurance Desk');
    var dest = input(null, b.destinationNumber || '', '+18005551234', 'tel');
    var prio = input(null, b.priority !== undefined ? b.priority : 1, '1', 'number');
    var cap = input(null, b.dailyCap !== undefined ? b.dailyCap : 25, '25', 'number');
    var states = input(null, Array.isArray(b.states) ? b.states.join(', ') : (b.states || ''), 'TX, FL, CA');
    var route = input(null, b.routeTag || '', 'auto-standard');
    var hours = el('textarea', 'in');
    hours.rows = 3;
    hours.placeholder = 'Hours as JSON, e.g. {"start":9,"end":18}';
    if (b.hours !== undefined && b.hours !== null) {
      hours.value = typeof b.hours === 'object' ? JSON.stringify(b.hours, null, 2) : String(b.hours);
    }
    var activeChk = el('input');
    activeChk.type = 'checkbox';
    activeChk.checked = b.active !== false;
    body.appendChild(fld('Name', name));
    body.appendChild(fld('Destination number', dest));
    var r1 = el('div', 'fld-row');
    r1.appendChild(fld('Priority', prio));
    r1.appendChild(fld('Daily cap', cap));
    body.appendChild(r1);
    body.appendChild(fld('Licensed states (comma-separated)', states));
    var r2 = el('div', 'fld-row');
    r2.appendChild(fld('Route tag', route));
    body.appendChild(r2);
    body.appendChild(fld('Hours', hours));
    var lab = el('label', 'check');
    lab.appendChild(activeChk);
    lab.appendChild(el('span', null, 'Active — eligible to receive transfers'));
    body.appendChild(lab);
    openModal(isNew ? 'Add buyer' : 'Edit buyer — ' + (b.name || b.id), body, [
      { label: 'Cancel', onClick: closeModal },
      {
        label: isNew ? 'Create buyer' : 'Save changes', cls: 'primary', onClick: function () {
          if (!name.value.trim() || !dest.value.trim()) { toast('Name and destination number are required', 'error'); return; }
          var hoursVal = hours.value.trim();
          var hoursParsed = hoursVal;
          if (hoursVal) { try { hoursParsed = JSON.parse(hoursVal); } catch (e) { /* keep raw string */ } }
          var payload = {
            id: b.id || ('buyer-' + Date.now().toString(36)),
            name: name.value.trim(),
            destinationNumber: dest.value.trim(),
            priority: Number(prio.value) || 0,
            dailyCap: Number(cap.value) || 0,
            states: states.value.split(',').map(function (s) { return s.trim().toUpperCase(); }).filter(function (s) { return s.length > 0; }),
            routeTag: route.value.trim(),
            hours: hoursParsed || undefined,
            active: activeChk.checked
          };
          api('/api/v2/buyers', { method: 'POST', body: payload }).then(function () {
            closeModal();
            toast(isNew ? 'Buyer created' : 'Buyer updated', 'ok');
            loadBuyerCards();
            loadBuyerAvail();
          }).catch(function () { /* toast shown */ });
        }
      }
    ]);
  }

<!--NEXT-->
</html>`;
}
