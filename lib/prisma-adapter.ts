import "dotenv/config";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaPg } from "@prisma/adapter-pg";

export function createPrismaAdapter() {
  const connectionString = process.env.DATABASE_URL!;

  return connectionString.startsWith("file:")
    ? new PrismaBetterSqlite3({ url: connectionString })
    : new PrismaPg({ connectionString }, { schema: "public" });
}
