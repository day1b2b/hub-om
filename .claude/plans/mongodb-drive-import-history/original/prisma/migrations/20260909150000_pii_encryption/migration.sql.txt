-- Maintenance migration; backfill before resuming application traffic.
BEGIN;
SET LOCAL lock_timeout = '5s';
-- AlterTable
ALTER TABLE "operation_sessions" ADD COLUMN     "avg_satisfaction_pii_index" TEXT,
ADD COLUMN     "coach_text_pii_index" TEXT,
ADD COLUMN     "company_wiki_link_pii_index" TEXT,
ADD COLUMN     "cost_raw_pii_index" TEXT,
ADD COLUMN     "created_by_pii_index" TEXT,
ADD COLUMN     "deleted_by_pii_index" TEXT,
ADD COLUMN     "drive_link_pii_index" TEXT,
ADD COLUMN     "education_format_raw_pii_index" TEXT,
ADD COLUMN     "instructor_satisfaction_pii_index" TEXT,
ADD COLUMN     "instructor_wiki_link_pii_index" TEXT,
ADD COLUMN     "instructors_text_pii_index" TEXT,
ADD COLUMN     "ld_name_pii_index" TEXT,
ADD COLUMN     "ld_user_id_pii_index" TEXT,
ADD COLUMN     "lecture_management_link_pii_index" TEXT,
ADD COLUMN     "lecture_management_note_pii_index" TEXT,
ADD COLUMN     "om_name_pii_index" TEXT,
ADD COLUMN     "om_update_pii_index" TEXT,
ADD COLUMN     "om_user_id_pii_index" TEXT,
ADD COLUMN     "onsite_om_name_pii_index" TEXT,
ADD COLUMN     "onsite_text_pii_index" TEXT,
ADD COLUMN     "operation_detail_pii_index" TEXT,
ADD COLUMN     "operation_issue_pii_index" TEXT,
ADD COLUMN     "padlet_link_pii_index" TEXT,
ADD COLUMN     "profit_raw_pii_index" TEXT,
ADD COLUMN     "region_pii_index" TEXT,
ADD COLUMN     "result_report_link_pii_index" TEXT,
ADD COLUMN     "special_notes_pii_index" TEXT,
ADD COLUMN     "updated_by_pii_index" TEXT;

-- AlterTable
ALTER TABLE "drive_import_runs" ADD COLUMN     "notes_pii_index" TEXT;

-- AlterTable
ALTER TABLE "drive_import_results" ADD COLUMN     "error_pii_index" TEXT,
ADD COLUMN     "folder_id_pii_index" TEXT,
ADD COLUMN     "folder_title_pii_index" TEXT,
ADD COLUMN     "folder_url_pii_index" TEXT,
ADD COLUMN     "input_value_pii_index" TEXT;

-- AlterTable
ALTER TABLE "members" ADD COLUMN     "calendar_id_pii_index" TEXT,
ADD COLUMN     "name_pii_index" TEXT,
ADD COLUMN     "normalized_name_pii_index" TEXT,
ADD COLUMN     "role_title_pii_index" TEXT;

-- AlterTable
ALTER TABLE "data_import_runs" ADD COLUMN     "file_name_pii_index" TEXT,
ADD COLUMN     "imported_by_pii_index" TEXT,
ADD COLUMN     "notes_pii_index" TEXT,
ADD COLUMN     "source_name_pii_index" TEXT,
ADD COLUMN     "workbook_name_pii_index" TEXT;

-- AlterTable
ALTER TABLE "operation_source_records" ADD COLUMN     "source_sheet_pii_index" TEXT,
ADD COLUMN     "source_workbook_pii_index" TEXT;

-- AlterTable
ALTER TABLE "coaches" ADD COLUMN     "access_token_pii_index" TEXT,
ADD COLUMN     "availability_detail_pii_index" TEXT,
ADD COLUMN     "deleted_by_pii_index" TEXT,
ADD COLUMN     "dx_tag_pii_index" TEXT,
ADD COLUMN     "employee_no_pii_index" TEXT,
ADD COLUMN     "manager_note_pii_index" TEXT,
ADD COLUMN     "name_pii_index" TEXT,
ADD COLUMN     "normalized_name_pii_index" TEXT,
ADD COLUMN     "notion_page_id_pii_index" TEXT,
ADD COLUMN     "portfolio_url_pii_index" TEXT,
ADD COLUMN     "return_date_encrypted" TEXT,
ADD COLUMN     "self_note_pii_index" TEXT,
ADD COLUMN     "source_coach_id_pii_index" TEXT,
ADD COLUMN     "status_note_pii_index" TEXT,
ADD COLUMN     "work_type_pii_index" TEXT;

