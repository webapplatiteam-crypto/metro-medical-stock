// รายการเอกสารทั้งหมด / รออนุมัติ
import { sb, q, can, DOC, STATUS, esc, opt, n0, dTH, statusBadge, typeBadge, whName, $, $$, pageHead, go, debounce, addDays, today, downloadXlsx } from '../core.js';

export async function render(main, { route, query }) {
  const approvals = route === 'approvals';
  const f = { type: query.get('type') || '', status: approvals ? 'pending' : (query.get('status') || ''), from: approvals ? '' : addDays(today(), -30), to: '', term: '' };

  main.innerHTML = `${pageHead(approvals ? 'รออนุมัติ' : 'เอกสารทั้งหมด', approvals ? 'เอกสารที่เจ้าหน้าที่ส่งมา — เปิดเอกสารเพื่ออนุมัติหรือไม่อนุมัติ' : 'ใบรับเข้า · จ่ายออก · ปรับยอด · โอนย้าย · ตรวจนับ · ทำลาย/คืน',
    `<button class="b2" data-xls>ส่งออก Excel</button>${can.operate() ? '<a class="b1" href="#/receive">+ รับเข้า</a><a class="b1" href="#/issue">− จ่ายออก</a>' : ''}`)}
    <section class="card noprint"><div class="grid g5">
      <label class="f">ค้นหา<input class="i" data-f="term" placeholder="เลขที่ / อ้างอิง / หมายเหตุ"></label>
      <label class="f">ตั้งแต่วันที่<input class="i" type="date" data-f="from" value="${f.from}"></label>
      <label class="f">ถึงวันที่<input class="i" type="date" data-f="to" value="${f.to}"></label>
      <label class="f">สถานะ<select class="i" data-f="status">${opt('', 'ทุกสถานะ', f.status)}${Object.entries(STATUS).map(([k, v]) => opt(k, v[0], f.status)).join('')}</select></label>
      <label class="f">ประเภท<select class="i" data-f="type">${opt('', 'ทุกประเภท', f.type)}${Object.entries(DOC).map(([k, v]) => opt(k, v.label, f.type)).join('')}</select></label>
    </div></section>
    <section class="card"><div class="tw"><table class="t"><thead><tr><th>เลขที่</th><th>วันที่</th><th>ประเภท</th><th>คลัง</th><th>คู่ค้า / อ้างอิง</th><th class="num">รายการ</th><th class="num">จำนวนรวม</th><th>ผู้ทำ</th><th>สถานะ</th></tr></thead><tbody data-b></tbody></table></div>
    <span class="sub" data-c></span></section>`;

  let rows = [];
  async function load() {
    let b = sb.from('documents').select('id, doc_no, doc_type, status, doc_date, warehouse_id, to_warehouse_id, ref_no, note, partner:partners(name), creator:profiles!documents_created_by_fkey(full_name), document_lines(qty)')
      .order('created_at', { ascending: false }).limit(500);
    if (f.type) b = b.eq('doc_type', f.type);
    if (f.status) b = b.eq('status', f.status);
    if (f.from) b = b.gte('doc_date', f.from);
    if (f.to) b = b.lte('doc_date', f.to);
    if (f.term) b = b.or(`doc_no.ilike.%${f.term}%,ref_no.ilike.%${f.term}%,note.ilike.%${f.term}%`);
    rows = await q(b);
    $('[data-b]', main).innerHTML = rows.map((d) => `<tr class="click" data-id="${d.id}">
      <td class="mono"><a href="#/doc/${d.id}">${esc(d.doc_no)}</a></td><td>${dTH(d.doc_date)}</td><td>${typeBadge(d.doc_type)}</td>
      <td>${esc(whName(d.warehouse_id))}${d.doc_type === 'TRF' ? ' → ' + esc(whName(d.to_warehouse_id)) : ''}</td>
      <td>${esc(d.partner?.name || '')}${d.ref_no ? `<div class="sub">${esc(d.ref_no)}</div>` : ''}</td>
      <td class="num">${d.document_lines.length}</td><td class="num">${n0(d.document_lines.reduce((s, l) => s + Number(l.qty), 0))}</td>
      <td>${esc(d.creator?.full_name || '')}</td><td>${statusBadge(d.status)}</td></tr>`).join('') || '<tr><td colspan="9" class="empty">ไม่มีเอกสารตามเงื่อนไข</td></tr>';
    $('[data-c]', main).textContent = rows.length >= 500 ? 'แสดง 500 รายการล่าสุด — ใช้ตัวกรองเพื่อดูเพิ่ม' : `${rows.length} เอกสาร`;
  }
  $$('[data-f]', main).forEach((el) => el.addEventListener(el.tagName === 'INPUT' && el.type === 'text' ? 'input' : 'change', debounce(() => { f[el.dataset.f] = el.value.trim().replace(/[,()%*]/g, ''); load(); }, 300)));
  $('[data-b]', main).addEventListener('click', (e) => { const tr = e.target.closest('tr[data-id]'); if (tr && !e.target.closest('a')) go('#/doc/' + tr.dataset.id); });
  $('[data-xls]', main).onclick = () => downloadXlsx(`เอกสาร_${today()}.xlsx`, [{ name: 'เอกสาร', cols: [16, 12, 12, 18, 24, 18, 8, 10, 14, 12],
    rows: [['เลขที่', 'วันที่', 'ประเภท', 'คลัง', 'คู่ค้า', 'อ้างอิง', 'รายการ', 'จำนวนรวม', 'ผู้ทำ', 'สถานะ'],
      ...rows.map((d) => [d.doc_no, dTH(d.doc_date), DOC[d.doc_type].label, whName(d.warehouse_id), d.partner?.name || '', d.ref_no || '', d.document_lines.length, d.document_lines.reduce((s, l) => s + Number(l.qty), 0), d.creator?.full_name || '', STATUS[d.status][0]])] }]);
  await load();
}
