// หน้าทำรายการ: รับเข้า / จ่ายออก / ปรับยอด / โอนย้าย / ทำลาย-คืน / ตรวจนับ
import {
  sb, q, state, can, DOC, PURPOSE, esc, opt, n0, n2, dTH, today, daysLeft, expiryBadge, toast, errMsg, modal,
  confirmBox, $, $$, whOptions, partnerOptions, mainWh, pageHead, go, debounce,
} from '../core.js';
import { scanBoxHtml, bindScanInput, openCamera, lookupProduct, beep, parseScan } from '../scan.js';

const TYPE_BY_ROUTE = { receive: 'IN', issue: 'OUT', adjust: 'ADJ', transfer: 'TRF', dispose: 'DSP', count: 'CNT' };
const TITLE = { IN: 'รับเข้าสินค้า', OUT: 'จ่ายออก / ตัดสต็อก', ADJ: 'ปรับยอดสต็อก', TRF: 'โอนย้ายคลัง', DSP: 'ตัดทำลาย / คืนซัพพลายเออร์', CNT: 'ตรวจนับสต็อก' };
const PURPOSES = { IN: ['purchase', 'return', 'other'], OUT: ['sale', 'consignment', 'demo', 'other'], DSP: ['destroy', 'return_supplier'] };
const fine = window.matchMedia('(pointer:fine)').matches;
let seq = 0;