-- AlterTable
ALTER TABLE "coach_content_entries" ADD COLUMN     "author_email_pii_index" TEXT,
ADD COLUMN     "author_name_pii_index" TEXT,
ADD COLUMN     "content_pii_index" TEXT;

-- AlterTable
ALTER TABLE "coach_private_access_logs" ADD COLUMN     "accessed_by_email_pii_index" TEXT;

-- AlterTable
ALTER TABLE "coach_private_profiles" ADD COLUMN     "affiliation_pii_index" TEXT,
ADD COLUMN     "birth_date_encrypted" TEXT,
ADD COLUMN     "email_pii_index" TEXT,
ADD COLUMN     "employee_id_pii_index" TEXT,
ADD COLUMN     "phone_pii_index" TEXT;

-- AlterTable
ALTER TABLE "coach_day_reservations" ADD COLUMN     "reserved_by_email_pii_index" TEXT,
ADD COLUMN     "reserved_by_name_pii_index" TEXT;

-- AlterTable
ALTER TABLE "coach_engagements" ADD COLUMN     "feedback_pii_index" TEXT,
ADD COLUMN     "hired_by_id_pii_index" TEXT,
ADD COLUMN     "hired_by_text_pii_index" TEXT;

-- AlterTable
ALTER TABLE "coach_import_runs" ADD COLUMN     "notes_pii_index" TEXT;

-- AlterTable
ALTER TABLE "coach_sync_logs" ADD COLUMN     "error_detail_pii_index" TEXT,
ADD COLUMN     "triggered_by_pii_index" TEXT;

-- AlterTable
ALTER TABLE "sales_revenue_sync_logs" ADD COLUMN     "triggered_by_pii_index" TEXT;

-- AlterTable
ALTER TABLE "team_users" ADD COLUMN     "email_pii_index" TEXT,
ADD COLUMN     "name_pii_index" TEXT,
ADD COLUMN     "slack_id_pii_index" TEXT;

-- AlterTable
ALTER TABLE "om_requests" ADD COLUMN     "assigned_om_pii_index" TEXT,
ADD COLUMN     "business_number_pii_index" TEXT,
ADD COLUMN     "drive_link_pii_index" TEXT,
ADD COLUMN     "instructor_name_pii_index" TEXT,
ADD COLUMN     "ld_email_pii_index" TEXT,
ADD COLUMN     "ld_pii_index" TEXT,
ADD COLUMN     "notes_pii_index" TEXT,
ADD COLUMN     "syncup_link_pii_index" TEXT;

-- AlterTable
ALTER TABLE "announcements" ADD COLUMN     "author_email_pii_index" TEXT,
ADD COLUMN     "author_name_pii_index" TEXT,
ADD COLUMN     "content_pii_index" TEXT,
ADD COLUMN     "deleted_by_pii_index" TEXT,
ADD COLUMN     "title_pii_index" TEXT;

-- AlterTable
ALTER TABLE "announcement_attachments" ADD COLUMN     "file_name_pii_index" TEXT;

-- AlterTable
ALTER TABLE "coachdb_archive_snapshots" ADD COLUMN     "error_message_pii_index" TEXT;

-- AlterTable
ALTER TABLE "coachdb_archive_rows" ADD COLUMN     "row_key_pii_index" TEXT;

-- AlterTable
ALTER TABLE "instructor_notes" ADD COLUMN     "display_name_pii_index" TEXT,
ADD COLUMN     "instructor_name_pii_index" TEXT,
ADD COLUMN     "notes_pii_index" TEXT,
ADD COLUMN     "notion_id_pii_index" TEXT,
ADD COLUMN     "partner_id_pii_index" TEXT;

-- AlterTable
ALTER TABLE "calendar_event_links" ADD COLUMN     "calendar_id_pii_index" TEXT,
ADD COLUMN     "event_id_pii_index" TEXT;

-- AlterTable
ALTER TABLE "activity_requests" ADD COLUMN     "actor_email_pii_index" TEXT,
ADD COLUMN     "actor_name_pii_index" TEXT;

