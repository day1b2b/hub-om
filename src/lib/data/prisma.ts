import { assertPrivacyConfiguration } from "@/lib/privacy/crypto";
import { withPrivacyDatabase } from "@/lib/privacy/database";
import { withActivityDatabase } from "@/lib/activity/database";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClient;
};

export function getPrismaClient(): PrismaClient {
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
