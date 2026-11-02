"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { EGG_CHARGER_LABEL, EGG_PART_LABEL } from "@/lib/data/eggs/eggTypes";
import type { EggChargerType, EggDeviceSummary, EggPart } from "@/lib/data/eggs/eggTypes";
import { callEggApi } from "./eggApi";

interface EggDevicePanelProps {
  part: EggPart;
  devices: EggDeviceSummary[];
}

interface DeviceFormState {
  number: string;
  label: string;
  wifiName: string;
  serialNumber: string;
  wifiPassword: string;
  modelCode: string;
  chargerType: EggChargerType;
  speedMbps: string;
  storageLocation: string;
  monthlyDataGb: string;
  contractEndsOn: string;
  cautionNote: string;
}

const CHARGER_OPTIONS: EggChargerType[] = ["USB_C", "FIVE_PIN", "UNKNOWN"];

function emptyForm(nextNumber: number, storageLocation: string): DeviceFormState {
  return {
    number: String(nextNumber),
    label: `${nextNumber}번`,
    wifiName: "",
    serialNumber: "",
    wifiPassword: "",
    modelCode: "",
    chargerType: "UNKNOWN",
    speedMbps: "",
    storageLocation,
    monthlyDataGb: "20",
    contractEndsOn: "",
    cautionNote: ""
  };
}

function toForm(device: EggDeviceSummary): DeviceFormState {
  return {
    number: String(device.number),
    label: device.label,
    wifiName: device.wifiName,
    serialNumber: device.serialNumber,
    wifiPassword: device.wifiPassword,
    modelCode: device.modelCode ?? "",
    chargerType: device.chargerType,
    speedMbps: device.speedMbps === null ? "" : String(device.speedMbps),
    storageLocation: device.storageLocation,
    monthlyDataGb: device.monthlyDataGb === null ? "" : String(device.monthlyDataGb),
    contractEndsOn: device.contractEndsOn ?? "",
    cautionNote: device.cautionNote ?? ""
  };
}

/**
 * 기기 관리 (관리자 전용, 현재 탭의 파트만).
 * WiFi 비밀번호와 일련번호는 내부 정보라 코드나 저장소에 두지 않고 이 화면으로 입력한다.
 */