-- AlterTable
ALTER TABLE "activity_changes" ADD COLUMN     "actor_email_pii_index" TEXT,
ADD COLUMN     "actor_name_pii_index" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "members_role_source_team_normalized_name_pii_index_key" ON "members"("role", "source_team", "normalized_name_pii_index");

-- CreateIndex
CREATE UNIQUE INDEX "operation_source_records_import_run_id_source_sheet_pii_ind_key" ON "operation_source_records"("import_run_id", "source_sheet_pii_index", "source_row_number");

-- CreateIndex
CREATE UNIQUE INDEX "coaches_source_coach_id_pii_index_key" ON "coaches"("source_coach_id_pii_index");

-- CreateIndex
CREATE UNIQUE INDEX "coaches_access_token_pii_index_key" ON "coaches"("access_token_pii_index");

-- CreateIndex
CREATE UNIQUE INDEX "coaches_employee_no_pii_index_key" ON "coaches"("employee_no_pii_index");

-- CreateIndex
CREATE INDEX "coaches_normalized_name_pii_index_idx" ON "coaches"("normalized_name_pii_index");

-- CreateIndex
CREATE UNIQUE INDEX "coachdb_archive_rows_snapshot_id_table_schema_table_name_ro_key" ON "coachdb_archive_rows"("snapshot_id", "table_schema", "table_name", "row_key_pii_index");

-- CreateIndex
CREATE INDEX "instructor_notes_instructor_name_pii_index_idx" ON "instructor_notes"("instructor_name_pii_index");

-- CreateIndex
CREATE INDEX "activity_requests_actor_email_pii_index_idx" ON "activity_requests"("actor_email_pii_index");

-- CreateIndex
CREATE INDEX "activity_changes_actor_email_pii_index_idx" ON "activity_changes"("actor_email_pii_index");


CREATE OR REPLACE FUNCTION capture_activity_change() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
 context jsonb;
 before_row jsonb := '{}'::jsonb;
 after_row jsonb := '{}'::jsonb;
 row_data jsonb;
 field_name text;
 diff jsonb := '{}'::jsonb;
 action_name text := lower(TG_OP);
 target_key text;
 allow_fields jsonb := TG_ARGV[0]::jsonb;
