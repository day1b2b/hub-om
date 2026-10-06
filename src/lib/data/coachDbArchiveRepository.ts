export interface CoachDbArchiveRow { rowKey: string; rowData: Record<string, unknown>; }
export interface CoachDbArchiveTable { schema: string; name: string; rowCount: number; rows: CoachDbArchiveRow[]; }
export interface CoachDbArchiveInput { sourceDatabase: string; sourceSchema: "public"; tables: CoachDbArchiveTable[]; }
export interface CoachDbArchiveSummary { tableCount: number; rowCount: number; tables: Array<{ schema: string; name: string; rowCount: number }>; }
export interface CoachDbArchiveRepository { archive(input: CoachDbArchiveInput, apply: boolean): Promise<CoachDbArchiveSummary>; }
export function summarizeCoachDbArchive(input: CoachDbArchiveInput): CoachDbArchiveSummary {
  return { tableCount: input.tables.length, rowCount: input.tables.reduce((sum, table) => sum + table.rowCount, 0),
    tables: input.tables.map(({ schema, name, rowCount }) => ({ schema, name, rowCount })) };
}
