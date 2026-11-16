// ตั้งค่า: บริษัท / การแจ้งเตือน / คลัง / คู่ค้า / นำเข้า Excel / อุปกรณ์
import { sb, q, state, can, WH_KIND, esc, opt, n0, n2, dTH, today, isoDate, toast, errMsg, modal, confirmBox, $, $$, pageHead, go, loadRefs, xlsx, downloadXlsx, whOptions } from '../core.js';
import { parseScan, openCamera, lookupProduct } from '../scan.js';

const TABS = [['import', 'นำเข้า Excel'], ['company', 'ข้อมูลบริษัท'], ['alerts', 'การแจ้งเตือน'], ['warehouses', 'คลัง'], ['partners', 'ซัพพลายเออร์ / ลูกค้า'], ['devices', 'อุปกรณ์สแกน']];

export async function render(main, { args }) {
  if (!can.manage()) { main.innerHTML = '<div class="alert bad">เฉพาะหัวหน้าคลัง/ผู้ดูแลระบบ</div>'; return; }
  const tab = TABS.some((t) => t[0] === args[0]) ? args[0] : 'import';
  main.innerHTML = `${pageHead('ตั้งค่าระบบ', '')}<div class="tabs">${TABS.map(([k, l]) => `<a class="tab ${k === tab ? 'on' : ''}" href="#/settings/${k}" style="text-decoration:none">${l}</a>`).join('')}</div><div data-c></div>`;
  const c = $('[data-c]', main);
  await ({ import: importTab, company: companyTab, alerts: alertsTab, warehouses: whTab, partners: partnerTab, devices: deviceTab })[tab](c);
}

// ---------- นำเข้า Excel ----------
function toIso(v) {
  if (v == null || v === '') return null;
  if (v instanceof Date) { let y = v.getFullYear(); if (y > 2400) y -= 543; return `${y}-${String(v.getMonth() + 1).padStart(2, '0')}-${String(v.getDate()).padStart(2, '0')}`; }
  if (typeof v === 'number') { const d = new Date(Math.round((v - 25569) * 86400000)); return toIso(new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())); }
  const s = String(v).trim(); let m;
  if ((m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/))) { let y = +m[1]; if (y > 2400) y -= 543; return `${y}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`; }
  if ((m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/))) { let y = +m[3]; if (y < 100) y += 2000; if (y > 2400) y -= 543; return `${y}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`; }
  return null;
}
const numOr = (v) => (typeof v === 'number' ? v : (v !== '' && v != null && !isNaN(Number(String(v).replace(/,/g, ''))) ? Number(String(v).replace(/,/g, '')) : null));