export async function render(main, { route, args }) {
  if (!can.operate()) { main.innerHTML = '<div class="alert bad">บัญชีนี้ดูข้อมูลได้อย่างเดียว</div>'; return; }
  const type = TYPE_BY_ROUTE[route];
  const quarantine = state.warehouses.find((w) => w.kind === 'quarantine');
  const doc = {
    id: null, doc_no: null, doc_type: type, doc_date: today(),
    warehouse_id: (type === 'DSP' && quarantine ? quarantine.id : mainWh()?.id) || null,
    to_warehouse_id: type === 'TRF' ? (state.warehouses.find((w) => w.id !== mainWh()?.id && w.active)?.id || null) : null,
    partner_id: '', purpose: PURPOSES[type]?.[0] || null, ref_no: '', note: '',
  };
  let lines = [];
  let curLoc = '';
  let blind = false;
  const lotCache = new Map(); // product_id|warehouse → lots

  // ---------- โหลดร่างเดิม ----------
  if (args[0]) {
    const d = await q(sb.from('documents').select('*').eq('id', args[0]).maybeSingle());
    if (!d) { main.innerHTML = '<div class="alert bad">ไม่พบเอกสาร</div>'; return; }
    if (d.status !== 'draft') { go('#/doc/' + d.id); return; }
    Object.assign(doc, d, { partner_id: d.partner_id || '' });
    const ls = await q(sb.from('document_lines').select('*, product:products(*)').eq('document_id', d.id).order('line_no'));
    lines = ls.map((l) => ({ key: ++seq, product: l.product, lot_no: l.lot_no || '', expiry_date: l.expiry_date || '', lot_id: l.lot_id,
      qty: Number(l.qty), unit_cost: l.unit_cost, location: l.location || '', reason: l.reason || '', override_reason: l.override_reason || '', counted: type === 'CNT' }));
    for (const l of lines) if (type !== 'IN') await ensureLots(l.product.id);
  }

  async function ensureLots(pid, force = false) {
    const k = pid + '|' + doc.warehouse_id;
    if (!force && lotCache.has(k)) return lotCache.get(k);
    const rows = await q(sb.from('v_lot_stock').select('lot_id, lot_no, expiry_date, qty, location').eq('product_id', pid).eq('warehouse_id', doc.warehouse_id));
    rows.sort((a, b) => (a.expiry_date || '9999') < (b.expiry_date || '9999') ? -1 : (a.expiry_date || '9999') > (b.expiry_date || '9999') ? 1 : a.lot_no.localeCompare(b.lot_no));
    lotCache.set(k, rows);
    return rows;
  }
  const lotsOf = (pid) => lotCache.get(pid + '|' + doc.warehouse_id) || [];
  const usedQty = (lotId, exceptKey) => lines.filter((l) => l.lot_id === lotId && l.key !== exceptKey).reduce((s, l) => s + Number(l.qty || 0), 0);

  // ---------- โครงหน้า ----------
  const tabs = ['ADJ', 'TRF', 'DSP'].includes(type) ? `<div class="tabs noprint">${['ADJ', 'TRF', 'DSP'].map((t) =>
    `<a class="tab ${t === type ? 'on' : ''}" href="#/${DOC[t].route}" style="text-decoration:none">${TITLE[t]}</a>`).join('')}</div>` : '';
  main.innerHTML = `
    ${pageHead(TITLE[type] + (doc.doc_no ? ` <span class="bd bl" style="vertical-align:middle;font-size:14px">${esc(doc.doc_no)} · ร่าง</span>` : ''),
      type === 'CNT' ? 'สแกนสินค้าทีละชิ้น หรือดึงรายการทั้งคลังมานับ · ระบบเทียบยอดให้อัตโนมัติ' : 'สแกนบาร์โค้ด (เครื่องยิง/กล้อง) หรือเลือกสินค้า',
      `<button class="b2" data-save>บันทึกร่าง</button><button class="b1" data-post>ยืนยัน</button>`)}
    ${tabs}
    <div class="grid" style="grid-template-columns:minmax(0,1fr)">
      ${scanBoxHtml()}
      <div class="row noprint">
        <button class="b2 sm" data-pick>+ เลือกสินค้า</button>
        ${type === 'CNT' ? '<button class="b2 sm" data-loadall>ดึงรายการทั้งคลัง</button><label class="chk"><input type="checkbox" data-blind> นับแบบไม่เห็นยอดระบบ</label>' : ''}
        <span class="sub" data-loc></span><span class="grow"></span><span class="sub" data-msg></span>
      </div>
    </div>
    <details class="card" data-headwrap open><summary style="cursor:pointer;font-weight:700">ข้อมูลเอกสาร (วันที่ · คลัง · คู่ค้า · อ้างอิง)</summary><div data-head style="margin-top:12px"></div></details>
    <section class="card"><div class="tw"><table class="t lines"><thead data-thead></thead><tbody data-body></tbody><tfoot data-foot></tfoot></table></div></section>`;

  const headEl = $('[data-head]', main);
  const body = $('[data-body]', main);
  const scanInput = $('[data-scan]', main);

  function renderHead() {
    const wh = (label, key, filter) => `<label class="f">${label}<select class="i" data-h="${key}">${whOptions(doc[key], filter)}</select></label>`;
    const f = [];
    f.push(`<label class="f">วันที่<input class="i" type="date" data-h="doc_date" value="${esc(doc.doc_date)}"></label>`);
    if (type === 'TRF') { f.push(wh('จากคลัง', 'warehouse_id')); f.push(wh('ไปคลัง', 'to_warehouse_id')); }
    else f.push(wh('คลัง', 'warehouse_id', type === 'OUT' ? (w) => w.kind !== 'quarantine' : undefined));
    if (PURPOSES[type]) f.push(`<label class="f">${type === 'IN' ? 'ประเภทการรับ' : type === 'OUT' ? 'ประเภทการจ่าย' : 'วิธีจัดการ'}<select class="i" data-h="purpose">${PURPOSES[type].map((p) => opt(p, PURPOSE[p], doc.purpose)).join('')}</select></label>`);
    if (type === 'IN' || type === 'DSP') f.push(`<label class="f">ซัพพลายเออร์<select class="i" data-h="partner_id">${partnerOptions(doc.partner_id, ['supplier'])}</select></label>`);
    if (type === 'OUT') f.push(`<label class="f">ลูกค้า / โรงพยาบาล<select class="i" data-h="partner_id">${partnerOptions(doc.partner_id, ['customer'])}</select></label>`);
    if (['IN', 'OUT', 'DSP'].includes(type)) f.push(`<label class="f">${type === 'IN' ? 'เลขที่ใบส่งของ / Invoice' : type === 'OUT' ? 'อ้างอิง PO ลูกค้า' : 'อ้างอิง'}<input class="i" data-h="ref_no" value="${esc(doc.ref_no)}"></label>`);
    f.push(`<label class="f span2">หมายเหตุ<input class="i" data-h="note" value="${esc(doc.note)}"></label>`);
    headEl.innerHTML = `<div class="grid g4">${f.join('')}</div>`;
    $$('[data-h]', headEl).forEach((el) => el.addEventListener('change', async () => {
      doc[el.dataset.h] = el.value;
      if (el.dataset.h === 'warehouse_id' && type !== 'IN') {
        for (const l of lines) { await ensureLots(l.product.id); reassignLot(l); }
        renderLines();
      }
      if (el.dataset.h === 'partner_id' || el.dataset.h === 'doc_date') renderLines();
    }));
  }

  function reassignLot(l) {
    const lots = lotsOf(l.product.id);
    const found = lots.find((x) => x.lot_no === l.lot_no);
    l.lot_id = found?.lot_id || null;
    if (found) l.expiry_date = found.expiry_date || '';
  }

  // ---------- หัวตาราง / แถว ----------
  function thead() {
    const c = {
      IN: ['สินค้า', 'Lot / Serial', 'วันหมดอายุ', 'จำนวน', 'ราคาทุน/หน่วย', 'รวม', 'ตำแหน่ง', ''],
      OUT: ['สินค้า', 'Lot / Serial', 'หมดอายุ', 'คงเหลือ', 'จำนวน', 'หมายเหตุ', ''],
      TRF: ['สินค้า', 'Lot / Serial', 'หมดอายุ', 'คงเหลือ', 'จำนวนโอน', '', ''],
      DSP: ['สินค้า', 'Lot / Serial', 'หมดอายุ', 'คงเหลือ', 'จำนวน', 'เหตุผล', ''],
      ADJ: ['สินค้า', 'Lot / Serial', 'หมดอายุ', 'คงเหลือ', 'ปรับ (+/−)', 'เหตุผล *', ''],
      CNT: ['สินค้า', 'Lot / Serial', 'หมดอายุ', blind ? '' : 'ยอดระบบ', 'นับได้', blind ? '' : 'ต่าง', ''],
    }[type];
    return `<tr>${c.map((h, i) => `<th class="${/จำนวน|คงเหลือ|ปรับ|นับ|ระบบ|ต่าง|ราคา|รวม/.test(h) ? 'num' : ''}">${h}</th>`).join('')}</tr>`;
  }

  function lotCell(l) {
    if (type === 'IN' || ((type === 'ADJ' || type === 'CNT') && !l.lot_id && l.newLot)) {
      return `<input class="i sm" data-f="lot_no" value="${esc(l.lot_no)}" placeholder="${l.product.tracking === 'serial' ? 'Serial' : l.product.tracking === 'none' ? '—' : 'เลข Lot'}" ${l.product.tracking === 'none' ? 'disabled' : ''}>`;
    }
    const lots = lotsOf(l.product.id);
    const opts = lots.map((x) => opt(x.lot_id, `${x.lot_no}${x.expiry_date ? ' · ' + dTH(x.expiry_date) : ''} · เหลือ ${n0(x.qty)}`, l.lot_id)).join('');
    return `<select class="i sm" data-f="lot_id">${l.lot_id ? '' : '<option value="">— เลือก Lot —</option>'}${opts}${(type === 'ADJ' || type === 'CNT') ? '<option value="__new">+ Lot ใหม่ (พบของที่ไม่มีในระบบ)</option>' : ''}</select>`;
  }

  function lineWarn(l) {
    const w = [];
    const dl = daysLeft(l.expiry_date);
    if (type === 'IN') {
      if (l.product.tracking !== 'none' && !l.lot_no) w.push(['bad', 'ยังไม่ได้ใส่ ' + (l.product.tracking === 'serial' ? 'Serial' : 'Lot')]);
      if (l.product.tracking === 'lot' && !l.expiry_date) w.push(['warn', 'ยังไม่ได้ใส่วันหมดอายุ']);
      if (dl !== null && dl < 0) w.push(['bad', 'สินค้าหมดอายุแล้ว — รับเข้าไม่ได้']);
      else if (dl !== null && dl < (l.product.min_shelf_days ?? state.settings?.min_shelf_days ?? 180)) w.push(['warn', `อายุเหลือ ${dl} วัน — ต้องให้หัวหน้าคลังอนุมัติ`]);
    } else {
      if (!l.lot_id && !l.newLot) w.push(['bad', 'ไม่มี Lot นี้ในคลังที่เลือก']);
      const lot = lotsOf(l.product.id).find((x) => x.lot_id === l.lot_id);
      if (lot && ['OUT', 'TRF', 'DSP'].includes(type) && usedQty(l.lot_id) > Number(lot.qty)) w.push(['bad', `เกินคงเหลือ (มี ${n0(lot.qty)})`]);
      if (lot && type === 'ADJ' && Number(lot.qty) + usedQty(l.lot_id) < 0) w.push(['bad', 'ปรับแล้วยอดติดลบ']);
      if (type === 'OUT' && dl !== null && dl < 0) w.push(['bad', 'Lot หมดอายุแล้ว — ห้ามจ่าย (ใช้ใบทำลาย/คืน)']);
      if (type === 'OUT' && l.expiry_date) {
        const usedLots = new Set(lines.map((x) => x.lot_id));
        const early = lotsOf(l.product.id).find((x) => x.expiry_date && x.expiry_date < l.expiry_date && daysLeft(x.expiry_date) >= 0 && Number(x.qty) > 0 && !usedLots.has(x.lot_id));
        if (early) w.push([l.override_reason ? 'warn' : 'bad', `FEFO: ควรจ่าย Lot ${early.lot_no} (หมดอายุ ${dTH(early.expiry_date)}) ก่อน${l.override_reason ? ' — ข้ามโดยมีเหตุผล ต้องอนุมัติ' : ' — ใส่เหตุผลหากต้องการข้าม'}`]);
      }
      const cust = state.partners.find((p) => p.id === doc.partner_id);
      if (type === 'OUT' && cust?.min_shelf_days && dl !== null && dl < cust.min_shelf_days) w.push(['warn', `ลูกค้ารับอายุขั้นต่ำ ${cust.min_shelf_days} วัน (Lot นี้เหลือ ${dl}) — ต้องอนุมัติ`]);
      if (type === 'TRF' && dl !== null && dl < 0 && state.warehouses.find((x) => x.id === doc.to_warehouse_id)?.kind !== 'quarantine') w.push(['bad', 'Lot หมดอายุ โอนได้เฉพาะไปพื้นที่กักกัน']);
      if (type === 'ADJ' && !l.reason) w.push(['warn', 'ใส่เหตุผลการปรับ']);
    }
    if (l.product.tracking === 'serial' && ['IN', 'OUT', 'TRF', 'DSP'].includes(type) && Number(l.qty) !== 1) w.push(['bad', 'สินค้า Serial: 1 บรรทัด = 1 ชิ้น']);
    return w.map(([k, t]) => `<div class="bd ${k === 'bad' ? 'r' : 'o'}" style="margin-top:4px;white-space:normal">${esc(t)}</div>`).join('');
  }

  function rowHtml(l) {
    const p = l.product; const u = esc(p.unit || 'ชิ้น');
    const lot = lotsOf(p.id).find((x) => x.lot_id === l.lot_id);
    const verb = { IN: 'รับเข้า', OUT: 'จ่ายออก', TRF: 'โอน', DSP: 'ทำลาย/คืน', ADJ: 'ปรับ (+/−)', CNT: 'นับได้จริง' }[type];
    const name = `<td class="c-name full" data-l="สินค้า"><b>${esc(p.name)}</b><div class="sub mono">${esc(p.code)}${p.size ? ' · ' + esc(p.size) : ''}${l.location ? ' · ตำแหน่ง ' + esc(l.location) : ''}</div>${lineWarn(l)}</td>`;
    const qtyInput = (field = 'qty', allowNeg = false) => `<div class="qtybox"><button type="button" class="stepbtn" data-step="-1" aria-label="ลดจำนวน">−</button><input class="i sm num" style="width:96px;text-align:right" type="number" inputmode="decimal" step="any" ${allowNeg ? '' : 'min="0"'} data-f="${field}" value="${l[field] ?? ''}"><button type="button" class="stepbtn" data-step="1" aria-label="เพิ่มจำนวน">+</button><span class="unit">${u}</span></div>`;
    const del = `<td class="c-del"><button type="button" class="b3 delbtn" data-del aria-label="ลบรายการนี้">✕ ลบ</button></td>`;
    const expTxt = l.expiry_date ? dTH(l.expiry_date) + ' ' + expiryBadge(l.expiry_date) : '<span class="sub">ไม่ระบุ</span>';
    const exp = (type === 'IN')
      ? `<td class="c-exp" data-l="วันหมดอายุ"><input class="i sm" type="date" data-f="expiry_date" value="${esc(l.expiry_date)}" ${p.tracking === 'none' ? 'disabled' : ''}></td>`
      : `<td class="c-exp c-info" data-l="หมดอายุ">${l.newLot ? `<input class="i sm" type="date" data-f="expiry_date" value="${esc(l.expiry_date)}">` : expTxt}</td>`;
    const avail = `<td class="num c-avail c-info" data-l="มีในคลัง">${lot ? n0(lot.qty) : '0'} <span class="unit">${u}</span></td>`;
    const lotTd = `<td class="c-lot full" data-l="${type === 'IN' ? (p.tracking === 'serial' ? 'Serial' : 'เลข Lot') : 'Lot ที่ใช้ (ระบบเลือกตัวที่หมดอายุก่อนให้)'}">${lotCell(l)}</td>`;
    let cells;
    if (type === 'IN') {
      cells = `${name}${lotTd}${exp}<td class="c-qty full" data-l="จำนวนที่${verb}">${qtyInput()}</td>
        <td class="num" data-l="ราคาทุน/หน่วย"><input class="i sm" style="width:100px;text-align:right" type="number" inputmode="decimal" step="any" min="0" data-f="unit_cost" value="${l.unit_cost ?? ''}"></td>
        <td class="num c-info" data-l="รวม">${n2(Number(l.qty || 0) * Number(l.unit_cost || 0))}</td>
        <td data-l="ตำแหน่งเก็บ"><input class="i sm" style="width:90px" data-f="location" value="${esc(l.location)}"></td>${del}`;
    } else if (type === 'CNT') {
      const sys = lot ? Number(lot.qty) : 0; const diff = Number(l.qty || 0) - sys;
      cells = `${name}${lotTd}${exp}<td class="num c-info" data-l="ยอดในระบบ">${blind ? '' : n0(sys)}</td>
        <td class="num c-qty full" data-l="${verb}">${qtyInput()}</td>
        <td class="num c-info" data-l="ต่าง" style="font-weight:700;color:${diff < 0 ? '#9A3412' : diff > 0 ? '#0A4DA2' : '#14532D'}">${blind || !l.counted ? '' : (diff > 0 ? '+' : '') + n0(diff)}</td>${del}`;
    } else {
      const fefo = /FEFO/.test(lineWarn(l)); const needNote = type !== 'OUT' || l.override_reason || l.showNote || fefo;
      const extra = type === 'OUT'
        ? (needNote ? `<input class="i sm" data-f="override_reason" placeholder="${fefo ? 'ทำไมไม่จ่าย Lot ที่หมดอายุก่อน' : 'เช่น ส่งด่วน, ลูกค้าขอ Lot นี้'}" value="${esc(l.override_reason)}">` : '<button type="button" class="b3" data-shownote>+ เพิ่มหมายเหตุ</button>')
        : `<select class="i sm" data-f="reason">${['', 'ชำรุด / บรรจุภัณฑ์เสียหาย', 'หมดอายุ', 'สูญหาย', 'นับผิดครั้งก่อน', 'พบของเกิน', 'ผลจากการตรวจนับ', 'อื่น ๆ'].map((r) => opt(r, r || '— เลือกเหตุผล —', l.reason)).join('')}</select>`;
      const noteLbl = type === 'OUT' ? (needNote ? (fefo ? 'เหตุผลข้าม FEFO *' : 'หมายเหตุ') : '') : 'เหตุผล';
      cells = `${name}${lotTd}${exp}${avail}<td class="num c-qty full" data-l="จำนวนที่${verb}">${qtyInput('qty', type === 'ADJ')}</td>${type === 'TRF' ? '' : `<td class="c-note full" ${noteLbl ? `data-l="${noteLbl}"` : ''}>${extra}</td>`}${del}`;
    }
    return `<tr class="linecard" data-k="${l.key}">${cells}</tr>`;
  }

  function renderLines() {
    $('[data-thead]', main).innerHTML = thead();
    body.innerHTML = lines.length ? lines.map(rowHtml).join('') : `<tr><td colspan="9" class="empty full">ยังไม่มีรายการ — สแกนบาร์โค้ดหรือกด "+ เลือกสินค้า"</td></tr>`;
    const totQty = lines.reduce((s, l) => s + Number(l.qty || 0), 0);
    const totVal = lines.reduce((s, l) => s + Number(l.qty || 0) * Number(type === 'IN' ? (l.unit_cost || 0) : (l.product.cost || 0)), 0);
    $('[data-foot]', main).innerHTML = lines.length ? `<tr><td colspan="9"><div class="row between"><span>${lines.length} รายการ · ${n0(totQty)} หน่วย</span>${can.seeCost() ? `<span>มูลค่า ฿${n2(totVal)}</span>` : ''}</div></td></tr>` : '';
    $$('[data-post]', main).forEach((b) => (b.textContent = type === 'CNT' ? 'ปิดรอบ & ส่งผลนับ' : `ยืนยัน${TITLE[type].split(' ')[0]} (${lines.length})`));
  }

  // แก้ไขในตาราง
  body.addEventListener('change', async (e) => {
    const tr = e.target.closest('tr[data-k]'); if (!tr) return;
    const l = lines.find((x) => x.key === Number(tr.dataset.k)); const f = e.target.dataset.f; if (!l || !f) return;
    if (f === 'lot_id') {
      if (e.target.value === '__new') { l.newLot = true; l.lot_id = null; l.lot_no = ''; l.expiry_date = ''; }
      else { const lot = lotsOf(l.product.id).find((x) => x.lot_id === e.target.value); l.lot_id = lot?.lot_id || null; l.lot_no = lot?.lot_no || ''; l.expiry_date = lot?.expiry_date || ''; }
    } else if (['qty', 'unit_cost'].includes(f)) { l[f] = e.target.value === '' ? '' : Number(e.target.value); if (f === 'qty') l.counted = true; }
    else l[f] = e.target.value;
    if (f === 'lot_no' && type !== 'IN' && l.newLot) l.lot_no = e.target.value.trim();
    renderLines();
  });
  body.addEventListener('click', (e) => {
    const tr0 = e.target.closest('tr[data-k]'); const l0 = tr0 && lines.find((x) => x.key === Number(tr0.dataset.k));
    const st = e.target.closest('[data-step]');
    if (st && l0) { const v = Number(l0.qty || 0) + Number(st.dataset.step); l0.qty = type === 'ADJ' ? v : Math.max(0, v); l0.counted = true; renderLines(); return; }
    if (e.target.closest('[data-shownote]') && l0) { l0.showNote = true; renderLines(); $(`tr[data-k="${l0.key}"] [data-f="override_reason"]`, main)?.focus(); return; }
    if (!e.target.closest('[data-del]')) return;
    const k = Number(e.target.closest('tr').dataset.k);
    lines = lines.filter((l) => l.key !== k); renderLines();
  });

  // ---------- เพิ่มรายการ ----------
  async function addProduct(product, { lot = null, expiry = null, serial = null, qty = 1 } = {}) {
    if (!product.active) { toast('สินค้านี้ถูกปิดใช้งาน', 'err'); return; }
    const lotNo = serial || lot || '';
    if (type === 'IN') {
      const same = lotNo && product.tracking !== 'serial' && lines.find((l) => l.product.id === product.id && l.lot_no === lotNo);
      if (same) { same.qty = Number(same.qty || 0) + qty; if (expiry && !same.expiry_date) same.expiry_date = expiry; }
      else {
        if (product.tracking === 'serial' && lotNo && lines.some((l) => l.product.id === product.id && l.lot_no === lotNo)) { beep(false); toast('Serial นี้สแกนไปแล้ว', 'err'); return; }
        lines.push({ key: ++seq, product, lot_no: product.tracking === 'none' ? '-' : lotNo, expiry_date: expiry || '', qty, unit_cost: product.cost, location: curLoc || product.default_location || '', reason: '', override_reason: '' });
      }
    } else {
      const lots = await ensureLots(product.id);
      let target;
      if (lotNo) {
        target = lots.find((x) => x.lot_no === lotNo);
        if (!target && !['ADJ', 'CNT'].includes(type)) { beep(false); toast(`ไม่พบ ${product.code} Lot ${lotNo} ในคลังนี้`, 'err'); return; }
      } else if (type !== 'CNT' || lots.length) {
        // FEFO: Lot ที่หมดอายุก่อนและยังเหลือ (ไม่นับ Lot หมดอายุสำหรับจ่ายออก)
        target = lots.find((x) => Number(x.qty) - usedQty(x.lot_id) >= qty && (type !== 'OUT' || x.expiry_date === null || daysLeft(x.expiry_date) >= 0)) || lots[0];
      }
      if (!target && !lots.length && type !== 'ADJ' && type !== 'CNT') { beep(false); toast(`${product.code} ไม่มีของในคลังนี้`, 'err'); return; }
      const same = target && product.tracking !== 'serial' && lines.find((l) => l.lot_id === target.lot_id);
      if (same) { same.qty = Number(same.qty || 0) + qty; same.counted = true; }
      else if (target) lines.push({ key: ++seq, product, lot_id: target.lot_id, lot_no: target.lot_no, expiry_date: target.expiry_date || '', qty: type === 'ADJ' ? -qty : qty, unit_cost: product.cost, location: curLoc || target.location || '', reason: '', override_reason: '', counted: true });
      else lines.push({ key: ++seq, product, lot_id: null, newLot: true, lot_no: lotNo, expiry_date: expiry || '', qty, unit_cost: product.cost, location: curLoc, reason: type === 'ADJ' ? 'พบของเกิน' : '', override_reason: '', counted: true });
    }
    beep(true);
    $('[data-msg]', main).textContent = `ล่าสุด: ${product.code}${lotNo ? ' · ' + lotNo : ''}`;
    renderLines();
  }

  async function onScan(p) {
    if (p.kind === 'empty') return;
    if (p.kind === 'location') { curLoc = p.location; $('[data-loc]', main).textContent = 'ตำแหน่งปัจจุบัน: ' + curLoc; beep(true); return; }
    const product = await lookupProduct(p);
    if (!product) { beep(false); return unknownBarcode(p); }
    await addProduct(product, { lot: p.lot, expiry: p.expiry, serial: p.serial, qty: p.count || 1 });
  }

  async function unknownBarcode(p) {
    const code = p.gtin || p.code;
    if (!can.manage()) { toast(`ไม่พบสินค้าจากบาร์โค้ด ${code} — แจ้งหัวหน้าคลังให้ผูกบาร์โค้ด`, 'err'); return; }
    const products = await q(sb.from('products').select('id, code, name').eq('active', true).order('code'));
    modal({
      title: 'ไม่พบสินค้าจากบาร์โค้ดนี้',
      body: `<p>บาร์โค้ด <b class="mono">${esc(code)}</b> ยังไม่ผูกกับสินค้า เลือกสินค้าเพื่อผูกถาวร</p>
        <label class="f">สินค้า<select class="i" data-p>${products.map((x) => opt(x.id, `${x.code} — ${x.name}`)).join('')}</select></label>
        <label class="chk"><input type="checkbox" data-asgtin checked> ตั้งเป็น GTIN หลักของสินค้า (ถ้ายังไม่มี)</label>`,
      actions: [{ label: 'ยกเลิก' }, { label: 'ผูกบาร์โค้ด & เพิ่มรายการ', cls: 'b1', onClick: async (bg) => {
        const pid = $('[data-p]', bg).value; const asG = $('[data-asgtin]', bg).checked;
        const prod = await q(sb.from('products').select('*').eq('id', pid).single());
        if (asG && !prod.gtin && p.gtin) await q(sb.from('products').update({ gtin: p.gtin }).eq('id', pid));
        else await q(sb.from('product_barcodes').insert({ product_id: pid, barcode: code }));
        toast('ผูกบาร์โค้ดแล้ว', 'ok');
        await addProduct({ ...prod, gtin: prod.gtin || (asG ? p.gtin : null) }, { lot: p.lot, expiry: p.expiry, serial: p.serial });
      } }],
    });
  }

  bindScanInput(scanInput, onScan);
  $('[data-cam]', main).onclick = () => openCamera(onScan, { continuous: true, title: 'สแกนต่อเนื่อง — กดปิดเมื่อเสร็จ' });
  $('[data-pick]', main).onclick = () => pickProduct(async (p) => addProduct(p));
  if (fine) setTimeout(() => scanInput.focus(), 50);
  else $('[data-headwrap]', main).open = false;

  if (type === 'CNT') {
    $('[data-blind]', main).onchange = (e) => { blind = e.target.checked; renderLines(); };
    $('[data-loadall]', main).onclick = async () => {
      const rows = await q(sb.from('v_lot_stock').select('lot_id, lot_no, expiry_date, qty, product_id, location').eq('warehouse_id', doc.warehouse_id).gt('qty', 0));
      if (!rows.length) return toast('คลังนี้ไม่มีสินค้า', 'err');
      const prods = await q(sb.from('products').select('*').in('id', [...new Set(rows.map((r) => r.product_id))]));
      for (const r of rows) {
        await ensureLots(r.product_id);
        if (lines.some((l) => l.lot_id === r.lot_id)) continue;
        lines.push({ key: ++seq, product: prods.find((p) => p.id === r.product_id), lot_id: r.lot_id, lot_no: r.lot_no, expiry_date: r.expiry_date || '', qty: '', location: r.location || '', counted: false, reason: '', override_reason: '' });
      }
      lines.sort((a, b) => a.product.code.localeCompare(b.product.code));
      renderLines(); toast(`ดึง ${rows.length} Lot — สแกนหรือกรอกจำนวนที่นับได้`, 'ok');
    };
  }

  // ---------- บันทึก ----------
  function validate(forPost) {
    if (!doc.warehouse_id) throw new Error('เลือกคลัง');
    if (type === 'TRF' && (!doc.to_warehouse_id || doc.to_warehouse_id === doc.warehouse_id)) throw new Error('เลือกคลังปลายทางให้ถูกต้อง');
    if (!forPost) return;
    if (!lines.length) throw new Error('ยังไม่มีรายการสินค้า');
    for (const l of lines) {
      if (type === 'CNT' && (l.qty === '' || l.qty === null)) continue;
      if (type === 'IN' && l.product.tracking !== 'none' && !l.lot_no) throw new Error(`${l.product.code}: ใส่ Lot/Serial`);
      if (type !== 'IN' && !l.lot_id && !(l.newLot && l.lot_no)) throw new Error(`${l.product.code}: เลือก Lot`);
      if (type === 'ADJ' && !l.reason) throw new Error(`${l.product.code}: ใส่เหตุผลการปรับยอด`);
      if (type !== 'ADJ' && type !== 'CNT' && !(Number(l.qty) > 0)) throw new Error(`${l.product.code}: จำนวนต้องมากกว่า 0`);
    }
  }

  async function save(forPost = false) {
    validate(forPost);
    const header = {
      doc_type: type, doc_date: doc.doc_date, warehouse_id: doc.warehouse_id, to_warehouse_id: type === 'TRF' ? doc.to_warehouse_id : null,
      partner_id: doc.partner_id || null, purpose: doc.purpose || null, ref_no: doc.ref_no || null, note: doc.note || null,
    };
    if (!doc.id) {
      const d = await q(sb.from('documents').insert({ ...header, status: 'draft', created_by: state.profile.id }).select('id, doc_no').single());
      doc.id = d.id; doc.doc_no = d.doc_no;
      history.replaceState(null, '', `#/${DOC[type].route}/${d.id}`);
    } else {
      await q(sb.from('documents').update(header).eq('id', doc.id));
    }
    await q(sb.from('document_lines').delete().eq('document_id', doc.id));
    const use = lines.filter((l) => !(type === 'CNT' && (l.qty === '' || l.qty === null)));
    if (use.length) {
      await q(sb.from('document_lines').insert(use.map((l, i) => ({
        document_id: doc.id, line_no: i + 1, product_id: l.product.id,
        lot_no: l.lot_no || null, lot_id: l.newLot ? null : (l.lot_id || null), expiry_date: l.expiry_date || null,
        qty: Number(l.qty || 0), unit_cost: type === 'IN' ? (l.unit_cost === '' ? null : l.unit_cost) : null,
        location: l.location || null, reason: l.reason || null, override_reason: l.override_reason || null,
      }))));
    }
    return use.length;
  }

  $('[data-save]', main).onclick = async (e) => {
    e.target.disabled = true;
    try { await save(false); toast(`บันทึกร่าง ${doc.doc_no} แล้ว`, 'ok'); } catch (err) { toast(errMsg(err), 'err'); }
    e.target.disabled = false;
  };
  $('[data-post]', main).onclick = async (e) => {
    const btn = e.target; btn.disabled = true;
    try {
      validate(true);
      if (type === 'CNT') {
        const skipped = lines.filter((l) => l.qty === '' || l.qty === null).length;
        if (skipped && !(await confirmBox('ยังนับไม่ครบ', `มี ${skipped} รายการที่ยังไม่ได้กรอกจำนวน — รายการเหล่านี้จะไม่ถูกปรับยอด ดำเนินการต่อ?`))) { btn.disabled = false; return; }
      }
      await save(true);
      const status = await q(sb.rpc('post_document', { p_id: doc.id }));
      window.dispatchEvent(new Event('mms:changed'));
      toast(status === 'pending' ? `${doc.doc_no} ส่งให้หัวหน้าคลังอนุมัติแล้ว` : `${doc.doc_no} ยืนยันแล้ว — ตัดสต็อกเรียบร้อย`, 'ok');
      go('#/doc/' + doc.id);
    } catch (err) { beep(false); toast(errMsg(err), 'err'); btn.disabled = false; }
  };

  $('[data-post]', main).closest('.row').classList.add('actbar');
  renderHead();
  renderLines();
}

