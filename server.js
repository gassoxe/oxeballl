const http = require('http');
const fs   = require('fs');
const path = require('path');
const crypto = require('crypto');

// ─── DATA FILES ───────────────────────────────────────────────────────────────
const DATA_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR);

function dbPath(name) { return path.join(DATA_DIR, name + '.json'); }

function readDB(name) {
  try { return JSON.parse(fs.readFileSync(dbPath(name), 'utf8')); }
  catch(e) { return {}; }
}

function writeDB(name, data) {
  fs.writeFileSync(dbPath(name), JSON.stringify(data, null, 2));
}

// Initialize default config if missing
if (!readDB('config').rate) {
  writeDB('config', {
    rate: 20, minBet: 10, maxBet: 100000,
    winPct: 10, trialOxe: 200, adminPw: 'oxeball2024'
  });
}
if (!readDB('users').list) writeDB('users', { list: {} });
if (!readDB('refs').list)  writeDB('refs',  { list: {} });
if (!readDB('txlog').deposits) writeDB('txlog', { deposits: [], withdrawals: [], deletedUsers: [], referrals: [] });

// ─── HELPERS ──────────────────────────────────────────────────────────────────
function hash(str) { return crypto.createHash('sha256').update(str).digest('hex'); }

function readBody(req) {
  return new Promise((res) => {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      try { res(JSON.parse(body)); } catch(e) { res({}); }
    });
  });
}

function json(res, data, status=200) {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type,Authorization'
  });
  res.end(JSON.stringify(data));
}

function serveFile(res, filePath, extraHeaders={}) {
  const ext = path.extname(filePath).toLowerCase();
  const types = {
    '.html': 'text/html; charset=utf-8',
    '.js':   'application/javascript; charset=utf-8',
    '.css':  'text/css',
    '.json': 'application/json',
    '.png':  'image/png',
    '.ico':  'image/x-icon',
    '.txt':  'text/plain'
  };
  try {
    const data = fs.readFileSync(filePath);
    res.writeHead(200, {
      'Content-Type': types[ext] || 'application/octet-stream',
      ...extraHeaders
    });
    res.end(data);
  } catch(e) {
    res.writeHead(404, { 'Content-Type': 'text/html', ...extraHeaders });
    res.end(`<!DOCTYPE html><html><body style="font-family:sans-serif;padding:40px;background:#03030b;color:#00d4ff">
      <h2>⬡ OXE BALL</h2><p style="color:#ff5533">Page not found: ${filePath}</p>
      <a href="/" style="color:#9933ff">← Back to game</a></body></html>`);
  }
}

// Simple token store (in-memory, resets on server restart — use Redis in prod)
const sessions = {};
function genToken() { return crypto.randomBytes(32).toString('hex'); }

// Pending email verifications {email: {code, username, password, refCode, expiresAt}}
const pending = {};
function genCode() { return String(Math.floor(100000 + Math.random() * 900000)); }

// ── EMAIL SENDER ──────────────────────────────────────────────────────────────
// Uses Node.js built-in net/tls — no npm packages needed
// Configure via environment variables or data/email-config.json
function getEmailConfig() {
  try {
    const cfg = JSON.parse(require('fs').readFileSync(
      require('path').join(__dirname, 'data', 'email-config.json'), 'utf8'
    ));
    return cfg;
  } catch(e) {
    return {
      host: process.env.SMTP_HOST || 'smtp.gmail.com',
      port: parseInt(process.env.SMTP_PORT) || 587,
      user: process.env.SMTP_USER || '',
      pass: process.env.SMTP_PASS || '',
      from: process.env.SMTP_FROM || process.env.SMTP_USER || 'oxeball@gmail.com'
    };
  }
}