function parseWorkbook(X, wb) {
  const issues = []; let docDate = null; let rows = [];
  const summary = wb.SheetNames.find((n) => n.trim() === 'สรุป');
  if (summary) {
    const a = X.utils.sheet_to_json(wb.Sheets[summary], { header: 1, raw: true, defval: '' });
    const hi = a.findIndex((r) => String(r[0]).trim() === 'ลำดับ' && /ชื่อ/.test(String(r[1])));
    const dRow = a.find((r) => String(r[0]).trim() === 'วันที่'); if (dRow) docDate = toIso(dRow[1]);
    if (/วี\.บิลด์/.test(JSON.stringify(wb.SheetNames.slice(1, 4).map((n) => X.utils.sheet_to_json(wb.Sheets[n], { header: 1 }).slice(0, 3))))) issues.push(['warn', 'หัวชีตทะเบียนคุมบางชีตใช้ชื่อ "วี.บิลด์ พลัส" — ระบบใช้ชื่อบริษัทจากการตั้งค่าแทน']);
    let empty = 0;
    const ws = wb.Sheets[summary]; const r0 = X.utils.decode_range(ws['!ref']).s.r;
    for (const [ri, r] of a.entries()) {
      if (ri < hi + 2) continue;
      const name = String(r[1] ?? '').trim(); const code = String(r[3] ?? '').trim();
      if (String(r[0]).trim() === 'รวม') break;
      if (!name || !code || /^\d+$/.test(name)) { empty++; continue; }
      const recv = numOr(r[4]); const price = numOr(r[5]);
      const kCell = ws[X.utils.encode_cell({ r: r0 + ri, c: 10 })];
      let remain = kCell?.t === 'e' ? null : numOr(r[10]);
      if (remain === null) { issues.push(['bad', `${code}: คงเหลือในไฟล์เป็น "${kCell?.w || r[10] || 'ว่าง'}" (สูตรเสีย) — ใช้ยอดรับ ${n0(recv)} แทน`]); remain = recv ?? 0; }
      rows.push({ code, name, cost: numOr(r[11]) || price || 0, qty: remain, lot_no: '', expiry_date: null });
    }
    if (empty) issues.push(['info', `ข้ามแถวว่าง/ไม่มีชื่อสินค้า ${empty} แถว`]);
    issues.push(['warn', 'ไฟล์รูปแบบเดิมไม่มี Lot / วันหมดอายุ — นำเข้าเป็น "ยอดยกมา" แล้วตรวจนับเพื่อแยก Lot ภายหลัง']);
    if (docDate && Number(docDate.slice(0, 4)) > 2400) docDate = toIso(docDate);
  } else {
    const ws = wb.Sheets[wb.SheetNames[0]];
    const a = X.utils.sheet_to_json(ws, { raw: true, defval: '' });
    const pick = (r, ...keys) => { for (const k of keys) { const f = Object.keys(r).find((h) => h.trim().toLowerCase() === k.toLowerCase()); if (f && r[f] !== '') return r[f]; } return ''; };
    rows = a.map((r) => ({
      code: String(pick(r, 'รหัส', 'code')).trim(), name: String(pick(r, 'ชื่อสินค้า', 'name')).trim(), grp: String(pick(r, 'กลุ่ม', 'group')).trim(),
      size: String(pick(r, 'ขนาด', 'size')).trim(), unit: String(pick(r, 'หน่วย', 'unit')).trim(), cost: numOr(pick(r, 'ราคาทุน', 'cost')) || 0,
      qty: numOr(pick(r, 'จำนวน', 'qty')) || 0, lot_no: String(pick(r, 'Lot', 'lot')).trim(), expiry_date: toIso(pick(r, 'วันหมดอายุ', 'expiry')),
      location: String(pick(r, 'ตำแหน่ง', 'location')).trim(), gtin: String(pick(r, 'GTIN', 'gtin')).replace(/\D/g, ''), tracking: String(pick(r, 'ติดตาม', 'tracking')).trim().toLowerCase() || 'lot',
    })).filter((r) => r.code);
    rows.forEach((r) => { if (r.qty > 0 && r.tracking !== 'none' && !r.lot_no) issues.push(['warn', `${r.code}: ไม่มีเลข Lot — จะนำเข้าเป็น "ยอดยกมา"`]); });
  }
  return { rows, issues, docDate, format: summary ? 'ไฟล์ทะเบียนคุมเดิม (ชีต "สรุป")' : 'ไฟล์แม่แบบ' };
}

