BEGIN;
SET LOCAL lock_timeout = '5s';

CREATE TABLE activity_requests (
 id uuid PRIMARY KEY, occurred_at timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
 actor_email text, actor_name text, actor_type text NOT NULL,
 route text NOT NULL, method text NOT NULL, status integer NOT NULL, duration_ms integer NOT NULL
);
CREATE INDEX activity_requests_occurred_at_id_idx ON activity_requests(occurred_at, id);
CREATE INDEX activity_requests_actor_email_occurred_at_id_idx ON activity_requests(actor_email, occurred_at, id);
CREATE TABLE activity_changes (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), occurred_at timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
 request_id uuid NOT NULL, actor_email text, actor_name text, actor_type text NOT NULL,
 route text NOT NULL, method text NOT NULL, target_type text NOT NULL, target_id text NOT NULL,
 action text NOT NULL, changes jsonb NOT NULL
);
CREATE INDEX activity_changes_occurred_at_id_idx ON activity_changes(occurred_at, id);
CREATE INDEX activity_changes_actor_email_occurred_at_id_idx ON activity_changes(actor_email, occurred_at, id);
CREATE INDEX activity_changes_target_type_target_id_occurred_at_id_idx ON activity_changes(target_type, target_id, occurred_at, id);
CREATE INDEX activity_changes_request_id_idx ON activity_changes(request_id);

-- Bound scalar/array values; unknown/free text fields never reach this function.
CREATE FUNCTION activity_safe_value(value jsonb) RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
 SELECT CASE WHEN value IS NULL THEN 'null'::jsonb
 WHEN length(value::text) > 500 THEN jsonb_build_object('truncated', true, 'preview', left(value::text, 500))
 ELSE value END
$$;

CREATE FUNCTION capture_activity_change() RETURNS trigger LANGUAGE plpgsql AS $$
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
  IF field_name = ANY(ARRAY['id','created_at','updated_at','created_by','updated_by','deleted_by','normalized_name','source_fingerprint','validation_errors']) THEN CONTINUE; END IF;
  IF (before_row->field_name) IS NOT DISTINCT FROM (after_row->field_name) THEN CONTINUE; END IF;
  -- Compare first: redaction/truncation cannot conceal a real change.
  IF allow_fields ? field_name THEN
   diff := diff || jsonb_build_object(field_name, jsonb_build_object('before', activity_safe_value(before_row->field_name), 'after', activity_safe_value(after_row->field_name)));
  ELSE
   diff := diff || jsonb_build_object(field_name, jsonb_build_object('redacted', true));
  END IF;
 END LOOP;
 IF TG_OP = 'UPDATE' AND diff = '{}'::jsonb THEN RETURN NULL; END IF;
 target_key := coalesce(row_data->>'id', row_data->>'coach_id');
 IF TG_TABLE_NAME IN ('coach_fields','coach_curriculums') THEN target_key := (jsonb_build_array(row_data->>'coach_id', row_data->>'tag_id'))::text; END IF;
 INSERT INTO activity_changes(request_id, actor_email, actor_name, actor_type, route, method, target_type, target_id, action, changes)
 VALUES ((context->>'requestId')::uuid, context->>'actorEmail', context->>'actorName', context->>'actorType', context->>'route', context->>'method', TG_TABLE_NAME, target_key, action_name, diff);
 RETURN NULL;
END;
$$;

CREATE TRIGGER activity_change AFTER INSERT OR UPDATE OR DELETE ON companies
 FOR EACH ROW EXECUTE FUNCTION capture_activity_change('["name"]');
CREATE TRIGGER activity_change AFTER INSERT OR UPDATE OR DELETE ON courses
 FOR EACH ROW EXECUTE FUNCTION capture_activity_change('["company_id", "course_id", "course_name", "operation_type", "course_category", "revenue"]');
CREATE TRIGGER activity_change AFTER INSERT OR UPDATE OR DELETE ON course_id_labels
 FOR EACH ROW EXECUTE FUNCTION capture_activity_change('["company_id", "course_id", "label"]');
CREATE TRIGGER activity_change AFTER INSERT OR UPDATE OR DELETE ON operation_sessions
 FOR EACH ROW EXECUTE FUNCTION capture_activity_change('["operation_id", "course_record_id", "operation_status", "archive_status", "education_format", "operation_channel", "round_no", "education_days", "start_date", "end_date", "education_dates", "operation_month", "session_duration_days", "session_duration_type", "time_text", "om_name", "ld_name", "instructors_text", "coach_text", "onsite_required", "onsite_om_name", "total_cost", "instructor_cost", "operation_cost", "avg_satisfaction", "instructor_satisfaction", "has_satisfaction_survey", "has_result_report", "om_user_id", "ld_user_id"]');
