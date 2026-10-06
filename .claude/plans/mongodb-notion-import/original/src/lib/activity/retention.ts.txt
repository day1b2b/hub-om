import type { Prisma } from "@prisma/client";

/** Bounded batches; callers choose whether to run once or drain a backlog. */
export async function pruneActivityBatch(tx: Prisma.TransactionClient) {
  const requests = await tx.$executeRaw`DELETE FROM activity_requests WHERE id IN (SELECT id FROM activity_requests WHERE occurred_at < now() - interval '30 days' ORDER BY occurred_at LIMIT 1000)`;
  const changes = await tx.$executeRaw`DELETE FROM activity_changes WHERE id IN (SELECT id FROM activity_changes WHERE occurred_at < now() - interval '365 days' ORDER BY occurred_at LIMIT 1000)`;
  return { requests, changes };
}
