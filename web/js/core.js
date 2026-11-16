// แกนกลางของแอป: Supabase client, สถานะผู้ใช้, ตัวช่วยแสดงผล
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

export const configured = !SUPABASE_URL.includes('YOUR-PROJECT') && !SUPABASE_ANON_KEY.includes('YOUR-ANON');
export const sb = configured ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: true, autoRefreshToken: true } }) : null;

export const state = { session: null, profile: null, settings: null, warehouses: [], partners: [] };

// ---------- ป้ายชื่อ ----------
export const ROLE = { admin: 'ผู้ดูแลระบบ', manager: 'หัวหน้าคลัง', staff: 'เจ้าหน้าที่คลัง', sales: 'ฝ่ายขาย', viewer: 'บัญชี / ผู้บริหาร' };
export const DOC = {
  IN:  { label: 'รับเข้า',     route: 'receive',  cls: 'g' },
  OUT: { label: 'จ่ายออก',     route: 'issue',    cls: 'bl' },
  ADJ: { label: 'ปรับยอด',     route: 'adjust',   cls: 'n' },
  TRF: { label: 'โอนย้าย',     route: 'transfer', cls: 'y' },
  CNT: { label: 'ตรวจนับ',     route: 'count',    cls: 'n' },
  DSP: { label: 'ทำลาย / คืน', route: 'dispose',  cls: 'r' },
};
export const STATUS = { draft: ['ร่าง', 'n'], pending: ['รออนุมัติ', 'o'], posted: ['ยืนยันแล้ว', 'g'], cancelled: ['ยกเลิก', 'r'] };
export const PURPOSE = {
  purchase: 'ซื้อ / รับจากซัพพลายเออร์', return: 'รับคืนจากลูกค้า', opening: 'ยอดยกมา', other: 'อื่น ๆ',
  sale: 'ขาย / ส่งโรงพยาบาล', consignment: 'ฝากขาย (Consignment)', demo: 'ยืม / Demo',
  return_supplier: 'คืนซัพพลายเออร์', destroy: 'ตัดทำลาย',
};
export const TRACK = { lot: 'Lot + วันหมดอายุ', serial: 'Serial', none: 'ไม่ติดตาม' };
export const WH_KIND = { main: 'คลังบริษัท', quarantine: 'กักกัน (ห้ามจ่าย)', consignment: 'ฝากขาย', demo: 'Demo / ยืม' };

// ---------- สิทธิ์ ----------
export const role = () => state.profile?.role;
export const can = {
  operate: () => ['admin', 'manager', 'staff'].includes(role()),
  manage:  () => ['admin', 'manager'].includes(role()),
  admin:   () => role() === 'admin',
  seeCost: () => ['admin', 'manager', 'viewer'].includes(role()),
};

