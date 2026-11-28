const isDev = process.env.NODE_ENV !== "production";

const baseHeaders = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), browsing-topics=(), payment=()"
  },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  { key: "Cross-Origin-Resource-Policy", value: "same-origin" },
  { key: "X-DNS-Prefetch-Control", value: "off" }
];

const apiCsp = [
  "default-src 'none'",
  "frame-ancestors 'none'",
  "base-uri 'none'",
  ...(isDev ? [] : ["upgrade-insecure-requests"])
].join("; ");

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  output: "standalone",
  serverExternalPackages: [
    "@prisma/adapter-better-sqlite3",
    "@prisma/adapter-pg",
    "@prisma/client",
    "bcryptjs",
    "bullmq",
    // pdfkit memuat font standar dari direktori paket secara runtime; bundling
    // membuat MODULE_NOT_FOUND di standalone. exceljs/nodemailer juga punya
    // aset runtime, jadi ketiganya sengaja dipakai lewat require native.
    "exceljs",
    "ioredis",
    "nodemailer",
    "pdfkit"
  ],
  async headers() {
    return [
      {
        source: "/api/:path*",
        headers: [
          ...baseHeaders,
          { key: "Content-Security-Policy", value: apiCsp },
          { key: "Cache-Control", value: "no-store, max-age=0" }
        ]
      }
    ];
  }
};

export default nextConfig;
