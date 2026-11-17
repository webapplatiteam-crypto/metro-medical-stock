// โครงแอป: ล็อกอิน, เมนู, เปลี่ยนหน้า
import { sb, configured, state, ROLE, can, esc, toast, errMsg, q, loadRefs, $, $$, modal } from './core.js';

const NAV = [
  { r: 'dashboard', label: 'แดชบอร์ด', show: () => true },
  { r: 'receive',   label: 'รับเข้า', show: can.operate },
  { r: 'issue',     label: 'จ่ายออก / ตัดสต็อก', show: can.operate },
  { r: 'adjust',    label: 'ปรับยอด / โอน / ทำลาย', show: can.operate },
  { r: 'approvals', label: 'รออนุมัติ', show: can.manage, badge: 'pending' },
  { r: 'documents', label: 'เอกสารทั้งหมด', show: () => true },
  { r: 'products',  label: 'สินค้า & Lot', show: () => true },
  { r: 'expiry',    label: 'วันหมดอายุ', show: () => true, badge: 'expiry' },
  { r: 'count',     label: 'ตรวจนับสต็อก', show: can.operate },
  { r: 'labels',    label: 'พิมพ์ฉลากบาร์โค้ด', show: can.operate },
  { r: 'reports',   label: 'รายงาน / ส่งออก', show: () => true },
  { r: 'users',     label: 'ผู้ใช้ & สิทธิ์', show: can.admin },
  { r: 'settings',  label: 'ตั้งค่า / นำเข้า Excel', show: can.manage },
  { r: 'help',      label: 'คู่มือการใช้งาน', show: () => true },
];

// เส้นทาง → ไฟล์หน้า
const PAGES = {
  dashboard: 'dashboard', receive: 'docedit', issue: 'docedit', adjust: 'docedit', transfer: 'docedit', dispose: 'docedit',
  count: 'docedit', approvals: 'documents', documents: 'documents', doc: 'docview', products: 'products',
  product: 'productform', ledger: 'ledger', expiry: 'expiry', labels: 'labels', reports: 'reports', users: 'users', settings: 'settings', help: 'help',
};

const LOGO = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>';
const app = document.getElementById('app');
let cleanup = null;
const badges = { pending: 0, expiry: 0 };

// ---------- ยังไม่ตั้งค่า ----------
function renderNotConfigured() {
  app.innerHTML = `<div class="main" style="max-width:720px;margin:40px auto"><div class="card">
    <h1>ยังไม่ได้เชื่อมต่อ Supabase</h1>
    <p>ตั้งค่า Environment variables ใน Netlify: <code>SUPABASE_URL</code> และ <code>SUPABASE_ANON_KEY</code> แล้ว Deploy ใหม่
    หรือแก้ไฟล์ <code>web/js/config.js</code> โดยตรง (ดูขั้นตอนใน README.md)</p></div></div>`;
}

