# TESTING — MEDI-BOT AGENCY v3

## 1. Otomatis

```powershell
npm test
```

Harapan: **10/10 tes triage lulus** (`tests/triage.test.ts`) dan 3 tes perbaikan Bug Hunter
(`fixes/fixes.test.ts`), total 13/13.

Cakupan tes:
1. TD 190/120 → MERAH
2. Diastolik 115 → MERAH
3. Gula 320 dan 45 → MERAH
4. Saturasi 88 → MERAH, 90 tidak
5. Nadi 125/38 → MERAH, batas 120/40 tidak
6. Suhu 39.5, kalium 6.1, Hb 6.9, trombosit 49000 → MERAH
7. Kelima keyword MERAH terdeteksi
8. KUNING (kontrol >7 hari, obat 3 hari, lab ringan)
9. HIJAU normal, lengkap
10. Data kosong → HIJAU tetapi `needsReview=true`

Cek tambahan:

```powershell
npm run typecheck
npm run build
```

## 2. Manual — fondasi

1. `npm run db:setup` sukses; 20 pasien masuk (3 MERAH, 5 KUNING, 12 HIJAU).
2. NIK dummy semuanya diawali `35` dan tampil sebagai `35****xxxx` di role rendah.
3. Login `resepsionis@klinik.example` → halaman dashboard menunjukkan "Lihat diagnosis: DITOLAK".
4. Login `dokter@klinik.example` → "Lihat diagnosis: IZIN".
5. Tidak ada file `.env` yang ter-commit (`git status`).

## 3. Manual — urgent (Langkah 3)

1. Buka `/triage`, input TD 190/120, submit.
2. Status MERAH muncul < 5 detik.
3. Klik "Simulasi Panggilan Urgent".
4. Buka Prisma Studio → `urgent_calls` bertambah 4 baris (WA, telepon 1, telepon 2, eskalasi).
5. Pastikan pesan WhatsApp tidak memuat diagnosis.

## 4. Manual — keamanan

```powershell
npm run prisma:generate:pg
```

Pastikan `prisma/schema.postgres.prisma` dibuat dan `DATABASE_URL` PostgreSQL diset sebelum
menggunakannya di produksi.

## 5. End-to-end otomatis

Dengan server produksi berjalan (`npm run build && npm run start`), jalankan:

```powershell
npm run e2e
```

Hasil terverifikasi: login dokter/resepsionis/admin, 20 pasien, input 190/120 → MERAH
(<1 detik), simulasi 4 log urgent, download PDF & Excel, resepsionis diblokir, Manual Run
6/6 agent sukses.

Smoke test agent tanpa HTTP:

```powershell
npm run verify:agents
```

## 6. Yang belum diuji untuk produksi

- Validasi klinis atas ambang triage oleh dokter/perawat.
- Review legal UU PDP No. 27/2022 dan DPA provider WhatsApp/telepon/SMTP.
- Deployment PostgreSQL + BullMQ/Redis multi-instance (Scheduler saat ini in-process).
- Pengiriman nyata WhatsApp/telepon/email (sengaja dinonaktifkan secara default).
- Jangan gunakan untuk pasien nyata sampai item di atas selesai.
