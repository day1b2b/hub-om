"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { createOperationAction } from "@/app/operations/new/actions";
import { teamScopeSearchParam, type TeamScope } from "@/lib/teamScope";

interface OperationCreateFormProps {
  personOptions: {
    ld: string[];
    om: string[];
  };
  teamScope: TeamScope;
  today: string;
}

export function OperationCreateForm({ personOptions, teamScope, today }: OperationCreateFormProps) {
  const ldOptions = useMemo(() => unique(personOptions.ld), [personOptions.ld]);
  const omOptions = useMemo(() => unique(personOptions.om), [personOptions.om]);
  const teamQuery = teamScopeSearchParam(teamScope);

  return (
    <form action={createOperationAction} className="operation-form">
      <input name="teamScope" type="hidden" value={teamScope} />
      <section className="dashboard-panel operation-form-section">
        <div className="section-title">
          <h2>기본 정보</h2>
        </div>
        <div className="operation-form-grid">
          <label>
            <span>기업명</span>
            <input name="companyName" required />
          </label>
          <label>
            <span>과정명</span>
            <input name="courseName" required />
          </label>
          <label>
            <span>코스ID</span>
            <input name="courseId" placeholder="없으면 비워둠" />
          </label>
          <label>
            <span>회차</span>
            <input name="roundNo" placeholder="예: 1" />
          </label>
          <label>
            <span>시작일</span>
            <input defaultValue={today} name="startDate" required type="date" />
          </label>
          <label>
            <span>종료일</span>
            <input defaultValue={today} name="endDate" required type="date" />
          </label>
          <label>
            <span>시간</span>
            <input name="timeText" placeholder="예: 09:00~18:00" />
          </label>
          <label>
            <span>교육일수</span>
            <input name="educationDays" placeholder="예: 3일" />
          </label>
        </div>
      </section>

      <section className="dashboard-panel operation-form-section">
        <div className="section-title">
          <h2>운영 상태</h2>
        </div>
        <div className="operation-form-grid compact">
          <label>
            <span>상태</span>
            <select defaultValue="배정필요" name="operationStatus">
              {["배정필요", "배정예정", "진행중", "완료", "회고완료", "아카이빙필요"].map((status) => (
                <option key={status}>{status}</option>
              ))}
            </select>
          </label>
          <label>
            <span>아카이빙</span>
            <select defaultValue="아카이빙전" name="archiveStatus">
              {["아카이빙전", "아카이빙필요", "완료"].map((status) => (
                <option key={status}>{status}</option>
              ))}
            </select>
          </label>
          <label>
            <span>교육형태</span>
            <select defaultValue="검토필요" name="educationFormat">
              {["오프라인", "비대면", "블랜디드", "플립러닝", "검토필요"].map((format) => (
                <option key={format}>{format}</option>
              ))}
            </select>
          </label>
          <label>
            <span>운영유형</span>
            <select defaultValue="검토필요" name="operationType">
              {["특강", "단기", "중기", "중장기", "준장기", "장기", "연간", "상시형", "검토필요"].map((type) => (
                <option key={type}>{type}</option>
              ))}
            </select>
          </label>
          <label>
            <span>오프라인 여부</span>
            <select defaultValue="UNKNOWN" name="onsiteRequired">
              <option value="UNKNOWN">검토필요</option>
              <option value="Y">오프라인</option>
              <option value="N">온라인</option>
              <option value="PARTIAL">일부 오프라인</option>
            </select>
          </label>
          <label>
            <span>지역</span>
            <input name="region" placeholder="예: 서울" />
          </label>
        </div>
      </section>

      <section className="dashboard-panel operation-form-section">
        <div className="section-title">
          <h2>담당자 / 강사</h2>
        </div>
        <div className="operation-form-grid compact">
          <NameSelectList fieldName="om" label="OM" nameOptions={omOptions} />
          <NameSelectList fieldName="ld" label="LD" nameOptions={ldOptions} />
          <label>
            <span>강사</span>
            <input name="instructors" placeholder="자유 입력" />
          </label>
          <label>
            <span>실습코치</span>
            <input name="coach" placeholder="자유 입력" />
          </label>
        </div>
      </section>

      <section className="dashboard-panel operation-form-section">
        <div className="section-title">
          <h2>금액</h2>
        </div>
        <div className="operation-form-grid compact">
          <label>
            <span>매출</span>
            <input inputMode="numeric" name="revenue" placeholder="숫자만 입력" />
          </label>
          <label>
            <span>총 비용</span>
            <input inputMode="numeric" name="totalCost" />
          </label>
          <label>
            <span>강사비</span>
            <input inputMode="numeric" name="instructorCost" />
          </label>
          <label>
            <span>운영비</span>
            <input inputMode="numeric" name="operationCost" />
          </label>
          <label className="wide-field">
            <span>비용 메모</span>
            <input name="costRaw" />
          </label>
        </div>
      </section>

      <section className="dashboard-panel operation-form-section">
        <div className="section-title">
          <h2>링크 / 메모</h2>
        </div>
        <div className="operation-form-grid compact">
          <label>
            <span>싱크업</span>
            <input name="operationDetail" placeholder="https://..." required type="url" />
          </label>
          <label>
            <span>드라이브</span>
            <input name="driveLink" placeholder="https://..." />
          </label>
          <label>
            <span>강의관리</span>
            <input name="lectureManagementLink" placeholder="https://..." />
          </label>
          <label>
            <span>결과보고서</span>
            <input name="resultReportLink" placeholder="https://..." />
          </label>
          <label>
            <span>기업 Wiki</span>
            <input name="companyWikiLink" placeholder="https://..." />
          </label>
          <label>
            <span>강사 Wiki</span>
            <input name="instructorWikiLink" placeholder="https://..." />
          </label>
          <label className="full-row-field">
            <span>패들렛</span>
            <input name="padletLink" placeholder="https://..." />
          </label>
          <label className="full-row-field">
            <span>특이사항</span>
            <textarea name="specialNotes" rows={3} />
          </label>
          <label className="full-row-field">
            <span>운영 이슈</span>
            <textarea name="operationIssue" rows={3} />
          </label>
        </div>
      </section>

      <div className="operation-form-actions">
        <Link className="secondary-action" href={`/operations${teamQuery}`}>취소</Link>
        <button className="primary-action" type="submit">저장</button>
      </div>
    </form>
  );
}

