import { getDataRepositoryOverride } from "../dataRepositoryContext";
import type { EggRepository } from "./eggRepository";
import { PrismaEggRepository } from "./prismaEggRepository";

/** runEggRequest 안에서는 Mongo 저장소, 그 밖(OPERATION_PAGES_BACKEND=postgres)에서는 PostgreSQL 저장소를 쓴다. */
export function getEggRepository(): EggRepository {
  return getDataRepositoryOverride("eggs") ?? new PrismaEggRepository();
}