// ---------- รูปแบบตัวเลข / วันที่ (แสดงเป็น พ.ศ.) ----------
export const n0 = (v) => Number(v || 0).toLocaleString('en-US', { maximumFractionDigits: 2 });
export const n2 = (v) => Number(v || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const TH_M = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
const parts = (iso) => { if (!iso) return null; const [y, m, d] = String(iso).slice(0, 10).split('-').map(Number); return y ? { y, m, d } : null; };
export const dTH = (iso) => { const p = parts(iso); return p ? `${String(p.d).padStart(2, '0')}/${String(p.m).padStart(2, '0')}/${p.y + 543}` : '—'; };
export const dTHlong = (iso) => { const p = parts(iso); return p ? `${p.d} ${TH_M[p.m - 1]} ${p.y + 543}` : '—'; };
export const dtTH = (ts) => { if (!ts) return '—'; const t = new Date(ts); return `${dTH(isoDate(t))} ${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}`; };
export const isoDate = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
export const today = () => isoDate();
export const addDays = (iso, n) => { const p = parts(iso); const d = new Date(p.y, p.m - 1, p.d + n); return isoDate(d); };
export const daysLeft = (iso) => { const p = parts(iso); if (!p) return null; const a = new Date(p.y, p.m - 1, p.d); const t = new Date(); t.setHours(0, 0, 0, 0); return Math.round((a - t) / 86400000); };

export function expiryBadge(iso) {
  const d = daysLeft(iso);
  if (d === null) return '<span class="bd y">ยังไม่ระบุ</span>';
  if (d < 0) return `<span class="bd r">หมดอายุ ${-d} วัน</span>`;
  if (d <= 30) return `<span class="bd o">${d} วัน</span>`;
  if (d <= 90) return `<span class="bd y">${d} วัน</span>`;
  if (d <= 180) return `<span class="bd bl">${d} วัน</span>`;
  return `<span class="bd g">${d >= 365 ? Math.floor(d / 30) + ' เดือน' : d + ' วัน'}</span>`;
}
export const statusBadge = (s) => `<span class="bd ${STATUS[s]?.[1] || 'n'}">${STATUS[s]?.[0] || s}</span>`;
export const typeBadge = (t) => `<span class="bd ${DOC[t]?.cls || 'n'}">${DOC[t]?.label || t}</span>`;

// ---------- HTML ----------
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
export const opt = (v, label, sel) => `<option value="${esc(v)}" ${String(v) === String(sel ?? '') ? 'selected' : ''}>${esc(label)}</option>`;
export const debounce = (fn, ms = 250) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };

// ---------- แจ้งเตือน / กล่องโต้ตอบ ----------
export function toast(msg, type = '') {
  let box = document.getElementById('toasts');
  if (!box) { box = document.createElement('div'); box.id = 'toasts'; box.setAttribute('role', 'status'); document.body.appendChild(box); }
  const el = document.createElement('div');
  el.className = 'toast ' + type; el.textContent = msg; box.appendChild(el);
  setTimeout(() => el.remove(), type === 'err' ? 7000 : 3500);
}
export const errMsg = (e) => (e?.message || e?.error_description || String(e)).replace(/^.*?ERROR:\s*/, '');

export function modal({ title, body = '', actions = [], wide = false, onOpen }) {
  const bg = document.createElement('div');
  bg.className = 'modal-bg';
  bg.innerHTML = `<div class="modal ${wide ? 'wide' : ''}" role="dialog" aria-modal="true" aria-label="${esc(title)}">
    <div class="row between"><h2>${esc(title)}</h2><button type="button" class="b3" data-x aria-label="ปิด">ปิด</button></div>
    <div class="mbody">${body}</div>
    <div class="row end mact"></div></div>`;
  const close = () => { bg.remove(); document.removeEventListener('keydown', onKey); };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);
  bg.addEventListener('click', (e) => { if (e.target === bg) close(); });
  $('[data-x]', bg).onclick = close;
  const act = $('.mact', bg);
  for (const a of actions) {
    const b = document.createElement('button');
    b.type = 'button'; b.className = a.cls || 'b2'; b.textContent = a.label;
    b.onclick = async () => { b.disabled = true; try { const keep = await a.onClick?.(bg); if (keep !== true) close(); } catch (e) { toast(errMsg(e), 'err'); } finally { b.disabled = false; } };
    act.appendChild(b);
  }
  document.body.appendChild(bg);
  onOpen?.(bg);
  setTimeout(() => $('input,select,textarea', $('.mbody', bg))?.focus(), 30);
  return { el: bg, close };
}
export const confirmBox = (title, text, okLabel = 'ยืนยัน', danger = false) => new Promise((res) => {
  let done = false;
  const m = modal({ title, body: `<p>${esc(text)}</p>`, actions: [
    { label: 'ยกเลิก', cls: 'b2', onClick: () => { done = true; res(false); } },
    { label: okLabel, cls: danger ? 'bd-btn' : 'b1', onClick: () => { done = true; res(true); } }] });
  const obs = new MutationObserver(() => { if (!document.body.contains(m.el)) { obs.disconnect(); if (!done) res(false); } });
  obs.observe(document.body, { childList: true });
});
export const promptBox = (title, label, { required = true, value = '' } = {}) => new Promise((res) => {
  let done = false;
  const m = modal({ title, body: `<label class="f">${esc(label)}<textarea class="i" data-v>${esc(value)}</textarea></label>`, actions: [
    { label: 'ยกเลิก', cls: 'b2', onClick: () => { done = true; res(null); } },
    { label: 'ตกลง', cls: 'b1', onClick: (bg) => { const v = $('[data-v]', bg).value.trim(); if (required && !v) { toast('กรุณากรอกข้อมูล', 'err'); return true; } done = true; res(v); } }] });
  const obs = new MutationObserver(() => { if (!document.body.contains(m.el)) { obs.disconnect(); if (!done) res(null); } });
  obs.observe(document.body, { childList: true });
});

