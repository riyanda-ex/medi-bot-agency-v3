# TESTING — MediBot Clinical Operations Platform

## 1. Otomatis

```powershell
npm test
```

Harapan: **semua tes lulus** — mencakup triage (`tests/triage.test.ts`), helper Bug Hunter
(`fixes/fixes.test.ts`), hardening (`tests/hardening.test.ts`), dan password seed lokal
(`tests/seed-password.test.ts`).

Cakupan triage:

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

Cakupan hardening meliputi: RBAC fail-closed, izin approval, penolakan placeholder/secret pendek,
provider mock dan blokir outbound nyata, template WhatsApp tanpa diagnosis, chatbot edukatif,
enkripsi + masking NIK/HP, IP audit hanya dari proxy tepercaya, opsi retry BullMQ, tanda tangan
payload job, containment path laporan, dan rate limit login.

Cek tambahan:

```powershell
npm run typecheck
npm run build
npm audit --audit-level=high
```

## 2. Manual — fondasi

1. `npm run db:setup` sukses; 20 pasien masuk (3 MERAH, 5 KUNING, 12 HIJAU).
2. NIK dummy semuanya diawali `35` dan tampil sebagai `35****xxxx` di role rendah.
3. Form login tidak berisi email/kata sandi otomatis.
4. Login `resepsionis@klinik.example` → dashboard menunjukkan "Lihat diagnosis: DITOLAK" dan tidak ada teks diagnosis.
5. Login `dokter@klinik.example` → "Lihat diagnosis: IZIN" dan teks diagnosis nyata tampil.
6. `git status --short` tidak menampilkan `.env`.

## 3. Manual — urgent (Langkah 3)

1. Buka `/triage`, input TD 190/120, submit.
2. Status MERAH muncul < 5 detik.
3. Klik "Simulasi Panggilan Urgent".
4. Buka Prisma Studio → `urgent_calls` bertambah 4 baris (WA, telepon 1, telepon 2, eskalasi).
5. Pastikan pesan WhatsApp tidak memuat diagnosis atau angka vital.
6. Bila pengiriman nyata diaktifkan, minta approval DOKTER/ADMIN dari panel dashboard dan masukkan `approvalId` pada form triage.

## 4. Manual — approval dan laporan

1. Login sebagai DOKTER/ADMIN, buka panel "Approval pengiriman nyata" di dashboard.
2. Pilih triage log MERAH atau laporan tanggal hari ini, lalu berikan approval.
3. Salin `approvalId` yang muncul; berlaku 30 menit dan tercatat di `audit_logs`.
4. Halaman laporan menampilkan metrik nyata dari API dan grafik batang 7 hari.
5. Download PDF (`%PDF`) dan Excel (`PK`) tetap dibatasi role `report:read`.

## 5. End-to-end otomatis

Untuk pengujian lokal dengan `.env` bawaan (kunci DEV + `SYNC_MODE=true`), jalankan server
development lalu E2E:

```powershell
npm run dev
# di terminal lain:
npm run e2e
```

Server produksi (`npm run build && npm run start`) menolak kunci DEV dan `SYNC_MODE=true`.
Bila ingin menjalankan E2E terhadap build produksi, siapkan environment produksi yang aman
(`NEXTAUTH_SECRET`/`FIELD_ENCRYPTION_KEY` acak, `SYNC_MODE=false`, `ALLOW_SEED=true`,
`SEED_PASSWORD` kuat) dan seed ulang database sesuai kunci tersebut. CI melakukan ini dengan
nilai throwaway khusus CI.

Kredensial dapat dioverride lewat `E2E_DOCTOR_EMAIL`, `E2E_RECEPTIONIST_EMAIL`,
`E2E_ADMIN_EMAIL`, `E2E_PATIENT_EMAIL`, dan `E2E_PASSWORD`.

E2E memverifikasi: login empat peran, 20 pasien, teks diagnosis DOKTER dan ketiadaannya untuk
RESEPSIONIS, endpoint rekam medis berbasis peran, `/api/me`, chatbot, 190/120 → MERAH < 5 detik,
simulasi 4 log urgent, **generate laporan sebelum download**, PDF/Excel valid, blokir laporan
untuk RESEPSIONIS, dan Manual Run 6/6 agent `SUCCESS`.

Smoke test agent tanpa HTTP:

```powershell
npm run verify:agents
```

Skrip menjalankan 6 agent langsung (Analyzer, Urgent, Reporter, Security Guard, Engagement,
Bug Hunter) plus pemeriksaan database; Orchestrator diuji lewat Manual Run/E2E.

## 6. Produksi (PostgreSQL + Redis)

```powershell
docker compose up -d
# Isi POSTGRES_PASSWORD dan REDIS_PASSWORD di .env dengan nilai acak.
# Set DATABASE_URL PostgreSQL, QUEUE_MODE=redis,
# REDIS_URL=redis://:<password>@localhost:6379,
# NEXTAUTH_SECRET dan FIELD_ENCRYPTION_KEY minimal 32 byte acak.
npm run db:setup:pg
npm run build
npm run queue:worker
```

Verifikasi producer/worker terpisah:

```powershell
npm run queue:check
```

Endpoint `/api/orchestrator/run` dan `/api/urgent/simulate` harus mengembalikan `202` + `jobId`,
dan log worker menampilkan `Worker aktif` serta penyelesaian job. CI GitHub Actions menjalankan
skenario yang sama dengan service PostgreSQL/Redis berpassword.

## 7. Yang belum diuji untuk produksi

- Validasi klinis atas ambang triage oleh dokter/perawat.
- Review legal UU PDP No. 27/2022 dan DPA provider WhatsApp/telepon/SMTP.
- Pengiriman nyata WhatsApp/telepon/email (sengaja dinonaktifkan secara default).
- Beban multi-instance dan failover Redis di lingkungan produksi sesungguhnya.
- Jangan gunakan untuk pasien nyata sampai item di atas selesai.
