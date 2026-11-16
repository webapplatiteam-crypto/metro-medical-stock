// พิมพ์ฉลากบาร์โค้ด (สินค้า / Lot / ตำแหน่งชั้นวาง)
import { sb, q, esc, opt, dTH, toast, $, $$, pageHead, fetchAll } from '../core.js';

const SIZES = { s: ['38 × 25 มม.', 38, 25], m: ['50 × 30 มม.', 50, 30], l: ['100 × 50 มม.', 100, 50] };
let libP;
const loadLib = () => (window.bwipjs ? Promise.resolve() : (libP ||= new Promise((res, rej) => {
  const s = document.createElement('script'); s.src = 'https://cdn.jsdelivr.net/npm/bwip-js@4/dist/bwip-js-min.js';
  s.onload = res; s.onerror = () => rej(new Error('โหลดตัวสร้างบาร์โค้ดไม่สำเร็จ')); document.head.appendChild(s);
})));
const ascii = (s) => /^[\x20-\x7E]*$/.test(s || '');

export function labelPayload(product, lot, kind) {
  const yymmdd = lot?.expiry_date ? lot.expiry_date.slice(2, 4) + lot.expiry_date.slice(5, 7) + lot.expiry_date.slice(8, 10) : '';
  const lotNo = lot && ascii(lot.lot_no) && lot.lot_no !== '-' ? lot.lot_no : '';
  if (product.gtin && kind !== 'internal') {
    const gtin = product.gtin.padStart(14, '0');
    let text = `(01)${gtin}`;
    if (yymmdd) text += `(17)${yymmdd}`;
    if (lotNo) text += product.tracking === 'serial' ? `(21)${lotNo}` : `(10)${lotNo}`;
    return { bcid: kind === 'matrix' ? 'gs1datamatrix' : 'gs1-128', text, human: text };
  }
  const text = `MMS:${product.code}${lotNo ? ':' + lotNo : ''}${lotNo && lot?.expiry_date ? ':' + lot.expiry_date.replace(/-/g, '') : ''}`;
  return { bcid: kind === 'matrix' ? 'datamatrix' : 'code128', text, human: text };
}

