import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "MediBot Clinical Operations Platform",
  description: "Platform operasional klinis multi-agent untuk klinik Indonesia"
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="id">
      <body>{children}</body>
    </html>
  );
}
