import pg from "pg";
import type { CoachDbImportSourceData, SourceCoach, SourceCoachSchedule, SourceCoachTag, SourceEngagement, SourceEngagementSchedule, SourceScheduleAccessLog, SourceTag } from "./coachDbImportRepository";
const {Client}=pg;
export async function readCoachDbImportSource(connectionString:string):Promise<CoachDbImportSourceData>{
 const client=new Client({connectionString,connectionTimeoutMillis:5_000,options:"-c default_transaction_read_only=on -c statement_timeout=120000 -c idle_in_transaction_session_timeout=120000"});
 try{await client.connect();const mode=await client.query<{transaction_read_only:string}>("SHOW transaction_read_only");if(mode.rows[0]?.transaction_read_only!=="on")throw new Error("SOURCE_NOT_READ_ONLY");await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
  // node-postgres serializes one connection internally; keep the sequence explicit so
  // future pg versions do not reject concurrent query() calls on this fixed snapshot.
  const coaches=await client.query<SourceCoach>(`SELECT id,access_token,employee_id,name,to_char(birth_date,'YYYY-MM-DD') AS birth_date,phone,email,affiliation,work_type,status,status_note,to_char(return_date,'YYYY-MM-DD') AS return_date,self_note,portfolio_url,availability_detail,manager_note,dx_tag,deleted_at,deleted_by FROM coaches`);
  const engagements=await client.query<SourceEngagement>(`SELECT id,coach_id,course_name,status,source,to_char(start_date,'YYYY-MM-DD') AS start_date,to_char(end_date,'YYYY-MM-DD') AS end_date,start_time,end_time,rating,feedback,rehire,hired_by FROM engagements`);
  const engagementSchedules=await client.query<SourceEngagementSchedule>(`SELECT id,engagement_id,coach_id,to_char(date,'YYYY-MM-DD') AS date,start_time,end_time,cancelled_at FROM engagement_schedules`);
  const coachSchedules=await client.query<SourceCoachSchedule>(`SELECT id,coach_id,to_char(date,'YYYY-MM-DD') AS date,start_time,end_time,updated_at FROM coach_schedules`);
  const scheduleAccessLogs=await client.query<SourceScheduleAccessLog>(`SELECT id,coach_id,year_month,accessed_at,last_edited_at FROM schedule_access_logs`);
  const fields=await client.query<SourceTag>(`SELECT id,name FROM fields`);
  const coachFields=await client.query<SourceCoachTag>(`SELECT coach_id,field_id AS tag_id FROM coach_fields`);
  const curriculums=await client.query<SourceTag>(`SELECT id,name FROM curriculums`);
  const coachCurriculums=await client.query<SourceCoachTag>(`SELECT coach_id,curriculum_id AS tag_id FROM coach_curriculums`);
  await client.query("COMMIT");return{coaches:coaches.rows,engagements:engagements.rows,engagementSchedules:engagementSchedules.rows,coachSchedules:coachSchedules.rows,scheduleAccessLogs:scheduleAccessLogs.rows,fields:fields.rows,coachFields:coachFields.rows,curriculums:curriculums.rows,coachCurriculums:coachCurriculums.rows};
 }catch{await client.query("ROLLBACK").catch(()=>{});throw new Error("COACH_DB_IMPORT_SOURCE_FAILED");}finally{await client.end().catch(()=>{});}
}
