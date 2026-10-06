import { randomUUID } from "node:crypto";
import { generateCoachAccessToken, normalizeCoachName } from "./accessToken";
import { expandDateRange, parseLooseDate, toDateKey } from "./dateParse";
import { cell, expandWeekdaySchedules, normalizeEmail, normalizePhone, parseWorkSchedules, type WorkSchedule } from "./sheetParsers";
import { mergeWorkTypeStrings, normalizeWorkTypeString } from "./workType";
import { emptySyncResult, type SyncResult } from "./syncTypes";
import type { CoachEngagementStatus } from "../data/coachEngagementRepository";
import type { CoachSheetSyncRepository, SheetEngagementWrite, SheetPrivateFields, SheetSyncCoach } from "../data/coachSheetSyncRepository";

interface CoachSupplement extends SheetPrivateFields { workType: string | null; hiredByText?: string | null }
interface ParsedContract {
  rowNumber: number; coachName: string; coachId: string; courseName: string; startDate: Date; endDate: Date;
  startTime: string | null; endTime: string | null; hiredByText: string | null; status: CoachEngagementStatus; schedules: WorkSchedule[];
}
function byName(coaches: SheetSyncCoach[]) { return new Map(coaches.map(coach => [coach.name, coach])); }
function emptyPrivate(): SheetPrivateFields { return { employeeId: null, email: null, phone: null }; }
/** Read-modify-write supplementation is shared by both backends and rechecks manual values under the guard. */
async function ensureCoach(repository: CoachSheetSyncRepository, name: string, values: CoachSupplement, source: "sheet" | "samsung", allowCreate = true) {
  return repository.transaction(async tx => {
    const found = await tx.findLiveCoachByName(name);
    if (!found && !allowCreate) return null;
    const id = found?.id ?? randomUUID();
    await tx.lockCoaches([id]);
    const current = found ? await tx.getCoach(id) : null;
    if (found && !current) throw new Error("동기화 대상 코치가 변경되었습니다.");
    const workType = source === "samsung" ? mergeWorkTypeStrings(current?.workType, "삼전 DS", values.workType) : mergeWorkTypeStrings(current?.workType, values.workType);
    const privateFields = { employeeId: values.employeeId, email: values.email, phone: values.phone };
    if (!current) {
      const coach = await tx.createCoach({ id, sourceCoachId: `${source}:${normalizeCoachName(name)}`, accessToken: generateCoachAccessToken(), name, normalizedName: normalizeCoachName(name), workType, ...(source === "samsung" ? { dxTag: "DS" } : {}), privateProfile: privateFields });
      return { coach, created: true };
    }
    if (source === "samsung" || workType !== current.workType) await tx.patchCoach(id, { workType, ...(source === "samsung" ? { dxTag: "DS" } : {}) });
    if (values.employeeId || values.email || values.phone) {
      const patch: Partial<SheetPrivateFields> = {};
      for (const field of ["employeeId", "email", "phone"] as const) if (!current.privateProfile?.[field] && values[field]) patch[field] = values[field];
      await tx.upsertPrivateProfile(id, privateFields, patch);
    }
    return { coach: { ...current, workType }, created: false };
  });
}
export function collectEmployeeIds(rows: string[][]): Map<string, string> {
  const noise = new Set(["취소", "입사취소", "입사 취소", "계약취소", "근무취소", "사번없음", "-"]);
  const values = new Map<string, Set<string>>();
  for (let index = 1; index < rows.length; index++) {
    const name = cell(rows[index], 4), employeeId = cell(rows[index], 3).replace(/-\d+$/, "").replace(/\(.*?\)/g, "").trim();
    if (!name || !employeeId || noise.has(employeeId)) continue;
    if (!values.has(name)) values.set(name, new Set()); values.get(name)!.add(employeeId);
  }
  return new Map([...values].map(([name, ids]) => [name, [...ids].sort().join(", ")]));
}
function statusFromDates(startDate: Date, endDate: Date): CoachEngagementStatus {
  const today = new Date();
  if (endDate < today) return "COMPLETED";
  if (startDate <= today && endDate >= today) return "IN_PROGRESS";
  return "SCHEDULED";
}
function contractSourceId(row: ParsedContract) { return `contract-sheet:${row.rowNumber}:${row.coachName}:${toDateKey(row.startDate)}:${toDateKey(row.endDate)}`; }
function engagementWrite(row: ParsedContract): SheetEngagementWrite {
  return { sourceEngagementId: contractSourceId(row), coachId: row.coachId, courseName: row.courseName, status: row.status, source: "SHEET", startDate: row.startDate, endDate: row.endDate, startTime: row.startTime, endTime: row.endTime, hiredByText: row.hiredByText };
}

