import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "MEDI-BOT AGENCY v3",
  description: "Sistem multi-agent untuk rekam medis klinik Indonesia"
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="id">
      <body>{children}</body>
    </html>
  );
}