// ---------- ล็อกอิน ----------
function renderLogin(msg = '') {
  app.innerHTML = `<div class="login">
    <section class="hero">
      <div class="brand"><div class="logo">${LOGO}</div><div><b>บริษัท เมโทร เมดิคอล จำกัด</b><small>Metro Medical Co., Ltd.</small></div></div>
      <h1>ระบบคลังเครื่องมือแพทย์</h1>
      <p>รับเข้า จ่ายออก ตัดสต็อก ด้วยการสแกนบาร์โค้ด ติดตาม Lot และวันหมดอายุ — ใช้ได้ทั้งคอมพิวเตอร์ เครื่องยิงบาร์โค้ด และมือถือ</p>
    </section>
    <section class="panel">
      <form class="card" style="padding:32px;gap:16px" data-login>
        <div><h2 style="font-size:24px">เข้าสู่ระบบ</h2><span class="sub">ใช้บัญชีพนักงานของบริษัท</span></div>
        ${msg ? `<div class="alert bad">${esc(msg)}</div>` : ''}
        <label class="f">อีเมล<input class="i" type="email" name="email" autocomplete="username" required></label>
        <label class="f">รหัสผ่าน<input class="i" type="password" name="password" autocomplete="current-password" required></label>
        <button class="b1" type="submit">เข้าสู่ระบบ</button>
        <button class="b3" type="button" data-forgot>ลืมรหัสผ่าน?</button>
        <button class="b2" type="button" data-help>คู่มือการใช้งาน</button>
      </form>
    </section></div>`;
  const f = $('[data-login]');
  f.onsubmit = async (e) => {
    e.preventDefault();
    const btn = $('button[type=submit]', f); btn.disabled = true;
    const { error } = await sb.auth.signInWithPassword({ email: f.email.value.trim(), password: f.password.value });
    btn.disabled = false;
    if (error) renderLogin(error.message === 'Invalid login credentials' ? 'อีเมลหรือรหัสผ่านไม่ถูกต้อง' : error.message);
  };
  $('[data-help]', f).onclick = async () => {
    const { helpHtml, bindJumps } = await import('./pages/help.js');
    const m = modal({ title: 'คู่มือการใช้งาน', wide: true, body: `<div style="display:flex;flex-direction:column;gap:12px">${helpHtml()}</div>` });
    bindJumps(m.el);
  };
  $('[data-forgot]', f).onclick = async () => {
    const email = f.email.value.trim();
    if (!email) { toast('กรอกอีเมลก่อน', 'err'); return; }
    const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: location.origin + '/#/reset' });
    toast(error ? errMsg(error) : 'ส่งลิงก์ตั้งรหัสผ่านใหม่ไปที่อีเมลแล้ว', error ? 'err' : 'ok');
  };
}

function renderSetPassword() {
  app.innerHTML = `<div class="login"><section class="panel" style="flex-basis:100%"><form class="card" style="padding:32px;gap:16px;max-width:400px" data-pw>
    <h2>ตั้งรหัสผ่านใหม่</h2>
    <label class="f">รหัสผ่านใหม่ (อย่างน้อย 10 ตัว)<input class="i" type="password" name="pw" minlength="10" required autocomplete="new-password"></label>
    <button class="b1" type="submit">บันทึก</button></form></section></div>`;
  $('[data-pw]').onsubmit = async (e) => {
    e.preventDefault();
    const { error } = await sb.auth.updateUser({ password: e.target.pw.value });
    if (error) return toast(errMsg(error), 'err');
    toast('ตั้งรหัสผ่านแล้ว', 'ok'); location.hash = '#/dashboard'; boot();
  };
}

// ---------- โครงหน้า ----------
function renderShell() {
  const p = state.profile;
  const items = NAV.filter((n) => n.show());
  app.innerHTML = `<div class="shell">
    <nav class="side noprint" aria-label="เมนูหลัก">
      <div class="brand"><div class="logo">${LOGO}</div><div><b>Metro Medical</b><small>ระบบคลังสินค้า</small></div></div>
      <div class="nav">${items.map((n) => `<a href="#/${n.r}" data-r="${n.r}">${n.label}${n.badge ? `<span class="badge hidden" data-badge="${n.badge}"></span>` : ''}</a>`).join('')}</div>
      <div class="me"><div class="avatar">${esc((p.full_name || p.email || '?').slice(0, 1))}</div>
        <div class="who"><b>${esc(p.full_name || p.email)}</b><small>${ROLE[p.role]}</small></div>
        <button type="button" data-logout>ออก</button></div>
    </nav>
    <main class="main" id="main" tabindex="-1"></main>
    <nav class="bottomnav noprint" aria-label="เมนูล่าง">
      <a href="#/dashboard" data-r="dashboard">หน้าหลัก</a>
      ${can.operate() ? '<a href="#/receive" data-r="receive">รับเข้า</a><a href="#/issue" data-r="issue">จ่ายออก</a>' : '<a href="#/products" data-r="products">สินค้า</a><a href="#/reports" data-r="reports">รายงาน</a>'}
      <a href="#/expiry" data-r="expiry">หมดอายุ</a>
      <button type="button" data-menu>เมนู</button>
    </nav></div>`;
  $('[data-logout]').onclick = () => sb.auth.signOut();
  $('[data-menu]').onclick = () => {
    const m = modal({ title: 'เมนู', body: `<div class="nav" style="background:var(--navy);border-radius:12px;padding:8px">${items.map((n) => `<a href="#/${n.r}">${n.label}</a>`).join('')}</div>
      <div class="row between" style="margin-top:12px"><span class="sub">${esc(p.full_name || p.email)} · ${ROLE[p.role]}</span><button class="b2 sm" data-out>ออกจากระบบ</button></div>` });
    $$('a', m.el).forEach((a) => a.addEventListener('click', m.close));
    $('[data-out]', m.el).onclick = () => { m.close(); sb.auth.signOut(); };
  };
  refreshBadges();
}

