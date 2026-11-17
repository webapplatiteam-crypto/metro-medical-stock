// การสแกน: เครื่องยิง USB/PDA (พิมพ์เป็นคีย์บอร์ด), กล้องมือถือ, แยกข้อมูล GS1
import { sb, q, modal, toast, esc } from './core.js';

const FIXED = { '00': 18, '01': 14, '02': 14, '11': 6, '12': 6, '13': 6, '15': 6, '16': 6, '17': 6, '20': 2 };
const GS = '\x1d';

function yymmdd(v) {
  if (!/^\d{6}$/.test(v)) return null;
  const y = 2000 + Number(v.slice(0, 2)); const m = Number(v.slice(2, 4)); let d = Number(v.slice(4, 6));
  if (m < 1 || m > 12) return null;
  if (d === 0) d = new Date(y, m, 0).getDate(); // DD=00 = วันสุดท้ายของเดือน
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

function applyAI(out, ai, val) {
  if (ai === '01' || ai === '02') out.gtin = val;
  else if (ai === '17') out.expiry = yymmdd(val);
  else if (ai === '11') out.prodDate = yymmdd(val);
  else if (ai === '10') out.lot = val;
  else if (ai === '21') out.serial = val;
  else if (ai === '30' || ai === '37') out.count = Number(val);
}

// คืนค่า { kind: 'gs1'|'internal'|'location'|'code', code?, gtin?, lot?, serial?, expiry?, raw }
export function parseScan(raw) {
  let s = String(raw || '').replace(/[\r\n]/g, '').trim();
  s = s.replace(/^\][A-Za-z][0-9A-Za-z]/, '');          // AIM prefix เช่น ]C1 ]d2 ]Q3
  const out = { raw: s };
  if (!s) return { ...out, kind: 'empty' };

  if (/^MMS:/i.test(s)) {                                  // ฉลากที่ระบบพิมพ์เอง  MMS:รหัส:Lot:YYYYMMDD
    const [, code, lot, exp] = s.split(':');
    return { ...out, kind: 'internal', code, lot: lot || null, expiry: exp && /^\d{8}$/.test(exp) ? `${exp.slice(0, 4)}-${exp.slice(4, 6)}-${exp.slice(6, 8)}` : null };
  }
  if (/^LOC:/i.test(s)) return { ...out, kind: 'location', location: s.slice(4) };

  if (s.startsWith('(')) {                                 // (01)xxxx(17)yymmdd(10)lot
    const re = /\((\d{2,4})\)([^(]*)/g; let m; let any = false;
    while ((m = re.exec(s))) { applyAI(out, m[1], m[2].replace(GS, '').trim()); any = true; }
    if (any && (out.gtin || out.lot)) return { ...out, kind: 'gs1' };
  }

  if (/^(01|02)\d{14}/.test(s) && (s.length > 16 || s.includes(GS))) {  // GS1 แบบดิบ
    let i = 0;
    while (i < s.length) {
      if (s[i] === GS) { i++; continue; }
      let ai = s.slice(i, i + 2);
      if (/^2[45]$/.test(ai)) ai = s.slice(i, i + 3);
      else if (/^(31|32|33|34|35|36|39|70|71|72|80|81)$/.test(ai)) ai = s.slice(i, i + 4);
      i += ai.length;
      if (FIXED[ai]) { applyAI(out, ai, s.slice(i, i + FIXED[ai])); i += FIXED[ai]; continue; }
      if (/^31|^32|^33|^34|^35|^36/.test(ai)) { i += 6; continue; }
      let end = s.indexOf(GS, i); if (end === -1) end = s.length;
      applyAI(out, ai, s.slice(i, end)); i = end + 1;
    }
    return { ...out, kind: 'gs1' };
  }

  if (/^\d{13,14}$/.test(s)) return { ...out, kind: 'code', code: s, gtin: s.padStart(14, '0') };
  return { ...out, kind: 'code', code: s };
}

// ค้นหาสินค้าจากผลสแกน
export async function lookupProduct(p) {
  const keys = [p.gtin, p.code].filter(Boolean);
  for (const k of keys) {
    const rows = await q(sb.rpc('find_product', { p_code: k }));
    if (rows?.length) return rows[0];
  }
  return null;
}

// ผูกช่องสแกน: เครื่องยิงส่ง Enter ท้ายรหัส
export function bindScanInput(input, onScan) {
  input.addEventListener('keydown', async (e) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const v = input.value; input.value = '';
    if (!v.trim()) return;
    try { await onScan(parseScan(v)); } catch (err) { toast(err.message || String(err), 'err'); }
  });
}

