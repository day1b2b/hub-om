import type { CourseCommonNote as CourseCommonNoteValue } from "@/lib/data/operationTypes";
import { commonNoteEntries } from "./courseCommonNoteModel";

export { commonNoteEntries } from "./courseCommonNoteModel";

/** 공통 메모는 과정 단위로만 보여 주며, 기존 회차별 메모는 별도 후보 영역에서 그대로 보존한다. */
export function CourseCommonNote({ note }: { note?: CourseCommonNoteValue }) {
  const entries = note ? commonNoteEntries(note) : [];

  return (
    <section aria-labelledby="course-common-note-title" className="detail-section">
      <div className="section-title">
        <h2 id="course-common-note-title">공통 메모</h2>
        <span>과정 전체에 적용되는 메모입니다. 기존 회차별 메모는 변경하지 않습니다.</span>
      </div>
      {entries.length > 0 ? (
        <dl className="info-grid">
          {entries.map((entry) => (
            <div key={entry.label}>
              <dt>{entry.label}</dt>
              <dd><pre>{entry.value}</pre></dd>
            </div>
          ))}
        </dl>
      ) : <p>등록된 공통 메모가 없습니다.</p>}
    </section>
  );
}