BEGIN
 -- No context means migrations, scripts or non-API work, not an attributed user request.
 IF nullif(current_setting('app.activity_context', true), '') IS NULL THEN RETURN NULL; END IF;
 context := current_setting('app.activity_context')::jsonb;
 IF TG_OP <> 'INSERT' THEN before_row := to_jsonb(OLD); END IF;
 IF TG_OP <> 'DELETE' THEN after_row := to_jsonb(NEW); END IF;
 row_data := CASE WHEN TG_OP = 'DELETE' THEN before_row ELSE after_row END;
 -- Keep the existing coach history feed; avoid a second history event about the history itself.
 IF TG_TABLE_NAME = 'coach_content_entries' AND row_data->>'kind' = 'EDIT_HISTORY' THEN RETURN NULL; END IF;
 IF TG_OP = 'INSERT' THEN action_name := 'create'; END IF;
 IF TG_OP = 'UPDATE' AND before_row->>'deleted_at' IS NULL AND after_row->>'deleted_at' IS NOT NULL THEN action_name := 'delete'; END IF;
 IF TG_OP = 'UPDATE' AND before_row->>'deleted_at' IS NOT NULL AND after_row->>'deleted_at' IS NULL THEN action_name := 'restore'; END IF;
 FOR field_name IN SELECT jsonb_object_keys(before_row || after_row) LOOP
  IF field_name LIKE '%\_pii_index' ESCAPE '\' THEN CONTINUE; END IF;
  IF field_name LIKE '%\_encrypted' ESCAPE '\' THEN
   IF (before_row->field_name) IS DISTINCT FROM (after_row->field_name) THEN
    diff := diff || jsonb_build_object(left(field_name, length(field_name) - 10), jsonb_build_object('redacted', true));
   END IF;
   CONTINUE;
  END IF;
  -- Randomized encryption changes bytes even when the user's value is unchanged.
  IF (after_row ? (field_name || '_pii_index')) AND (before_row->(field_name || '_pii_index')) IS NOT DISTINCT FROM (after_row->(field_name || '_pii_index')) THEN CONTINUE; END IF;
  IF field_name = ANY(ARRAY['id','created_at','updated_at','created_by','updated_by','deleted_by','normalized_name','source_fingerprint','validation_errors']) THEN CONTINUE; END IF;
  IF (before_row->field_name) IS NOT DISTINCT FROM (after_row->field_name) THEN CONTINUE; END IF;
  -- Compare first: redaction/truncation cannot conceal a real change.
  IF allow_fields ? field_name AND NOT (coalesce(('{"operation_sessions": ["validation_errors", "education_format_raw", "om_name", "ld_name", "instructors_text", "coach_text", "region", "onsite_text", "onsite_om_name", "special_notes", "operation_issue", "om_update", "drive_link", "operation_detail", "company_wiki_link", "instructor_wiki_link", "cost_raw", "profit_raw", "avg_satisfaction", "instructor_satisfaction", "result_report_link", "lecture_management_link", "lecture_management_note", "padlet_link", "created_by", "updated_by", "om_user_id", "ld_user_id", "deleted_by"], "drive_import_runs": ["summary", "notes"], "drive_import_results": ["input_value", "folder_id", "folder_title", "folder_url", "key_candidates", "folder_candidates", "issues", "error"], "members": ["name", "normalized_name", "role_title", "calendar_id"], "data_import_runs": ["source_name", "workbook_name", "file_name", "imported_by", "notes", "validation_logs"], "operation_source_records": ["source_workbook", "source_sheet", "row_snapshot", "mapped_fields", "unmapped_fields", "validation_errors"], "coaches": ["source_coach_id", "access_token", "name", "normalized_name", "work_type", "status_note", "return_date", "self_note", "portfolio_url", "availability_detail", "manager_note", "dx_tag", "employee_no", "notion_page_id", "deleted_by"], "coach_content_entries": ["content", "author_email", "author_name"], "coach_private_access_logs": ["accessed_by_email"], "coach_private_profiles": ["employee_id", "phone", "email", "birth_date", "affiliation"], "coach_day_reservations": ["reserved_by_email", "reserved_by_name"], "coach_engagements": ["feedback", "hired_by_id", "hired_by_text"], "coach_import_runs": ["summary", "notes"], "coach_sync_logs": ["error_detail", "triggered_by"], "sales_revenue_sync_logs": ["triggered_by", "detail"], "team_users": ["name", "email", "slack_id"], "om_requests": ["assigned_om", "ld_email", "ld", "business_number", "instructor_name", "syncup_link", "drive_link", "sessions", "notes"], "announcements": ["title", "content", "author_email", "author_name", "deleted_by"], "announcement_attachments": ["file_name", "data"], "coachdb_archive_snapshots": ["error_message"], "coachdb_archive_rows": ["row_key", "row_data"], "instructor_notes": ["instructor_name", "display_name", "notion_id", "partner_id", "notes", "notion_profile"], "calendar_event_links": ["calendar_id", "event_id"], "activity_requests": ["actor_email", "actor_name"], "activity_changes": ["actor_email", "actor_name", "changes"]}'::jsonb)->TG_TABLE_NAME, '[]'::jsonb) ? field_name) THEN
   diff := diff || jsonb_build_object(field_name, jsonb_build_object('before', activity_safe_value(before_row->field_name), 'after', activity_safe_value(after_row->field_name)));
  ELSE
   diff := diff || jsonb_build_object(field_name, jsonb_build_object('redacted', true));
  END IF;
 END LOOP;
 IF TG_OP = 'UPDATE' AND diff = '{}'::jsonb THEN RETURN NULL; END IF;
 target_key := coalesce(row_data->>'id', row_data->>'coach_id');
 IF TG_TABLE_NAME IN ('coach_fields','coach_curriculums') THEN target_key := (jsonb_build_array(row_data->>'coach_id', row_data->>'tag_id'))::text; END IF;
 INSERT INTO activity_changes(request_id, actor_email, actor_name, actor_email_pii_index, actor_name_pii_index, actor_type, route, method, target_type, target_id, action, changes)
 VALUES ((context->>'requestId')::uuid, context->>'actorEmail', context->>'actorName', context->>'actorEmailPiiIndex', context->>'actorNamePiiIndex', context->>'actorType', context->>'route', context->>'method', TG_TABLE_NAME, target_key, action_name, diff);
 RETURN NULL;
