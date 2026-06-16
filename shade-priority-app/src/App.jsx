import { useEffect, useMemo, useState } from "react";
import * as XLSX from "xlsx";
import {
  AlertTriangle,
  CheckCircle2,
  Database,
  Download,
  FileUp,
  MapPinned,
  RefreshCw,
  Settings2
} from "lucide-react";
import { getCandidates, getExistingShades, getHealth, getRules, uploadInstalledShades } from "./lib/api.js";
import { meters, number, statusClass, statusLabel } from "./lib/format.js";
import { CandidateMap } from "./components/CandidateMap.jsx";

const modes = [
  { id: "selected", label: "선정 후보" },
  { id: "review", label: "현장 확인" },
  { id: "excluded", label: "제외 후보" },
  { id: "all", label: "전체" },
  { id: "existing", label: "기존 그늘막" }
];

export default function App() {
  const [health, setHealth] = useState(null);
  const [rules, setRules] = useState([]);
  const [enabledRuleIds, setEnabledRuleIds] = useState([]);
  const [mode, setMode] = useState("selected");
  const [result, setResult] = useState(null);
  const [existingShades, setExistingShades] = useState([]);
  const [selectedCandidate, setSelectedCandidate] = useState(null);
  const [loading, setLoading] = useState(true);
  const [uploadState, setUploadState] = useState({ year: new Date().getFullYear(), message: "" });

  useEffect(() => {
    async function bootstrap() {
      const [healthPayload, rulesPayload] = await Promise.all([getHealth(), getRules()]);
      setHealth(healthPayload);
      setRules(rulesPayload.rules);
      setEnabledRuleIds(rulesPayload.rules.filter((rule) => rule.enabled).map((rule) => rule.id));
    }
    bootstrap().catch((error) => setUploadState((state) => ({ ...state, message: error.message })));
  }, []);

  useEffect(() => {
    if (!enabledRuleIds.length) return;
    refreshCandidates();
  }, [enabledRuleIds, mode]);

  async function refreshCandidates() {
    setLoading(true);
    try {
      if (mode === "existing") {
        const payload = await getExistingShades();
        setExistingShades(payload.shades);
        setResult((current) => current || { summary: {} });
        setSelectedCandidate(null);
        return;
      }
      const [payload, shadesPayload] = await Promise.all([
        getCandidates({ enabledRuleIds, mode }),
        mode === "all" ? getExistingShades() : Promise.resolve({ shades: [] })
      ]);
      setResult(payload);
      setExistingShades(shadesPayload.shades);
      setSelectedCandidate(payload.candidates[0] || null);
    } finally {
      setLoading(false);
    }
  }

  function toggleRule(rule) {
    if (rule.locked) return;
    setEnabledRuleIds((current) =>
      current.includes(rule.id) ? current.filter((id) => id !== rule.id) : [...current, rule.id]
    );
  }

  async function handleUpload(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    setUploadState((state) => ({ ...state, message: "업로드 처리 중..." }));
    const payload = await uploadInstalledShades({ file, year: uploadState.year });
    await refreshCandidates();
    const duplicateText = payload.duplicateWarnings.length
      ? `, 중복 의심 ${payload.duplicateWarnings.length}건`
      : "";
    setUploadState((state) => ({ ...state, message: `${payload.savedCount}건 저장${duplicateText}` }));
    event.target.value = "";
  }

function exportXlsx() {
    const rows = (result?.candidates || []).map((row, index) => ({
      순위: row.rank || index + 1,
      행정동: row.dongName,
      노드ID: row.nodeId,
      상태: statusLabel(row.status),
      총점: row.totalScore,
      보도폭: row.sidewalkWidthM ?? "",
      보도폭점수: scoreOf(row, "sidewalk_width_bonus"),
      주요도로점수: scoreOf(row, "major_road"),
      대로변횡단보도점수: scoreOf(row, "crosswalk_match"),
      고령자점수: scoreOf(row, "elderly_density"),
      쉼터점수: scoreOf(row, "cooling_shelter_gap"),
      교차로점수: scoreOf(row, "intersection"),
      보도폭매칭신뢰도: row.sidewalkMatchConfidence,
      보도구간: row.sidewalkLocationRange,
      기존그늘막거리m: Math.round(row.nearestExistingShadeM || 0),
      무더위쉼터거리m: Math.round(row.nearestCoolingShelterM || 0),
      교차로거리m: Math.round(row.nearestIntersectionM || 0),
      제외사유: row.exclusionReason,
      현장확인사항: row.reviewFlags.join("; "),
      경도: row.longitude,
      위도: row.latitude
    }));
    const sheet = XLSX.utils.json_to_sheet(rows);
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, sheet, "후보지");
    XLSX.writeFile(book, `그늘막_후보지_${mode}_${new Date().toISOString().slice(0, 10)}.xlsx`);
  }

  function scoreOf(row, ruleId) {
    return row.breakdown?.[ruleId]?.score ?? 0;
  }

  function valueWithScore(value, score, suffix = "") {
    const display = value || value === 0 ? `${value}${suffix}` : "-";
    return `${display} (+${score})`;
  }

  const summaryCards = useMemo(() => {
    const summary = result?.summary;
    return [
      { label: "원천 후보", value: summary?.sourceCandidateCount ?? health?.counts?.crosswalks ?? 0 },
      { label: "선정", value: summary?.selectedCount ?? 0 },
      { label: "현장 확인", value: summary?.reviewRequiredCount ?? 0 },
      { label: "제외", value: summary?.excludedCount ?? 0 }
    ];
  }, [health, result]);

  return (
    <div className="app-shell">
      <aside className="nav-rail" aria-label="주요 메뉴">
        <div className="brand-mark">SD</div>
        <button className="nav-button is-active" title="후보지 지도">
          <MapPinned size={20} />
        </button>
        <button className="nav-button" title="점수체계">
          <Settings2 size={20} />
        </button>
        <button className="nav-button" title="데이터베이스">
          <Database size={20} />
        </button>
      </aside>

      <main className="workspace">
        <header className="topbar">
          <div>
            <h1>서대문구 그늘막 설치 위치 선정 시뮬레이션</h1>
            <p>대로변 횡단보도를 기본 후보로 두고 보도폭, 교차로, 고령자, 쉼터, 기존 설치 위치를 재평가합니다.</p>
          </div>
          <div className="topbar-actions">
            <span className={`db-badge ${health?.dbAvailable ? "ok" : "warn"}`}>
              {health?.dbAvailable ? "PostgreSQL 연결" : "로컬 데이터 모드"}
            </span>
            <button className="icon-button" onClick={refreshCandidates} title="재산정">
              <RefreshCw size={18} />
            </button>
          </div>
        </header>

        <section className="summary-strip" aria-label="평가 요약">
          {summaryCards.map((item) => (
            <div className="summary-item" key={item.label}>
              <span>{item.label}</span>
              <strong>{item.value.toLocaleString()}</strong>
            </div>
          ))}
        </section>

        <section className="main-grid">
          <div className="map-panel">
            <div className="map-mode-tabs" role="tablist" aria-label="지도 후보 상태 필터">
              {modes.map((item) => (
                <button
                  key={item.id}
                  className={mode === item.id ? "is-active" : ""}
                  onClick={() => setMode(item.id)}
                >
                  {item.label}
                </button>
              ))}
            </div>
            <CandidateMap
              candidates={mode === "existing" ? [] : result?.candidates || []}
              existingShades={mode === "existing" || mode === "all" ? existingShades : []}
              selectedCandidate={selectedCandidate}
              onSelect={setSelectedCandidate}
            />
          </div>

          <section className="table-panel">
            <div className="panel-header">
              <div className="tabs" role="tablist">
                {modes.map((item) => (
                  <button
                    key={item.id}
                    className={mode === item.id ? "is-active" : ""}
                    onClick={() => setMode(item.id)}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
              <button className="secondary-button" onClick={exportXlsx} disabled={!result?.candidates?.length}>
                <Download size={16} />
                엑셀 다운로드
              </button>
            </div>

            <div className="candidate-table-wrap">
              <table className="candidate-table">
                <thead>
                  <tr>
                    <th>순위</th>
                    <th>행정동</th>
                    <th>상태</th>
                    <th>총점</th>
                    <th>보도폭</th>
                    <th>주요도로</th>
                    <th>횡단보도</th>
                    <th>고령자</th>
                    <th>기존</th>
                    <th>쉼터</th>
                    <th>교차로</th>
                  </tr>
                </thead>
                <tbody>
                  {mode === "existing" ? (
                    <tr>
                      <td colSpan="11" className="empty-cell">
                        기존 그늘막 {existingShades.length.toLocaleString()}개가 지도에 검은색으로 표시됩니다.
                      </td>
                    </tr>
                  ) : loading ? (
                    <tr>
                      <td colSpan="11" className="empty-cell">재산정 중...</td>
                    </tr>
                  ) : (
                    (result?.candidates || []).map((row, index) => (
                      <tr
                        key={row.nodeId}
                        className={selectedCandidate?.nodeId === row.nodeId ? "is-current" : ""}
                        onClick={() => setSelectedCandidate(row)}
                      >
                        <td>{row.rank || index + 1}</td>
                        <td>
                          <strong>{row.dongName || "-"}</strong>
                          <span>{row.nodeId}</span>
                        </td>
                        <td>
                          <span className={`status-pill ${statusClass(row.status)}`}>{statusLabel(row.status)}</span>
                        </td>
                        <td>{number(row.totalScore)}</td>
                        <td>{valueWithScore(row.sidewalkWidthM, scoreOf(row, "sidewalk_width_bonus"), "m")}</td>
                        <td>{`+${scoreOf(row, "major_road")}`}</td>
                        <td>{`+${scoreOf(row, "crosswalk_match")}`}</td>
                        <td>{`+${scoreOf(row, "elderly_density")}`}</td>
                        <td>{meters(row.nearestExistingShadeM)}</td>
                        <td>{`${meters(row.nearestCoolingShelterM)} (+${scoreOf(row, "cooling_shelter_gap")})`}</td>
                        <td>{`${meters(row.nearestIntersectionM)} (+${scoreOf(row, "intersection")})`}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </section>
      </main>

      <aside className="score-sidebar">
        <section className="detail-panel">
          <div className="detail-title">
            <CheckCircle2 size={18} />
            <h2>선택 후보</h2>
          </div>
          {selectedCandidate ? (
            <div className="candidate-detail">
              <strong>{selectedCandidate.dongName || "-"} · {selectedCandidate.nodeId}</strong>
              <span className={`status-pill ${statusClass(selectedCandidate.status)}`}>
                {statusLabel(selectedCandidate.status)}
              </span>
              <dl>
                <div><dt>총점</dt><dd>{number(selectedCandidate.totalScore)}</dd></div>
                <div><dt>보도폭</dt><dd>{selectedCandidate.sidewalkWidthM ? `${selectedCandidate.sidewalkWidthM}m` : "데이터 없음"}</dd></div>
                <div><dt>보도 매칭</dt><dd>{selectedCandidate.sidewalkMatchConfidence}</dd></div>
                <div><dt>기존 그늘막</dt><dd>{meters(selectedCandidate.nearestExistingShadeM)}</dd></div>
              </dl>
              {(selectedCandidate.exclusionReason || selectedCandidate.reviewFlags.length > 0) && (
                <div className="warning-box">
                  <AlertTriangle size={16} />
                  <span>{selectedCandidate.exclusionReason || selectedCandidate.reviewFlags.join(", ")}</span>
                </div>
              )}
            </div>
          ) : (
            <p className="muted">후보지를 선택하세요.</p>
          )}
        </section>

        <section className="rule-panel">
          <div className="panel-heading">
            <h2>점수체계</h2>
            <span>{enabledRuleIds.length}개 적용</span>
          </div>
          <div className="rule-list">
            {rules.map((rule) => (
              <label className={`rule-row ${rule.locked ? "is-locked" : ""}`} key={rule.id}>
                <input
                  type="checkbox"
                  checked={enabledRuleIds.includes(rule.id)}
                  disabled={rule.locked}
                  onChange={() => toggleRule(rule)}
                />
                <span>
                  <strong>{rule.label}</strong>
                  <small>{rule.description}</small>
                </span>
                <em>{rule.maxScore ? `+${rule.maxScore}` : "필수"}</em>
              </label>
            ))}
          </div>
        </section>

        <section className="upload-panel">
          <div className="panel-heading">
            <h2>연도별 설치 업로드</h2>
          </div>
          <div className="upload-controls">
            <input
              type="number"
              value={uploadState.year}
              onChange={(event) => setUploadState((state) => ({ ...state, year: event.target.value }))}
              aria-label="설치연도"
            />
            <label className="upload-button">
              <FileUp size={16} />
              파일 선택
              <input type="file" accept=".xlsx,.xls,.csv" onChange={handleUpload} />
            </label>
          </div>
          <p>{uploadState.message || "엑셀/CSV 업로드 시 DB 또는 로컬 실행 상태에 반영됩니다."}</p>
        </section>
      </aside>
    </div>
  );
}