async function importTab(c) {
  c.innerHTML = `<section class="card"><h2>นำเข้าสินค้าและยอดคงเหลือจาก Excel</h2>
    <p class="sub" style="margin:0">รองรับ 2 แบบ: (1) ไฟล์ทะเบียนคุมเดิมที่มีชีต "สรุป" (2) ไฟล์แม่แบบที่มีคอลัมน์ Lot / วันหมดอายุ — สินค้าที่มีรหัสอยู่แล้วจะอัปเดตข้อมูล ยอดจะถูกสร้างเป็นใบรับเข้า "ยอดยกมา"</p>
    <div class="row"><input type="file" accept=".xlsx,.xls,.csv" data-file class="i" style="max-width:420px"><button class="b2" data-tpl>ดาวน์โหลดไฟล์แม่แบบ</button></div>
    <div data-prev></div></section>`;
  $('[data-tpl]', c).onclick = () => downloadXlsx('แม่แบบนำเข้าสต็อก.xlsx', [{ name: 'นำเข้า', cols: [12, 44, 14, 10, 8, 10, 10, 14, 14, 10, 16, 10],
    rows: [['รหัส', 'ชื่อสินค้า', 'กลุ่ม', 'ขนาด', 'หน่วย', 'ราคาทุน', 'จำนวน', 'Lot', 'วันหมดอายุ', 'ตำแหน่ง', 'GTIN', 'ติดตาม'],
      ['0029037', 'Redon probe with radiopaque line, CH 12, 4.0 mm', 'Redon probe', 'CH 12', 'ชิ้น', 18, 1100, 'R2405', '2027-02-05', 'A-03', '', 'lot'],
      ['APPLIERML', 'Laparoscopic Applier Medium/Large Polymer LocaClip', 'Applier', 'ML', 'ชิ้น', 15000, 1, 'SN-0001', '', 'C-01', '', 'serial']] },
    { name: 'คำอธิบาย', rows: [['คอลัมน์', 'คำอธิบาย'], ['วันหมดอายุ', 'รูปแบบ ปปปป-ดด-วว (ค.ศ.) หรือ วว/ดด/ปปปป (รับทั้ง ค.ศ. และ พ.ศ.)'], ['ติดตาม', 'lot = Lot+วันหมดอายุ · serial = 1 แถวต่อ 1 ชิ้น · none = ไม่ติดตาม'], ['จำนวน', 'ยอดคงเหลือที่นับได้จริง ณ วันเริ่มระบบ'], ['หมายเหตุ', 'สินค้าเดียวกันหลาย Lot ให้แยกหลายแถว']], cols: [16, 80] }]);

  $('[data-file]', c).onchange = async (e) => {
    const file = e.target.files[0]; if (!file) return;
    const prev = $('[data-prev]', c); prev.innerHTML = '<div class="empty">กำลังอ่านไฟล์…</div>';
    try {
      const X = await xlsx();
      const wb = X.read(await file.arrayBuffer(), { cellDates: true });
      const { rows, issues, docDate, format } = parseWorkbook(X, wb);
      const withQty = rows.filter((r) => r.qty > 0);
      prev.innerHTML = `<div class="alert info">รูปแบบ: <b>${format}</b> · พบสินค้า <b>${rows.length}</b> รายการ · มียอดคงเหลือ ${withQty.length} รายการ · รวม ${n0(withQty.reduce((s, r) => s + r.qty, 0))} หน่วย · มูลค่า ฿${n2(withQty.reduce((s, r) => s + r.qty * r.cost, 0))}</div>
        ${issues.length ? `<h3>ผลตรวจข้อมูล</h3>${issues.map(([k, t]) => `<div class="alert ${k === 'bad' ? 'bad' : k === 'warn' ? 'warn' : 'info'}" style="padding:8px 12px">${esc(t)}</div>`).join('')}` : ''}
        <div class="tw" style="max-height:360px"><table class="t"><thead><tr><th>รหัส</th><th>ชื่อสินค้า</th><th>Lot</th><th>วันหมดอายุ</th><th class="num">จำนวน</th><th class="num">ราคาทุน</th></tr></thead><tbody>
        ${rows.map((r) => `<tr><td class="mono">${esc(r.code)}</td><td>${esc(r.name)}</td><td>${esc(r.lot_no || 'ยอดยกมา')}</td><td>${r.expiry_date ? dTH(r.expiry_date) : '—'}</td><td class="num">${n0(r.qty)}</td><td class="num">${n2(r.cost)}</td></tr>`).join('')}</tbody></table></div>
        <div class="grid g3"><label class="f">วันที่ยอดยกมา<input class="i" type="date" data-date value="${docDate || today()}"></label><label class="f">นำเข้าคลัง<select class="i" data-wh>${whOptions(null, (w) => w.kind !== 'quarantine')}</select></label>
        <button class="b1" data-go style="align-self:end">ยืนยันนำเข้า ${rows.length} รายการ</button></div>`;
      $('[data-go]', prev).onclick = async (ev) => {
        if (!(await confirmBox('ยืนยันนำเข้า', `สร้าง/อัปเดตสินค้า ${rows.length} รายการ และบันทึกยอดยกมา ${withQty.length} รายการ เข้าคลัง ${$('[data-wh] option:checked', prev).textContent}?`))) return;
        ev.target.disabled = true;
        try {
          const res = await q(sb.rpc('import_stock', { p_rows: rows, p_doc_date: $('[data-date]', prev).value, p_warehouse: $('[data-wh]', prev).value, p_note: 'นำเข้าจากไฟล์ ' + file.name }));
          toast(`นำเข้าแล้ว: สินค้า ${res.products} รายการ · ยอดยกมา ${res.lines} รายการ`, 'ok');
          window.dispatchEvent(new Event('mms:changed'));
          if (res.document_id) go('#/doc/' + res.document_id); else go('#/products');
        } catch (err) { toast(errMsg(err), 'err'); ev.target.disabled = false; }
      };
    } catch (err) { prev.innerHTML = `<div class="alert bad">อ่านไฟล์ไม่ได้: ${esc(errMsg(err))}</div>`; }
  };
}

