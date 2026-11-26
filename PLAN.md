# PLAN — MEDI-BOT AGENCY v3

> Status: **Selesai — Langkah 0 sampai 5 + hardening produksi terverifikasi (2026-11-26).**
> Dokumen ini adalah sumber kebenaran untuk urutan kerja. Centang hanya setelah kode benar-benar berjalan dan teruji.

---

## 1. Prinsip yang tidak bisa ditawar

| Prinsip | Penerapan konkret |
|---|---|
| **Aman secara default** | `WHATSAPP_PROVIDER=mock`, `PHONE_PROVIDER=mock`, `ALLOW_REAL_OUTBOUND=false`. Provider nyata hanya jalan jika flag diubah **dan** ada approval manusia. |
| **Tidak ada kunci asli di kode** | Semua kredensial dibaca dari `.env`. `.env` masuk `.gitignore`. Tes memakai kunci dev turunan dengan peringatan di console. |
| **Tidak ada placeholder** | Setiap agent punya implementasi nyata. Tidak ada `// TODO`, tidak ada fungsi kosong. |
| **Keselamatan pasien di atas otomasi** | Triage adalah *decision support*. Panggilan otomatis hanya berisi ajakan datang/hubungi nomor darurat, **tidak pernah diagnosis lengkap**. |
| **Auditabel** | Setiap akses data tercatat di `audit_logs` (siapa, kapan, target, IP). Setiap aksi agent tercatat di `agent_logs`. |
| **Jujur soal batasan** | Sistem ini **belum** tersertifikasi sebagai alat medis dan **belum** siap dipakai klinis sebelum validasi klinis + review legal UU PDP No. 27/2022. |

---

## 2. Peta agent

| # | Agent | File | Tanggung jawab utama |
|---|---|---|---|
| 1 | RME Analyzer | `agents/analyzer.ts` | Validasi RME, skor 0–100, MERAH jika < 70 |
| 2 | Orchestrator | `agents/orchestrator.ts` | Jadwal 07:00/12:00/18:00/22:00 + cek MERAH tiap 5 menit + retry 3x |
| 3 | Bug Hunter | `agents/bugHunter.ts` | Scan P0–P3, hasilkan file perbaikan nyata di `/fixes/` |
| 4 | Auto Reporter | `agents/reporter.ts` | Laporan 07:30, PDF + Excel, grafik 7 hari, email pimpinan |
| 5 | Urgent Triage + Caller | `agents/urgentCaller.ts` | **Prioritas utama**. Deteksi MERAH, WA, telepon, eskalasi |
| 6 | Security Guard | `agents/securityGuard.ts` | AES-256, RBAC, masking NIK, audit log |
| 7 | Patient Engagement | `agents/engagement.ts` | Pengingat obat/kontrol, chatbot, prediksi no-show |

Pendukung: `lib/triageRules.ts`, `lib/whatsapp.ts`, `lib/phone.ts`, `lib/crypto.ts`, `lib/prisma.ts`, `lib/auth.ts`, `lib/rbac.ts`.

---

## 3. Urutan kerja

### Langkah 0 — PLAN.md
- [x] Tulis rencana, prinsip keamanan, peta agent, dan Definition of Done.

### Langkah 1 — Struktur project + Prisma + Auth + seed
- [x] Next.js 14 App Router + TypeScript + Tailwind + pola shadcn/ui (`components/ui/button.tsx`).
- [x] `prisma/schema.prisma` (SQLite default) + skrip `prisma:generate:pg` untuk PostgreSQL via `DATABASE_PROVIDER`.
- [x] 18 model: patients, doctors, visits, medical_records, lab_results, prescriptions, triage_logs, urgent_calls, agent_logs, audit_logs, reports, notifications, appointments + User, WaitingList, MedicineStock, Claim.
- [x] NextAuth Credentials + JWT, role di session, `proxy.ts` proteksi route.
- [x] Enkripsi AES-256-GCM + HMAC hash NIK + masking `35****7890`.
- [x] Seed 20 pasien Indonesia: 3 MERAH (190/120, gula 320, saturasi 88%), 5 KUNING, 12 HIJAU. NIK diawali `35`.
- [x] `.env.example` tanpa kunci asli.

### Langkah 2 — Agent 5 + triageRules + tes (PRIORITAS)
- [x] `lib/triageRules.ts` — semua ambang MERAH/KUNING/HIJAU + alasan berbahasa Indonesia.
- [x] `tests/triage.test.ts` — 10 tes sesuai DoD.
- [x] `agents/urgentCaller.ts` — workflow 0 detik / 5 detik / 10 detik / 2 menit / 5 menit / 15 menit.
- [x] `lib/whatsapp.ts` (fonnte, wablas, mock) dan `lib/phone.ts` (twilio, mock) dengan *outbound guard*.
- [x] Template WhatsApp tanpa diagnosis lengkap.
- [x] Endpoint + tombol "Simulasi Panggilan Urgent" menyimpan ke `urgent_calls`.

### Langkah 3 — Dashboard + Triage
- [x] `app/dashboard` dengan status MERAH/KUNING/HIJAU dan Manual Run (ADMIN).
- [x] `app/triage` dengan input TD 190/120 → MERAH < 5 detik (validasi Zod + evaluate synchronous).
- [x] Halaman login DOKTER vs RESEPSIONIS (DOKTER lihat diagnosa, RESEPSIONIS tidak).

