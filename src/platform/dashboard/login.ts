// ── Login page ─────────────────────────────────────────────────────
// Minimal dark login screen for the command center. Served at /login;
// posts to /api/v2/auth/login which sets the qf_session cookie.

export function getLoginHtml(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Quoting Fast — Sign in</title>
<style>
  :root { color-scheme: dark; }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    background: #07090f;
    color: #e6e9f0;
    min-height: 100vh;
    display: flex; align-items: center; justify-content: center;
  }
  body::before {
    content: ''; position: fixed; inset: 0;
    background:
      radial-gradient(600px 400px at 20% 10%, rgba(56,130,246,.12), transparent 60%),
      radial-gradient(700px 500px at 85% 90%, rgba(16,185,129,.08), transparent 60%);
    pointer-events: none;
  }
  .card {
    position: relative; width: 380px; padding: 40px 36px;
    background: rgba(15,19,30,.85); border: 1px solid rgba(120,140,180,.14);
    border-radius: 16px; box-shadow: 0 24px 80px rgba(0,0,0,.5);
  }
  .brand { display: flex; align-items: center; gap: 12px; margin-bottom: 28px; }
  .brand .dot { width: 10px; height: 10px; border-radius: 50%; background: #10b981; box-shadow: 0 0 12px #10b981; }
  .brand h1 { font-size: 17px; font-weight: 700; letter-spacing: .02em; }
  .brand span { color: #6b7690; font-weight: 500; }
  label { display: block; font-size: 12px; color: #9aa4bc; margin: 16px 0 6px; letter-spacing: .04em; text-transform: uppercase; }
  input {
    width: 100%; padding: 12px 14px; border-radius: 10px;
    border: 1px solid rgba(120,140,180,.18); background: #0b0f19; color: #e6e9f0;
    font-size: 15px; outline: none; transition: border-color .15s;
  }
  input:focus { border-color: #3b82f6; }
  button {
    width: 100%; margin-top: 24px; padding: 13px; border: none; border-radius: 10px;
    background: linear-gradient(135deg, #2563eb, #3b82f6); color: #fff;
    font-size: 15px; font-weight: 600; cursor: pointer; transition: filter .15s;
  }
  button:hover { filter: brightness(1.1); }
  button:disabled { filter: grayscale(.6); cursor: wait; }
  .error { margin-top: 14px; font-size: 13px; color: #f87171; min-height: 18px; text-align: center; }
</style>
</head>
<body>
  <form class="card" id="loginForm">
    <div class="brand"><div class="dot"></div><h1>Quoting Fast <span>· Command Center</span></h1></div>
    <label for="username">Username</label>
    <input id="username" autocomplete="username" required autofocus>
    <label for="password">Password</label>
    <input id="password" type="password" autocomplete="current-password" required>
    <button type="submit" id="submitBtn">Sign in</button>
    <div class="error" id="error"></div>
  </form>
<script>
document.getElementById('loginForm').addEventListener('submit', async function (e) {
  e.preventDefault();
  var btn = document.getElementById('submitBtn');
  var err = document.getElementById('error');
  btn.disabled = true; err.textContent = '';
  try {
    var res = await fetch('/api/v2/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: document.getElementById('username').value,
        password: document.getElementById('password').value,
      }),
    });
    var data = await res.json();
    if (res.ok) { window.location.href = '/dashboard'; return; }
    err.textContent = data.error || 'Sign-in failed';
  } catch (ex) {
    err.textContent = 'Network error — try again';
  }
  btn.disabled = false;
});
</script>
</body>
</html>`;
}