// ---------- บริษัท ----------
async function companyTab(c) {
  const s = state.settings || {}; const ro = !can.admin();
  const f = (k, label, span = '') => `<label class="f ${span}">${label}<input class="i" data-k="${k}" value="${esc(s[k] ?? '')}" ${ro ? 'disabled' : ''}></label>`;
  c.innerHTML = `<section class="card"><h2>ข้อมูลบริษัท (แสดงบนเอกสาร รายงาน ทะเบียนคุม)</h2><div class="grid g2">
    ${f('name', 'ชื่อบริษัท', 'span2')}${f('name_en', 'ชื่อภาษาอังกฤษ')}${f('tax_id', 'เลขประจำตัวผู้เสียภาษี')}${f('license_no', 'เลขที่ใบอนุญาตขายเครื่องมือแพทย์')}${f('address', 'ที่อยู่ / สถานประกอบการ', 'span2')}</div>
    ${ro ? '<span class="sub">แก้ไขได้เฉพาะผู้ดูแลระบบ</span>' : '<div class="row end"><button class="b1" data-save>บันทึก</button></div>'}</section>`;
  $('[data-save]', c)?.addEventListener('click', async () => {
    const upd = { updated_at: new Date().toISOString() }; $$('[data-k]', c).forEach((el) => (upd[el.dataset.k] = el.value.trim() || null));
    if (!upd.name) return toast('กรอกชื่อบริษัท', 'err');
    try { await q(sb.from('company_settings').update(upd).eq('id', 1)); await loadRefs(); toast('บันทึกแล้ว', 'ok'); } catch (e) { toast(errMsg(e), 'err'); }
  });
}

// ---------- การแจ้งเตือน ----------
async function alertsTab(c) {
  const s = state.settings || {}; const ro = !can.admin();
  c.innerHTML = `<section class="card"><h2>กฎวันหมดอายุและการแจ้งเตือน</h2><div class="grid g2">
    <label class="f">รับเข้าอายุคงเหลือน้อยกว่า (วัน) ต้องให้หัวหน้าอนุมัติ<input class="i" type="number" min="0" data-k="min_shelf_days" value="${s.min_shelf_days ?? 180}" ${ro ? 'disabled' : ''}></label>
    <label class="f">แจ้งเตือนล่วงหน้า (วัน คั่นด้วย ,)<input class="i" data-k="alert_days" value="${(s.alert_days || []).join(',')}" ${ro ? 'disabled' : ''}></label>
    <label class="f">อีเมลรับสรุปทุกเช้า (คั่นด้วย ,)<input class="i" data-k="notify_emails" value="${esc((s.notify_emails || []).join(', '))}" ${ro ? 'disabled' : ''}></label>
    <label class="f">LINE: userId หรือ groupId ที่รับแจ้งเตือน<input class="i" data-k="line_to" value="${esc(s.line_to || '')}" ${ro ? 'disabled' : ''}></label></div>
    <div class="alert info">การส่งอีเมล/LINE อัตโนมัติทำโดย Edge Function <b>expiry-alert</b> ที่ตั้งเวลาไว้ทุกเช้า 08:00 — ดูวิธีเปิดใช้ใน README หัวข้อ "แจ้งเตือนวันหมดอายุอัตโนมัติ"</div>
    <div class="alert info">กฎที่ระบบบังคับเสมอ: กักกัน Lot หมดอายุ (ห้ามจ่าย) · จ่ายตาม FEFO (ข้ามได้เมื่อมีเหตุผล + อนุมัติ) · รับของอายุสั้นต้องอนุมัติ · เตือนเมื่อส่งของอายุน้อยกว่าที่ลูกค้ากำหนด</div>
    ${ro ? '' : '<div class="row end"><button class="b2" data-test>ทดสอบส่งแจ้งเตือนตอนนี้</button><button class="b1" data-save>บันทึก</button></div>'}</section>`;
  $('[data-save]', c)?.addEventListener('click', async () => {
    const v = (k) => $(`[data-k=${k}]`, c).value;
    const upd = { min_shelf_days: Number(v('min_shelf_days')) || 0, alert_days: v('alert_days').split(',').map((x) => Number(x.trim())).filter((x) => x > 0),
      notify_emails: v('notify_emails').split(',').map((x) => x.trim()).filter(Boolean), line_to: v('line_to').trim() || null, updated_at: new Date().toISOString() };
    try { await q(sb.from('company_settings').update(upd).eq('id', 1)); await loadRefs(); toast('บันทึกแล้ว', 'ok'); } catch (e) { toast(errMsg(e), 'err'); }
  });
  $('[data-test]', c)?.addEventListener('click', async () => {
    const { data, error } = await sb.functions.invoke('expiry-alert', { body: { test: true } });
    toast(error || data?.error ? 'ส่งไม่สำเร็จ: ' + (data?.error || errMsg(error)) : `ส่งแล้ว: ${data?.sent?.join(', ') || 'ไม่มีช่องทางที่ตั้งค่า'}`, error || data?.error ? 'err' : 'ok');
  });
}

