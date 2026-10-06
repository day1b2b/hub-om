export interface SourceCoach { id:string; access_token:string|null; employee_id:string|null; name:string; birth_date:unknown; phone:string|null; email:string|null; affiliation:string|null; work_type:string|null; status:string; status_note:string|null; return_date:unknown; self_note:string|null; portfolio_url:string|null; availability_detail:string|null; manager_note:string|null; dx_tag:string|null; deleted_at:Date|null; deleted_by:string|null; }
export interface SourceEngagement { id:string; coach_id:string; course_name:string; status:string; source:string; start_date:unknown; end_date:unknown; start_time:string|null; end_time:string|null; rating:number|null; feedback:string|null; rehire:boolean|null; hired_by:string|null; }
export interface SourceEngagementSchedule { id:string; engagement_id:string; coach_id:string; date:unknown; start_time:string; end_time:string; cancelled_at:Date|null; }
export interface SourceCoachSchedule { id:string; coach_id:string; date:unknown; start_time:string; end_time:string; updated_at:Date|null; }
export interface SourceScheduleAccessLog { id:string; coach_id:string; year_month:string; accessed_at:Date; last_edited_at:Date|null; }
export interface SourceTag { id:string; name:string; }
export interface SourceCoachTag { coach_id:string; tag_id:string; }
export interface CoachDbImportSourceData { coaches:SourceCoach[]; engagements:SourceEngagement[]; engagementSchedules:SourceEngagementSchedule[]; coachSchedules:SourceCoachSchedule[]; scheduleAccessLogs:SourceScheduleAccessLog[]; fields:SourceTag[]; coachFields:SourceCoachTag[]; curriculums:SourceTag[]; coachCurriculums:SourceCoachTag[]; }
export interface CoachDbImportSummary { coachCount:number; engagementCount:number; scheduleCount:number; matchedOperationCount:number; unmatchedOperationCount:number; errorCount:number; }
export interface CoachDbImportRepository { importCoachData(data:CoachDbImportSourceData, apply:boolean, startedAt:Date):Promise<CoachDbImportSummary>; }
export function emptyCoachDbImportSummary():CoachDbImportSummary { return { coachCount:0,engagementCount:0,scheduleCount:0,matchedOperationCount:0,unmatchedOperationCount:0,errorCount:0 }; }
export function coachImportDate(value:unknown):string { if(!value)return ""; if(value instanceof Date)return value.toISOString().slice(0,10); const match=/^(\d{4})-(\d{2})-(\d{2})/.exec(String(value).trim()); return match?.[0]??""; }
export function coachImportName(value:string|null|undefined):string { return String(value??"").trim().replace(/\s+/g," ").toLowerCase(); }
