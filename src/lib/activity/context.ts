import { AsyncLocalStorage } from "node:async_hooks";

export interface ActivityContext {
  requestId: string;
  route: string;
  method: string;
  actorEmail: string | null;
  actorName: string | null;
  actorType: "user" | "token_request" | "anonymous" | "development";
}

// Next.js can bundle API routes independently. The store must be process-global,
// just like the cached Prisma client, or one route can lose another bundle's context.
const globalForActivity = globalThis as unknown as { hubOmActivityContext?: AsyncLocalStorage<ActivityContext> };
export const activityContext = globalForActivity.hubOmActivityContext ??= new AsyncLocalStorage<ActivityContext>();
