// ดูเอกสาร / อนุมัติ / ยกเลิก / พิมพ์
import { sb, q, state, can, DOC, PURPOSE, esc, n0, n2, dTH, dtTH, statusBadge, typeBadge, expiryBadge, toast, errMsg, promptBox, confirmBox, $, whName, pageHead, go } from '../core.js';

export async function render(main, { args }) {
  const id = args[0];
  const d = await q(sb.from('documents').select('*, partner:partners(name), creator:profiles!documents_created_by_fkey(full_name,email), poster:profiles!documents_posted_by_fkey(full_name), approver:profiles!documents_approved_by_fkey(full_name), canceller:profiles!documents_cancelled_by_fkey(full_name)').eq('id', id).maybeSingle());
  if (!d) { main.innerHTML = '<div class="alert bad">ไม่พบเอกสาร</div>'; return; }
  const lines = await q(sb.from('document_lines').select('*, product:products(code,name,unit,cost,size), lot:lots(lot_no,expiry_date)').eq('document_id', id).order('line_no'));
  const t = d.doc_type;
  const showCost = can.seeCost();
  const s = state.settings || {};

  const actions = [];
  if (d.status === 'draft' && can.operate()) actions.push(`<a class="b2" href="#/${DOC[t].route}/${d.id}">แก้ไขร่าง</a>`);
  if (d.status === 'pending' && can.manage()) actions.push('<button class="b1" data-approve>อนุมัติ & ตัดสต็อก</button><button class="bd-btn" data-reject>ไม่อนุมัติ</button>');
  if (d.status === 'draft' && can.operate()) actions.push('<button class="b1" data-post>ยืนยัน</button>');
  actions.push('<button class="b2" data-print>พิมพ์</button>');
  if (['posted', 'draft', 'pending'].includes(d.status) && (can.manage() || (d.status !== 'posted' && d.created_by === state.profile.id))) actions.push('<button class="bd-btn" data-cancel>ยกเลิกเอกสาร</button>');

  const qtyLabel = { IN: 'รับ', OUT: 'จ่าย', ADJ: 'ปรับ', TRF: 'โอน', CNT: 'นับได้', DSP: 'จำนวน' }[t];
  const rows = lines.map((l, i) => {
    const exp = l.lot?.expiry_date || l.expiry_date;
    const cost = Number(l.unit_cost ?? l.product.cost ?? 0);
    return `<tr><td>${i + 1}</td><td><b>${esc(l.product.name)}</b><div class="sub mono">${esc(l.product.code)}</div>${l.override_reason ? `<div class="sub">เหตุผลข้าม FEFO: ${esc(l.override_reason)}</div>` : ''}${l.reason ? `<div class="sub">เหตุผล: ${esc(l.reason)}</div>` : ''}</td>
      <td>${esc(l.lot?.lot_no || l.lot_no || '—')}</td><td>${exp ? dTH(exp) : '—'}${exp && d.status !== 'posted' ? '<br>' + expiryBadge(exp) : ''}</td>
      ${t === 'CNT' ? `<td class="num">${l.system_qty == null ? '—' : n0(l.system_qty)}</td>` : ''}
      <td class="num"><b>${n0(l.qty)}</b> ${esc(l.product.unit || '')}</td>
      ${t === 'CNT' ? `<td class="num">${l.system_qty == null ? '—' : n0(Number(l.qty) - Number(l.system_qty))}</td>` : ''}
      ${showCost ? `<td class="num">${n2(cost)}</td><td class="num">${n2(cost * Number(l.qty))}</td>` : ''}
      <td>${esc(l.location || '')}</td></tr>`;
  }).join('');
  const total = lines.reduce((a, l) => a + Number(l.qty) * Number(l.unit_cost ?? l.product.cost ?? 0), 0);

  main.innerHTML = `
    <div class="printonly"><h2>${esc(s.name || '')}</h2><div class="sub">${esc(s.address || '')} ${s.tax_id ? '· เลขประจำตัวผู้เสียภาษี ' + esc(s.tax_id) : ''}</div><hr></div>
    ${pageHead(`${esc(d.doc_no)} ${typeBadge(t)} ${statusBadge(d.status)}`, `${DOC[t].label}${d.purpose ? ' · ' + (PURPOSE[d.purpose] || d.purpose) : ''}`, actions.join(''), '<a href="#/documents">เอกสารทั้งหมด</a> › ดูเอกสาร')}
    ${d.status === 'pending' ? `<div class="alert warn"><b>รออนุมัติ เพราะ:</b><ul style="margin:6px 0 0">${(d.approval_reasons || []).map((r) => `<li>${esc(r)}</li>`).join('')}</ul></div>` : ''}
    ${d.status === 'cancelled' ? `<div class="alert bad"><b>ยกเลิกแล้ว</b> โดย ${esc(d.canceller?.full_name || '')} ${dtTH(d.cancelled_at)} — ${esc(d.cancel_reason || '')}</div>` : ''}
    <section class="card"><div class="grid g4">
      <div><div class="sub">วันที่เอกสาร</div><b>${dTH(d.doc_date)}</b></div>
      <div><div class="sub">${t === 'TRF' ? 'จากคลัง → ไปคลัง' : 'คลัง'}</div><b>${esc(whName(d.warehouse_id))}${t === 'TRF' ? ' → ' + esc(whName(d.to_warehouse_id)) : ''}</b></div>
      <div><div class="sub">${t === 'OUT' ? 'ลูกค้า' : 'คู่ค้า'}</div><b>${esc(d.partner?.name || '—')}</b></div>
      <div><div class="sub">อ้างอิง</div><b>${esc(d.ref_no || '—')}</b></div>
      <div class="span2"><div class="sub">หมายเหตุ</div>${esc(d.note || '—')}</div>
      <div><div class="sub">ผู้ทำรายการ</div>${esc(d.creator?.full_name || d.creator?.email || '—')}<div class="sub">${dtTH(d.created_at)}</div></div>
      <div><div class="sub">ยืนยัน / อนุมัติ</div>${d.posted_at ? esc(d.poster?.full_name || '') + '<div class="sub">' + dtTH(d.posted_at) + '</div>' : '—'}${d.approver ? `<div class="sub">อนุมัติโดย ${esc(d.approver.full_name)}</div>` : ''}</div>
    </div></section>
    <section class="card"><div class="tw"><table class="t"><thead><tr><th>#</th><th>สินค้า</th><th>Lot / Serial</th><th>หมดอายุ</th>${t === 'CNT' ? '<th class="num">ระบบ</th>' : ''}<th class="num">${qtyLabel}</th>${t === 'CNT' ? '<th class="num">ต่าง</th>' : ''}${showCost ? '<th class="num">ราคา/หน่วย</th><th class="num">มูลค่า</th>' : ''}<th>ตำแหน่ง</th></tr></thead>
      <tbody>${rows || '<tr><td colspan="9" class="empty">ไม่มีรายการ</td></tr>'}</tbody>
      ${showCost && lines.length ? `<tfoot><tr><td colspan="${t === 'CNT' ? 8 : 6}" class="num">รวม</td><td class="num">${n2(total)}</td><td></td></tr></tfoot>` : ''}</table></div></section>
    <div class="printonly"><br><br><div class="grid g3" style="text-align:center"><div>…………………………<br>ผู้จัดทำ</div><div>…………………………<br>ผู้ตรวจสอบ / อนุมัติ</div><div>…………………………<br>ผู้รับ / ผู้ส่ง</div></div></div>`;

  const after = (msg) => { toast(msg, 'ok'); window.dispatchEvent(new Event('mms:changed')); go('#/doc/' + id); };
  $('[data-print]', main).onclick = () => window.print();
  const post = async () => { try { const st = await q(sb.rpc('post_document', { p_id: id })); after(st === 'pending' ? 'ส่งให้หัวหน้าคลังอนุมัติแล้ว' : 'ยืนยันแล้ว — ตัดสต็อกเรียบร้อย'); } catch (e) { toast(errMsg(e), 'err'); } };
  $('[data-post]', main)?.addEventListener('click', post);
  $('[data-approve]', main)?.addEventListener('click', async () => { if (await confirmBox('อนุมัติเอกสาร', `อนุมัติ ${d.doc_no} และตัดสต็อกตามรายการ?`)) post(); });
  const cancel = async (title) => {
    const reason = await promptBox(title, 'เหตุผล (บันทึกในประวัติ)');
    if (!reason) return;
    try { await q(sb.rpc('cancel_document', { p_id: id, p_reason: reason })); after('ยกเลิกเอกสารแล้ว' + (d.status === 'posted' ? ' — กลับยอดสต็อกแล้ว' : '')); } catch (e) { toast(errMsg(e), 'err'); }
  };
  $('[data-reject]', main)?.addEventListener('click', () => cancel('ไม่อนุมัติเอกสาร'));
  $('[data-cancel]', main)?.addEventListener('click', () => cancel(d.status === 'posted' ? 'ยกเลิกเอกสาร (ระบบจะกลับยอดสต็อก)' : 'ยกเลิกเอกสาร'));
}
