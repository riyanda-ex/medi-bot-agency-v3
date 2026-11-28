# Panduan Singkat untuk Staf Klinik (Tanpa Teknis)

Panduan ini untuk resepsionis, perawat, dan dokter yang memakai MediBot setiap hari.
Tidak perlu memahami kode. Bila ada keraguan klinis, **ikuti SOP klinik dan putuskan sendiri**,
jangan menunggu aplikasi.

## 1. Masuk (login)

1. Buka alamat yang diberikan admin klinik (bukan tautan dari email/WA orang tak dikenal).
2. Masukkan email dan kata sandi.
3. Jika MFA aktif, buka aplikasi authenticator dan masukkan kode 6 digit. Kode pemulihan
   hanya boleh dipakai sekali dan disimpan oleh pemilik akun.
4. Lupa kata sandi? Klik **Ajukan tautan reset** pada halaman login. Tautan berlaku 1 jam
   dan sekali pakai. Jika email tidak terdaftar, aplikasi tetap menjawab sama — ini normal.

## 2. Halaman utama (dashboard)

- Angka **MERAH / KUNING / HIJAU** adalah jumlah **pasien unik**, bukan jumlah triase.
- Tabel **Triage terbaru** diurutkan berdasarkan waktu dibuat (terbaru dulu). Urutan prioritas
  MERAH hanya dipakai pada panel approval.
- Klik **Keamanan** untuk mengaktifkan MFA. Lakukan sekarang jika belum aktif.

## 3. Triase

1. Pilih pasien, isi tekanan darah, gula, saturasi, dan keluhan lain yang tersedia.
2. Klik **Jalankan Triage**.
3. Warna merah berarti butuh tindakan klinis segera. Aplikasi **hanya membantu**;
   penilaian akhir tetap tenaga kesehatan.
4. Jika muncul permintaan approval, periksa identitas pasien dulu sebelum menyetujui.

## 4. Approval pengiriman nyata

Panel approval hanya muncul untuk DOKTER/ADMIN.

- **Setujui**: pilih kanal lalu klik Setujui. ID approval berlaku 30 menit, sekali pakai,
  dan tercatat di audit. Salin ID jika sistem memintanya.
- **Tolak**: isi alasan minimal 5 karakter lalu klik Tolak. Penolakan juga tercatat.
- Jangan menyetujui jika data pasien belum dikonfirmasi atau consent pasien dicabut.
  Pengiriman nyata ke pasien (WA/telepon) tetap diblokir bila consent tidak `GRANTED`;
  email laporan ke staf hanya butuh approval.

## 5. Hak pasien & privasi

- Pencabutan consent saat ini melalui admin/API (`PUT /api/me/consent`); halaman consent untuk
  pasien belum ada. Pengiriman baru ke pasien langsung berhenti.
- Rekam medis **tidak boleh dihapus** sebelum 25 tahun sejak kunjungan terakhir. Yang bisa
  dilakukan sekarang adalah penghentian penggunaan data dan anonimisasi identitas setelah consent
  dicabut, masa retensi habis, tidak ada legal hold, dan ada tiket yang diverifikasi admin.
- Permintaan akses/salinan/koreksi/penghapusan dibuat sebagai tiket. Batas jawaban adalah
  **3 × 24 jam (72 jam)**. Jika ada tiket mendekati batas, laporkan ke admin/DPO.
- Jangan pernah membagikan NIK lengkap, nomor HP, email, atau diagnosis lewat WA/email pribadi.

## 6. Laporan

- Laporan harian dibuat oleh sistem. Unduh lewat halaman Laporan.
- Pengiriman email nyata memerlukan approval. Tanpa approval, sistem hanya menyimpan simulasi.

## 7. Jika ada masalah

- Simpan ID yang tersedia: halaman error menampilkan `Referensi: <digest>`, sedangkan respons
  error API menyertakan `requestId`. Laporkan ke admin.
- Jangan menghapus log audit. Jangan mencoba mengubah peran sendiri.
- Untuk insiden kebocoran data, ikuti `docs/INCIDENT-RESPONSE.md` dan segera hubungi kontak
  keamanan klinik.

## 8. Yang belum bisa dijamin aplikasi

Validasi klinis ambang triase, penandatanganan SOP, DPA vendor, dan penunjukan DPO/DPP
adalah kewajiban klinik. Lihat `docs/SOP-KLINIK.md` dan `docs/PRODUCTION-CHECKLIST.md`.
