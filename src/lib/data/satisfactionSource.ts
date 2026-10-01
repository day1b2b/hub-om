import { getDataRepositoryOverride } from "./dataRepositoryContext";
import { readDefaultSatisfactionRows } from "./satisfactionDefaultSource";

export interface SatisfactionSource {
  readRows(spreadsheetId: string, tabTitle: string): Promise<string[][]>;
}

const defaultSource: SatisfactionSource = Object.freeze({
  async readRows(spreadsheetId: string, tabTitle: string) {
    return readDefaultSatisfactionRows(spreadsheetId, tabTitle);
  }
});

export function getSatisfactionSource(): SatisfactionSource {
  return getDataRepositoryOverride("satisfactionSource") ?? defaultSource;
}
