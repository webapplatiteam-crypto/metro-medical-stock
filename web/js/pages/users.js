// ผู้ใช้และสิทธิ์ (เฉพาะผู้ดูแลระบบ)
import { sb, q, state, can, ROLE, esc, opt, dtTH, toast, errMsg, modal, $, pageHead, go } from '../core.js';

const MATRIX = [
  ['ดูสต็อก / แดชบอร์ด / รายงาน', 'ได้', 'ได้', 'ได้', 'ดู', 'ดู'],
  ['รับเข้า / จ่ายออก / โอนย้าย / ตรวจนับ', 'ได้', 'ได้', 'ได้', '—', '—'],
  ['ข้าม FEFO / จ่ายของอายุสั้น / รับของอายุสั้น', 'ได้', 'อนุมัติ', 'ขออนุมัติ', '—', '—'],
  ['ปรับยอด / ตัดทำลาย / คืนซัพพลายเออร์', 'ได้', 'อนุมัติ', 'ขออนุมัติ', '—', '—'],
  ['ยกเลิกเอกสารที่ยืนยันแล้ว', 'ได้', 'ได้', '—', '—', '—'],
  ['แก้ข้อมูลสินค้า / คู่ค้า / คลัง / นำเข้า Excel', 'ได้', 'ได้', '—', '—', '—'],
  ['เห็นราคาทุน / มูลค่า', 'ได้', 'ได้', '—', '—', 'ได้'],
  ['จัดการผู้ใช้ / ตั้งค่าบริษัท', 'ได้', '—', '—', '—', '—'],
];