export async function runContractSheetSync(snapshot: { values: string[][]; struckCells: Set<string> }, repository: CoachSheetSyncRepository, dryRun: boolean): Promise<SyncResult> {
  const { values: rows, struckCells } = snapshot, result = emptySyncResult(dryRun);
  result.totalRows = Math.max(0, rows.length - 1);
  const coaches = byName(await repository.listLiveCoaches()), employeeIds = collectEmployeeIds(rows), parsed: ParsedContract[] = [];
  for (let index = 1; index < rows.length; index++) {
    const row = rows[index], rowNumber = index + 1, coachName = cell(row, 4), courseName = cell(row, 7);
    const startDate = parseLooseDate(row[9]), endDate = parseLooseDate(row[10]);
    if (!coachName || !courseName || courseName.includes("취소") || cell(row, 0).includes("취소") || struckCells.has(`${index}:7`)) { result.skipped++; continue; }
    if (!startDate || !endDate) { result.skipped++; result.errorDetail.push(`${rowNumber}행 날짜 누락: ${coachName} / ${courseName}`); continue; }
    const values = { workType: normalizeWorkTypeString(cell(row, 5)), employeeId: employeeIds.get(coachName) ?? null, email: normalizeEmail(cell(row, 13)), phone: normalizePhone(cell(row, 14)) };
    let coach = coaches.get(coachName);
    if (dryRun) {
      if (!coach) {
        if (startDate.getUTCFullYear() < 2026) { result.skipped++; continue; }
        coach = { id: `dry-run:${coachName}`, name: coachName, workType: values.workType, privateProfile: null };
        coaches.set(coachName, coach); result.created++; result.changes?.push({ coachName, courseName, action: "create_coach", details: "계약 시트 신규 코치" });
      }
    } else {
      const ensured = await ensureCoach(repository, coachName, values, "sheet", startDate.getUTCFullYear() >= 2026);
      if (!ensured) { result.skipped++; continue; }
      coach = ensured.coach; coaches.set(coachName, coach); if (ensured.created) result.created++;
    }
    const explicit = parseWorkSchedules(row[12], startDate.getUTCFullYear());
    const schedules = explicit.length ? explicit : expandWeekdaySchedules(startDate, endDate, row[12]);
    parsed.push({ rowNumber, coachName, coachId: coach.id, courseName, startDate, endDate, startTime: schedules[0]?.startTime ?? null, endTime: schedules[0]?.endTime ?? null, hiredByText: cell(row, 6) || null, status: statusFromDates(startDate, endDate), schedules });
  }
  // Deliberately preserve phase boundaries: successful coach supplements remain if a later engagement fails.
  for (const row of parsed) {
    if (dryRun) {
      const existing = row.coachId.startsWith("dry-run:") ? null : await repository.findMatchingEngagement(engagementWrite(row));
      if (existing) result.updated++; else result.created++;
      result.changes?.push({ coachName: row.coachName, courseName: row.courseName, action: existing ? "update_engagement" : "create_engagement", details: `스케줄 ${row.schedules.length}건` }); continue;
    }
    const updated = await repository.transaction(async tx => {
      const write = engagementWrite(row), initial = await tx.findMatchingEngagement(write);
      await tx.lockCoaches([...new Set([row.coachId, ...(initial ? [initial.coachId] : [])])].sort());
      if (!await tx.getCoach(row.coachId)) throw new Error("동기화 대상 코치가 변경되었습니다.");
      const existing = await tx.findMatchingEngagement(write);
      let engagementId: string;
      if (existing) {
        const patch = { sourceEngagementId: write.sourceEngagementId, courseName: write.courseName, status: write.status, source: write.source, startDate: write.startDate, endDate: write.endDate, startTime: write.startTime, endTime: write.endTime, hiredByText: write.hiredByText };
        await tx.patchEngagement(existing.id, patch); engagementId = existing.id;
      } else engagementId = (await tx.createEngagement(write)).id;
      await tx.replaceSchedules(engagementId, row.schedules.map((schedule, index) => ({ ...schedule, sourceEngagementScheduleId: `${contractSourceId(row)}:${index}:${toDateKey(schedule.date)}`, engagementId, coachId: row.coachId })));
      await tx.cancelReservations(row.schedules.map(schedule => ({ coachId: row.coachId, date: schedule.date, engagementId })));
      return Boolean(existing);
    });
    if (updated) result.updated++; else result.created++;
  }
  return result;
}

