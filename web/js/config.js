// ใส่ค่าจาก Supabase › Project Settings › API
// (บน Netlify ไม่ต้องแก้ไฟล์นี้ — ตั้ง Environment variables SUPABASE_URL / SUPABASE_ANON_KEY แทน ระบบเขียนให้ตอน build)
// anon public key เปิดเผยได้ — ความปลอดภัยอยู่ที่ Row Level Security ในฐานข้อมูล
export const SUPABASE_URL = 'https://YOUR-PROJECT-REF.supabase.co';
export const SUPABASE_ANON_KEY = 'YOUR-ANON-PUBLIC-KEY';
