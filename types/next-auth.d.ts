import type { DefaultSession } from "next-auth";
import type { Role } from "@/lib/rbac";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      role: Role;
      patientId?: string;
      doctorId?: string;
    } & DefaultSession["user"];
  }

  interface User {
    id: string;
    role: string;
    patientId?: string | null;
    doctorId?: string | null;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    role?: string;
    patientId?: string;
    doctorId?: string;
  }
}