export function EggDevicePanel({ part, devices }: EggDevicePanelProps) {
  const router = useRouter();
  const nextNumber = devices.reduce((max, device) => Math.max(max, device.number), 0) + 1;
  const defaultLocation = devices[0]?.storageLocation ?? "";

  const [open, setOpen] = useState(devices.length === 0);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<DeviceFormState>(emptyForm(nextNumber, defaultLocation));
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  function update<K extends keyof DeviceFormState>(key: K, value: DeviceFormState[K]) {
    setForm((previous) => ({ ...previous, [key]: value }));
  }

  function startCreate() {
    setEditingId(null);
    setForm(emptyForm(nextNumber, defaultLocation));
    setError(null);
    setMessage(null);
  }

  function startEdit(device: EggDeviceSummary) {
    setEditingId(device.id);
    setForm(toForm(device));
    setError(null);
    setMessage(null);
  }

  async function submit() {
    setError(null);
    setMessage(null);
    setPending(true);

    const body = {
      part,
      number: Number(form.number),
      label: form.label.trim() || `${form.number}번`,
      wifiName: form.wifiName.trim(),
      serialNumber: form.serialNumber.trim(),
      wifiPassword: form.wifiPassword.trim(),
      modelCode: form.modelCode.trim(),
      chargerType: form.chargerType,
      speedMbps: form.speedMbps.trim(),
      storageLocation: form.storageLocation.trim(),
      monthlyDataGb: form.monthlyDataGb.trim(),
      contractEndsOn: form.contractEndsOn.trim(),
      cautionNote: form.cautionNote.trim()
    };

    const result = await callEggApi(
      editingId ? `/api/eggs/devices/${editingId}` : "/api/eggs/devices",
      editingId ? "PATCH" : "POST",
      body
    );
    setPending(false);

    if (!result.ok) {
      setError(result.error ?? "저장에 실패했습니다.");
      return;
    }

    setMessage(editingId ? "기기 정보를 수정했습니다." : "기기를 등록했습니다.");
    setEditingId(null);
    setForm(emptyForm(editingId ? nextNumber : Number(form.number) + 1, defaultLocation));
    router.refresh();
  }

  return (
    <section className="dashboard-panel egg-admin">
      <div className="section-title">
        <h2>🔒 {EGG_PART_LABEL[part]} 기기 관리</h2>
        <div className="section-title-actions">
          <span>관리자만 보입니다.</span>
          <button type="button" className="secondary-action" onClick={() => setOpen((value) => !value)}>
            {open ? "접기" : `펼치기 (${devices.length}대)`}
          </button>
        </div>
      </div>

      {open ? (
        <div className="egg-detail-body">
          {message ? <p className="egg-feedback egg-feedback-ok">{message}</p> : null}
          {error ? <p className="egg-feedback egg-feedback-error">{error}</p> : null}

          {devices.length > 0 ? (
            <div className="table-wrap">
              <table className="egg-table">
                <thead>
                  <tr>
                    <th>순서</th>
                    <th>이름</th>
                    <th>L코드</th>
                    <th>충전</th>
                    <th>속도</th>
                    <th>WiFi 이름</th>
                    <th>일련번호</th>
                    <th>보관 위치</th>
                    <th>관리</th>
                  </tr>
                </thead>
                <tbody>
                  {devices.map((device) => (
                    <tr key={device.id} className={device.id === editingId ? "egg-row-editing" : ""}>
                      <td>{device.number}</td>
                      <td>
                        <strong>{device.label}</strong>
                      </td>
                      <td>{device.modelCode ?? "-"}</td>
                      <td>{EGG_CHARGER_LABEL[device.chargerType]}</td>
                      <td>{device.speedMbps ? `${device.speedMbps}Mbps` : "-"}</td>
                      <td>{device.wifiName || "-"}</td>
                      <td>{device.serialNumber || "-"}</td>
                      <td>{device.storageLocation}</td>
                      <td>
                        <button type="button" className="secondary-action" onClick={() => startEdit(device)}>
                          수정
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}

          <div className="egg-form">
            <h3>{editingId ? "기기 정보 수정" : "새 기기 등록"}</h3>
            <div className="egg-form-grid">
              <label>
                <span>
                  정렬 순서 <span className="required-mark">*</span>
                </span>
                <input type="number" min={1} value={form.number} onChange={(event) => update("number", event.target.value)} />
              </label>
              <label>
                <span>표시 이름</span>
                <input
                  type="text"
                  value={form.label}
                  onChange={(event) => update("label", event.target.value)}
                  placeholder="예: 3번, USB 1번"
                />
              </label>
              <label>
                <span>L코드(기기번호)</span>
                <input
                  type="text"
                  value={form.modelCode}
                  onChange={(event) => update("modelCode", event.target.value)}
                  placeholder="예: L2387"
                />
              </label>
              <label>
                <span>충전 단자</span>
                <select
                  value={form.chargerType}
                  onChange={(event) => update("chargerType", event.target.value as EggChargerType)}
                >
                  {CHARGER_OPTIONS.map((option) => (
                    <option key={option} value={option}>
                      {EGG_CHARGER_LABEL[option]}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span>WiFi 이름</span>
                <input type="text" value={form.wifiName} onChange={(event) => update("wifiName", event.target.value)} />
              </label>
              <label>
                <span>WiFi 비밀번호</span>
                <input
                  type="text"
                  value={form.wifiPassword}
                  onChange={(event) => update("wifiPassword", event.target.value)}
                />
              </label>
              <label>
                <span>일련번호</span>
                <input
                  type="text"
                  value={form.serialNumber}
                  onChange={(event) => update("serialNumber", event.target.value)}
                />
              </label>
              <label>
                <span>
                  보관 위치 <span className="required-mark">*</span>
                </span>
                <input
                  type="text"
                  value={form.storageLocation}
                  onChange={(event) => update("storageLocation", event.target.value)}
                />
              </label>
              <label>
                <span>속도(Mbps)</span>
                <input
                  type="number"
                  min={0}
                  value={form.speedMbps}
                  onChange={(event) => update("speedMbps", event.target.value)}
                />
              </label>
              <label>
                <span>월 데이터(GB)</span>
                <input
                  type="number"
                  min={0}
                  value={form.monthlyDataGb}
                  onChange={(event) => update("monthlyDataGb", event.target.value)}
                />
              </label>
              <label>
                <span>렌탈 만료일</span>
                <input
                  type="date"
                  value={form.contractEndsOn}
                  onChange={(event) => update("contractEndsOn", event.target.value)}
                />
              </label>
            </div>
            <label className="egg-form-full">
              <span>기기별 특이사항 (한 줄)</span>
              <input
                type="text"
                value={form.cautionNote}
                onChange={(event) => update("cautionNote", event.target.value)}
                placeholder="이 기기에만 해당하는 내용. 파트 공통 내용은 주의사항에 적어주세요."
              />
            </label>
            <div className="egg-actions">
              {editingId ? (
                <button type="button" className="assign-cancel-btn" disabled={pending} onClick={startCreate}>
                  수정 취소
                </button>
              ) : null}
              <button type="button" className="assign-save-btn" disabled={pending} onClick={submit}>
                {pending ? "저장 중..." : editingId ? "수정 저장" : "등록"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
