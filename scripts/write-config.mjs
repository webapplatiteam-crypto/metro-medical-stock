// รันตอน build บน Netlify: เขียน web/js/config.js จาก Environment variables
import { writeFileSync } from 'node:fs';

const url = (process.env.SUPABASE_URL || '').trim().replace(/\/+$/, '');
const key = (process.env.SUPABASE_ANON_KEY || '').trim();

if (!url || !key) {
  console.log('[write-config] ไม่พบ SUPABASE_URL / SUPABASE_ANON_KEY — ใช้ web/js/config.js เดิม');
  process.exit(0);
}
if (!/^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(url)) console.warn('[write-config] SUPABASE_URL ดูไม่ถูกต้อง:', url);

writeFileSync('web/js/config.js',
  `// สร้างอัตโนมัติตอน build จาก Netlify Environment variables\n` +
  `export const SUPABASE_URL = ${JSON.stringify(url)};\n` +
  `export const SUPABASE_ANON_KEY = ${JSON.stringify(key)};\n`);
console.log('[write-config] เขียน web/js/config.js แล้ว →', url);
