import { getDataRepositoryOverride } from "../dataRepositoryContext";
import type { SupplyRepository } from "./supplyRepository";
import { PrismaSupplyRepository } from "./prismaSupplyRepository";

/** runSupplyRequest 안에서는 Mongo 저장소, 그 밖(OPERATION_PAGES_BACKEND=postgres)에서는 PostgreSQL 저장소를 쓴다. */
export function getSupplyRepository(): SupplyRepository {
  return getDataRepositoryOverride("supplies") ?? new PrismaSupplyRepository();
}