// ---------- คลัง ----------
async function whTab(c) {
  const draw = () => {
    c.innerHTML = `<section class="card"><div class="row between"><h2>คลังและพื้นที่จัดเก็บ</h2><button class="b1" data-add>+ เพิ่มคลัง</button></div>
      <div class="tw"><table class="t"><thead><tr><th>รหัส</th><th>ชื่อ</th><th>ประเภท</th><th>หมายเหตุ</th><th>สถานะ</th><th></th></tr></thead><tbody>
      ${state.warehouses.map((w) => `<tr><td class="mono">${esc(w.code)}</td><td><b>${esc(w.name)}</b></td><td>${WH_KIND[w.kind]}</td><td>${esc(w.note || '')}</td><td>${w.active ? '<span class="bd g">ใช้งาน</span>' : '<span class="bd n">ปิด</span>'}</td><td><button class="b3" data-edit="${w.id}">แก้ไข</button></td></tr>`).join('')}
      </tbody></table></div><span class="sub">ฝากขาย = ของยังเป็นของบริษัทแต่อยู่ที่โรงพยาบาล · กักกัน = ห้ามจ่ายขาย ใช้เก็บของหมดอายุ/ชำรุด · ตำแหน่งชั้นวางกำหนดตอนรับเข้า หรือสแกนป้ายตำแหน่ง</span></section>`;
    $('[data-add]', c).onclick = () => edit({ code: '', name: '', kind: 'main', note: '', active: true });
    $$('[data-edit]', c).forEach((b) => (b.onclick = () => edit(state.warehouses.find((w) => w.id === b.dataset.edit))));
  };
  const edit = (w) => modal({
    title: w.id ? 'แก้ไขคลัง' : 'เพิ่มคลัง',
    body: `<div class="grid g2"><label class="f">รหัส<input class="i" data-c value="${esc(w.code)}"></label><label class="f">ประเภท<select class="i" data-k>${Object.entries(WH_KIND).map(([k, v]) => opt(k, v, w.kind)).join('')}</select></label>
      <label class="f span2">ชื่อ<input class="i" data-n value="${esc(w.name)}"></label><label class="f span2">หมายเหตุ<input class="i" data-o value="${esc(w.note || '')}"></label>
      <label class="chk"><input type="checkbox" data-a ${w.active ? 'checked' : ''}> ใช้งาน</label></div>`,
    actions: [{ label: 'ยกเลิก' }, { label: 'บันทึก', cls: 'b1', onClick: async (bg) => {
      const rec = { code: $('[data-c]', bg).value.trim().toUpperCase(), name: $('[data-n]', bg).value.trim(), kind: $('[data-k]', bg).value, note: $('[data-o]', bg).value.trim() || null, active: $('[data-a]', bg).checked };
      if (!rec.code || !rec.name) { toast('กรอกรหัสและชื่อ', 'err'); return true; }
      try { w.id ? await q(sb.from('warehouses').update(rec).eq('id', w.id)) : await q(sb.from('warehouses').insert(rec)); await loadRefs(); draw(); toast('บันทึกแล้ว', 'ok'); } catch (e) { toast(errMsg(e), 'err'); return true; }
    } }],
  });
  draw();
}

