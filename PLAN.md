# PLAN — MEDI-BOT AGENCY v3

## 1. Prinsip

- Keamanan lebih penting daripada kenyamanan: default mock, outbound nyata mati.
- Satu file per agent di `agents/`, log berbahasa Indonesia, variabel berbahasa Inggris.
- Tidak ada `// TODO`, placeholder fungsional, atau kunci API di repository.
- Semua akses patient/diagnosis melewati RBAC dan audit.
- Mode SQLite + `SYNC_MODE=true` untuk Windows; PostgreSQL + Redis untuk produksi.

## 2. Peta agent

| Agent                       | File                      | Fungsi utama                                          |
| --------------------------- | ------------------------- | ----------------------------------------------------- |
| RME Analyzer                | `agents/analyzer.ts`      | 13 field wajib, skor kelengkapan, kontraindikasi      |
| Orchestrator                | `agents/orchestrator.ts`  | cron WIB, cek MERAH 5 menit, retry 3x, agent logs     |
| Bug Hunter                  | `agents/bugHunter.ts`     | scan P0–P3, artefak read-only di `fixes/`             |
| Auto Reporter               | `agents/reporter.ts`      | PDF, Excel + grafik 7 hari, email mock/approval       |
| Urgent Triage + Auto Caller | `agents/urgentCaller.ts`  | 0/5/10 detik, 2/5/15 menit, WA/telepon/eskalasi       |
| Security Guard              | `agents/securityGuard.ts` | enkripsi, masking, RBAC, audit bertanda tangan        |
| Patient Engagement          | `agents/engagement.ts`    | obat, kontrol H-3/H-1, chatbot, waiting list, no-show |

## 3. Urutan kerja

### Langkah 0 — PLAN.md

- [x] Rencana, prinsip keamanan, peta agent, dan Definition of Done.

### Langkah 1 — Struktur project + Prisma + Auth + seed

- [x] Next.js 16.4.6 App Router + TypeScript + Tailwind + pola shadcn/ui.
- [x] `prisma/schema.prisma` dengan **17 model** (SQLite default) + generator PostgreSQL.
- [x] NextAuth Credentials + JWT, revalidasi database tiap request, `proxy.ts` proteksi route.
- [x] Enkripsi AES-256-GCM + HMAC hash NIK + masking `35****xxxx`.
- [x] Seed 20 pasien Indonesia: 3 MERAH (190/120, gula 320, saturasi 88%), 5 KUNING, 12 HIJAU. NIK diawali `35`.
- [x] `.env.example` tanpa kunci asli; seed produksi diblokir tanpa `ALLOW_SEED=true`.

### Langkah 2 — Agent 5 + triageRules + tes (PRIORITAS)

- [x] `lib/triageRules.ts` — semua ambang MERAH/KUNING/HIJAU + alasan berbahasa Indonesia.
- [x] `tests/triage.test.ts` — 10 tes sesuai DoD.
- [x] `agents/urgentCaller.ts` — workflow 0/5/10 detik, 2/5/15 menit.
- [x] `lib/whatsapp.ts` (fonnte, wablas, mock) dan `lib/phone.ts` (twilio, mock) dengan outbound guard.
- [x] Template WhatsApp tanpa diagnosis lengkap atau angka vital.
- [x] Endpoint + tombol "Simulasi Panggilan Urgent" menyimpan ke `urgent_calls`.

### Langkah 3 — Dashboard + Triage

- [x] Dashboard menghitung pasien unik per level MERAH/KUNING/HIJAU.
- [x] Triage 190/120 → MERAH < 5 detik (validasi Zod + evaluasi sinkron).
- [x] DOKTER melihat teks diagnosis nyata; RESEPSIONIS tidak (dashboard + `/api/patients/[id]/record`).

### Langkah 4 — Agent 1, 4, 6, 7, 2, 3

- [x] Analyzer (13 field wajib + skor + kontraindikasi alergi/kehamilan).
- [x] Reporter (PDF, Excel + grafik batang 7 hari, email dengan approval).
- [x] Security Guard (RBAC penuh, audit 1 tahun, masking, tanda tangan HMAC).
- [x] Engagement (obat 08:00/20:00, H-3/H-1, chatbot, waiting list, no-show, dispatcher notifikasi).
- [x] Orchestrator (cron env-driven `CRON_ALL_AGENTS`/`CRON_RED_CHECK`, retry 3x).
- [x] Bug Hunter (scan P0–P3; tidak menimpa sumber di `/fixes`).

### Langkah 5 — Test end-to-end + README

- [x] `npm install && npm run build` bersih di Windows PowerShell.
- [x] `npm test` 28/28 (10 triage + 3 helper + 15 hardening).
- [x] `npm audit --audit-level=high` = 0 vulnerability.
- [x] E2E HTTP dari kondisi bersih: generate laporan dulu, lalu download PDF/Excel.
- [x] E2E memastikan semua 6 outcome Manual Run `SUCCESS`.
- [x] README final.

---

## 4. Definition of Done (dari permintaan)

