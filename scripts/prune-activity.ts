import { config } from "dotenv";
import { getPrismaClient } from "../src/lib/data/prisma";
import { pruneActivityBatch } from "../src/lib/activity/retention";

config({ path: ".env.local" });
config({ path: ".env" });
const prisma = getPrismaClient();
let requests = 0;
let changes = 0;
try {
  for (;;) {
    const result = await prisma.$transaction(pruneActivityBatch, { timeout: 10000 });
    requests += result.requests;
    changes += result.changes;
    if (result.requests < 1000 && result.changes < 1000) break;
  }
  console.log(JSON.stringify({ deletedRequests: requests, deletedChanges: changes }));
} finally {
  await prisma.$disconnect();
}
