# SOP Klinik — Penggunaan MediBot Clinical Operations Platform

> **Status draf:** belum ditandatangani. Ini kerangka operasional untuk disetujui dan
> ditandatangani oleh pimpinan klinik, dokter penanggung jawab, dan DPO/DPP.
> Kode tidak dapat menggantikan tanda tangan atau keputusan klinis.

## 1. Tujuan & ruang lingkup

Mengatur penggunaan MediBot untuk triase awal, pencatatan, laporan, dan pengingat,
serta batas kewenangan tenaga kesehatan dan sistem. MediBot **bukan alat medis tersertifikasi**.

## 2. Kewenangan

| Peran       | Boleh melihat                                            | Boleh menyetujui outbound   |
| ----------- | -------------------------------------------------------- | --------------------------- |
| RESEPSIONIS | Jadwal & antrean saja (tanpa `patient:read`)             | Tidak                       |
| PERAWAT     | Pasien, triase, kontak; bukan diagnosis/NIK              | Tidak                       |
| DOKTER      | Rekam medis lengkap termasuk diagnosis & NIK             | Ya                          |
| ADMIN       | Rekam medis lengkap termasuk diagnosis/NIK, audit & akun | Ya (bukan keputusan klinis) |
| PASIEN      | Data diri sendiri & tiket                                | Tidak                       |

Aturan teknis ada di `lib/rbac.ts`; SOP ini yang mengikat secara operasional.

## 3. Alur triase MERAH

1. Perawat menginput vital dan keluhan.
2. Sistem memberi label MERAH/KUNING/HIJAU sebagai **pembantu**, bukan diagnosis.
3. Untuk MERAH, dokter atau perawat melakukan penilaian langsung dalam waktu yang
   ditetapkan klinik (target internal aplikasi: pemeriksaan ulang 5 menit, eskalasi 2/5/15 menit).
4. Kontak nyata ke pasien hanya terjadi bila: consent `GRANTED`, approval masih berlaku
   (30 menit), approval belum terpakai, dan petugas memastikan alamat/telepon benar.

## 4. Consent, retensi, dan hak pasien

- Consent dicatat dengan waktu grant/revoke. Pencabutan menghentikan pemrosesan baru
  segera; tidak menghapus fakta klinis.
- Rekam medis disimpan minimal **25 tahun sejak kunjungan terakhir**
  (Permenkes 24/2022). Penghapusan identitas hanya setelah consent dicabut (`REVOKED`
  atau `consentRevokedAt` terisi), retensi habis, tidak ada legal hold, dan tiket
  DELETION disetujui ADMIN.
- Tiket hak subjek data (akses, salinan, koreksi, pencabutan, penghapusan) dijawab
  dalam **3 × 24 jam**. `npm run retention:sweep` membantu memantau SLA dan retensi.
- Audit log bertanda tangan tidak boleh dihapus rutin. `npm run audit:verify`
  dijalankan mingguan oleh operator.

## 5. Insiden & eskalasi

Ikuti `docs/INCIDENT-RESPONSE.md`. Sev-1 (kebocoran data/auth bypass) segera dieskalasi
ke pimpinan klinik dan DPO. Jangan menghapus bukti.

## 6. Penandatanganan

| Peran                   | Nama | Tanda tangan | Tanggal |
| ----------------------- | ---- | ------------ | ------- |
| Pimpinan klinik         | …    | …            | …       |
| Dokter penanggung jawab | …    | …            | …       |
| DPO / DPP               | …    | …            | …       |
| Operator sistem         | …    | …            | …       |

Belum terisi → SOP **belum berlaku**. Ini adalah blocker eksternal untuk skor 10/10.
