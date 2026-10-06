import type { Prisma } from "@prisma/client";
import type { readPrismaAdminDatabaseRows } from "./prismaAdminDatabaseRows";
// Type-only reference to the original projection. No Prisma runtime is used by Mongo.
type Logical<T> = T extends Date ? Date : T extends Prisma.Decimal ? { toString(): string }
  : T extends readonly (infer U)[] ? Logical<U>[] : T extends object ? { [K in keyof T]: Logical<T[K]> } : T;
export type AdminDatabaseRows = Logical<Awaited<ReturnType<typeof readPrismaAdminDatabaseRows>>>;
