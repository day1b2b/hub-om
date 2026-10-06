import assert from "node:assert/strict";
import test from "node:test";
import pg from "pg";
import { readCoachDbImportSource } from "./coachDbImportSource";

const url=process.env.POSTGRES_COACH_DB_IMPORT_SOURCE_TEST_URL;
test("coach DB import reads all source tables through a read-only snapshot",{skip:!url,timeout:120_000},async()=>{
 const parsed=new URL(url!);assert.equal(parsed.hostname,"127.0.0.1");assert.equal(parsed.pathname,"/coach_import_source_test");assert.equal(parsed.password,"");const client=new pg.Client({connectionString:url});
 try{await client.connect();await client.query(`
  DROP TABLE IF EXISTS coach_curriculums, curriculums, coach_fields, fields, schedule_access_logs, coach_schedules, engagement_schedules, engagements, coaches CASCADE;
  CREATE TABLE coaches(id text primary key,access_token text not null,employee_id text,name text not null,birth_date date,phone text,email text,affiliation text,work_type text,status text not null,status_note text,return_date date,self_note text,portfolio_url text,availability_detail text,manager_note text,dx_tag text,deleted_at timestamptz,deleted_by text);
  CREATE TABLE engagements(id text primary key,coach_id text,course_name text,status text,source text,start_date date,end_date date,start_time text,end_time text,rating int,feedback text,rehire boolean,hired_by text);
  CREATE TABLE engagement_schedules(id text primary key,engagement_id text,coach_id text,date date,start_time text,end_time text,cancelled_at timestamptz);
  CREATE TABLE coach_schedules(id text primary key,coach_id text,date date,start_time text,end_time text,updated_at timestamptz);
  CREATE TABLE schedule_access_logs(id text primary key,coach_id text,year_month text,accessed_at timestamptz,last_edited_at timestamptz);
  CREATE TABLE fields(id text primary key,name text);CREATE TABLE coach_fields(coach_id text,field_id text);CREATE TABLE curriculums(id text primary key,name text);CREATE TABLE coach_curriculums(coach_id text,curriculum_id text);
  INSERT INTO coaches VALUES('source-a','token-a','employee-a','Synthetic Source','2000-01-02','010-0000','private@example.invalid','Org','Work','active',NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL);
  INSERT INTO engagements VALUES('eng-a','source-a','Course','scheduled','manual','2099-06-01','2099-06-01','09:00','18:00',5,'Private',true,'Private hirer');
  INSERT INTO engagement_schedules VALUES('eng-s-a','eng-a','source-a','2099-06-01','09:00','18:00',NULL);INSERT INTO coach_schedules VALUES('schedule-a','source-a','2099-06-01','09:00','18:00',now());INSERT INTO schedule_access_logs VALUES('log-a','source-a','2099-06',now(),NULL);INSERT INTO fields VALUES('field-a','Field');INSERT INTO coach_fields VALUES('source-a','field-a');INSERT INTO curriculums VALUES('curriculum-a','Curriculum');INSERT INTO coach_curriculums VALUES('source-a','curriculum-a');
 `);const result=await readCoachDbImportSource(url!);assert.equal(result.coaches.length,1);assert.equal(result.engagements.length,1);assert.equal(result.engagementSchedules.length,1);assert.equal(result.coachSchedules.length,1);assert.equal(result.scheduleAccessLogs.length,1);assert.equal(result.fields.length,1);assert.equal(result.coachFields[0].tag_id,"field-a");assert.equal(result.curriculums.length,1);assert.equal(result.coachCurriculums[0].tag_id,"curriculum-a");assert.equal(result.coaches[0].name,"Synthetic Source");assert.equal(result.coaches[0].birth_date,"2000-01-02");assert.equal(result.engagements[0].start_date,"2099-06-01");assert.equal(result.engagementSchedules[0].date,"2099-06-01");assert.equal(result.coachSchedules[0].date,"2099-06-01");
 }finally{try{await client.query("DROP TABLE IF EXISTS coach_curriculums, curriculums, coach_fields, fields, schedule_access_logs, coach_schedules, engagement_schedules, engagements, coaches CASCADE");}finally{await client.end();}}
});