async function sendEmail(to, subject, html) {
  const cfg = getEmailConfig();
  if (!cfg.user || !cfg.pass) {
    // Dev mode — log to console instead of sending
    console.log('\n📧 [EMAIL SIMULATION — configure SMTP to send real emails]');
    console.log('  To:', to);
    console.log('  Subject:', subject);
    console.log('  Body snippet:', html.replace(/<[^>]+>/g,'').trim().slice(0,100));
    console.log('');
    return true;
  }
  return new Promise((resolve) => {
    const tls = require('tls');
    const net = require('net');

    const b64 = (s) => Buffer.from(s).toString('base64');
    const crlf = '\r\n';

    const body = [
      'From: OXE BALL <' + cfg.from + '>',
      'To: ' + to,
      'Subject: ' + subject,
      'MIME-Version: 1.0',
      'Content-Type: text/html; charset=UTF-8',
      '',
      html
    ].join(crlf);

    let sock;
    let step = 0;
    const steps = [
      () => sock.write('EHLO oxeball' + crlf),
      () => sock.write('AUTH LOGIN' + crlf),
      () => sock.write(b64(cfg.user) + crlf),
      () => sock.write(b64(cfg.pass) + crlf),
      () => sock.write('MAIL FROM:<' + cfg.from + '>' + crlf),
      () => sock.write('RCPT TO:<' + to + '>' + crlf),
      () => sock.write('DATA' + crlf),
      () => sock.write(body + crlf + '.' + crlf),
      () => sock.write('QUIT' + crlf),
    ];

    function next(data) {
      if (data && (data.includes('535') || data.includes('550') || data.includes('554'))) {
        console.error('SMTP error:', data.trim());
        sock.destroy(); resolve(false); return;
      }
      if (step < steps.length) { steps[step++](); }
      else { sock.destroy(); resolve(true); }
    }

    if (cfg.port === 465) {
      sock = tls.connect({ host: cfg.host, port: cfg.port }, () => next());
    } else {
      sock = net.connect({ host: cfg.host, port: cfg.port });
      sock.once('data', () => {
        sock.write('STARTTLS' + crlf);
        sock.once('data', (d) => {
          if (d.toString().includes('220')) {
            const upgraded = tls.connect({ socket: sock, host: cfg.host }, () => {
              sock = upgraded;
              sock.on('data', d => next(d.toString()));
              next();
            });
          } else { next(); }
        });
      });
    }

    if (cfg.port !== 465) {
      sock.on('data', d => next(d.toString()));
    }
    sock.on('error', (e) => { console.error('SMTP sock error:', e.message); resolve(false); });
    setTimeout(() => { try { sock.destroy(); } catch(e){} resolve(false); }, 15000);
  });
}
function authCheck(req) {
  const auth = req.headers['authorization'] || '';
  const token = auth.replace('Bearer ', '');
  return sessions[token] || null;
}
function isAdmin(req) {
  const sess = authCheck(req);
  return sess && sess.role === 'admin';
}

// ─── ROUTER ───────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
const HOST = '0.0.0.0'; // required for Railway, Render, Glitch