export async function render(main, { query }) {
  const products = await fetchAll(() => sb.from('products').select('id, code, name, gtin, tracking, size').eq('active', true).order('code'));
  const items = []; // { product, lot, copies } | { location, copies }
  const opts = { size: 'm', kind: 'linear' };

  main.innerHTML = `${pageHead('พิมพ์ฉลากบาร์โค้ด', 'สำหรับสินค้าที่ไม่มีบาร์โค้ดผู้ผลิต, ฉลาก Lot และป้ายตำแหน่งชั้นวาง', '<button class="b1" data-print>พิมพ์</button>')}
    <div class="grid g2 noprint">
      <section class="card"><h2>เพิ่มฉลากสินค้า</h2>
        <label class="f">สินค้า<select class="i" data-p>${products.map((p) => opt(p.id, `${p.code} — ${p.name}`, query.get('p'))).join('')}</select></label>
        <label class="f">Lot / Serial<select class="i" data-lot></select></label>
        <div class="row"><label class="f" style="width:140px">จำนวนดวง<input class="i" type="number" min="1" value="1" data-copies></label><button class="b2" data-add style="align-self:end">+ เพิ่มฉลาก</button></div>
        <hr style="border:0;border-top:1px solid var(--line);width:100%">
        <h3>ป้ายตำแหน่งชั้นวาง</h3>
        <div class="row"><label class="f grow">ตำแหน่ง (คั่นด้วย , เช่น A-01,A-02)<input class="i" data-locs placeholder="A-01,A-02,A-03"></label><button class="b2" data-addloc style="align-self:end">+ เพิ่มป้าย</button></div>
        <span class="sub">สแกนป้ายตำแหน่งก่อนสแกนสินค้า ระบบจะบันทึกตำแหน่งให้อัตโนมัติ</span>
      </section>
      <section class="card"><h2>รูปแบบ</h2>
        <div><div class="sub" style="font-weight:600;margin-bottom:6px">ขนาดฉลาก</div><div class="tabs" data-size>${Object.entries(SIZES).map(([k, v]) => `<button class="tab ${k === opts.size ? 'on' : ''}" data-v="${k}">${v[0]}</button>`).join('')}</div></div>
        <div><div class="sub" style="font-weight:600;margin-bottom:6px">ชนิดบาร์โค้ด</div><div class="tabs" data-kind>
          <button class="tab on" data-v="linear">GS1-128 / Code 128</button><button class="tab" data-v="matrix">GS1 DataMatrix / DataMatrix</button><button class="tab" data-v="internal">รหัสภายใน (ไม่ใช้ GTIN)</button></div>
          <p class="sub">สินค้าที่มี GTIN: ใส่ GTIN + วันหมดอายุ + Lot ในบาร์โค้ดเดียว ยิงครั้งเดียวได้ครบ · ไม่มี GTIN: ใช้รหัสภายใน MMS:รหัส:Lot:วันหมดอายุ</p></div>
        <div><div class="sub" style="font-weight:600">รายการที่จะพิมพ์</div><div data-list></div></div>
      </section>
    </div>
    <section class="card"><h2 class="noprint">ตัวอย่าง</h2><div class="labels" data-out></div></section>`;

  const pSel = $('[data-p]', main); const lotSel = $('[data-lot]', main);
  async function loadLots() {
    const rows = await q(sb.from('lots').select('id, lot_no, expiry_date').eq('product_id', pSel.value).order('expiry_date'));
    lotSel.innerHTML = opt('', '— ไม่ระบุ Lot (ฉลากรหัสสินค้า) —') + rows.map((l) => opt(l.id, `${l.lot_no}${l.expiry_date ? ' · หมดอายุ ' + dTH(l.expiry_date) : ''}`)).join('');
    lotSel._rows = rows;
  }
  pSel.onchange = loadLots; await loadLots();

  function drawList() {
    $('[data-list]', main).innerHTML = items.map((it, i) => `<div class="row between" style="border-bottom:1px solid var(--line2);padding:6px 0"><span>${it.location ? 'ตำแหน่ง ' + esc(it.location) : esc(it.product.code) + (it.lot ? ' · ' + esc(it.lot.lot_no) : '')}</span><span class="row"><span class="sub">× ${it.copies}</span><button class="b3" data-del="${i}">ลบ</button></span></div>`).join('') || '<div class="sub">ยังไม่มี</div>';
  }
  async function drawLabels() {
    const out = $('[data-out]', main);
    if (!items.length) { out.innerHTML = '<div class="empty">เพิ่มฉลากจากด้านบน</div>'; return; }
    try { await loadLib(); } catch (e) { out.innerHTML = `<div class="alert bad">${esc(e.message)}</div>`; return; }
    const [, w, h] = SIZES[opts.size];
    out.innerHTML = '';
    for (const it of items) {
      const pl = it.location ? { bcid: opts.kind === 'matrix' ? 'datamatrix' : 'code128', text: 'LOC:' + it.location, human: 'ตำแหน่ง ' + it.location } : labelPayload(it.product, it.lot, opts.kind);
      for (let c = 0; c < it.copies; c++) {
        const el = document.createElement('div'); el.className = 'label'; el.style.width = w + 'mm'; el.style.height = h + 'mm';
        el.innerHTML = it.location ? `<span class="ln" style="font-size:${h > 40 ? 22 : 14}px">${esc(it.location)}</span>` : `<span class="ln">${esc(it.product.name)}</span>`;
        const cv = document.createElement('canvas');
        try {
          window.bwipjs.toCanvas(cv, { bcid: pl.bcid, text: pl.text, scale: 2, height: pl.bcid.includes('matrix') ? undefined : Math.max(6, h / 4), includetext: false });
          cv.style.maxHeight = (h * 0.55) + 'mm'; el.appendChild(cv);
        } catch (err) { el.insertAdjacentHTML('beforeend', `<span class="bd r">${esc(String(err.message || err))}</span>`); }
        el.insertAdjacentHTML('beforeend', `<span class="lt">${esc(pl.human)}</span>${it.lot?.expiry_date ? `<span class="lt">EXP ${dTH(it.lot.expiry_date)}</span>` : ''}`);
        out.appendChild(el);
      }
    }
  }
  const redraw = () => { drawList(); drawLabels(); };
  $('[data-add]', main).onclick = () => {
    const product = products.find((p) => p.id === pSel.value); const lot = (lotSel._rows || []).find((l) => l.id === lotSel.value) || null;
    const copies = Math.min(500, Math.max(1, Number($('[data-copies]', main).value) || 1));
    if (lot && !ascii(lot.lot_no)) toast('เลข Lot มีอักษรไทย จะไม่ถูกใส่ในบาร์โค้ด (แสดงเป็นตัวอักษรอย่างเดียว)');
    items.push({ product, lot, copies }); redraw();
  };
  $('[data-addloc]', main).onclick = () => {
    $('[data-locs]', main).value.split(',').map((s) => s.trim().toUpperCase()).filter(Boolean).forEach((location) => items.push({ location, copies: 1 }));
    $('[data-locs]', main).value = ''; redraw();
  };
  $('[data-list]', main).addEventListener('click', (e) => { const b = e.target.closest('[data-del]'); if (b) { items.splice(Number(b.dataset.del), 1); redraw(); } });
  for (const [sel, key] of [['[data-size]', 'size'], ['[data-kind]', 'kind']]) {
    $(sel, main).addEventListener('click', (e) => { const b = e.target.closest('[data-v]'); if (!b) return; opts[key] = b.dataset.v; $$(sel + ' .tab', main).forEach((t) => t.classList.toggle('on', t === b)); drawLabels(); });
  }
  $('[data-print]', main).onclick = () => { if (!items.length) return toast('ยังไม่มีฉลาก', 'err'); window.print(); };
  if (query.get('p')) { /* เปิดจากการ์ดสินค้า */ }
  redraw();
}