| Kriteria                                                     | Status | Catatan                                           |
| ------------------------------------------------------------ | ------ | ------------------------------------------------- |
| `npm install && npm run dev` jalan tanpa error di PowerShell | ✅     | Build produksi juga bersih                        |
| Login DOKTER bisa lihat diagnosis, RESEPSIONIS tidak         | ✅     | Teks diagnosis nyata diverifikasi via E2E         |
| Input TD 190/120 langsung MERAH < 5 detik                    | ✅     | Diukur dalam E2E                                  |
| Klik Simulasi Panggilan Urgent masuk ke log                  | ✅     | 4 baris `urgent_calls` per simulasi               |
| Laporan download PDF & Excel                                 | ✅     | Laporan dibuat otomatis oleh E2E sebelum download |
| `npm test` lolos 10/10 triage                                | ✅     | Total 28/28 dengan hardening                      |
| Tidak ada API key asli di kode                               | ✅     | Hanya placeholder di `.env.example`               |

**Catatan keputusan:** spesifikasi awal meminta Next.js 14, tetapi audit keamanan 2026
menandai versi lama sebagai kritis. Atas persetujuan Anda, repo memakai **Next.js 16.4.6 + React 19**
agar `npm audit` = 0 vulnerability.

---

## 5. Batasan yang harus dibaca sebelum produksi

1. **Bukan alat medis tersertifikasi.** Ambang triage berasal dari spesifikasi internal, bukan pedoman klinis resmi Kemenkes. Validasi tenaga klinis wajib.
2. **Panggilan nyata butuh approval.** `ALLOW_REAL_OUTBOUND=false` dan `REQUIRE_HUMAN_APPROVAL=true` harus tetap aktif sampai ada SOP tertulis. Di produksi approval tidak bisa dimatikan lewat env.
3. **UU PDP No. 27/2022.** Data pasien sensitif. Perlu consent, retensi/audit 1 tahun, KMS/HSM, dan DPA provider.
4. **PostgreSQL produksi.** SQLite hanya untuk testing Windows. Gunakan `npm run db:setup:pg` dengan `DATABASE_URL` PostgreSQL.
5. **Redis produksi.** `REDIS_URL` wajib berpassword; host publik wajib TLS. Docker compose mengikat port ke loopback.
6. **Cron dalam proses.** Scheduler node-cron untuk single-instance; multi-instance memakai `QUEUE_MODE=redis` + worker.

---

## 6. Audit lanjutan dan perbaikannya

- [x] Validasi environment produksi: placeholder secret, `SYNC_MODE=true`, kunci DEV, seed publik, dan approval yang dimatikan ditolak.
- [x] RBAC fail-closed (`TIDAK_AKTIF`) dan izin baru `outbound:approve`.
- [x] Approval nyata: endpoint `/api/urgent/approve`, UI panel approval, audit + HMAC, TTL 30 menit, verifikasi ulang di urgent caller, worker, dan email laporan.
- [x] Login: rate limit per IP+email, dummy bcrypt, audit kegagalan tanpa kata sandi.
- [x] Sesi: `tokenVersion`/status/role direvalidasi terhadap DB di callback JWT.
- [x] Urgent simulate: ID pasien/visit/triage-log harus mengarah ke pasien yang sama; fallback "MERAH terbaru" dihapus.
- [x] Audit: actor anonim/system, method/path/user agent/role, IP proxy tepercaya, tanda tangan integritas.
- [x] Antrean: payload HMAC + Zod, `jobId` deterministik memuat actor/approval/simulate, delay nyata 0/5/10/120/300/900 detik di mode redis.
- [x] Laporan: containment path `reports/`, tidak ada path absolut ke klien, metrik nyata dari `/api/reports/generate`, grafik Excel dan UI.
- [x] Bug Hunter: tidak memindai rule literal dirinya sendiri, artefak `/fixes` read-only.
- [x] Fitur tambahan: `/api/me`, `/api/chatbot`, dispatcher notifikasi, dashboard RBAC + pasien unik.
- [x] CI: `permissions: contents: read`, secrets throwaway yang kuat, job worker BullMQ dengan 202 + `jobId`, E2E dari seed bersih.
- [x] Dokumen diselaraskan: 28 tes, 17 model, Next.js 16.4.6, cron env-driven, `DATABASE_PROVIDER` dihapus.

---

## 7. Hak kekayaan intelektual

- [x] `LICENSE` v3.1: proprietary komersial, All Rights Reserved, Pemilik = `riyanda-ex`,
      tanpa lisensi default, evaluasi tertulis revokabel, larangan reverse engineering/publicity,
      rahasia dagang, ganti rugi, disclaimer medis, dan yurisdiksi Indonesia.
- [x] `PATENT.md`: status jujur (belum diajukan), draft invensi, draf klaim teknis,
      checklist DGIP/PCT, dan alternatif rahasia dagang.
- [x] README bagian 8 merangkum status IP dan larangan label paten palsu.

Yang **tidak** bisa diselesaikan oleh kode: pengajuan paten, pemeriksaan novelty,
penandatanganan NDA/kontrak, dan penegakan hukum. Semua itu memerlukan pemilik hak
dan konsultan paten.