// ---------- กล่องเลือกสินค้า ----------
export async function pickProduct(onPick) {
  const all = await q(sb.from('v_product_stock').select('*').eq('active', true).order('code'));
  const list = (term) => all.filter((p) => !term || (p.code + ' ' + p.name + ' ' + (p.gtin || '')).toLowerCase().includes(term.toLowerCase()))
    .map((p) => `<tr class="click" data-id="${p.id}"><td class="mono">${esc(p.code)}</td><td>${esc(p.name)}</td><td class="num">${n0(p.qty)}</td></tr>`).join('') || '<tr><td colspan="3" class="empty">ไม่พบ</td></tr>';
  const m = modal({
    title: 'เลือกสินค้า', wide: true,
    body: `<input class="i" data-s placeholder="ค้นหาชื่อ รหัส หรือ GTIN"><div class="tw" style="max-height:55vh;margin-top:10px"><table class="t"><thead><tr><th>รหัส</th><th>ชื่อสินค้า</th><th class="num">คงเหลือ</th></tr></thead><tbody data-l>${list('')}</tbody></table></div>`,
  });
  const tb = $('[data-l]', m.el);
  $('[data-s]', m.el).addEventListener('input', debounce((e) => { tb.innerHTML = list(e.target.value); }, 150));
  tb.addEventListener('click', async (e) => {
    const tr = e.target.closest('tr[data-id]'); if (!tr) return;
    m.close();
    const p = all.find((x) => x.id === tr.dataset.id);
    await onPick(p);
  });
}

export { parseScan };