END;
$$;
DROP TRIGGER IF EXISTS activity_change ON operation_sessions;
CREATE TRIGGER activity_change AFTER INSERT OR UPDATE OR DELETE ON operation_sessions
 FOR EACH ROW EXECUTE FUNCTION capture_activity_change('["operation_id", "course_record_id", "operation_status", "archive_status", "education_format", "operation_channel", "round_no", "education_days", "start_date", "end_date", "education_dates", "operation_month", "session_duration_days", "session_duration_type", "time_text", "onsite_required", "total_cost", "instructor_cost", "operation_cost", "has_satisfaction_survey", "has_result_report"]');
DROP TRIGGER IF EXISTS activity_change ON members;
CREATE TRIGGER activity_change AFTER INSERT OR UPDATE OR DELETE ON members
 FOR EACH ROW EXECUTE FUNCTION capture_activity_change('["role", "source_team"]');
DROP TRIGGER IF EXISTS activity_change ON coaches;
CREATE TRIGGER activity_change AFTER INSERT OR UPDATE OR DELETE ON coaches
 FOR EACH ROW EXECUTE FUNCTION capture_activity_change('["status", "is_active", "display_order"]');
DROP TRIGGER IF EXISTS activity_change ON coach_content_entries;
CREATE TRIGGER activity_change AFTER INSERT OR UPDATE OR DELETE ON coach_content_entries
 FOR EACH ROW EXECUTE FUNCTION capture_activity_change('["coach_id", "kind", "flagged_at"]');
DROP TRIGGER IF EXISTS activity_change ON coach_private_profiles;
CREATE TRIGGER activity_change AFTER INSERT OR UPDATE OR DELETE ON coach_private_profiles
 FOR EACH ROW EXECUTE FUNCTION capture_activity_change('[]');
DROP TRIGGER IF EXISTS activity_change ON coach_day_reservations;
CREATE TRIGGER activity_change AFTER INSERT OR UPDATE OR DELETE ON coach_day_reservations
 FOR EACH ROW EXECUTE FUNCTION capture_activity_change('["coach_id", "date", "confirmed_engagement_id", "cancelled_at"]');
DROP TRIGGER IF EXISTS activity_change ON coach_engagements;
CREATE TRIGGER activity_change AFTER INSERT OR UPDATE OR DELETE ON coach_engagements
 FOR EACH ROW EXECUTE FUNCTION capture_activity_change('["coach_id", "operation_session_id", "course_name", "status", "source", "start_date", "end_date", "start_time", "end_time", "rating", "rehire", "review_flagged_at"]');
DROP TRIGGER IF EXISTS activity_change ON team_users;
CREATE TRIGGER activity_change AFTER INSERT OR UPDATE OR DELETE ON team_users
 FOR EACH ROW EXECUTE FUNCTION capture_activity_change('["team", "role"]');
DROP TRIGGER IF EXISTS activity_change ON om_requests;
CREATE TRIGGER activity_change AFTER INSERT OR UPDATE OR DELETE ON om_requests
 FOR EACH ROW EXECUTE FUNCTION capture_activity_change('["status", "operation_id", "team", "company", "training_type", "course_id", "course_name", "course_category_major", "course_category", "skillflo_setup", "skillmatch_setup", "onsite_operation", "coach_request", "total_sessions"]');
DROP TRIGGER IF EXISTS activity_change ON announcements;
CREATE TRIGGER activity_change AFTER INSERT OR UPDATE OR DELETE ON announcements
 FOR EACH ROW EXECUTE FUNCTION capture_activity_change('[]');
DROP TRIGGER IF EXISTS activity_change ON announcement_attachments;
CREATE TRIGGER activity_change AFTER INSERT OR UPDATE OR DELETE ON announcement_attachments
 FOR EACH ROW EXECUTE FUNCTION capture_activity_change('["announcement_id", "mime_type", "size"]');
DROP TRIGGER IF EXISTS activity_change ON instructor_notes;
CREATE TRIGGER activity_change AFTER INSERT OR UPDATE OR DELETE ON instructor_notes
 FOR EACH ROW EXECUTE FUNCTION capture_activity_change('["recruit_avoid"]');
DROP TRIGGER IF EXISTS activity_change ON calendar_event_links;
CREATE TRIGGER activity_change AFTER INSERT OR UPDATE OR DELETE ON calendar_event_links
 FOR EACH ROW EXECUTE FUNCTION capture_activity_change('["operation_id", "event_date"]');
COMMIT;