// ---------- ข้อมูลอ้างอิง ----------
export async function q(promise) {
  const { data, error } = await promise;
  if (error) throw error;
  return data;
}
export async function loadRefs() {
  const [settings, warehouses, partners] = await Promise.all([
    q(sb.from('company_settings').select('*').eq('id', 1).maybeSingle()),
    q(sb.from('warehouses').select('*').order('code')),
    q(sb.from('partners').select('*').order('name')),
  ]);
  Object.assign(state, { settings, warehouses, partners });
}
export const whName = (id) => state.warehouses.find((w) => w.id === id)?.name || '—';
export const partnerName = (id) => state.partners.find((p) => p.id === id)?.name || '';
export const mainWh = () => state.warehouses.find((w) => w.kind === 'main' && w.active) || state.warehouses[0];
export const whOptions = (sel, filter = () => true) => state.warehouses.filter((w) => w.active && filter(w)).map((w) => opt(w.id, `${w.name} (${w.code})`, sel)).join('');
export const partnerOptions = (sel, kinds) => '<option value="">— ไม่ระบุ —</option>' + state.partners
  .filter((p) => p.active && (!kinds || kinds.includes(p.kind) || p.kind === 'both')).map((p) => opt(p.id, p.name, sel)).join('');

// ---------- Excel (SheetJS โหลดเมื่อใช้) ----------
let XLSX;
export async function xlsx() { XLSX ||= await import('https://cdn.sheetjs.com/xlsx-0.20.3/package/xlsx.mjs'); return XLSX; }
export async function downloadXlsx(filename, sheets) {
  const X = await xlsx();
  const wb = X.utils.book_new();
  for (const s of sheets) {
    const ws = X.utils.aoa_to_sheet(s.rows);
    if (s.cols) ws['!cols'] = s.cols.map((w) => ({ wch: w }));
    if (s.merges) ws['!merges'] = s.merges;
    X.utils.book_append_sheet(wb, ws, s.name.slice(0, 31).replace(/[\\/?*[\]:]/g, '-'));
  }
  X.writeFile(wb, filename);
}

// ---------- อื่น ๆ ----------
export const pageHead = (title, sub = '', actions = '', crumb = '') => `
  <div class="pagehead"><div class="t">${crumb ? `<span class="crumb">${crumb}</span>` : ''}<h1>${title}</h1>${sub ? `<span class="sub">${sub}</span>` : ''}</div>
  <div class="row noprint">${actions}</div></div>`;
export const emptyRow = (cols, text = 'ไม่มีข้อมูล') => `<tr><td colspan="${cols}" class="empty">${text}</td></tr>`;
export function go(hash) { if (location.hash === hash) window.dispatchEvent(new HashChangeEvent('hashchange')); else location.hash = hash; }
export async function fetchAll(builder, page = 1000) {
  const out = [];
  for (let from = 0; ; from += page) {
    const rows = await q(builder().range(from, from + page - 1));
    out.push(...rows);
    if (rows.length < page) return out;
  }
}