export function parseSamsungContracts(rows: string[][]): Map<string, CoachSupplement> {
  const map = new Map<string, CoachSupplement>();
  for (let index = 2; index < rows.length; index++) {
    const row = rows[index], name = cell(row, 5); if (!name) continue;
    map.set(name, { employeeId: cell(row, 4) || null, workType: normalizeWorkTypeString(cell(row, 6)), hiredByText: cell(row, 7) || null, email: normalizeEmail(cell(row, 14)), phone: normalizePhone(cell(row, 15)) });
  }
  return map;
}
export async function runSamsungSheetSync(snapshot: { rows: string[][]; contractRows: string[][] }, repository: CoachSheetSyncRepository, dryRun: boolean, names: { courseName: string; oldCourseName: string }): Promise<SyncResult> {
  const { rows, contractRows } = snapshot, result = emptySyncResult(dryRun), contracts = parseSamsungContracts(contractRows);
  result.totalRows = Math.max(0, rows.length - 1);
  const coaches = byName(await repository.listLiveCoaches());
  const entries: Array<{ coachName: string; coachId: string; startDate: Date; endDate: Date; hiredByText: string | null }> = [];
  for (let index = 1; index < rows.length; index++) {
    const row = rows[index], startDate = parseLooseDate(row[2]), endDate = parseLooseDate(row[3]) ?? startDate;
    const coachNames = cell(row, 6).split(/[/／,]/).map(name => name.trim()).filter(Boolean);
    if (!startDate || !endDate || !coachNames.length) { result.skipped++; continue; }
    for (const coachName of coachNames) {
      const contract = contracts.get(coachName);
      let coach = coaches.get(coachName);
      if (dryRun) {
        if (!coach) { coach = { id: `dry-run:${coachName}`, name: coachName, workType: mergeWorkTypeStrings("삼전 DS", contract?.workType), privateProfile: null }; coaches.set(coachName, coach); result.created++; result.changes?.push({ coachName, courseName: names.courseName, action: "create_coach", details: "삼성 일정 신규 코치" }); }
      } else {
        const ensured = await ensureCoach(repository, coachName, contract ?? { ...emptyPrivate(), workType: null }, "samsung");
        if (!ensured) throw new Error("동기화 대상 코치가 변경되었습니다.");
        coach = ensured.coach; coaches.set(coachName, coach); if (ensured.created) result.created++;
      }
      entries.push({ coachName, coachId: coach.id, startDate, endDate, hiredByText: contract?.hiredByText ?? null });
    }
  }
  if (dryRun) { result.created += entries.length; result.changes?.push({ coachName: "삼성 일정", courseName: names.courseName, action: "replace_samsung_engagements", details: `재생성 대상 ${entries.length}건` }); return result; }
  await repository.transaction(async tx => {
    const old = await tx.listEngagementsByCourseNames([names.courseName, names.oldCourseName]);
    const reservationCoachIds = await tx.listReservationCoachIdsForEngagements(old.map(row => row.id));
    const coachIds = [...new Set([...old.map(row => row.coachId), ...entries.map(row => row.coachId), ...reservationCoachIds])].sort();
    await tx.lockCoaches(coachIds);
    const current = await tx.listEngagementsByCourseNames([names.courseName, names.oldCourseName]);
    const currentReservationCoachIds = await tx.listReservationCoachIdsForEngagements(current.map(row => row.id));
    if (current.some(row => !coachIds.includes(row.coachId)) || currentReservationCoachIds.some(id => !coachIds.includes(id))) throw new Error("동기화 대상 과정이 변경되었습니다.");
    for (const id of new Set(entries.map(row => row.coachId))) if (!await tx.getCoach(id)) throw new Error("동기화 대상 코치가 변경되었습니다.");
    await tx.deleteEngagements(current.map(row => row.id));
    const confirmed: Array<{ coachId: string; date: Date; engagementId: string }> = [];
    for (let index = 0; index < entries.length; index++) {
      const row = entries[index];
      const engagement = await tx.createEngagement({ sourceEngagementId: `samsung:${index}:${row.coachName}:${toDateKey(row.startDate)}:${toDateKey(row.endDate)}`, coachId: row.coachId, courseName: names.courseName, status: statusFromDates(row.startDate, row.endDate), source: "SHEET", startDate: row.startDate, endDate: row.endDate, startTime: "09:00", endTime: "18:00", hiredByText: row.hiredByText });
      const schedules = expandDateRange(row.startDate, row.endDate).map((date, dateIndex) => ({ sourceEngagementScheduleId: `samsung:${index}:${dateIndex}:${row.coachName}:${toDateKey(date)}`, engagementId: engagement.id, coachId: row.coachId, date, startTime: "09:00", endTime: "18:00" }));
      await tx.replaceSchedules(engagement.id, schedules);
      confirmed.push(...schedules.map(schedule => ({ coachId: row.coachId, date: schedule.date, engagementId: engagement.id })));
    }
    await tx.cancelReservations(confirmed);
  }, { timeoutMs: 60000 });
  result.created += entries.length;
  return result;
}
