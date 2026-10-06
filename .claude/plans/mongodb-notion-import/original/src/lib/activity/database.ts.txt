import { encryptField, indexField } from "@/lib/privacy/fields";
import type { PrismaClient, Prisma } from "@prisma/client";
import { activityContext } from "./context";

const writes = new Set(["create", "createMany", "createManyAndReturn", "update", "updateMany", "updateManyAndReturn", "upsert", "delete", "deleteMany"]);
const excludedModels = new Set(["activityRequest", "activityChange"]);

async function setContext(tx: Prisma.TransactionClient) {
  const context = activityContext.getStore();
  if (context) {
    const installed = await tx.$queryRaw<Array<{ installed: boolean }>>`SELECT set_config('app.activity_context', ${JSON.stringify({ ...context,
      actorEmail: encryptField("ActivityChange", "actorEmail", context.actorEmail),
      actorName: encryptField("ActivityChange", "actorName", context.actorName),
      actorEmailPiiIndex: indexField("ActivityChange", "actorEmail", context.actorEmail),
      actorNamePiiIndex: indexField("ActivityChange", "actorName", context.actorName)
    })}, true), to_regprocedure('public.capture_activity_change()') IS NOT NULL AS installed`;
    if (!installed[0]?.installed) throw new Error("Activity migration must be applied before serving API writes.");
  }
}

/** Keep audit attribution transaction-local, including nested writes and existing transactions.
 * Batch transaction arrays are deliberately unsupported: all application transactions use callbacks.
 * The returned client preserves delegate types; dynamic dispatch is confined to this adapter.
 */
export function withActivityDatabase(client: PrismaClient): PrismaClient {
  const delegates = new Map<PropertyKey, unknown>();
  return new Proxy(client, {
    get(target, property) {
      if (property === "$transaction") {
        return (callback: (tx: Prisma.TransactionClient) => Promise<unknown>, options?: Parameters<PrismaClient["$transaction"]>[1]) => {
          if (typeof callback !== "function") throw new Error("Use a callback transaction for activity attribution.");
          return target.$transaction(async (tx) => {
            await setContext(tx);
            return callback(tx);
          }, options);
        };
      }
      const value = Reflect.get(target, property);
      if (typeof property !== "string" || property.startsWith("$") || property.startsWith("_") || !value || typeof value !== "object" || excludedModels.has(property)) {
        return typeof value === "function" ? value.bind(target) : value;
      }
      if (!delegates.has(property)) {
        delegates.set(property, new Proxy(value, {
          get(delegate, operation) {
            const fn = Reflect.get(delegate, operation);
            if (typeof fn !== "function") return fn;
            return (...args: unknown[]) => {
              if (!writes.has(String(operation)) || !activityContext.getStore()) return fn.apply(delegate, args);
              return target.$transaction(async (tx) => {
                await setContext(tx);
                const model = Reflect.get(tx, property);
                return Reflect.get(model, operation).apply(model, args);
              });
            };
          }
        }));
      }
      return delegates.get(property);
    }
  });
}