// ---------- คู่ค้า ----------
async function partnerTab(c) {
  const KIND = { supplier: 'ซัพพลายเออร์', customer: 'ลูกค้า / โรงพยาบาล', both: 'ทั้งสองแบบ' };
  const draw = () => {
    c.innerHTML = `<section class="card"><div class="row between"><h2>ซัพพลายเออร์และลูกค้า</h2><button class="b1" data-add>+ เพิ่ม</button></div>
      <div class="tw"><table class="t"><thead><tr><th>ชื่อ</th><th>ประเภท</th><th>รับอายุขั้นต่ำ</th><th>ผู้ติดต่อ</th><th>โทร</th><th>สถานะ</th><th></th></tr></thead><tbody>
      ${state.partners.map((p) => `<tr><td><b>${esc(p.name)}</b></td><td><span class="bd ${p.kind === 'customer' ? 'g' : 'bl'}">${KIND[p.kind]}</span></td><td>${p.min_shelf_days ? p.min_shelf_days + ' วัน' : '—'}</td><td>${esc(p.contact || '')}</td><td>${esc(p.phone || '')}</td><td>${p.active ? '<span class="bd g">ใช้งาน</span>' : '<span class="bd n">ปิด</span>'}</td><td><button class="b3" data-edit="${p.id}">แก้ไข</button></td></tr>`).join('') || '<tr><td colspan="7" class="empty">ยังไม่มีคู่ค้า</td></tr>'}
      </tbody></table></div><span class="sub">"รับอายุขั้นต่ำ" ของโรงพยาบาล ใช้เตือนตอนจ่ายของที่อายุเหลือน้อยกว่าที่ลูกค้ากำหนด</span></section>`;
    $('[data-add]', c).onclick = () => edit({ kind: 'customer', name: '', active: true });
    $$('[data-edit]', c).forEach((b) => (b.onclick = () => edit(state.partners.find((p) => p.id === b.dataset.edit))));
  };
  const edit = (p) => modal({
    title: p.id ? 'แก้ไขคู่ค้า' : 'เพิ่มคู่ค้า',
    body: `<div class="grid g2"><label class="f span2">ชื่อ<input class="i" data-f="name" value="${esc(p.name || '')}"></label>
      <label class="f">ประเภท<select class="i" data-f="kind">${Object.entries(KIND).map(([k, v]) => opt(k, v, p.kind)).join('')}</select></label>
      <label class="f">รับอายุขั้นต่ำ (วัน)<input class="i" type="number" min="0" data-f="min_shelf_days" value="${p.min_shelf_days ?? ''}"></label>
      <label class="f">ผู้ติดต่อ<input class="i" data-f="contact" value="${esc(p.contact || '')}"></label><label class="f">โทร<input class="i" data-f="phone" value="${esc(p.phone || '')}"></label>
      <label class="f">อีเมล<input class="i" data-f="email" value="${esc(p.email || '')}"></label><label class="f">เลขผู้เสียภาษี<input class="i" data-f="tax_id" value="${esc(p.tax_id || '')}"></label>
      <label class="f span2">ที่อยู่<input class="i" data-f="address" value="${esc(p.address || '')}"></label>
      <label class="chk"><input type="checkbox" data-a ${p.active !== false ? 'checked' : ''}> ใช้งาน</label></div>`,
    actions: [{ label: 'ยกเลิก' }, { label: 'บันทึก', cls: 'b1', onClick: async (bg) => {
      const rec = { active: $('[data-a]', bg).checked }; $$('[data-f]', bg).forEach((el) => (rec[el.dataset.f] = el.value.trim() || null));
      rec.min_shelf_days = rec.min_shelf_days ? Number(rec.min_shelf_days) : null;
      if (!rec.name) { toast('กรอกชื่อ', 'err'); return true; }
      try { p.id ? await q(sb.from('partners').update(rec).eq('id', p.id)) : await q(sb.from('partners').insert(rec)); await loadRefs(); draw(); toast('บันทึกแล้ว', 'ok'); } catch (e) { toast(errMsg(e), 'err'); return true; }
    } }],
  });
  draw();
}

