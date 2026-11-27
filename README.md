# MEDI-BOT AGENCY v3

Sistem multi-agent untuk rekam medis klinik Indonesia. Fondasi dibangun aman secara default:
semua provider WhatsApp/telepon/email memakai `mock`, tidak ada kunci API asli di repository,
pengiriman nyata memerlukan `ALLOW_REAL_OUTBOUND=true` **dan** approval manusia.

> **Penafian penting:** ini adalah sistem pendukung keputusan, **bukan alat medis tersertifikasi**.
> Ambang triage berasal dari spesifikasi internal dan harus divalidasi oleh tenaga klinis sebelum
> dipakai untuk pasien nyata. Lihat `PLAN.md` bagian batasan.

---

## 1. Persyaratan

- Windows PowerShell (diuji), Node.js 22+, npm 11+
- Next.js 16.4.6 + React 19 + TypeScript + Tailwind + Prisma
- Tidak perlu Docker untuk mode testing (SQLite + `SYNC_MODE=true`)
- PostgreSQL + Redis opsional untuk produksi: `docker compose up -d`
- Worker BullMQ dijalankan terpisah dari server Next.js bila `QUEUE_MODE=redis`

## 2. Quickstart (Windows PowerShell)

```powershell
cd C:\Users\Last Order\medi-bot-agency-v3
Copy-Item .env.example .env
npm install
npm run db:setup
npm test
npm run dev
```

Buka `http://localhost:3000`, lalu masuk dengan akun uji lokal:

| Peran | Email | Kata sandi | Dapat melihat diagnosis? |
|---|---|---|---|
| DOKTER | `dokter@klinik.example` | `password123` | Ya |
| PERAWAT | `perawat@klinik.example` | `password123` | Triage saja |
| RESEPSIONIS | `resepsionis@klinik.example` | `password123` | **Tidak** |
| ADMIN | `admin@klinik.example` | `password123` | Ya |
| PASIEN | `pasien@klinik.example` | `password123` | Data sendiri |

Kredensial ini **hanya untuk pengembangan**. Form login tidak mengisi otomatis, dan seed di
produksi ditolak kecuali `ALLOW_SEED=true` dengan `SEED_PASSWORD` acak minimal 32 byte.

## 3. Skrip

| Perintah | Fungsi |
|---|---|
| `npm run dev` | Jalankan Next.js 16 (mode development) |
| `npm test` | 28 tes: 10 triage, 3 helper Bug Hunter, 15 hardening |
| `npm run typecheck` | Cek TypeScript |
| `npm run db:push` | Sinkronkan schema SQLite |
| `npm run db:seed` | Isi 20 pasien dummy (ditolak di produksi tanpa `ALLOW_SEED=true`) |
| `npm run db:studio` | Prisma Studio |
| `npm run prisma:generate:pg` | Hasilkan schema + client PostgreSQL dari `schema.prisma` |
| `npm run db:setup:pg` | Push + seed PostgreSQL (set `DATABASE_URL` dulu) |
| `npm run queue:worker` | Jalankan worker BullMQ (butuh `QUEUE_MODE=redis`) |
| `npm run verify:agents` | Smoke test 6 agent + database (Orchestrator tidak dijalankan sebagai worker di skrip ini) |
| `npm run e2e` | Cek HTTP end-to-end (server harus berjalan di :3000) |
| `npm run queue:check` | Cek producer 202 + `jobId` saat `QUEUE_MODE=redis` |

## 4. Struktur

```
app/                 UI + API Next.js (dashboard, triage, reports, audit, login,
                     /api/me, /api/chatbot, /api/urgent/approve)
agents/              Tujuh agent sesuai spesifikasi, satu file per agent
lib/                 env, auth, rbac, audit, approval, crypto, rateLimit, queue,
                     triageRules, whatsapp, phone, prisma, agentLog, reportFiles
prisma/              schema.prisma (17 model) + seed.ts
tests/               triage.test.ts + hardening.test.ts
fixes/               Artefak scan Bug Hunter (read-only) + tes helper
components/ui/       Komponen shadcn/ui
scripts/             Generator schema PostgreSQL, E2E, queue check, worker antrean
.github/workflows/   CI Windows + PostgreSQL/Redis/E2E + worker BullMQ
docker-compose.yml   PostgreSQL + Redis untuk produksi (loopback + password)
PLAN.md              Rencana kerja & status
TESTING.md           Protokol pengujian
```

## 5. Provider dan pengaman yang bisa diganti lewat `.env`

