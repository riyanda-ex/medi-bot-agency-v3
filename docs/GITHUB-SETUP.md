# Petunjuk Pengaturan GitHub

Dokumen ini untuk pengaturan yang **tidak bisa sepenuhnya diotomasi dari repo**.

> **Status per 28 November 2026:** visibilitas repositori **belum dikonfirmasi**. `README.md`, `CONTRIBUTING.md`, dan `LICENSE` menyatakan repo ini **proprietary**; jangan menganggapnya PUBLIC tanpa verifikasi di Settings > General. Perlindungan branch `main` harus mewajibkan **minimal satu review approval** selain CI checks.

## Pengaturan yang perlu diverifikasi ulang

- [ ] Repo visibility — cek di Settings > General dan samakan dengan status proprietary di README/CONTRIBUTING/LICENSE (jangan asumsikan PUBLIC).
- [ ] Description, homepage, topics
- [ ] Discussions enabled
- [ ] Secret scanning enabled
- [ ] Secret scanning push protection enabled
- [ ] Branch protection `main`: required CI checks + minimal 1 required reviewer approval, strict, conversation resolution, no force push/delete

## Wajib dicek manual

- [ ] **Social preview**: Settings > General > Social preview > upload `docs/assets/social-preview.png`.
- [ ] **Branch protection enforce admins**: jika ingin alur PR-only ketat, aktifkan “Do not allow bypassing the above settings”.
- [ ] **Dependabot alerts & security updates**: Settings > Code security and analysis > aktifkan semua yang relevan.
- [ ] **Code scanning default setup / CodeQL**: pastikan workflow CodeQL hijau dan alerts ditinjau.
- [ ] **Actions permissions**: batasi ke workflow yang diperlukan; review secrets environment.
- [ ] **Environment secrets**: gunakan GitHub Environments untuk staging/production secrets, bukan repo secrets biasa bila perlu approval.
- [ ] **Required reviewers**: tambahkan minimal 1 reviewer untuk perubahan area sensitif (`lib/auth.ts`, `lib/rbac.ts`, `lib/crypto.ts`, `prisma/`).

## Rekomendasi operasional

- [ ] Aktifkan backup DB terjadwal + uji restore.
- [ ] Tambahkan monitoring/alerting (Sentry/OTel) untuk error rate, auth failures, queue lag.
- [ ] Tetapkan kebijakan retensi audit log dan data pasien sesuai regulasi.
- [ ] Jalankan penetration test eksternal sebelum data pasien nyata.
