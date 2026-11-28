import { type NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { normalizeRole, TIDAK_AKTIF } from "@/lib/rbac";
import { assertSecureEnvironment } from "@/lib/env";
import { checkRateLimit, pruneRateLimits } from "@/lib/rateLimit";
import { getRequestIp, recordAuthFailure } from "@/lib/audit";
import { logger } from "@/lib/logger";

const credentialsSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1).max(200)
});

const LOGIN_LIMIT = 8;
// Batas global per email: XFF bisa diputar penyerang, jadi IP saja tidak cukup.
const LOGIN_EMAIL_LIMIT = 20;
const LOGIN_WINDOW_MS = 5 * 60_000;
// Hash dummy dipakai saat email tidak ada agar waktu respons tidak membedakan
// antara "email tidak terdaftar" dan "kata sandi salah".
// Hash statis precomputed: tidak perlu menjalankan bcrypt saat modul dimuat.
const DUMMY_HASH = "$2a$10$52vxxR/eTsqzgZO0R34rxuz2B/.iM1THzq8cF4vQgk/gMQTUZSBOe";

export const authOptions: NextAuthOptions = {
  providers: [
    CredentialsProvider({
      name: "Akun Klinik",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Kata sandi", type: "password" }
      },
      async authorize(credentials, request) {
        assertSecureEnvironment();
        const parsed = credentialsSchema.safeParse(credentials);
        if (!parsed.success) return null;

        const email = parsed.data.email.trim().toLowerCase();
        const headers = (request?.headers ?? {}) as Record<string, string | string[] | undefined>;
        const ip = getRequestIp(headers);
        pruneRateLimits();
        const [ipRate, emailRate] = await Promise.all([
          checkRateLimit(`login:ip:${ip}:${email}`, LOGIN_LIMIT, LOGIN_WINDOW_MS),
          checkRateLimit(`login:email:${email}`, LOGIN_EMAIL_LIMIT, LOGIN_WINDOW_MS)
        ]);
        if (!ipRate.allowed || !emailRate.allowed) {
          const retryAfterSeconds = Math.max(ipRate.retryAfterSeconds, emailRate.retryAfterSeconds);
          logger.warn("auth.login_rate_limited", { email, ip, retryAfterSeconds });
          await recordAuthFailure({ email, ip, reason: "RATE_LIMITED" });
          return null;
        }

        const user = await prisma.user.findUnique({ where: { email } });
        const valid = await bcrypt.compare(parsed.data.password, user?.passwordHash ?? DUMMY_HASH);

        if (!user || !valid) {
          logger.warn("auth.login_failed", { email, ip });
          await recordAuthFailure({ email, ip, reason: "INVALID_CREDENTIALS" });
          return null;
        }
        if (user.status !== "AKTIF") {
          logger.warn("auth.inactive_account", { email, ip });
          await recordAuthFailure({ email, ip, reason: "ACCOUNT_INACTIVE" });
          return null;
        }

        await prisma.user.update({
          where: { id: user.id },
          data: { lastLoginAt: new Date() }
        });

        return {
          id: user.id,
          email: user.email,
          name: user.name,
          role: normalizeRole(user.role),
          patientId: user.patientId,
          doctorId: user.doctorId,
          tokenVersion: user.tokenVersion
        };
      }
    })
  ],
  session: { strategy: "jwt", maxAge: 8 * 60 * 60 },
  pages: { signIn: "/login" },
  secret: process.env.NEXTAUTH_SECRET,
  cookies: {
    sessionToken: {
      name: process.env.NEXTAUTH_URL?.startsWith("https://")
        ? "__Secure-next-auth.session-token"
        : "next-auth.session-token",
      options: {
        httpOnly: true,
        sameSite: "strict",
        secure: process.env.NEXTAUTH_URL?.startsWith("https://") ?? false,
        path: "/"
      }
    }
  },
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.sub = user.id;
        token.patientId = user.patientId ?? undefined;
        token.doctorId = user.doctorId ?? undefined;
        token.tokenVersion = (user as { tokenVersion?: number }).tokenVersion ?? 0;
      }

      // Revalidasi setiap permintaan: peran berubah atau tokenVersion naik
      // langsung memblokir JWT lama, termasuk di middleware/proxy.
      if (token.sub) {
        const dbUser = await prisma.user.findUnique({
          where: { id: token.sub },
          select: { role: true, status: true, tokenVersion: true, patientId: true, doctorId: true }
        });
        const stale =
          !dbUser || dbUser.status !== "AKTIF" || dbUser.tokenVersion !== (token.tokenVersion ?? 0);

        if (stale) {
          token.invalid = true;
          token.role = TIDAK_AKTIF;
          token.patientId = undefined;
          token.doctorId = undefined;
        } else {
          token.invalid = false;
          token.role = normalizeRole(dbUser.role);
          token.patientId = dbUser.patientId ?? undefined;
          token.doctorId = dbUser.doctorId ?? undefined;
        }
      } else {
        token.invalid = true;
        token.role = TIDAK_AKTIF;
      }

      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = token.sub ?? "";
        session.user.role = normalizeRole(token.role);
        session.user.patientId = token.patientId;
        session.user.doctorId = token.doctorId;
        session.user.invalid = token.invalid === true;
      }
      return session;
    }
  }
};
