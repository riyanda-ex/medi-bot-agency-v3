# MEDI-BOT AGENCY v3

[English](README.md) | **Bahasa Indonesia**

> Fondasi operasional klinik multi-agent untuk klinik Indonesia — aman secara default, mock secara default, dapat diaudit secara desain.

[![CI](https://github.com/riyanda-ex/medi-bot-agency-v3/actions/workflows/ci.yml/badge.svg)](https://github.com/riyanda-ex/medi-bot-agency-v3/actions/workflows/ci.yml)
![Node](https://img.shields.io/badge/node-22%2B-339933?logo=node.js&logoColor=white)
![Next.js](https://img.shields.io/badge/Next.js-16.4.6-black?logo=next.js)
![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178C6?logo=typescript&logoColor=white)
![License](https://img.shields.io/badge/license-Proprietary-red)

MEDI-BOT AGENCY v3 adalah sistem Next.js App Router yang mengorkestrasi tujuh agent khusus untuk triase klinis, analisis rekam medis, pelaporan, audit keamanan, dan keterlibatan pasien. Sistem ini dibuat **aman untuk pengembangan lokal terlebih dahulu** dan memiliki kontrol hardening produksi.

> **Peringatan medis penting:** Perangkat lunak ini adalah prototipe pendukung keputusan, **bukan alat medis tersertifikasi**. Ambang triase adalah aturan internal dan harus divalidasi secara klinis sebelum digunakan pada pasien nyata.

## Daftar Isi

- [Fitur Utama](#fitur-utama)
- [Postur Keamanan](#postur-keamanan)
- [Teknologi](#teknologi)
- [Mulai Cepat](#mulai-cepat)
- [Perintah yang Tersedia](#perintah-yang-tersedia)
- [Struktur Proyek](#struktur-proyek)
- [Konfigurasi](#konfigurasi)
- [Deployment Produksi](#deployment-produksi)
- [Dokumentasi](#dokumentasi)
- [Kontribusi & Keamanan](#kontribusi--keamanan)
- [Lisensi & HKI](#lisensi--hki)

## Fitur Utama

- **7 agent**: RME Analyzer, Orchestrator, Bug Hunter, Auto Reporter, Urgent Triage + Auto Caller, Security Guard, Patient Engagement.
- **Akses berbasis peran**: DOKTER, PERAWAT, RESEPSIONIS, ADMIN, PASIEN dengan RBAC fail-closed.
- **Alur triase urgent**: evaluasi MERAH/KUNING/HIJAU berbasis aturan dengan audit log dan simulasi tindak lanjut.
- **Gerbang approval manusia**: aksi outbound nyata memerlukan approval DOKTER/ADMIN (HMAC-signed, TTL 30 menit).
- **Auditabilitas**: catatan audit bertanda tangan untuk akses API, penolakan, approval, dan aksi penting.
- **Pelaporan**: laporan harian PDF/Excel dengan pembatasan download di folder `reports/`.
- **Default aman**: provider WhatsApp/telepon/email mock, tidak ada kunci asli di repo, outbound dimatikan secara default.

## Postur Keamanan

Kontrol yang sudah diimplementasikan:

- NextAuth credentials + JWT, revalidasi sesi ke DB, blokir sesi invalid.
- RBAC fail-closed dan redaksi data sesuai peran (diagnosis disembunyikan dari role tidak berwenang).
- Enkripsi AES-256-GCM untuk field sensitif; hashing/masking NIK.
- Audit log bertanda tangan dengan konteks aktor/peran/metode/path/IP/user-agent.
- Rate limiting, cek same-origin untuk API mutasi, `Cache-Control: no-store` pada respons API.
- Security headers/CSP via `next.config.mjs` dan header proxy untuk route terlindungi.
- Job queue HMAC-signed/Zod-validated; cek keamanan Redis produksi (password/TLS host publik).
- Guard env produksi menolak secret placeholder/DEV/CI, `SYNC_MODE=true`, dan approval manusia dimatikan.

> Tidak ada sistem yang bisa dijamin “tidak bisa diretas”. Sebelum deployment klinis nyata, selesaikan [Checklist Produksi](docs/PRODUCTION-CHECKLIST.md), penetration test eksternal, dan review legal/kepatuhan.

## Teknologi

| Area       | Teknologi                                                            |
| ---------- | -------------------------------------------------------------------- |
| Framework  | Next.js 16.4.6 (App Router), React 19                                |
| Bahasa     | TypeScript (strict)                                                  |
| Styling/UI | Tailwind CSS, pola shadcn/ui, Radix primitives                       |
| Data       | Prisma, SQLite (default dev), PostgreSQL (produksi)                  |
| Auth       | NextAuth Credentials/JWT                                             |
| Queue      | Sync default; BullMQ + Redis opsional                                |
| Testing    | Vitest, skrip E2E, skrip cek queue                                   |
| CI         | GitHub Actions (Windows verify, PostgreSQL/Redis E2E, BullMQ worker) |

## Mulai Cepat

### Prasyarat

- Windows PowerShell (diuji), Node.js 22+, npm 11+
- Docker **tidak wajib** untuk dev lokal (SQLite + `SYNC_MODE=true`)

### Instalasi & Jalankan

```powershell
Copy-Item .env.example .env
npm install
npm run db:setup
npm test
npm run dev
```

Buka `http://localhost:3000`.

### Akun Pengembangan Lokal

> Hanya untuk pengembangan lokal. Form login tidak mengisi otomatis. Seeding produksi diblokir kecuali `ALLOW_SEED=true` dengan `SEED_PASSWORD` yang kuat.

| Peran       | Email                        | Kata sandi    | Akses Diagnosis |
| ----------- | ---------------------------- | ------------- | --------------- |
| DOKTER      | `dokter@klinik.example`      | `password123` | Ya              |
| PERAWAT     | `perawat@klinik.example`     | `password123` | Triase saja     |
| RESEPSIONIS | `resepsionis@klinik.example` | `password123` | Tidak           |
| ADMIN       | `admin@klinik.example`       | `password123` | Ya              |
| PASIEN      | `pasien@klinik.example`      | `password123` | Data sendiri    |

## Perintah yang Tersedia

| Perintah                | Deskripsi                                                  |
| ----------------------- | ---------------------------------------------------------- |
| `npm run dev`           | Jalankan server development Next.js.                       |
| `npm run build`         | Buat build produksi.                                       |
| `npm run start`         | Jalankan server produksi.                                  |
| `npm run lint`          | Jalankan ESLint.                                           |
| `npm run format:check`  | Cek format Prettier.                                       |
| `npm run typecheck`     | Cek TypeScript.                                            |
| `npm test`              | Jalankan test Vitest.                                      |
| `npm run test:coverage` | Jalankan test dengan coverage.                             |
| `npm run db:setup`      | Generate Prisma client, push schema SQLite, seed data dev. |
| `npm run db:studio`     | Buka Prisma Studio.                                        |
| `npm run db:setup:pg`   | Push + seed PostgreSQL (butuh `DATABASE_URL`).             |
| `npm run queue:worker`  | Jalankan worker BullMQ (butuh `QUEUE_MODE=redis`).         |
| `npm run verify:agents` | Smoke-test agent dan DB.                                   |
| `npm run e2e`           | Jalankan cek HTTP E2E terhadap server berjalan.            |
| `npm run queue:check`   | Verifikasi queue Redis mengembalikan 202 + `jobId`.        |

## Struktur Proyek

Lihat [`docs/STRUCTURE.md`](docs/STRUCTURE.md) untuk aturan penempatan file dan area sensitif keamanan.

```text
app/         UI + API routes Next.js App Router
agents/      7 agent domain
lib/         Shared auth/rbac/env/crypto/audit/queue/guards
components/  Komponen UI
prisma/      Schema + seed
scripts/     Worker, E2E, cek queue, sinkron schema
tests/       Tes Vitest
fixes/       Artefak/helper bug-hunter
docs/        Arsitektur, API, struktur, checklist produksi, ADR
.github/     CI, CodeQL, Dependabot, template, CODEOWNERS
```

## Konfigurasi

Salin `.env.example` ke `.env`. Variabel penting:

| Variabel                 | Default      | Tujuan                                              |
| ------------------------ | ------------ | --------------------------------------------------- |
| `WHATSAPP_PROVIDER`      | `mock`       | `mock`, `fonnte`, `wablas`                          |
| `PHONE_PROVIDER`         | `mock`       | `mock`, `twilio`                                    |
| `ALLOW_REAL_OUTBOUND`    | `false`      | Aktifkan outbound nyata hanya dengan gate approval. |
| `REQUIRE_HUMAN_APPROVAL` | `true`       | Wajib untuk outbound nyata; dipaksa di produksi.    |
| `QUEUE_MODE`             | `sync`       | `sync` atau `redis`.                                |
| `REDIS_URL`              | -            | Wajib untuk mode queue Redis.                       |
| `TRUST_PROXY`            | kosong       | IP proxy tepercaya untuk forwarded client IP.       |
| `SYNC_MODE`              | `true` (dev) | Harus `false` di produksi.                          |
| `RATE_LIMIT_MODE`        | `auto`       | `auto`, `memory`, `redis` untuk rate limiter.       |

Lihat `.env.example` untuk daftar lengkap.

## Deployment Produksi

1. Ikuti [`docs/PRODUCTION-CHECKLIST.md`](docs/PRODUCTION-CHECKLIST.md).
2. Sediakan PostgreSQL + Redis (jaringan privat, auth/TLS sesuai kebutuhan).
3. Set secret kuat dan env guard produksi.
4. Jalankan:

```powershell
docker compose up -d
npm run db:setup:pg
npm run build
npm run queue:worker
npm run start
```

`QUEUE_MODE=redis` mengembalikan HTTP 202 + `jobId` untuk pekerjaan yang diantrikan; jalankan worker sebagai proses terpisah.

## Dokumentasi

- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — desain sistem dan alur data.
- [`docs/API.md`](docs/API.md) — ringkasan endpoint API.
- [`docs/STRUCTURE.md`](docs/STRUCTURE.md) — layout repo dan aturan penempatan.
- [`docs/PRODUCTION-CHECKLIST.md`](docs/PRODUCTION-CHECKLIST.md) — checklist hardening deployment.
- [`docs/THREAT-MODEL.md`](docs/THREAT-MODEL.md) — model ancaman STRIDE.
- [`docs/PRIVACY-DATA-HANDLING.md`](docs/PRIVACY-DATA-HANDLING.md) — penanganan data/privasi.
- [`docs/INCIDENT-RESPONSE.md`](docs/INCIDENT-RESPONSE.md) — runbook respons insiden.
- [`TESTING.md`](TESTING.md) — protokol pengujian.
- [`SECURITY.md`](SECURITY.md) — pelaporan kerentanan.
- [`CHANGELOG.md`](CHANGELOG.md) — perubahan penting.

## Kontribusi & Keamanan

- Baca [`CONTRIBUTING.md`](CONTRIBUTING.md) dan [`CODE_OF_CONDUCT.md`](CODE_OF_CONDUCT.md).
- **Jangan laporkan kerentanan keamanan di issue publik.** Ikuti [`SECURITY.md`](SECURITY.md).
- Repo ini proprietary; kontribusi eksternal butuh izin tertulis owner.

## Lisensi & HKI

- [`LICENSE`](LICENSE) — Lisensi komersial proprietary v3.1 (All Rights Reserved). Pemilik: `riyanda-ex`.
- [`PATENT.md`](PATENT.md) — Status paten dan draft materi. **Belum ada paten yang diajukan/diberikan.** Jangan beri label “Patent Pending” tanpa bukti resmi.

README ini bersifat informasional, bukan nasihat hukum atau medis.