CREATE TRIGGER activity_change AFTER INSERT OR UPDATE OR DELETE ON members
 FOR EACH ROW EXECUTE FUNCTION capture_activity_change('["name", "role", "source_team"]');
CREATE TRIGGER activity_change AFTER INSERT OR UPDATE OR DELETE ON coaches
 FOR EACH ROW EXECUTE FUNCTION capture_activity_change('["name", "work_type", "status", "return_date", "dx_tag", "is_active", "display_order"]');
CREATE TRIGGER activity_change AFTER INSERT OR UPDATE OR DELETE ON coach_content_entries
 FOR EACH ROW EXECUTE FUNCTION capture_activity_change('["coach_id", "kind", "flagged_at"]');
CREATE TRIGGER activity_change AFTER INSERT OR UPDATE OR DELETE ON coach_private_profiles
 FOR EACH ROW EXECUTE FUNCTION capture_activity_change('[]');
CREATE TRIGGER activity_change AFTER INSERT OR UPDATE OR DELETE ON coach_field_masters
 FOR EACH ROW EXECUTE FUNCTION capture_activity_change('["name"]');
CREATE TRIGGER activity_change AFTER INSERT OR UPDATE OR DELETE ON coach_curriculum_masters
 FOR EACH ROW EXECUTE FUNCTION capture_activity_change('["name"]');
CREATE TRIGGER activity_change AFTER INSERT OR UPDATE OR DELETE ON coach_fields
 FOR EACH ROW EXECUTE FUNCTION capture_activity_change('["coach_id", "tag_id"]');
CREATE TRIGGER activity_change AFTER INSERT OR UPDATE OR DELETE ON coach_curriculums
 FOR EACH ROW EXECUTE FUNCTION capture_activity_change('["coach_id", "tag_id"]');
CREATE TRIGGER activity_change AFTER INSERT OR UPDATE OR DELETE ON coach_schedules
 FOR EACH ROW EXECUTE FUNCTION capture_activity_change('["coach_id", "date", "start_time", "end_time"]');
CREATE TRIGGER activity_change AFTER INSERT OR UPDATE OR DELETE ON coach_day_reservations
 FOR EACH ROW EXECUTE FUNCTION capture_activity_change('["coach_id", "date", "reserved_by_email", "reserved_by_name", "confirmed_engagement_id", "cancelled_at"]');
CREATE TRIGGER activity_change AFTER INSERT OR UPDATE OR DELETE ON coach_engagements
 FOR EACH ROW EXECUTE FUNCTION capture_activity_change('["coach_id", "operation_session_id", "course_name", "status", "source", "start_date", "end_date", "start_time", "end_time", "rating", "rehire", "review_flagged_at"]');
CREATE TRIGGER activity_change AFTER INSERT OR UPDATE OR DELETE ON coach_engagement_schedules
 FOR EACH ROW EXECUTE FUNCTION capture_activity_change('["engagement_id", "coach_id", "date", "start_time", "end_time", "cancelled_at"]');
CREATE TRIGGER activity_change AFTER INSERT OR UPDATE OR DELETE ON team_users
 FOR EACH ROW EXECUTE FUNCTION capture_activity_change('["name", "email", "team", "role"]');
CREATE TRIGGER activity_change AFTER INSERT OR UPDATE OR DELETE ON om_requests
 FOR EACH ROW EXECUTE FUNCTION capture_activity_change('["status", "assigned_om", "ld_email", "operation_id", "team", "ld", "company", "training_type", "course_id", "course_name", "course_category_major", "course_category", "instructor_name", "skillflo_setup", "skillmatch_setup", "onsite_operation", "coach_request", "total_sessions"]');
CREATE TRIGGER activity_change AFTER INSERT OR UPDATE OR DELETE ON announcements
 FOR EACH ROW EXECUTE FUNCTION capture_activity_change('[]');
CREATE TRIGGER activity_change AFTER INSERT OR UPDATE OR DELETE ON announcement_attachments
 FOR EACH ROW EXECUTE FUNCTION capture_activity_change('["announcement_id", "mime_type", "size"]');
CREATE TRIGGER activity_change AFTER INSERT OR UPDATE OR DELETE ON instructor_notes
 FOR EACH ROW EXECUTE FUNCTION capture_activity_change('["instructor_name", "display_name", "recruit_avoid"]');
CREATE TRIGGER activity_change AFTER INSERT OR UPDATE OR DELETE ON calendar_event_links
 FOR EACH ROW EXECUTE FUNCTION capture_activity_change('["operation_id", "event_date"]');

COMMIT;
