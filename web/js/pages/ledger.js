// การ์ดสินค้า: คงเหลือแยก Lot/คลัง + ทะเบียนคุม
import { sb, q, state, can, TRACK, esc, n0, n2, dTH, expiryBadge, toast, errMsg, modal, $, pageHead, go, downloadXlsx, today, fetchAll } from '../core.js';
import { describe, ledgerRows, stockCardSheet } from '../stockcard.js';

export async function render(main, { args }) {
  const p = await q(sb.from('v_product_stock').select('*').eq('id', args[0]).maybeSingle());
  if (!p) { main.innerHTML = '<div class="alert bad">ไม่พบสินค้า</div>'; return; }
  const [lots, movs] = await Promise.all([
    q(sb.from('v_lot_stock').select('*').eq('product_id', p.id)),
    fetchAll(() => sb.from('v_movements').select('*').eq('product_id', p.id).order('doc_date').order('id')),
  ]);
  lots.sort((a, b) => (a.expiry_date || '9999').localeCompare(b.expiry_date || '9999'));
  const showCost = can.seeCost();
  const rows = ledgerRows(movs, p.cost);
  const word = p.tracking === 'serial' ? 'Serial' : 'Lot';

  main.innerHTML = `${pageHead(esc(p.name), `<span class="mono">${esc(p.code)}</span>${p.size ? ' · ' + esc(p.size) : ''}${p.grp ? ' · ' + esc(p.grp) : ''} · ${TRACK[p.tracking]}${p.active ? '' : ' · <span class="bd n">ปิดใช้งาน</span>'}`,
    `${can.operate() ? `<a class="b2" href="#/labels?p=${p.id}">พิมพ์ฉลาก</a>` : ''}${can.manage() ? `<a class="b2" href="#/product/${p.id}">แก้ไขสินค้า</a>` : ''}<button class="b1" data-xls>ส่งออกทะเบียนคุม</button>`,
    '<a href="#/products">สินค้าทั้งหมด</a> › การ์ดสินค้า')}
    ${p.note ? `<div class="alert warn">${esc(p.note)}</div>` : ''}
    <section class="grid g4">
      <div class="card kpi"><span class="sub">คงเหลือ</span><span class="v">${n0(p.qty)} <span style="font-size:15px;font-weight:500">${esc(p.unit)}</span></span><span class="sub">${p.lot_count || 0} ${word}</span></div>
      ${showCost ? `<div class="card kpi"><span class="sub">ราคาทุน / หน่วย</span><span class="v">฿${n2(p.cost)}</span></div><div class="card kpi"><span class="sub">มูลค่าคงเหลือ</span><span class="v">฿${n2(p.value)}</span></div>` : ''}
      <div class="card kpi"><span class="sub">หมดอายุเร็วสุด</span><span class="v" style="font-size:20px">${p.next_expiry ? dTH(p.next_expiry) : '—'}</span>${p.next_expiry ? expiryBadge(p.next_expiry) : ''}</div>
    </section>
    <div class="grid split">
      <section class="card"><h2>คงเหลือแยกตาม ${word} และคลัง</h2>
        <div class="tw"><table class="t"><thead><tr><th>${word}</th><th>วันหมดอายุ</th><th>เหลือ</th><th>คลัง</th><th>ตำแหน่ง</th><th class="num">คงเหลือ</th>${can.manage() ? '<th></th>' : ''}</tr></thead><tbody>
        ${lots.map((l) => `<tr><td><b>${esc(l.lot_no)}</b></td><td>${l.expiry_date ? dTH(l.expiry_date) : '<span class="sub">ไม่ระบุ</span>'}</td><td>${expiryBadge(l.expiry_date)}</td><td>${esc(l.warehouse_name)}</td><td>${esc(l.location || '')}</td><td class="num"><b>${n0(l.qty)}</b></td>${can.manage() ? `<td><button class="b3" data-lot="${l.lot_id}">แก้วันหมดอายุ</button></td>` : ''}</tr>`).join('') || '<tr><td colspan="7" class="empty">ไม่มีสินค้าคงเหลือ</td></tr>'}
        </tbody></table></div>
        ${lots.some((l) => l.lot_no === 'ยอดยกมา') ? `<span class="sub">"ยอดยกมา" = ยอดจากไฟล์ Excel ที่ยังไม่แยก ${word} — ตรวจนับแล้วปรับยอดเข้า ${word} จริง</span>` : ''}
      </section>
      <section class="card"><h2>ข้อมูลสินค้า</h2><div class="grid g2">
        <div><div class="sub">GTIN</div>${esc(p.gtin || '—')}</div><div><div class="sub">หน่วยนับ</div>${esc(p.unit)}</div>
        <div><div class="sub">ทะเบียน อย.</div>${esc(p.fda_no || '—')}${p.fda_expiry ? `<div class="sub">หมดอายุ ${dTH(p.fda_expiry)}</div>` : ''}</div><div><div class="sub">จุดสั่งซื้อ</div>${n0(p.min_qty)}</div>
        <div><div class="sub">ผู้ผลิต</div>${esc(p.manufacturer || '—')}</div><div><div class="sub">ตำแหน่งเริ่มต้น</div>${esc(p.default_location || '—')}</div>
      </div></section>
    </div>
    <section class="card"><div class="row between"><h2>ทะเบียนคุมเครื่องมือเครื่องใช้</h2><span class="sub">ผู้ประกอบการ: ${esc(state.settings?.name || '')}</span></div>
      <div class="tw"><table class="t"><thead>
        <tr><th rowspan="2">ว.ด.ป.</th><th rowspan="2">เลขที่เอกสาร</th><th rowspan="2">รายการ</th><th rowspan="2">${word}</th><th colspan="${showCost ? 3 : 1}" style="text-align:center;background:#EEF7F1">รับ</th><th colspan="${showCost ? 3 : 1}" style="text-align:center;background:#EEF3FB">จ่าย</th><th colspan="${showCost ? 3 : 1}" style="text-align:center;background:#F4F5F8">คงเหลือ</th></tr>
        <tr>${(showCost ? ['หน่วย', 'ราคา', 'เงิน'] : ['หน่วย']).map((h) => `<th class="num">${h}</th>`).join('').repeat(3)}</tr></thead><tbody>
        ${rows.map((r) => `<tr class="click" data-d="${r.document_id}"><td>${dTH(r.doc_date)}</td><td class="mono">${esc(r.doc_no)}</td><td>${esc(describe(r))}</td><td>${esc(r.lot_no)}</td>
          <td class="num">${r.inQ ? n0(r.inQ) : ''}</td>${showCost ? `<td class="num">${r.inQ ? n2(r.price) : ''}</td><td class="num">${r.inQ ? n2(r.inQ * r.price) : ''}</td>` : ''}
          <td class="num">${r.outQ ? n0(r.outQ) : ''}</td>${showCost ? `<td class="num">${r.outQ ? n2(r.price) : ''}</td><td class="num">${r.outQ ? n2(r.outQ * r.price) : ''}</td>` : ''}
          <td class="num"><b>${n0(r.bal)}</b></td>${showCost ? `<td class="num">${n2(r.balPrice)}</td><td class="num">${n2(r.bal * r.balPrice)}</td>` : ''}</tr>`).join('') || '<tr><td colspan="13" class="empty">ยังไม่มีความเคลื่อนไหว</td></tr>'}
      </tbody></table></div></section>`;

  main.addEventListener('click', (e) => { const tr = e.target.closest('tr[data-d]'); if (tr) go('#/doc/' + tr.dataset.d); });
  $('[data-xls]', main).onclick = () => downloadXlsx(`ทะเบียนคุม_${p.code}_${today()}.xlsx`, [stockCardSheet(p, movs, state.settings)]);
  main.querySelectorAll('[data-lot]').forEach((b) => b.addEventListener('click', () => {
    const l = lots.find((x) => x.lot_id === b.dataset.lot);
    modal({ title: `วันหมดอายุ ${word} ${l.lot_no}`, body: `<label class="f">วันหมดอายุ<input class="i" type="date" data-e value="${l.expiry_date || ''}"></label><p class="sub">ใช้แก้ไขเมื่อกรอกผิด — มีผลกับทุกคลังที่มี ${word} นี้</p>`,
      actions: [{ label: 'ยกเลิก' }, { label: 'บันทึก', cls: 'b1', onClick: async (bg) => {
        try { await q(sb.from('lots').update({ expiry_date: $('[data-e]', bg).value || null }).eq('id', l.lot_id)); toast('บันทึกแล้ว', 'ok'); go('#/ledger/' + p.id); } catch (e) { toast(errMsg(e), 'err'); return true; }
      } }] });
  }));
}
