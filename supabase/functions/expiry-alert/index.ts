// สรุปสินค้าใกล้หมดอายุ ส่งทางอีเมล (Resend) และ LINE (Messaging API)
// เรียกได้ 2 ทาง: (1) ตั้งเวลาทุกเช้าด้วย pg_cron โดยส่ง header x-cron-secret
//               (2) ผู้ดูแลระบบกด "ทดสอบส่งแจ้งเตือน" ในหน้าตั้งค่า
import { createClient } from 'npm:@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown) => new Response(JSON.stringify(body), { headers: { ...cors, 'Content-Type': 'application/json' } });
const fmt = (n: number) => Number(n || 0).toLocaleString('en-US', { maximumFractionDigits: 0 });
const thDate = (iso: string) => { const [y, m, d] = iso.split('-').map(Number); return `${String(d).padStart(2, '0')}/${String(m).padStart(2, '0')}/${y + 543}`; };

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  try {
    const url = Deno.env.get('SUPABASE_URL')!;
    const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const admin = createClient(url, service, { auth: { persistSession: false } });

    // ---- ตรวจสิทธิ์ ----
    const cronSecret = Deno.env.get('CRON_SECRET');
    const isCron = !!cronSecret && req.headers.get('x-cron-secret') === cronSecret;
    if (!isCron) {
      const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
      const { data: { user } } = await admin.auth.getUser(token);
      if (!user) return json({ error: 'ไม่มีสิทธิ์' });
      const { data: me } = await admin.from('profiles').select('role, active').eq('id', user.id).single();
      if (!me?.active || !['admin', 'manager'].includes(me.role)) return json({ error: 'เฉพาะผู้ดูแลระบบ/หัวหน้าคลัง' });
    }
    const body = await req.json().catch(() => ({}));

    // ---- ข้อมูล ----
    const { data: st } = await admin.from('company_settings').select('*').eq('id', 1).single();
    const maxDays = Math.max(...((st?.alert_days?.length ? st.alert_days : [180]) as number[]));
    const { data: rows, error } = await admin.rpc('expiry_summary', { p_days: maxDays });
    if (error) return json({ error: error.message });
    const list = (rows ?? []) as Array<{ bucket: string; code: string; name: string; lot_no: string; expiry_date: string; days_left: number; warehouse_name: string; qty: number; value: number }>;
    if (!list.length && !body.test) return json({ sent: [], note: 'ไม่มีรายการใกล้หมดอายุ' });

    const sum = (b: string) => { const r = list.filter((x) => x.bucket === b); return { n: r.length, v: r.reduce((s, x) => s + Number(x.value), 0) }; };
    const ex = sum('expired'), d30 = sum('d30'), d90 = sum('d90'), d180 = sum('d180');
    const today = new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10);
    const top = list.slice(0, 10).map((x) => `• ${x.code} ${x.name} · Lot ${x.lot_no} · หมดอายุ ${thDate(x.expiry_date)} (${x.days_left < 0 ? 'เลยมา ' + -x.days_left : 'อีก ' + x.days_left} วัน) · ${fmt(x.qty)} ชิ้น · ${x.warehouse_name}`);
    const text = [
      `${st?.name ?? 'Metro Medical'}`,
      `สรุปวันหมดอายุ ${thDate(today)}`,
      `หมดอายุแล้ว ${ex.n} Lot (฿${fmt(ex.v)})`,
      `≤ 30 วัน ${d30.n} Lot (฿${fmt(d30.v)})`,
      `31–90 วัน ${d90.n} Lot (฿${fmt(d90.v)})`,
      `91–${maxDays} วัน ${d180.n} Lot (฿${fmt(d180.v)})`,
      '', ...(top.length ? ['ด่วนที่สุด:', ...top] : ['ไม่มีรายการ']),
      ...(Deno.env.get('APP_URL') ? ['', `เปิดดูในระบบ: ${Deno.env.get('APP_URL')}/#/expiry`] : []),
    ].join('\n');

    const sent: string[] = [];
    const errors: string[] = [];

    // ---- อีเมล (Resend) ----
    const resendKey = Deno.env.get('RESEND_API_KEY');
    const emails: string[] = st?.notify_emails ?? [];
    if (resendKey && emails.length) {
      const r = await fetch('https://api.resend.com/emails', {
        method: 'POST', headers: { Authorization: `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: Deno.env.get('ALERT_FROM') ?? 'Metro Medical Stock <onboarding@resend.dev>', to: emails,
          subject: `แจ้งเตือนวันหมดอายุ ${thDate(today)} — หมดแล้ว ${ex.n} · ≤30 วัน ${d30.n} · ≤90 วัน ${d90.n}`,
          text }),
      });
      r.ok ? sent.push('อีเมล ' + emails.length + ' ราย') : errors.push('อีเมล: ' + (await r.text()));
    }

    // ---- LINE Messaging API ----
    const lineToken = Deno.env.get('LINE_CHANNEL_ACCESS_TOKEN');
    if (lineToken && st?.line_to) {
      const r = await fetch('https://api.line.me/v2/bot/message/push', {
        method: 'POST', headers: { Authorization: `Bearer ${lineToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ to: st.line_to, messages: [{ type: 'text', text: text.slice(0, 4900) }] }),
      });
      r.ok ? sent.push('LINE') : errors.push('LINE: ' + (await r.text()));
    }

    await admin.from('audit_log').insert({ action: 'EXPIRY_ALERT', table_name: 'notifications', detail: { sent, errors, items: list.length } });
    if (errors.length && !sent.length) return json({ error: errors.join(' | ') });
    return json({ sent, errors, items: list.length });
  } catch (e) {
    return json({ error: String((e as Error)?.message ?? e) });
  }
});
