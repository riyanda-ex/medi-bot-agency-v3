import type { NextAuthConfig } from "next-auth";
import Credentials from "next-auth/providers/credentials";
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
const LOGIN_WINDOW_MS = 5 * 60_000;
// Hash dummy dipakai saat email tidak ada agar waktu respons tidak membedakan
// antara "email tidak terdaftar" dan "kata sandi salah".
const DUMMY_HASH = bcrypt.hashSync("timing-equalizer-not-a-real-password", 10);
const secureCookies = (process.env.AUTH_URL ?? process.env.NEXTAUTH_URL)?.startsWith("https://");

export const authConfig: NextAuthConfig = {
  providers: [
    Credentials({
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
        const ip = getRequestIp(request);
        const rateKey = `login:${ip}:${email}`;
        pruneRateLimits();
        const rate = await checkRateLimit(rateKey, LOGIN_LIMIT, LOGIN_WINDOW_MS);
        if (!rate.allowed) {
          logger.warn("AUTH_LOGIN_RATE_LIMITED", { ip, retryAfterSeconds: rate.retryAfterSeconds });
          await recordAuthFailure({ email, ip, reason: "RATE_LIMITED" });
          return null;
        }

        const user = await prisma.user.findUnique({ where: { email } });
        const valid = await bcrypt.compare(parsed.data.password, user?.passwordHash ?? DUMMY_HASH);

        if (!user || !valid) {
          logger.warn("AUTH_LOGIN_FAILED", { ip, reason: "INVALID_CREDENTIALS" });
          await recordAuthFailure({ email, ip, reason: "INVALID_CREDENTIALS" });
          return null;
        }
        if (user.status !== "AKTIF") {
          logger.warn("AUTH_LOGIN_INACTIVE", { ip });
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
  secret: process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET,
  trustHost: true,
  cookies: {
    sessionToken: {
      name: secureCookies ? "__Secure-authjs.session-token" : "authjs.session-token",
      options: {
        httpOnly: true,
        sameSite: "strict",
        secure: secureCookies ?? false,
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
        token.tokenVersion = user.tokenVersion ?? 0;
      }

      // Revalidasi setiap permintaan: peran berubah atau tokenVersion naik
      // langsung memblokir JWT lama.
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

// Kompatibilitas dengan tooling lama yang masih mengimpor authOptions.
export const authOptions = authConfig;
