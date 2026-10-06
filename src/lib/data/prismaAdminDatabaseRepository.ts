import { getPrismaClient } from "./prisma";
import { getAdminEditableField } from "../admin/databaseEditConfig";
import { buildDatabaseDashboard } from "../admin/databaseDashboardPresenter";
import { AdminDatabaseCellError, type AdminDatabaseRepository, type AdminDatabaseCellUpdate } from "./adminDatabaseRepository";
import { readPrismaAdminDatabaseRows } from "./prismaAdminDatabaseRows";

export class PrismaAdminDatabaseRepository implements AdminDatabaseRepository {
  async readDashboard() { return buildDatabaseDashboard(await readPrismaAdminDatabaseRows()); }
  async updateCell(input: AdminDatabaseCellUpdate): Promise<void> {
    if (!getAdminEditableField(input.table, input.field)) throw new AdminDatabaseCellError("READ_ONLY_FIELD");
    const prisma = getPrismaClient();
    if (input.table === "companies") {
      await prisma.company.update({
        data: input.field === "name"
          ? { name: String(input.value), normalizedName: normalizeName(String(input.value)) }
          : { [input.field]: input.value },
        where: { id: input.rowId }
      });
      return;
    }

    if (input.table === "courses") {
      await prisma.course.update({
        data: { [input.field]: input.value },
        where: { id: input.rowId }
      });
      return;
    }

    if (input.table === "members") {
      await prisma.member.update({
        data: input.field === "name"
          ? { name: String(input.value), normalizedName: normalizeName(String(input.value)) }
          : { [input.field]: input.value },
        where: { id: input.rowId }
      });
      return;
    }

    await prisma.operationSession.update({
      data: {
        [input.field]: input.value,
        updatedBy: input.updatedBy
      },
      where: { id: input.rowId }
    });
  }
}
function normalizeName(value: string) { return value.trim().replace(/\s+/g, " ").toLowerCase(); }