function NameSelectList({ fieldName, label, nameOptions }: { fieldName: string; label: string; nameOptions: string[] }) {
  const [values, setValues] = useState([""]);
  const selectedNames = values.filter(Boolean);
  const hiddenValue = selectedNames.join(", ");

  return (
    <div className="name-select-field">
      <span className="name-select-label">{label}</span>
      <input name={fieldName} type="hidden" value={hiddenValue} />
      <div className="name-select-list">
        {values.map((value, index) => (
          <div className="name-select-row" key={`${fieldName}-${index}`}>
            <select
              aria-label={`${label} ${index + 1}`}
              disabled={nameOptions.length === 0}
              onChange={(event) => updateValue(index, event.target.value)}
              value={value}
            >
              <option value="">{nameOptions.length === 0 ? "선택 가능한 이름 없음" : "선택"}</option>
              {nameOptions.map((name) => (
                <option disabled={selectedNames.includes(name) && name !== value} key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
            {values.length > 1 ? (
              <button className="name-remove-button" onClick={() => removeValue(index)} type="button">
                삭제
              </button>
            ) : null}
            {index === values.length - 1 ? (
              <button className="name-add-button" disabled={nameOptions.length === 0} onClick={addValue} type="button">
                +
              </button>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );

  function addValue() {
    setValues((current) => [...current, ""]);
  }

  function removeValue(index: number) {
    setValues((current) => current.filter((_, currentIndex) => currentIndex !== index));
  }

  function updateValue(index: number, value: string) {
    setValues((current) => current.map((currentValue, currentIndex) => (currentIndex === index ? value : currentValue)));
  }
}

function unique(values: string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, "ko-KR"));
}