### Langkah 4 — Agent 1, 4, 6, 7, 2, 3
- [x] Analyzer (13 field wajib + skor + critical error alergi Penicillin/Amoxicillin & kehamilan kategori X).
- [x] Reporter (PDF, Excel, grafik 7 hari, email mock).
- [x] Security Guard (RBAC penuh + audit 1 tahun + masking).
- [x] Engagement (obat 08:00/20:00, H-3/H-1, chatbot, batal → waiting list, no-show risk).
- [x] Orchestrator (cron in-process via node-cron + retry 3x + agent_logs).
- [x] Bug Hunter (scan + 4 file perbaikan nyata + 3 tes di `/fixes/`).

### Langkah 5 — Test end-to-end + README
- [x] `npm install && npm run build` bersih di Windows PowerShell.
- [x] `npm test` 10/10 triage (total 13 tes dengan fix tests).
- [x] `npm audit` 0 vulnerability (produksi & dev).
- [x] Verifikasi end-to-end HTTP (`scripts/e2e-check.mjs`) — semua check lolos.
- [x] README final.

---

## 4. Definition of Done (dari permintaan)

| Kriteria | Status | Catatan |
|---|---|---|
| `npm install && npm run dev` jalan tanpa error di PowerShell | ✅ | Build produksi juga bersih; 0 warning |
| Login DOKTER bisa lihat diagnosa, RESEPSIONIS tidak | ✅ | Diverifikasi via HTTP e2e |
| Input TD 190/120 langsung MERAH < 5 detik | ✅ | 82–757 ms pada e2e |
| Klik Simulasi Panggilan Urgent masuk ke log | ✅ | 4 baris `urgent_calls` per simulasi |
| Laporan download PDF & Excel | ✅ | PDF `%PDF-1.3`, Excel `.xlsx` |
| `npm test` lolos 10/10 triage | ✅ | 10/10 triage + 3 fix tests = 13/13 |
| Tidak ada API key asli di kode | ✅ | Hanya placeholder di `.env.example` |

**Catatan keputusan:** spesifikasi awal meminta Next.js 14, tetapi audit keamanan 2026
menandai semua versi ≤ 16.3.0-preview sebagai kritis. Atas persetujuan Anda, repo
menggunakan **Next.js 16.4.6 + React 19** agar `npm audit` = 0 vulnerability.

---

## 5. Batasan yang harus dibaca sebelum produksi

1. **Bukan alat medis tersertifikasi.** Ambang triage di sini berasal dari spesifikasi Anda, bukan dari pedoman klinis resmi Kemenkes. Validasi oleh dokter/perawat wajib sebelum dipakai.
2. **Panggilan nyata butuh approval.** `ALLOW_REAL_OUTBOUND=false` dan `REQUIRE_HUMAN_APPROVAL=true` harus tetap aktif sampai ada SOP tertulis.
3. **UU PDP No. 27/2022.** Data pasien adalah data pribadi sensitif. Perlu: consent,(retensi/audit 1 tahun), enkripsi kunci terkelola (KMS/HSM), dan DPA dengan provider WhatsApp/telepon.
4. **PostgreSQL produksi.** Mode SQLite hanya untuk testing Windows. Untuk produksi jalankan `npm run db:setup:pg` setelah `DATABASE_URL` PostgreSQL diset.
5. **Cron dalam proses.** Scheduler node-cron tetap tersedia untuk single-instance; untuk multi-instance pakai `QUEUE_MODE=redis` + `npm run queue:worker`.

---

## 6. Hardening produksi (tambahan)

- [x] `lib/queue.ts` + `scripts/queue-worker.ts`: BullMQ/Redis, retry 3x, backoff eksponensial, dedup `jobId`, shutdown rapi. Default `QUEUE_MODE=sync` tanpa Redis.
- [x] API `orchestrator.run` dan `urgent.followup`: mode redis mengembalikan HTTP 202 + `jobId`, mode sync tetap menjalankan langsung agar DoD tidak berubah.
- [x] `docker-compose.yml`: PostgreSQL 16 + Redis 7 dengan healthcheck dan volume persisten.
- [x] `lib/audit.ts`: audit nyata di endpoint pasien, triage, simulasi urgent, laporan, dan agent run (aktor + IP + target).
- [x] `.github/workflows/ci.yml`: verifikasi Windows (npm ci, db setup, typecheck, test, build, audit) + verifikasi PostgreSQL/Redis/E2E di Ubuntu.
- [x] `tests/hardening.test.ts`: RBAC, outbound guard, template tanpa diagnosis, enkripsi/masking, IP audit, dan opsi antrean.

Batasan yang tetap berlaku: validasi klinis, review UU PDP, DPA provider, dan pengiriman nyata
masih memerlukan keputusan manusia. Worker Redis tidak menyala bila `QUEUE_MODE` tidak `redis`.

---

## 7. Hak kekayaan intelektual

- [x] `LICENSE`: lisensi proprietary, all rights reserved, tanpa lisensi paten tersirat.
- [x] `PATENT.md`: status jujur (belum diajukan), draft invensi, draf klaim teknis,
      checklist DGIP/PCT, dan alternatif rahasia dagang.
- [x] README bagian 8 merangkum status IP dan larangan memakai label paten palsu.

Yang **tidak** bisa diselesaikan oleh kode: pengajuan paten, pemeriksaan novelty,
penandatanganan NDA/kontrak, dan penegakan hukum. Semua itu memerlukan pemilik hak
dan konsultan paten.
