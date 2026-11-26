# PATEN — MEDI-BOT AGENCY v3

> **Status: BELUM ADA PERMOHONAN PATEN YANG DIAJUKAN ATAU DIBERIKAN.**
>
> Jangan mencantumkan label “PATENTED”, “PATEN TERDAFTAR”, atau “PATENT PENDING”
> pada kode, UI, README, atau materi komersial sebelum ada bukti resmi pengajuan
> dari otoritas paten. Pencantuman label palsu dapat menimbulkan sanksi hukum.

Dokumen ini adalah **berkas kerja internal** untuk membantu konsultan paten/DGIP,
bukan bukti kepemilikan paten dan bukan nasihat hukum.

---

## 1. Fakta yang perlu dipahami

- **Lisensi ≠ paten.** `LICENSE` mengatur izin penggunaan kode; paten adalah hak
  eksklusif yang diberikan negara setelah permohonan diperiksa.
- **Perangkat lunak murni** sering sulit dipatenkan. Yang biasanya dapat diuji adalah
  **invensi teknis** yang diwujudkan dengan perangkat lunak, misalnya cara sistem
  memproses data, mengurangi latency, menjaga kerahasiaan, dan mengendalikan/escalation.
- **Metode diagnostik/terapi medis** dapat masuk pengecualian dalam banyak yurisdiksi,
  termasuk Indonesia. Klaim sebaiknya diarahkan pada **arsitektur teknis sistem**,
  bukan pada “mendiagnosis pasien”.
- Paten bersifat **teritorial**. Pengajuan di Indonesia tidak otomatis melindungi
  negara lain. Jika diperlukan, pertimbangkan rute PCT.

---

## 2. Calon judul invensi

**“Sistem dan metode triage klinis berbasis multi-agent dengan eskalasi bertahap berbasis antrean, peredaksian peran, dan pesan keluar tanpa diagnosa.”**

Nama alternatif:

- “Metode dan sistem pengendalian notifikasi gawat darurat klinis dengan validasi approval manusia dan deduplikasi job antrean.”
- “Arsitektur agen klinis dengan aturan triage deterministik, enkripsi field, dan jalur eskalasi berbasis waktu.”

---

## 3. Ringkasan invensi (untuk deskripsi)

Sistem ini terdiri dari beberapa agen perangkat lunak yang berjalan bersama:

1. **RME Analyzer** memeriksa kelengkapan rekam medis dan menghitung skor.
2. **Urgent Triage + Auto Caller** mengevaluasi tanda vital menggunakan aturan
   deterministik, menghasilkan level MERAH/KUNING/HIJAU, dan memicu eskalasi
   bertahap: deteksi 0 detik, alarm 5 detik, WhatsApp 10 detik, telepon 2 menit,
   telepon 5 menit, eskalasi 15 menit.
3. **Orchestrator** menjadwalkan pemeriksaan dan retry dengan logging.
4. **Security Guard** melakukan enkripsi AES-256-GCM, HMAC NIK, masking, dan audit.
5. **Auto Reporter**, **Patient Engagement**, dan **Bug Hunter** melengkapi alur.

Ciri teknis yang dapat dijadikan dasar klaim:

- evaluasi triage **deterministik** berbasis ambang numerik + keyword, dengan
  keluaran alasan yang dapat diaudit;
- pesan keluar dibangun dari template yang **secara konstruksi tidak memuat diagnosis**;
- jalur pengiriman nyata hanya aktif bila `ALLOW_REAL_OUTBOUND=true` **dan** approval
  manusia tersedia;
- tindak lanjut MERAH dapat dijalankan lewat **antrean BullMQ/Redis** dengan `jobId`
  deterministik untuk mencegah eksekusi ganda;
- akses data belum direkamkan menurut **peran** sebelum dikirim ke klien;
- seluruh akses API dicatat sebagai `audit_logs` berisi aktor, waktu, target, dan IP.

---

## 4. Masalah teknis yang diselesaikan

| Masalah | Solusi teknis dalam kode |
|---|---|
| Inkonsistensi keputusan triage antar operator | Aturan deterministik di `lib/triageRules.ts` |
| Kebocoran diagnosa lewat notifikasi | Template statis di `agents/urgentCaller.ts`, tanpa field diagnosa |
| Eskalasi terlewat saat banyak instance | Antrean persisten + `jobId` dedup di `lib/queue.ts` |
| Pengiriman otomatis tanpa persetujuan | Guard `ALLOW_REAL_OUTBOUND` + `REQUIRE_HUMAN_APPROVAL` |
| Akses resepsionis terhadap diagnosa | RBAC di `lib/rbac.ts` + redaksi di `agents/securityGuard.ts` |
| Sulitnya audit insiden | `lib/audit.ts` menulis aktor/IP/target untuk tiap endpoint |

---

## 5. Draf klaim (untuk disempurnakan konsultan paten)