export async function refreshBadges() {
  try {
    const [{ count: pending }, { count: expiry }] = await Promise.all([
      can.manage() ? sb.from('documents').select('id', { count: 'exact', head: true }).eq('status', 'pending') : Promise.resolve({ count: 0 }),
      sb.from('v_lot_stock').select('lot_id', { count: 'exact', head: true }).gt('qty', 0).lte('days_left', 90),
    ]);
    badges.pending = pending || 0; badges.expiry = expiry || 0;
    $$('[data-badge]').forEach((el) => { const v = badges[el.dataset.badge]; el.textContent = v; el.classList.toggle('hidden', !v); });
  } catch { /* ไม่สำคัญ */ }
}
window.addEventListener('mms:changed', refreshBadges);

// ---------- เปลี่ยนหน้า ----------
async function route() {
  if (!state.profile) return;
  const raw = location.hash.replace(/^#\/?/, '') || 'dashboard';
  const [path, qs] = raw.split('?');
  const [r, ...args] = path.split('/');
  if (r === 'reset') return renderSetPassword();
  const page = PAGES[r] || 'dashboard';
  const nav = NAV.find((n) => n.r === r);
  if (nav && !nav.show()) { location.hash = '#/dashboard'; return; }
  const navKey = { transfer: 'adjust', dispose: 'adjust', doc: 'documents', product: 'products', ledger: 'products' }[r] || r;
  $$('[data-r]').forEach((a) => a.classList.toggle('on', a.dataset.r === navKey));
  if (typeof cleanup === 'function') { try { cleanup(); } catch { /* ignore */ } }
  cleanup = null;
  const main = $('#main');
  main.innerHTML = '<div class="empty">กำลังโหลด…</div>';
  try {
    const mod = await import(`./pages/${page}.js`);
    cleanup = await mod.render(main, { route: r, args, query: new URLSearchParams(qs || '') });
    main.focus({ preventScroll: true });
    window.scrollTo(0, 0);
  } catch (e) {
    console.error(e);
    main.innerHTML = `<div class="alert bad">เกิดข้อผิดพลาด: ${esc(errMsg(e))}</div>`;
  }
}
window.addEventListener('hashchange', route);

// ---------- เริ่มระบบ ----------
async function boot() {
  if (!configured) return renderNotConfigured();
  const { data: { session } } = await sb.auth.getSession();
  state.session = session;
  if (location.hash.startsWith('#/reset') && session) return renderSetPassword();
  if (!session) { state.profile = null; return renderLogin(); }
  try {
    state.profile = await q(sb.from('profiles').select('*').eq('id', session.user.id).maybeSingle());
    if (!state.profile) return renderLogin('ไม่พบข้อมูลผู้ใช้ในระบบ ติดต่อผู้ดูแล');
    if (!state.profile.active) { await sb.auth.signOut(); return renderLogin('บัญชีนี้ถูกปิดใช้งาน'); }
    await loadRefs();
  } catch (e) { return renderLogin(errMsg(e)); }
  renderShell();
  route();
}

sb?.auth.onAuthStateChange((event) => {
  if (event === 'SIGNED_IN' && !state.profile) boot();
  if (event === 'SIGNED_OUT') { state.profile = null; renderLogin(); }
  if (event === 'PASSWORD_RECOVERY') renderSetPassword();
});

boot();