export function beep(ok = true) {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const o = ctx.createOscillator(); const g = ctx.createGain();
    o.frequency.value = ok ? 1200 : 300; g.gain.value = 0.08; o.connect(g); g.connect(ctx.destination);
    o.start(); o.stop(ctx.currentTime + (ok ? 0.08 : 0.3));
    if (navigator.vibrate) navigator.vibrate(ok ? 40 : [80, 40, 80]);
  } catch { /* ไม่มีเสียงก็ไม่เป็นไร */ }
}

// ---------- กล้อง ----------
let libLoading;
function loadCameraLib() {
  if (window.Html5Qrcode) return Promise.resolve();
  libLoading ||= new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = 'https://unpkg.com/html5-qrcode@2.3.8/html5-qrcode.min.js';
    s.onload = res; s.onerror = () => rej(new Error('โหลดตัวอ่านกล้องไม่สำเร็จ ตรวจอินเทอร์เน็ต'));
    document.head.appendChild(s);
  });
  return libLoading;
}

// เปิดกล้อง สแกนต่อเนื่องได้ (continuous = true) จนกดปิด
export async function openCamera(onScan, { continuous = false, title = 'สแกนด้วยกล้อง' } = {}) {
  if (!window.isSecureContext) { toast('กล้องใช้ได้เฉพาะเว็บที่เป็น https', 'err'); return; }
  await loadCameraLib();
  let scanner; let last = ''; let lastAt = 0;
  const m = modal({
    title,
    body: `<div id="reader"></div><p class="sub" style="margin:8px 0 0">เล็งบาร์โค้ดให้อยู่ในกรอบ · รองรับ 1D, QR, GS1 DataMatrix</p><div data-last class="sub"></div>`,
    actions: [{ label: 'ปิดกล้อง', cls: 'b2' }],
  });
  const stop = async () => { try { if (scanner?.isScanning) await scanner.stop(); scanner?.clear(); } catch { /* ignore */ } };
  const obs = new MutationObserver(() => { if (!document.body.contains(m.el)) { obs.disconnect(); stop(); } });
  obs.observe(document.body, { childList: true });
  try {
    scanner = new window.Html5Qrcode('reader');
    await scanner.start({ facingMode: 'environment' }, { fps: 10, qrbox: (w, h) => ({ width: Math.min(300, w * 0.85), height: Math.min(200, h * 0.6) }) },
      async (text) => {
        const now = Date.now();
        if (text === last && now - lastAt < 2500) return;   // กันอ่านซ้ำรัว ๆ
        last = text; lastAt = now;
        beep(true);
        const lastEl = m.el.querySelector('[data-last]'); if (lastEl) lastEl.innerHTML = 'อ่านได้: <b>' + esc(text) + '</b>';
        try { await onScan(parseScan(text)); } catch (err) { beep(false); toast(err.message || String(err), 'err'); }
        if (!continuous) m.close();
      }, () => {});
  } catch (e) {
    m.close();
    toast('เปิดกล้องไม่ได้: ' + (e.message || e) + ' — ตรวจว่าอนุญาตกล้องให้เว็บนี้แล้ว', 'err');
  }
}

export const scanBoxHtml = (placeholder = 'ยิงบาร์โค้ด หรือพิมพ์รหัสแล้วกด Enter') => { if (window.matchMedia('(max-width: 760px)').matches) placeholder = 'ยิง / พิมพ์รหัส แล้ว Enter'; return `
  <div class="scanbox noprint">
    <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#0A4DA2" stroke-width="2" aria-hidden="true"><path d="M3 5v14M6 5v14M10 5v14M13 5v14M17 5v14M21 5v14"/></svg>
    <input data-scan type="text" inputmode="text" autocomplete="off" placeholder="${placeholder}" aria-label="ช่องสแกนบาร์โค้ด">
    <button type="button" class="b2 cam" data-cam>กล้อง</button>
  </div>`; };
