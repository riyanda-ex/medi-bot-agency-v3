/**
 * Validasi environment variable. Gunakan sebelum memakai kredensial.
 * Dihasilkan oleh Bug Hunter untuk mencegah kunci hardcode.
 */
import { z } from "zod";

const envSchema = z.object({
  DATABASE_URL: z.string().min(1),
  NEXTAUTH_SECRET: z.string().min(16),
  FIELD_ENCRYPTION_KEY: z.string().min(16),
  ALLOW_REAL_OUTBOUND: z.enum(["true", "false"]).default("false")
});

export type ValidEnv = z.infer<typeof envSchema>;

export function loadEnv(source: Record<string, string | undefined>): ValidEnv {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    throw new Error(
      `Environment tidak valid: ${parsed.error.issues.map((i) => i.path.join(".")).join(", ")}`
    );
  }
  return parsed.data;
}