// ---------- อุปกรณ์ ----------
async function deviceTab(c) {
  c.innerHTML = `<section class="card"><h2>ทดสอบเครื่องสแกน</h2>
    <label class="f">คลิกช่องนี้แล้วยิงบาร์โค้ด<input class="i" data-t placeholder="ผลจะแสดงด้านล่าง" autocomplete="off"></label>
    <div class="row"><button class="b2" data-cam>ทดสอบกล้องมือถือ</button></div><div data-r></div></section>
    <section class="card"><h2>การตั้งค่าอุปกรณ์</h2><div class="tw"><table class="t"><thead><tr><th>อุปกรณ์</th><th>การเชื่อมต่อ</th><th>ตั้งค่าที่ต้องทำ</th></tr></thead><tbody>
      <tr><td><b>เครื่องยิงบาร์โค้ด USB / ไร้สาย</b></td><td>เป็นคีย์บอร์ด (HID)</td><td>ตั้งให้ส่ง Enter ท้ายรหัส · เปิดการอ่าน GS1-128 / ส่ง FNC1 เป็นอักขระ GS (ASCII 29) · ภาษาคีย์บอร์ดต้องเป็นอังกฤษ</td></tr>
      <tr><td><b>PDA Android (Zebra, Honeywell, Urovo ฯลฯ)</b></td><td>Chrome + ปุ่มยิงในตัว</td><td>เปิดโหมด Keyboard Wedge ให้ส่ง Enter · เปิดเว็บนี้ใน Chrome แล้ว "เพิ่มลงในหน้าจอหลัก"</td></tr>
      <tr><td><b>มือถือ (กล้อง)</b></td><td>กล้องผ่านเว็บ (ต้องเป็น https)</td><td>กด "กล้อง" ครั้งแรกแล้วอนุญาตให้เว็บใช้กล้อง</td></tr>
      <tr><td><b>เครื่องพิมพ์ฉลาก</b></td><td>ไดรเวอร์ของเครื่อง (USB/LAN)</td><td>ตั้งขนาดกระดาษในไดรเวอร์ให้ตรงกับฉลาก แล้วพิมพ์จากเมนู "พิมพ์ฉลากบาร์โค้ด"</td></tr>
    </tbody></table></div></section>`;
  const show = async (p) => {
    const prod = p.kind !== 'location' ? await lookupProduct(p).catch(() => null) : null;
    $('[data-r]', c).innerHTML = `<div class="alert ${prod || p.kind === 'location' ? 'ok' : 'warn'}"><div class="mono">ดิบ: ${esc(JSON.stringify(p.raw))}</div>
      <div>ชนิด: <b>${p.kind}</b>${p.gtin ? ' · GTIN ' + esc(p.gtin) : ''}${p.lot ? ' · Lot ' + esc(p.lot) : ''}${p.serial ? ' · Serial ' + esc(p.serial) : ''}${p.expiry ? ' · หมดอายุ ' + dTH(p.expiry) : ''}${p.location ? ' · ตำแหน่ง ' + esc(p.location) : ''}</div>
      <div>${prod ? `พบสินค้า: <b>${esc(prod.code)} — ${esc(prod.name)}</b>` : p.kind === 'location' ? 'ป้ายตำแหน่งชั้นวาง' : 'ยังไม่พบสินค้าที่ผูกกับบาร์โค้ดนี้'}</div></div>`;
  };
  $('[data-t]', c).addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); show(parseScan(e.target.value)); e.target.value = ''; } });
  $('[data-cam]', c).onclick = () => openCamera(show);
}

export { toIso, parseWorkbook, isoDate };