http.createServer(async (req, res) => {
  // CORS — allow all origins
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type,Authorization'
  };

  if (req.method === 'OPTIONS') {
    res.writeHead(204, corsHeaders);
    return res.end();
  }

  // Strip query string and trailing slash for routing
  const rawUrl = req.url || '/';
  const url = rawUrl.split('?')[0].replace(/\/+$/, '') || '/';
  const method = req.method;

  // ── HEALTH CHECK (required by Railway / Render) ──
  if (url === '/health' || url === '/ping') {
    res.writeHead(200, { 'Content-Type': 'text/plain', ...corsHeaders });
    return res.end('OK');
  }

  // ── STATIC FILES ──
  if (method === 'GET') {
    if (url === '/' || url === '/index.html' || url === '/game' || url === '/game.html') {
      return serveFile(res, path.join(__dirname, 'public', 'game.html'), corsHeaders);
    }
    if (url === '/admin' || url === '/admin.html') {
      return serveFile(res, path.join(__dirname, 'public', 'admin.html'), corsHeaders);
    }
    // Serve any file from /public (api.js, etc.)
    if (!url.startsWith('/api/') && url !== '/api') {
      const filePath = path.join(__dirname, 'public', url.slice(1) || 'game.html');
      // Security: prevent path traversal
      if (!filePath.startsWith(path.join(__dirname, 'public'))) {
        res.writeHead(403); return res.end('Forbidden');
      }
      return serveFile(res, filePath, corsHeaders);
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  //  API ROUTES
  // ─────────────────────────────────────────────────────────────────────────

  // ── CONFIG (public read) ──
  if (method === 'GET' && url === '/api/config') {
    const cfg = readDB('config');
    return json(res, { rate: cfg.rate, minBet: cfg.minBet, maxBet: cfg.maxBet,
                       winPct: cfg.winPct, trialOxe: cfg.trialOxe });
  }

  // ── AUTH: send verification code to Gmail ──
  if (method === 'POST' && url === '/api/auth/send-code') {
    const body = await readBody(req);
    const { email, username, password, refCode } = body;
    if (!email || !username || !password)
      return json(res, { error: 'Missing fields' }, 400);
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email))
      return json(res, { error: 'Invalid email address' }, 400);
    if (password.length < 6)
      return json(res, { error: 'Password must be at least 6 characters' }, 400);
    if (username.length < 3)
      return json(res, { error: 'Username must be at least 3 characters' }, 400);
    // Check not already registered
    const users = readDB('users');
    if (users.list[email])
      return json(res, { error: 'Email already registered' }, 409);
    // Generate & store code (expires in 10 min)
    const code = genCode();
    pending[email] = {
      code, username, password: hash(password), refCode: refCode || null,
      expiresAt: Date.now() + 10 * 60 * 1000
    };
    // Send email
    const emailHtml = `
      <!DOCTYPE html><html><body style="margin:0;padding:0;background:#07070f;font-family:'Segoe UI',sans-serif;">
      <div style="max-width:480px;margin:0 auto;padding:32px 24px;">
        <div style="text-align:center;margin-bottom:24px;">
          <h1 style="color:#00d4ff;font-size:28px;letter-spacing:4px;margin:0;">OXE<span style="color:#cc44ff;">●</span>BALL</h1>
          <p style="color:#3344aa;font-size:11px;letter-spacing:2px;margin:4px 0 0;">CRYPTO PLINKO</p>
        </div>
        <div style="background:#0a0a1e;border:1px solid #2a2a55;border-radius:16px;padding:28px;">
          <p style="color:#aabbcc;font-size:15px;margin:0 0 8px;">Hi <b style="color:#fff;">\${username}</b>,</p>
          <p style="color:#6677aa;font-size:13px;margin:0 0 24px;">Your verification code for OXE BALL:</p>
          <div style="background:#04040e;border:2px solid #9933ff;border-radius:12px;padding:20px;text-align:center;margin:0 0 24px;">
            <div style="font-size:40px;font-weight:900;letter-spacing:10px;color:#cc44ff;font-family:'Courier New',monospace;">\${code}</div>
            <div style="color:#3344aa;font-size:11px;margin-top:8px;">Expires in 10 minutes</div>
          </div>
          <p style="color:#6677aa;font-size:12px;margin:0;">If you didn't request this, ignore this email.</p>
        </div>
        <p style="color:#1a1a44;font-size:10px;text-align:center;margin:20px 0 0;">© OXE BALL · Do not reply to this email</p>
      </div></body></html>
    `;
    const cfg2 = getEmailConfig();
    const sent = await sendEmail(email, 'Your OXE BALL Verification Code: ' + code, emailHtml);
    if (!cfg2.user) {
      // Dev mode — return code directly so frontend can show it
      return json(res, { success: true, devCode: code, message: 'Dev mode: code shown below' });
    }
    if (sent) {
      return json(res, { success: true, message: 'Verification code sent to ' + email });
    } else {
      return json(res, { error: 'Failed to send email. Check SMTP config in data/email-config.json' }, 500);
    }
  }

  // ── AUTH: verify code & complete registration ──
  if (method === 'POST' && url === '/api/auth/verify-code') {
    const body = await readBody(req);
    const { email, code } = body;
    const p = pending[email];
    if (!p) return json(res, { error: 'No pending verification for this email' }, 400);
    if (Date.now() > p.expiresAt) {
      delete pending[email];
      return json(res, { error: 'Code expired. Please register again.' }, 400);
    }
    if (p.code !== String(code).trim())
      return json(res, { error: 'Incorrect code. Try again.' }, 400);
    // Code correct — create user
    const users = readDB('users');
    if (users.list[email]) {
      delete pending[email];
      return json(res, { error: 'Email already registered' }, 409);
    }
    const uid = 'E' + Date.now();
    const now = new Date().toISOString();
    const refs = readDB('refs');
    let bonus = 0;
    if (p.refCode && refs.list[p.refCode]) {
      bonus = readDB('config').trialOxe || 200;
    }
    users.list[email] = {
      uid, email, username: p.username, pwHash: p.password,
      method: 'email', balance: bonus, gamesPlayed: 0,
      totalDeposits: 0, registeredAt: now, lastLogin: now,
      banned: false, emailVerified: true, referredBy: p.refCode || null
    };
    writeDB('users', users);
    // Referral code
    const myCode = ('OXE' + uid).toUpperCase().slice(0, 8);
    refs.list[myCode] = { uid, count: 0, earned: 0, referrals: [] };
    // Process referrer reward
    if (p.refCode && refs.list[p.refCode]) {
      const r = refs.list[p.refCode];
      if (!r.referrals.includes(uid)) {
        r.count++; r.earned += 15; r.referrals.push(uid);
        const referrer = Object.values(users.list).find(u => u.uid === r.uid);
        if (referrer) { referrer.balance = (referrer.balance || 0) + 15; writeDB('users', users); }
      }
    }
    writeDB('refs', refs);
    delete pending[email];
    const token = genToken();
    sessions[token] = { uid, email, username: p.username, role: 'player' };
    return json(res, { token, uid, email, username: p.username, balance: bonus, isNew: true });
  }

  // ── AUTH: resend verification code ──
  if (method === 'POST' && url === '/api/auth/resend-code') {
    const body = await readBody(req);
    const { email } = body;
    const p = pending[email];
    if (!p) return json(res, { error: 'No pending registration for this email' }, 400);
    // Refresh code
    p.code = genCode();
    p.expiresAt = Date.now() + 10 * 60 * 1000;
    const emailHtml = `<div style="font-family:sans-serif;padding:20px;background:#07070f;">
      <h2 style="color:#00d4ff;">OXE BALL — New Code</h2>
      <p style="color:#aaa;">Hi \${p.username}, your new code:</p>
      <div style="font-size:36px;font-weight:900;letter-spacing:10px;color:#cc44ff;padding:20px;background:#04040e;border:2px solid #9933ff;border-radius:12px;text-align:center;">\${p.code}</div>
      <p style="color:#666;">Expires in 10 minutes.</p></div>`;
    await sendEmail(email, 'OXE BALL — New Code: ' + p.code, emailHtml);
    const cfg = getEmailConfig();
    return json(res, { success: true, ...((!cfg.user) ? { devCode: p.code } : {}) });
  }

  // ── AUTH: register with email ──
  if (method === 'POST' && url === '/api/auth/register') {
    const body = await readBody(req);
    const { email, password, username, refCode } = body;
    if (!email || !password || !username)
      return json(res, { error: 'Missing fields' }, 400);
    const users = readDB('users');
    if (users.list[email])
      return json(res, { error: 'Email already registered' }, 409);
    const uid = 'E' + Date.now();
    const now = new Date().toISOString();
    const refs = readDB('refs');
    let bonus = 0;
    if (refCode && refs.list[refCode]) bonus = 200; // trialOxe default
    users.list[email] = {
      uid, email, username, pwHash: hash(password),
      method: 'email', balance: bonus, gamesPlayed: 0,
      totalDeposits: 0, registeredAt: now, lastLogin: now,
      banned: false, referredBy: refCode || null
    };
    writeDB('users', users);
    // Set up referral code
    const myCode = ('OXE' + uid).toUpperCase().slice(0, 8);
    refs.list[myCode] = { uid, count: 0, earned: 0, referrals: [] };
    writeDB('refs', refs);
    // Process referral reward
    if (refCode && refs.list[refCode]) {
      const r = refs.list[refCode];
      if (!r.referrals.includes(uid)) {
        r.count++; r.earned += 15; r.referrals.push(uid);
        const referrer = Object.values(users.list).find(u => u.uid === r.uid);
        if (referrer) referrer.balance = (referrer.balance || 0) + 15;
        writeDB('refs', refs); writeDB('users', users);
      }
    }
    const token = genToken();
    sessions[token] = { uid, email, username, role: 'player' };
    return json(res, { token, uid, email, username, balance: bonus });
  }

  // ── AUTH: login with email ──
  if (method === 'POST' && url === '/api/auth/login') {
    const body = await readBody(req);
    const { email, password } = body;
    const users = readDB('users');
    const u = users.list[email];
    if (!u || u.pwHash !== hash(password))
      return json(res, { error: 'Invalid email or password' }, 401);
    if (u.banned)
      return json(res, { error: 'Account banned' }, 403);
    u.lastLogin = new Date().toISOString();
    writeDB('users', users);
    const token = genToken();
    sessions[token] = { uid: u.uid, email, username: u.username, role: 'player' };
    return json(res, { token, uid: u.uid, email, username: u.username, balance: u.balance });
  }

  // ── AUTH: Google OAuth simulation ──
  if (method === 'POST' && url === '/api/auth/google') {
    // In production: verify the Google ID token server-side
    // Here we accept the payload from client (demo only)
    const body = await readBody(req);
    const { googleToken, refCode } = body; // googleToken would be verified with Google
    const users = readDB('users');
    // Simulate extracting user from Google token
    const uid = 'G' + Date.now();
    const names = ['Alex','Jordan','Sam','Chris','Morgan','Taylor'];
    const name  = names[Math.floor(Math.random() * names.length)];
    const email = name.toLowerCase() + uid.slice(-4) + '@gmail.com';
    let bonus = 0;
    const refs = readDB('refs');
    if (refCode && refs.list[refCode]) bonus = 15;
    if (!users.list[email]) {
      const now = new Date().toISOString();
      users.list[email] = {
        uid, email, username: name, method: 'google',
        balance: bonus, gamesPlayed: 0, totalDeposits: 0,
        registeredAt: now, lastLogin: now, banned: false, referredBy: refCode || null
      };
      writeDB('users', users);
      const myCode = ('OXE' + uid).toUpperCase().slice(0, 8);
      refs.list[myCode] = { uid, count: 0, earned: 0, referrals: [] };
      if (refCode && refs.list[refCode]) {
        const r = refs.list[refCode];
        if (!r.referrals.includes(uid)) {
          r.count++; r.earned += 15; r.referrals.push(uid);
          const referrer = Object.values(users.list).find(u => u.uid === r.uid);
          if (referrer) referrer.balance = (referrer.balance || 0) + 15;
          writeDB('users', users);
        }
      }
      writeDB('refs', refs);
    } else {
      users.list[email].lastLogin = new Date().toISOString();
      writeDB('users', users);
    }
    const u = users.list[email];
    const token = genToken();
    sessions[token] = { uid: u.uid, email, username: u.username, role: 'player' };
    return json(res, { token, uid: u.uid, email, username: u.username, balance: u.balance });
  }

  // ── PLAYER: get profile + balance ──
  if (method === 'GET' && url === '/api/me') {
    const sess = authCheck(req);
    if (!sess) return json(res, { error: 'Unauthorized' }, 401);
    const users = readDB('users');
    const u = Object.values(users.list).find(u => u.uid === sess.uid);
    if (!u) return json(res, { error: 'User not found' }, 404);
    return json(res, { uid: u.uid, email: u.email, username: u.username,
      balance: u.balance, gamesPlayed: u.gamesPlayed, method: u.method });
  }

  // ── PLAYER: update balance after game ──
  if (method === 'POST' && url === '/api/me/balance') {
    const sess = authCheck(req);
    if (!sess) return json(res, { error: 'Unauthorized' }, 401);
    const body = await readBody(req);
    const users = readDB('users');
    const u = Object.values(users.list).find(u => u.uid === sess.uid);
    if (!u) return json(res, { error: 'Not found' }, 404);
    if (typeof body.balance === 'number') u.balance = Math.max(0, body.balance);
    if (body.addGame) u.gamesPlayed = (u.gamesPlayed || 0) + 1;
    writeDB('users', users);
    return json(res, { balance: u.balance });
  }

  // ── PLAYER: get referral data ──
  if (method === 'GET' && url === '/api/referral') {
    const sess = authCheck(req);
    if (!sess) return json(res, { error: 'Unauthorized' }, 401);
    const refs = readDB('refs');
    const myCode = ('OXE' + sess.uid).toUpperCase().slice(0, 8);
    const data = refs.list[myCode] || { uid: sess.uid, count: 0, earned: 0, referrals: [] };
    const baseUrl = req.headers.host ? 'https://' + req.headers.host : 'http://localhost:' + PORT;
    return json(res, { code: myCode, ...data, url: baseUrl + '/?ref=' + myCode });
  }

  // ── PLAYER: request withdrawal ──
  if (method === 'POST' && url === '/api/withdraw') {
    const sess = authCheck(req);
    if (!sess) return json(res, { error: 'Unauthorized' }, 401);
    const body = await readBody(req);
    const { address, oxeAmount } = body;
    const users = readDB('users');
    const u = Object.values(users.list).find(u => u.uid === sess.uid);
    if (!u) return json(res, { error: 'User not found' }, 404);
    const cfg = readDB('config');
    const fee = 20;
    if (!address || oxeAmount < 200) return json(res, { error: 'Min 200 OXE' }, 400);
    if (u.balance < oxeAmount + fee) return json(res, { error: 'Insufficient balance' }, 400);
    u.balance -= (oxeAmount + fee);
    writeDB('users', users);
    const txlog = readDB('txlog');
    const wd = {
      id: 'WD-' + Date.now(), uid: u.uid, username: u.username,
      email: u.email, address, oxe: oxeAmount,
      usdt: (oxeAmount / cfg.rate).toFixed(2),
      status: 'Pending', note: '', time: new Date().toISOString()
    };
    txlog.withdrawals.unshift(wd);
    writeDB('txlog', txlog);
    return json(res, { success: true, id: wd.id, newBalance: u.balance });
  }

  // ── PLAYER: verify deposit tx hash ──
  if (method === 'POST' && url === '/api/deposit/verify') {
    const sess = authCheck(req);
    if (!sess) return json(res, { error: 'Unauthorized' }, 401);
    const body = await readBody(req);
    const { txHash } = body;
    if (!txHash || txHash.length < 60) return json(res, { error: 'Invalid TX hash' }, 400);
    // TODO: replace with real BSCScan API verification
    // const bscRes = await fetch(`https://api.bscscan.com/api?module=transaction&action=gettxreceiptstatus&txhash=${txHash}&apikey=YOUR_KEY`)
    const cfg = readDB('config');
    const usdtAmt = +(Math.random() * 195 + 5).toFixed(2);
    const oxeAmt = Math.round(usdtAmt * cfg.rate);
    const users = readDB('users');
    const u = Object.values(users.list).find(u => u.uid === sess.uid);
    if (!u) return json(res, { error: 'User not found' }, 404);
    u.balance = (u.balance || 0) + oxeAmt;
    u.totalDeposits = (u.totalDeposits || 0) + usdtAmt;
    writeDB('users', users);
    const txlog = readDB('txlog');
    txlog.deposits.unshift({
      id: 'DEP-' + Date.now(), uid: u.uid, email: u.email,
      txHash, usdt: usdtAmt, oxe: oxeAmt,
      status: 'Confirmed', time: new Date().toISOString()
    });
    writeDB('txlog', txlog);
    return json(res, { success: true, oxeAmt, usdtAmt, newBalance: u.balance });
  }

  // ────────────────────────────────────────────────────────────────────────────
  //  ADMIN ROUTES  (require admin token)
  // ────────────────────────────────────────────────────────────────────────────

  // ── ADMIN: login ──
  if (method === 'POST' && url === '/api/admin/login') {
    const body = await readBody(req);
    const cfg  = readDB('config');
    if (body.password !== cfg.adminPw)
      return json(res, { error: 'Wrong password' }, 401);
    const token = genToken();
    sessions[token] = { role: 'admin', uid: 'ADMIN' };
    return json(res, { token });
  }

  // Check admin auth for all /api/admin/* routes below
  if (url.startsWith('/api/admin/') && !isAdmin(req))
    return json(res, { error: 'Unauthorized' }, 401);

  // ── ADMIN: get all users ──
  if (method === 'GET' && url === '/api/admin/users') {
    return json(res, readDB('users').list);
  }

  // ── ADMIN: ban/unban user ──
  if (method === 'POST' && url === '/api/admin/users/ban') {
    const body = await readBody(req);
    const users = readDB('users');
    const u = Object.values(users.list).find(u => u.uid === body.uid);
    if (!u) return json(res, { error: 'Not found' }, 404);
    u.banned = body.ban;
    if (body.ban) u.bannedAt = new Date().toISOString();
    else delete u.bannedAt;
    writeDB('users', users);
    return json(res, { success: true });
  }

  // ── ADMIN: delete user ──
  if (method === 'DELETE' && url.startsWith('/api/admin/users/')) {
    const uid = url.split('/').pop();
    const users = readDB('users');
    let deleted = null;
    for (const [email, u] of Object.entries(users.list)) {
      if (u.uid === uid) { deleted = u; delete users.list[email]; break; }
    }
    if (!deleted) return json(res, { error: 'Not found' }, 404);
    writeDB('users', users);
    // Remove referral code
    const refs = readDB('refs');
    for (const [code, r] of Object.entries(refs.list)) {
      if (r.uid === uid) { delete refs.list[code]; break; }
    }
    writeDB('refs', refs);
    // Log
    const txlog = readDB('txlog');
    txlog.deletedUsers = txlog.deletedUsers || [];
    txlog.deletedUsers.push({ uid, name: deleted.username || deleted.email,
      deletedAt: new Date().toISOString() });
    writeDB('txlog', txlog);
    // Invalidate session
    for (const [t, s] of Object.entries(sessions)) {
      if (s.uid === uid) delete sessions[t];
    }
    return json(res, { success: true });
  }

  // ── ADMIN: get config ──
  if (method === 'GET' && url === '/api/admin/config') {
    return json(res, readDB('config'));
  }

  // ── ADMIN: save config ──
  if (method === 'POST' && url === '/api/admin/config') {
    const body = await readBody(req);
    const cfg  = readDB('config');
    Object.assign(cfg, body);
    writeDB('config', cfg);
    return json(res, { success: true });
  }

  // ── ADMIN: get withdrawals ──
  if (method === 'GET' && url === '/api/admin/withdrawals') {
    return json(res, readDB('txlog').withdrawals || []);
  }

  // ── ADMIN: update withdrawal status ──
  if (method === 'POST' && url === '/api/admin/withdrawals/update') {
    const body  = await readBody(req);
    const txlog = readDB('txlog');
    const wd = txlog.withdrawals.find(w => w.id === body.id);
    if (!wd) return json(res, { error: 'Not found' }, 404);
    wd.status = body.status;
    wd.note   = body.note || wd.note;
    writeDB('txlog', txlog);
    return json(res, { success: true });
  }

  // ── ADMIN: get deposits ──
  if (method === 'GET' && url === '/api/admin/deposits') {
    return json(res, readDB('txlog').deposits || []);
  }

  // ── ADMIN: get referrals ──
  if (method === 'GET' && url === '/api/admin/referrals') {
    return json(res, readDB('refs').list);
  }

  // ── ADMIN: get deleted users ──
  if (method === 'GET' && url === '/api/admin/deleted') {
    return json(res, (readDB('txlog').deletedUsers || []));
  }

  // 404
  json(res, { error: 'Not found' }, 404);

}).listen(PORT, HOST, () => {
  console.log('\n╔══════════════════════════════════════════╗');
  console.log('║   OXE BALL SERVER RUNNING                ║');
  console.log(`║   http://localhost:${PORT}                 ║`);
  console.log(`║   Game:  http://localhost:${PORT}/         ║`);
  console.log(`║   Admin: http://localhost:${PORT}/admin    ║`);
  console.log('╚══════════════════════════════════════════╝\n');
  console.log('  Share the public URL from your host.');
  console.log('  Railway: check Deployments > Domain tab\n');
});
