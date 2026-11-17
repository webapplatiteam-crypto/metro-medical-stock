// สร้างผู้ใช้ใหม่ (เรียกจากหน้า "ผู้ใช้ & สิทธิ์" — เฉพาะผู้ดูแลระบบ)
// ต้องใช้ service role key ฝั่ง server จึงทำในเบราว์เซอร์ไม่ได้
import { createClient } from 'npm:@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown) => new Response(JSON.stringify(body), { headers: { ...cors, 'Content-Type': 'application/json' } });
const ROLES = ['admin', 'manager', 'staff', 'sales', 'viewer'];

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  try {
    const url = Deno.env.get('SUPABASE_URL')!;
    // รองรับทั้งคีย์แบบใหม่ (sb_secret_…) และแบบเก่า (service_role)
    const service = Deno.env.get('SUPABASE_SECRET_KEY') || Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!service) return json({ error: 'ฟังก์ชันไม่พบ secret key ของโปรเจกต์ (SUPABASE_SECRET_KEY)' });
    const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
    if (!token) return json({ error: 'ยังไม่ได้เข้าสู่ระบบ' });

    const admin = createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data: { user } } = await admin.auth.getUser(token);
    if (!user) return json({ error: 'เซสชันหมดอายุ เข้าสู่ระบบใหม่' });

    const { data: me } = await admin.from('profiles').select('role, active').eq('id', user.id).single();
    if (!me || me.role !== 'admin' || !me.active) return json({ error: 'เฉพาะผู้ดูแลระบบ' });

    const { email, password, full_name, employee_code, role } = await req.json();
    if (!email || !password || String(password).length < 10) return json({ error: 'กรอกอีเมล และรหัสผ่านอย่างน้อย 10 ตัว' });
    if (!ROLES.includes(role)) return json({ error: 'บทบาทไม่ถูกต้อง' });

    const { data, error } = await admin.auth.admin.createUser({
      email: String(email).trim().toLowerCase(), password, email_confirm: true,
      user_metadata: { full_name, employee_code }, app_metadata: { role },
    });
    if (error) return json({ error: error.message });

    await admin.from('profiles').update({ role, full_name: full_name || null, employee_code: employee_code || null }).eq('id', data.user.id);
    await admin.from('audit_log').insert({ user_id: user.id, action: 'CREATE_USER', table_name: 'profiles', record_id: data.user.id, detail: { email, role } });
    return json({ id: data.user.id });
  } catch (e) {
    return json({ error: String((e as Error)?.message ?? e) });
  }
});
