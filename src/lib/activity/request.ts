import { pruneActivityBatch } from "./retention";
import { randomUUID } from "node:crypto";
import { auth } from "@/auth";
import { isAllowedWorkspaceEmail } from "@/lib/auth/workspaceAccess";
import { getPrismaClient } from "@/lib/data/prisma";
import { activityContext, type ActivityContext } from "./context";

let lastPruned = 0;

async function recordRequest(context: ActivityContext, status: number, durationMs: number) {
  if (!process.env.DATABASE_URL) return;
  try {
    const prisma = getPrismaClient();
    await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT set_config('statement_timeout', '1500', true)`;
      await tx.activityRequest.create({ data: {
        id: context.requestId, actorEmail: context.actorEmail, actorName: context.actorName,
        actorType: context.actorType, route: context.route, method: context.method, status, durationMs
      } });
    }, { maxWait: 1000, timeout: 2500 });
    if (Date.now() - lastPruned > 3_600_000) {
      lastPruned = Date.now();
      try {
        await prisma.$transaction(async (tx) => {
          await tx.$queryRaw`SELECT set_config('statement_timeout', '1500', true)`;
          // Bounded batches prevent a large backlog from delaying ordinary requests.
          await pruneActivityBatch(tx);
        }, { maxWait: 1000, timeout: 4000 });
      } catch {
        console.error("[activity] retention cleanup failed");
      }
    }
  } catch {
    // Never copy exception bodies: database/driver errors may include sensitive parameters.
    console.error("[activity] API request log write failed");
  }
}

export function withActivity<Args extends unknown[]>(route: string, method: string, handler: (...args: Args) => Promise<Response>) {
  return async (...args: Args): Promise<Response> => {
    const started = performance.now();
    const request = args[0] instanceof Request ? args[0] : undefined;
    const context: ActivityContext = {
      requestId: randomUUID(), route, method: request?.method ?? method, actorEmail: null, actorName: null, actorType: "anonymous"
    };
    // A credential-bearing request is not attributed to an unrelated browser cookie.
    // token_request describes the mechanism, not successful authentication or a known person.
    const tokenRoute = /^\/api\/(coach\/|sales\/lookup|team-users\/lookup|satisfaction\/round-apply)/.test(route);
    if (request?.headers.has("authorization") || tokenRoute) {
      context.actorType = "token_request";
    } else if (process.env.DEV_AUTH_BYPASS === "true" && process.env.NODE_ENV !== "production") {
      context.actorType = "development";
      context.actorEmail = process.env.DEV_AUTH_EMAIL ?? "dev@day1company.co.kr";
      context.actorName = "Dev User";
    } else {
      try {
        const session = await auth();
        if (isAllowedWorkspaceEmail(session?.user?.email)) {
          context.actorType = "user";
          context.actorEmail = session!.user!.email!.toLowerCase();
          context.actorName = session?.user?.name?.slice(0, 200) ?? null;
        }
      } catch { /* Route authentication remains authoritative. */ }
    }
    return activityContext.run(context, async () => {
      let status = 500;
      try {
        const response = await handler(...args);
        status = response.status;
        try { response.headers.set("X-Request-Id", context.requestId); } catch { /* Some platform responses have immutable headers. */ }
        return response;
      } catch (error) {
        // Next.js redirects are thrown control flow, not failed saves.
        const digest = error && typeof error === "object" && "digest" in error ? String(error.digest) : "";
        const redirectStatus = /^NEXT_REDIRECT;[^;]*;.*;(\d{3});$/.exec(digest);
        if (redirectStatus) status = Number(redirectStatus[1]);
        throw error;
      } finally {
        await recordRequest(context, status, Math.max(0, Math.round(performance.now() - started)));
      }
    });
  };
}