export async function render(main) {
  if (!can.admin()) { main.innerHTML = '<div class="alert bad">เฉพาะผู้ดูแลระบบ</div>'; return; }
  const users = await q(sb.from('profiles').select('*').order('created_at'));
  const logins = await q(sb.from('audit_log').select('user_id, at').eq('action', 'POST').order('at', { ascending: false }).limit(500));
  const lastAct = (id) => logins.find((l) => l.user_id === id)?.at;

  main.innerHTML = `${pageHead('ผู้ใช้และสิทธิ์', 'เพิ่มผู้ใช้ กำหนดบทบาท ปิดใช้งาน (ประวัติยังอยู่ครบ)', '<button class="b1" data-add>+ เพิ่มผู้ใช้</button>')}
    <section class="card"><div class="tw"><table class="t"><thead><tr><th>ชื่อ</th><th>อีเมล</th><th>รหัสพนักงาน</th><th>บทบาท</th><th>ยืนยันเอกสารล่าสุด</th><th>สถานะ</th><th></th></tr></thead><tbody>
      ${users.map((u) => `<tr><td><b>${esc(u.full_name || '')}</b></td><td>${esc(u.email || '')}</td><td>${esc(u.employee_code || '')}</td><td><span class="bd ${u.role === 'admin' ? 'r' : u.role === 'manager' ? 'y' : u.role === 'staff' ? 'bl' : 'n'}">${ROLE[u.role]}</span></td>
        <td class="sub">${dtTH(lastAct(u.id))}</td><td>${u.active ? '<span class="bd g">ใช้งาน</span>' : '<span class="bd n">ปิดใช้งาน</span>'}</td><td><button class="b3" data-edit="${u.id}">แก้ไข</button></td></tr>`).join('')}
    </tbody></table></div></section>
    <section class="card"><h2>สิทธิ์ตามบทบาท</h2><div class="tw"><table class="t"><thead><tr><th>ฟังก์ชัน</th>${Object.values(ROLE).map((r) => `<th style="text-align:center">${r}</th>`).join('')}</tr></thead><tbody>
      ${MATRIX.map(([fn, ...c]) => `<tr><td><b>${fn}</b></td>${c.map((x) => `<td style="text-align:center"><span class="bd ${x === 'ได้' ? 'g' : x === 'อนุมัติ' ? 'y' : x === 'ขออนุมัติ' || x === 'ดู' ? 'bl' : 'n'}">${x}</span></td>`).join('')}</tr>`).join('')}
    </tbody></table></div><span class="sub">สิทธิ์บังคับในฐานข้อมูล (Row Level Security) — ซ่อนปุ่มอย่างเดียวไม่พอ ระบบปฏิเสธที่ฝั่ง server ด้วย</span></section>`;

  $('[data-add]', main).onclick = () => modal({
    title: 'เพิ่มผู้ใช้',
    body: `<div class="grid g2"><label class="f span2">ชื่อ-นามสกุล<input class="i" data-n></label><label class="f">อีเมล<input class="i" type="email" data-e></label><label class="f">รหัสพนักงาน<input class="i" data-c></label>
      <label class="f">บทบาท<select class="i" data-r>${Object.entries(ROLE).map(([k, v]) => opt(k, v, 'staff')).join('')}</select></label><label class="f">รหัสผ่านเริ่มต้น (≥ 10 ตัว)<input class="i" type="text" data-p></label></div>
      <p class="sub">ผู้ใช้ควรเปลี่ยนรหัสผ่านเองหลังเข้าใช้ครั้งแรก (เมนู ลืมรหัสผ่าน)</p>`,
    actions: [{ label: 'ยกเลิก' }, { label: 'สร้างผู้ใช้', cls: 'b1', onClick: async (bg) => {
      const body = { email: $('[data-e]', bg).value.trim(), password: $('[data-p]', bg).value, full_name: $('[data-n]', bg).value.trim(), employee_code: $('[data-c]', bg).value.trim(), role: $('[data-r]', bg).value };
      if (!body.email || body.password.length < 10) { toast('กรอกอีเมล และรหัสผ่านอย่างน้อย 10 ตัว', 'err'); return true; }
      const { data, error } = await sb.functions.invoke('admin-create-user', { body });
      if (error || data?.error) { toast('สร้างไม่สำเร็จ: ' + (data?.error || errMsg(error)) + ' — ตรวจว่า deploy Edge Function admin-create-user แล้ว', 'err'); return true; }
      if (!data?.id) { toast('สร้างไม่สำเร็จ: ฟังก์ชัน admin-create-user ตอบกลับไม่ถูกต้อง — ตรวจว่าวางโค้ดจาก supabase/functions/admin-create-user/index.ts ครบทั้งไฟล์แล้ว Deploy ใหม่', 'err'); return true; }
      toast('สร้างผู้ใช้แล้ว', 'ok'); go('#/users');
    } }],
  });

  main.addEventListener('click', (e) => {
    const b = e.target.closest('[data-edit]'); if (!b) return;
    const u = users.find((x) => x.id === b.dataset.edit);
    const self = u.id === state.profile.id;
    modal({
      title: 'แก้ไขผู้ใช้ ' + (u.full_name || u.email),
      body: `<div class="grid g2"><label class="f span2">ชื่อ-นามสกุล<input class="i" data-n value="${esc(u.full_name || '')}"></label>
        <label class="f">รหัสพนักงาน<input class="i" data-c value="${esc(u.employee_code || '')}"></label>
        <label class="f">บทบาท<select class="i" data-r ${self ? 'disabled' : ''}>${Object.entries(ROLE).map(([k, v]) => opt(k, v, u.role)).join('')}</select></label>
        <label class="chk span2"><input type="checkbox" data-a ${u.active ? 'checked' : ''} ${self ? 'disabled' : ''}> ใช้งานอยู่</label></div>
        ${self ? '<p class="sub">แก้บทบาท/สถานะของตัวเองไม่ได้ เพื่อกันล็อกตัวเองออก</p>' : ''}
        <button class="b2 sm" data-reset type="button">ส่งอีเมลตั้งรหัสผ่านใหม่</button>`,
      onOpen: (bg) => { $('[data-reset]', bg).onclick = async () => { const { error } = await sb.auth.resetPasswordForEmail(u.email, { redirectTo: location.origin + '/#/reset' }); toast(error ? errMsg(error) : 'ส่งอีเมลแล้ว', error ? 'err' : 'ok'); }; },
      actions: [{ label: 'ยกเลิก' }, { label: 'บันทึก', cls: 'b1', onClick: async (bg) => {
        const upd = { full_name: $('[data-n]', bg).value.trim(), employee_code: $('[data-c]', bg).value.trim() || null };
        if (!self) { upd.role = $('[data-r]', bg).value; upd.active = $('[data-a]', bg).checked; }
        try { await q(sb.from('profiles').update(upd).eq('id', u.id)); toast('บันทึกแล้ว', 'ok'); go('#/users'); } catch (err) { toast(errMsg(err), 'err'); return true; }
      } }],
    });
  });
}