| Variabel | Nilai |
|---|---|
| `WHATSAPP_PROVIDER` | `mock` (default), `fonnte`, `wablas` |
| `PHONE_PROVIDER` | `mock` (default), `twilio` |
| `ALLOW_REAL_OUTBOUND` | `false` (default) / `true` |
| `REQUIRE_HUMAN_APPROVAL` | `true` (default; dipaksa di produksi) |
| `QUEUE_MODE` | `sync` (default) / `redis` |
| `REDIS_URL` | `redis://:password@localhost:6379` saat `QUEUE_MODE=redis` |
| `TRUST_PROXY` | Daftar IP proxy tepercaya untuk `X-Forwarded-For` (kosong = diabaikan) |
| `CRON_ALL_AGENTS`, `CRON_RED_CHECK` | Jadwal node-cron saat `ENABLE_SCHEDULER=true` |

Keamanan runtime yang aktif:

- `NEXTAUTH_SECRET` dan `FIELD_ENCRYPTION_KEY` placeholder ditolak saat produksi.
- `SYNC_MODE=true`, kunci DEV, seed publik, dan `REQUIRE_HUMAN_APPROVAL=false` ditolak saat produksi.
- Login dibatasi per IP+email, kegagalan login diaudit tanpa kata sandi, sesi JWT direvalidasi
  terhadap database setiap permintaan.
- Endpoint API sensitif dilindungi rate limit, cek Origin same-origin untuk mutasi, dan
  security headers/CSP; respons API disetel `no-store`.
- Audit log memiliki peran, method, path, user agent, IP, dan tanda tangan HMAC.
- Job BullMQ ditandatangani HMAC, divalidasi Zod di worker, dan `jobId`-nya deterministik.
- Path file laporan dibatasi hanya di dalam folder `reports/`.
- Approval nyata hanya DOKTER/ADMIN, berlaku 30 menit, dan diverifikasi ulang di worker/email.

Tidak ada API key di kode. Semua kredensial dibaca dari `.env`, dan `.env` tidak masuk Git.

### Produksi (opsional)

```powershell
docker compose up -d
# Isi POSTGRES_PASSWORD dan REDIS_PASSWORD di .env dengan nilai acak.
# Set DATABASE_URL PostgreSQL, QUEUE_MODE=redis, REDIS_URL dengan password,
# NEXTAUTH_SECRET dan FIELD_ENCRYPTION_KEY dengan kunci acak >= 32 byte.
npm run db:setup:pg
npm run build
npm run queue:worker
npm run start
```

Mode `sync` menjalankan agent langsung di request API. Mode `redis` mengembalikan HTTP 202
bersama `jobId`, lalu worker menjalankan `orchestrator.run` / `urgent.followup` dengan retry 3x
(backoff eksponensial). Delay nyata `0/5/10/120/300/900` detik dipakai di mode redis; mode sync
memakai fast-forward agar DoD tetap < 5 detik.

## 6. Status implementasi

Langkah 0–5, hardening, dan audit lanjutan selesai. Verifikasi terakhir: `npm test` 28/28,
`npm run typecheck` bersih, `npm run build` bersih, `npm audit --audit-level=high` 0 vulnerability,
dan `npm run e2e` lolos semua check dari database yang sudah di-seed.

Hardening lanjutan mencakup: validasi environment produksi, approval manusia nyata + UI,
RBAC fail-closed, brute-force protection, audit bertanda tangan, job antrean bertanda tangan,
containment file laporan, grafik Excel nyata, dispatcher notifikasi, endpoint `/api/me` dan
chatbot, serta CI worker BullMQ.

Keputusan keamanan: Next.js 14 diganti ke 16.4.6 karena advisory kritis pada versi lama.
Perubahan ini disetujui dan terdokumentasi di `PLAN.md`.

## 7. Kepatuhan data

Data pasien (NIK, nomor HP, diagnosa) dienkripsi AES-256-GCM. NIK juga disimpan sebagai HMAC
untuk deteksi duplikat tanpa menyimpan plaintext. Audit log mencatat aktor, peran, waktu, target,
method, path, IP, user agent, dan tanda tangan integritas. `agent_logs` hanya berisi ringkasan
tanpa angka vital atau teks diagnosis. Sebelum produksi: tinjau consent, retensi 1 tahun,
enkripsi kunci terkelola, dan DPA provider sesuai UU PDP No. 27/2022.

## 8. Hak kekayaan intelektual

- `LICENSE` — **Proprietary commercial license v3.1 (All Rights Reserved)**. Pemilik:
  `riyanda-ex`. Tidak ada lisensi default untuk pihak lain; akses repo tidak berarti izin
  pakai/modifikasi/distribusi. Lisensi evaluasi hanya lewat izin tertulis, revokabel, dan
  non-komersial. Tidak ada lisensi paten.
- `PATENT.md` — status paten, draft invensi, draf klaim, dan checklist pengajuan DGIP.

**Paten belum diajukan/diberikan.** Jangan memakai label “PATENT PENDING” atau
“PATEN TERDAFTAR” sebelum ada bukti resmi dari otoritas paten. Konsultasikan draft klaim dengan
konsultan paten sebelum pengajuan. Dokumen ini bukan nasihat hukum.