> Draf ini belum tentu memenuhi syarat novelty/inventive step. Jangan diajukan apa adanya.

### Klaim mandiri 1 — Sistem

Sistem pemrosesan data klinis berbasis komputer, meliputi:

- satu atau lebih processor yang menjalankan sejumlah agen perangkat lunak;
- modul evaluasi aturan yang menerima data tanda vital dan menghasilkan level
  prioritas beserta daftar alasan yang dapat diaudit;
- modul pembangun pesan yang menghasilkan pesan keluar dari template tetap yang
  tidak memuat field diagnosis pasien;
- modul pengendali akses yang mengizinkan pengiriman nyata hanya ketika indikator
  konfigurasi pengiriman nyata aktif dan identitas penyetuju manusia tersedia; dan
- modul antrean yang menjadwalkan tindak lanjut prioritas tinggi menggunakan
  identitas job deterministik turunan identitas catatan triage.

### Klaim mandiri 2 — Metode

Metode yang dijalankan oleh sistem komputer untuk mengendalikan eskalasi klinis,
meliputi langkah:

1. menerima data kunjungan dan mengevaluasi aturan triage deterministik;
2. menyimpan catatan triage beserta alasan dan skor;
3. apabila level prioritas memenuhi ambang tertentu, membuat job antrean dengan
   identitas deterministik;
4. menjalankan job tersebut pada worker terpisah dengan percobaan ulang;
5. membangun pesan notifikasi dari template yang tidak memuat diagnosis; dan
6. mencatat setiap tahapan pada log audit dan log agen.

### Klaim turunan

- Klaim 3: sistem menurut klaim 1,wherein modul antrean menggunakan backoff eksponensial.
- Klaim 4: sistem menurut klaim 1,wherein pesan notifikasi berisi ajakan datang ke klinik dan nomor darurat.
- Klaim 5: sistem menurut klaim 1,wherein data sensitif dienkripsi dengan AES-256-GCM dan NIK disimpan sebagai HMAC.
- Klaim 6: metode menurut klaim 2,wherein akses diagnosa hanya diberikan pada peran tertentu.

---

## 6. Yang **jangan** diklaim sebagai paten

- “Penemuan metode diagnosis/terapi penyakit” — berisiko masuk pengecualian.
- “Klinik lebih aman dari segala risiko” — klaim hasil, bukan klaim teknis.
- “Angka ambang 190/120 adalah milik kami” — ambang adalah data/spesifikasi, bukan invensi.
- “Next.js/Prisma/BullMQ adalah bagian dari paten kami” — pihak ketiga.

Fokuskan klaim pada **cara sistem mengelola alur, keamanan, dan antrean**, bukan pada
pengetahuan medisnya.

---

## 7. Langkah pengajuan di Indonesia

1. Tentukan **inventor** dan **pemegang hak** (nama/KTP atau badan hukum).
2. Buat deskripsi lengkap: latar belakang, masalah, solusi, gambar diagram alur,
   contoh keluaran, dan klaim.
3. Buat **abstrak** singkat dan satu gambar utama (system architecture / flowchart).
4. Lakukan penelusuran prior art minimal: Google Patents, Espacenet, DGIP.
5. Ajukan permohonan melalui **DGIP / Kemenkumham** (e-paten bila tersedia).
6. Simpan bukti penerimaan sebagai dasar penggunaan status “PATENT PENDING”.
7. Jika pasar luar negeri penting, konsultasikan rute **PCT**.
8. Awasi anuitas/biaya tahunan agar paten tidak gugur.

Konsultan paten sangat disarankan karena klaim yang terlalu luas mudah ditolak,
terlalu sempit mudah dihindari.

---

## 8. Strategi alternatif: rahasia dagang

Jika invensi sulit dibuktikan dari kode atau mudah ditemukan lawan, **rahasia dagang**
bisa lebih praktis daripada paten:

- simpan kode sebagai private repository;
- batasi akses dengan RBAC dan NDA;
- jangan mempublikasikan algoritma/ambang sebelum siap;
- catat pengembangan internal sebagai bukti kepemilikan.

Repo ini sudah private dan memiliki audit trail, yang mendukung strategi tersebut.

---

## 9. Status saat ini

| Item | Status |
|---|---|
| Lisensi proprietary | ✅ `LICENSE` |
| Draft invensi | ✅ `PATENT.md` |
| Draf klaim | ✅ bagian 5 |
| Permohonan DGIP | ❌ Belum dilakukan |
| Nomor paten | ❌ Belum ada |
| Hak eksklusif yang dapat dieksekusi | ❌ Belum ada sebelum paten diberikan |

---

**Penafian:** dokumen ini bukan nasihat hukum, bukan jaminan keamanan mutlak, dan
tidak menggantikan konsultan paten/notaris. Tidak ada dokumen yang melindungi
“dari apapun”; perlindungan nyata bergantung pada pendaftaran, kontrak, dan kepatuhan
operasional.
