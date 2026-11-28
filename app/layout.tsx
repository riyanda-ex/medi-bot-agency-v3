import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "MediBot Clinical Operations Platform",
  description: "Platform operasional klinis multi-agent untuk klinik Indonesia"
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#f8fafc"
};

// CSP nonce dari proxy hanya valid bila halaman dirender per-request.
// Tanpa ini, halaman statis berisi script Next.js akan diblokir oleh strict-dynamic.
export const dynamic = "force-dynamic";

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="id">
      <body>{children}</body>
    </html>
  );
}
