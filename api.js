// OXE BALL — API Client
// Works on any host — uses same origin as the page

const API = (() => {
  // Always use same origin — works on localhost AND any cloud host
  const BASE = window.location.origin;
  let _token = sessionStorage.getItem('oxe_token') || '';

  function setToken(t) {
    _token = t;
    sessionStorage.setItem('oxe_token', t);
  }
  function clearToken() {
    _token = '';
    sessionStorage.removeItem('oxe_token');
  }
  function headers() {
    return { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + _token };
  }
  async function get(path) {
    const r = await fetch(BASE + path, { headers: headers() });
    return r.json();
  }
  async function post(path, body) {
    const r = await fetch(BASE + path, { method: 'POST', headers: headers(), body: JSON.stringify(body) });
    return r.json();
  }
  async function del(path) {
    const r = await fetch(BASE + path, { method: 'DELETE', headers: headers() });
    return r.json();
  }

  return {
    setToken, clearToken, getToken: () => _token,
    hasToken: () => !!_token,
    post, get, // expose for custom calls

    // ── AUTH ──
    register:     (email, pw, username, refCode) => post('/api/auth/register', { email, password: pw, username, refCode }),
    login:        (email, pw)                    => post('/api/auth/login',    { email, password: pw }),
    googleAuth:   (refCode)                      => post('/api/auth/google',   { refCode }),

    // ── PLAYER ──
    me:           ()                  => get('/api/me'),
    setBalance:   (balance, addGame)  => post('/api/me/balance', { balance, addGame }),
    getReferral:  ()                  => get('/api/referral'),
    withdraw:     (address, oxeAmt)   => post('/api/withdraw', { address, oxeAmount: oxeAmt }),
    verifyDeposit:(txHash)            => post('/api/deposit/verify', { txHash }),

    // ── CONFIG (public) ──
    config:       ()                  => get('/api/config'),

    // ── ADMIN ──
    adminLogin:   (password)          => post('/api/admin/login',            { password }),
    adminUsers:   ()                  => get('/api/admin/users'),
    adminBan:     (uid, ban)          => post('/api/admin/users/ban',        { uid, ban }),
    adminDelete:  (uid)               => del('/api/admin/users/' + uid),
    adminConfig:  ()                  => get('/api/admin/config'),
    adminSaveConfig: (cfg)            => post('/api/admin/config',           cfg),
    adminWithdrawals: ()              => get('/api/admin/withdrawals'),
    adminUpdateWd:(id, status, note)  => post('/api/admin/withdrawals/update',{ id, status, note }),
    adminDeposits:()                  => get('/api/admin/deposits'),
    adminReferrals:()                 => get('/api/admin/referrals'),
    adminDeleted: ()                  => get('/api/admin/deleted'),
  };
})();
