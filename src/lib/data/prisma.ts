import { assertPrivacyConfiguration } from "@/lib/privacy/crypto";
import { withPrivacyDatabase } from "@/lib/privacy/database";
import { withActivityDatabase } from "@/lib/activity/database";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { assertDefaultDatabaseAccess } from "./dataRepositoryContext";

const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClient;
};

export function getPrismaClient(): PrismaClient {
  assertDefaultDatabaseAccess();
  assertPrivacyConfiguration();
  const databaseUrl = process.env.DATABASE_URL;

  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required to connect to PostgreSQL.");
  }

  if (!globalForPrisma.prisma) {
    // adapter-pg serializes timestamps without an offset. Keep every pooled
    // connection in UTC so timestamptz reads, writes and date filters agree.
    const adapter = new PrismaPg({ connectionString: databaseUrl, options: "-c timezone=UTC" });
    globalForPrisma.prisma = withActivityDatabase(withPrivacyDatabase(new PrismaClient({ adapter })));
  }

  return globalForPrisma.prisma;
}

/** CLI-owned default clients may be released without affecting explicitly scoped repositories. */
export async function disconnectPrismaClient(): Promise<void> {
  const client = globalForPrisma.prisma;
  if (!client) return;
  try { await client.$disconnect(); }
  finally { delete globalForPrisma.prisma; }
}
