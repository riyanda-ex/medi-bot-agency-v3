# MEDI-BOT AGENCY v3

Sistem multi-agent untuk rekam medis klinik Indonesia. Fondasi dibangun aman secara default:
semua provider WhatsApp/telepon memakai `mock`, tidak ada kunci API asli di repository, dan
pengiriman nyata memerlukan flag **`ALLOW_REAL_OUTBOUND=true`** plus approval manusia.

> **Penafian penting:** ini adalah sistem pendukung keputusan, **bukan alat medis tersertifikasi**.
> Ambang triage berasal dari spesifikasi internal dan harus divalidasi oleh tenaga klinis sebelum
> dipakai untuk pasien nyata. Lihat `PLAN.md` bagian batasan.

---

## 1. Persyaratan

- Windows PowerShell (diuji), Node.js 22+, npm 11+
- Next.js 16.4.6 + React 19 + TypeScript + Tailwind + Prisma
- Tidak perlu Docker untuk mode testing (SQLite)
- PostgreSQL + Redis hanya diperlukan untuk deployment produksi

## 2. Quickstart (Windows PowerShell)

```powershell
cd C:\Users\Last Order\medi-bot-agency-v3
Copy-Item .env.example .env
npm install
npm run db:setup
npm test
npm run dev
```

Buka `http://localhost:3000`, lalu masuk dengan akun uji:

| Peran | Email | Kata sandi | Dapat melihat diagnosis? |
|---|---|---|---|
| DOKTER | `dokter@klinik.example` | `password123` | Ya |
| PERAWAT | `perawat@klinik.example` | `password123` | Triage saja |
| RESEPSIONIS | `resepsionis@klinik.example` | `password123` | **Tidak** |
| ADMIN | `admin@klinik.example` | `password123` | Ya |
| PASIEN | `pasien@klinik.example` | `password123` | Data sendiri |

Ganti kata sandi seed sebelum penggunaan nyata.

## 3. Skrip

| Perintah | Fungsi |
|---|---|
| `npm run dev` | Jalankan Next.js 14 |
| `npm test` | 10 tes triage (Vitest) |
| `npm run typecheck` | Cek TypeScript |
| `npm run db:push` | Sinkronkan schema SQLite |
| `npm run db:seed` | Isi 20 pasien dummy |
| `npm run db:studio` | Prisma Studio |
| `npm run prisma:generate:pg` | Hasilkan schema + client PostgreSQL |
| `npm run verify:agents` | Jalankan ketujuh agent sekali untuk smoke test |
| `npm run e2e` | Cek HTTP end-to-end (server harus berjalan di :3000) |

## 4. Struktur

```
app/                 UI Next.js (dashboard, triage, reports, audit, login)
agents/              Tujuh agent sesuai spesifikasi
lib/                 triageRules, whatsapp, phone, crypto, auth, rbac, prisma, agentLog
prisma/              schema.prisma + seed.ts
tests/               triage.test.ts
components/ui/       Komponen shadcn/ui
scripts/             Generator schema PostgreSQL
PLAN.md              Rencana kerja & status
TESTING.md           Protokol pengujian
```

## 5. Provider yang bisa diganti lewat `.env`

| Variabel | Nilai |
|---|---|
| `WHATSAPP_PROVIDER` | `mock` (default), `fonnte`, `wablas` |
| `PHONE_PROVIDER` | `mock` (default), `twilio` |
| `ALLOW_REAL_OUTBOUND` | `false` (default) / `true` |
| `REQUIRE_HUMAN_APPROVAL` | `true` (default) |

Tidak ada API key di kode. Semua kredensial dibaca dari `.env`, dan `.env` tidak masuk Git.

## 6. Status implementasi

Lihat `PLAN.md`. Langkah 0–5 selesai dan terverifikasi: `npm test` 13/13 (10 triage),
`npm run build` bersih, `npm audit` 0 vulnerability, dan `npm run e2e` lolos semua check.

Keputusan keamanan: Next.js 14 diganti ke 16.4.6 karena advisory kritis pada semua
versi lama. Perubahan ini disetujui dan terdokumentasi di `PLAN.md`.

## 7. Kepatuhan data

Data pasien (NIK, nomor HP, diagnosa) dienkripsi AES-256-GCM. NIK juga disimpan sebagai HMAC
untuk deteksi duplikat tanpa menyimpan plaintext. Audit log mencatat aktor, waktu, target, dan IP.
Sebelum produksi: tinjau consent, retensi 1 tahun, enkripsi kunci terkelola, dan DPA provider
sesuai UU PDP No. 27/2022.
