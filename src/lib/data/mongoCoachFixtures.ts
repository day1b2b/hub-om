/** Synthetic fixtures shared by mocked-reference and optional real Mongo verification. */
import { randomUUID } from "node:crypto";
import { mongoRuntimeContracts } from "./mongoRuntimeCodec";
import { completeMongoRow, type MongoRow } from "./mongoOperationStore";
export function coachFixtureRow(model: string, values: MongoRow): MongoRow {
  const row = completeMongoRow(model, values);
  // Generated business identifiers must satisfy the real unique indexes too.
  const syntheticId = randomUUID();
  for (const [name, field] of Object.entries(mongoRuntimeContracts[model].fields)) {
    if (Object.hasOwn(row, name) || name.endsWith("PiiIndex") || name.endsWith("Encrypted")) continue;
    row[name] = field.values ? field.values[0] : field.uuid ? randomUUID() : field.type === "DateTime" ? new Date("2099-12-01T00:00:00.000Z") : field.type === "Int" ? 0 : field.type === "Boolean" ? false : field.type === "Json" ? {} : `Synthetic-${name}-${syntheticId}`;
  }
  return row;
}
export function mongoCoachFixtures() {
  const data = new Map<string, MongoRow[]>();
  const add = (model: string, values: MongoRow) => { const row = coachFixtureRow(model, values); data.set(model, [...(data.get(model) ?? []), row]); return row; };
  const a = add("Coach", { name: "가상 가", normalizedName: "가상가", sourceCoachId: "synthetic-source-a", status: "ACTIVE", isActive: true, displayOrder: 0, accessToken: "synthetic-token", statusNote: null });
  const b = add("Coach", { name: "가상 나", normalizedName: "가상나", sourceCoachId: "synthetic-source-b", status: "ACTIVE", isActive: true, displayOrder: 1, statusNote: "" });
  const deleted = add("Coach", { name: "삭제 가상", normalizedName: "삭제가상", sourceCoachId: "synthetic-deleted", status: "ACTIVE", isActive: true, deletedAt: new Date("2099-12-01"), displayOrder: 2 });
  add("Coach", { name: "비활성 가상", normalizedName: "비활성가상", sourceCoachId: "synthetic-inactive", status: "INACTIVE", isActive: false, displayOrder: null });
  const field=add("CoachFieldMaster",{name:"Synthetic field"}); const curriculum=add("CoachCurriculumMaster",{name:"Synthetic curriculum"});
  add("CoachField",{coachId:a.id,tagId:field.id}); add("CoachCurriculum",{coachId:a.id,tagId:curriculum.id});
  const e1=add("CoachEngagement",{coachId:a.id,courseName:"Synthetic first",source:"MANUAL",status:"SCHEDULED",startDate:new Date("2099-12-01"),endDate:new Date("2099-12-01"),rating:4,feedback:"Synthetic feedback",hiredByText:"Synthetic private hirer"});
  const e2=add("CoachEngagement",{coachId:a.id,courseName:"Synthetic second",source:"SHEET",status:"COMPLETED",startDate:new Date("2099-12-31"),endDate:new Date("2099-12-31"),rating:2});
  add("CoachEngagement",{coachId:a.id,courseName:"Synthetic cancelled",source:"SHEET",status:"CANCELLED",startDate:new Date("2099-12-02"),endDate:new Date("2099-12-02"),rating:null});
  for(const date of ["2099-12-01","2099-12-31","2100-01-01"]) add("CoachSchedule",{coachId:a.id,date:new Date(date),startTime:"09:00",endTime:"18:00"});
  add("CoachSchedule",{coachId:b.id,date:new Date("2099-12-01"),startTime:"09:00",endTime:"18:00"});
  add("CoachSchedule",{coachId:deleted.id,date:new Date("2099-12-01"),startTime:"09:00",endTime:"18:00"});
  add("CoachEngagementSchedule",{coachId:a.id,engagementId:e1.id,date:new Date("2099-12-01"),startTime:"09:00",endTime:"10:00"});
  add("CoachEngagementSchedule",{coachId:a.id,engagementId:e1.id,date:new Date("2099-12-01"),startTime:"10:00",endTime:"11:00"});
  add("CoachEngagementSchedule",{coachId:a.id,engagementId:e2.id,date:new Date("2099-12-31"),startTime:"09:00",endTime:"18:00",cancelledAt:new Date("2099-12-01")});
  add("CoachDayReservation",{coachId:a.id,date:new Date("2099-12-01"),reservedByName:"Synthetic reserver",reservedByEmail:"synthetic@example.invalid"});
  add("CoachPrivateProfile",{coachId:a.id,phone:"010-0000-0000",email:"synthetic-profile@example.invalid",employeeId:"SYNTHETIC-ID",birthDate:new Date("2000-01-02"),affiliation:"Synthetic affiliation"});
  const old=add("CoachdbArchiveSnapshot",{status:"completed",startedAt:new Date("2099-11-01")});
  const latest=add("CoachdbArchiveSnapshot",{status:"completed",startedAt:new Date("2099-12-01")});
  const pending=add("CoachdbArchiveSnapshot",{status:"pending",startedAt:new Date("2099-12-02")});
  for(const [snapshot,note] of [[old,"old"],[latest,"latest"],[pending,"pending"]] as const) add("CoachdbArchiveRow",{snapshotId:snapshot.id,tableSchema:"public",tableName:"coaches",rowKey:a.sourceCoachId,rowData:{status_note:note,return_date:"2100-01-01",availability_detail:"Synthetic available",dx_tag:"Synthetic DX"}});
  return {data,a,b,deleted};
}
