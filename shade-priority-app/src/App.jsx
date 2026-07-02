import { useEffect, useMemo, useRef, useState } from "react";
import * as XLSX from "xlsx";
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  FileUp,
  MapPinned,
  RefreshCw
} from "lucide-react";
import { CandidateMap } from "./components/CandidateMap.jsx";
import {
  getCandidates,
  getExistingShades,
  getHealth,
  getInstalledShadeUploadBatches,
  getInstalledShadeUploadBatchLocations,
  getMapLayers,
  getRules,
  rollbackInstalledShadeUploadBatch,
  uploadInstalledShades
} from "./lib/api.js";
import { meters, number, statusClass, statusLabel } from "./lib/format.js";

const modes = [
  { id: "selected", label: "선정 후보" },
  { id: "review", label: "현장 확인" },
  { id: "excluded", label: "제외 후보" },
  { id: "all", label: "전체" }
];

const tableModes = [...modes, { id: "existing", label: "기존 그늘막" }];

const defaultVisibleLayers = {
  elderly: true,
  existingShades: true,
  coolingShelters: true
};

export default function App() {
  const [health, setHealth] = useState(null);
  const [rules, setRules] = useState([]);
  const [enabledRuleIds, setEnabledRuleIds] = useState([]);
  const [mode, setMode] = useState("selected");
  const [tableMode, setTableMode] = useState("selected");
  const [result, setResult] = useState(null);
  const [mapLayers, setMapLayers] = useState(null);
  const [existingShades, setExistingShades] = useState([]);
  const [visibleLayers, setVisibleLayers] = useState(defaultVisibleLayers);
  const [selectedCandidate, setSelectedCandidate] = useState(null);
  const [selectedExistingShade, setSelectedExistingShade] = useState(null);
  const [highlightNodeId, setHighlightNodeId] = useState("");
  const [nodeIdQuery, setNodeIdQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [uploadState, setUploadState] = useState({ year: new Date().getFullYear(), message: "" });
  const [uploadBatches, setUploadBatches] = useState([]);
  const [focusedUploadBatch, setFocusedUploadBatch] = useState(null);
  const [rollbackingBatchId, setRollbackingBatchId] = useState(null);
  const rowRefs = useRef(new Map());

  useEffect(() => {
    async function bootstrap() {
      const [healthPayload, rulesPayload, layerPayload, batchesPayload, existingPayload] = await Promise.all([
        getHealth(),
        getRules(),
        getMapLayers(),
        getInstalledShadeUploadBatches(),
        getExistingShades()
      ]);
      setHealth(healthPayload);
      setRules(rulesPayload.rules);
      setMapLayers(layerPayload);
      setUploadBatches(batchesPayload.batches || []);
      setExistingShades(existingPayload.shades || []);
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
      const payload = await getCandidates({ enabledRuleIds, mode });
      setResult(payload);
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

  function toggleMapLayer(layerId) {
    setVisibleLayers((current) => ({ ...current, [layerId]: !current[layerId] }));
  }

  function selectTableMode(nextMode) {
    setTableMode(nextMode);
    setNodeIdQuery("");
    if (nextMode !== "existing") {
      setMode(nextMode);
    }
  }

  async function showUploadBatchOnMap(batchId) {
    if (!batchId) return;
    const payload = await getInstalledShadeUploadBatchLocations(batchId);
    setVisibleLayers((current) => ({ ...current, existingShades: true }));
    setFocusedUploadBatch({
      id: batchId,
      shades: payload.shades || [],
      rolledBack: Boolean(payload.rolledBack)
    });
    setUploadState((state) => ({
      ...state,
      message: `배치 #${batchId} 위치 ${payload.shades?.length || 0}건을 지도에 표시했습니다.`
    }));
  }

  function selectCandidate(candidate, source = "table") {
    setSelectedCandidate(candidate);
    setSelectedExistingShade(null);
    if (source === "map") {
      const row = rowRefs.current.get(candidate.nodeId);
      if (row) {
        row.scrollIntoView({ block: "center", behavior: "smooth" });
        setHighlightNodeId(candidate.nodeId);
        window.setTimeout(() => setHighlightNodeId((current) => (current === candidate.nodeId ? "" : current)), 1400);
      }
    }
  }

  function selectExistingShade(shade) {
    setSelectedExistingShade(shade);
    setSelectedCandidate(null);
    setVisibleLayers((current) => ({ ...current, existingShades: true }));
  }

  async function handleUpload(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    setUploadState((state) => ({ ...state, message: "업로드 처리 중..." }));
    const payload = await uploadInstalledShades({ file, year: uploadState.year });
    const [, , batchesPayload, existingPayload] = await Promise.all([
      refreshCandidates(),
      getMapLayers().then(setMapLayers),
      getInstalledShadeUploadBatches(),
      getExistingShades()
    ]);
    setUploadBatches(batchesPayload.batches || []);
    setExistingShades(existingPayload.shades || []);
    if (payload.batchId) {
      await showUploadBatchOnMap(payload.batchId);
    }
    setUploadState((state) => ({
      ...state,
      message: `배치 #${payload.batchId || "-"}: 신규 ${payload.insertedCount || 0}건, 업데이트 ${payload.updatedCount || 0}건, 변경 없음 ${payload.skippedCount || 0}건, 실패 ${payload.failedCount || 0}건${payload.batchId ? " - 지도에 표시했습니다." : ""}`
    }));
    event.target.value = "";
  }

  async function handleRollbackUploadBatch(batchId) {
    if (!batchId) return;
    setRollbackingBatchId(batchId);
    setUploadState((state) => ({ ...state, message: `배치 #${batchId} 롤백 처리 중...` }));
    try {
      const payload = await rollbackInstalledShadeUploadBatch(batchId);
      const [, , batchesPayload, existingPayload] = await Promise.all([
        refreshCandidates(),
        getMapLayers().then(setMapLayers),
        getInstalledShadeUploadBatches(),
        getExistingShades()
      ]);
      setUploadBatches(batchesPayload.batches || []);
      setExistingShades(existingPayload.shades || []);
      setFocusedUploadBatch((current) => (current?.id === batchId ? null : current));
      setUploadState((state) => ({
        ...state,
        message: `배치 #${batchId} 롤백 완료: 신규 취소 ${payload.rolledBackInserted || 0}건, 업데이트 복원 ${payload.rolledBackUpdated || 0}건`
      }));
    } finally {
      setRollbackingBatchId(null);
    }
  }

  function exportXlsx() {
    if (tableMode === "existing") {
      exportExistingShadesXlsx();
      return;
    }
    const rows = (result?.candidates || []).map((row, index) => ({
      순위: row.rank || index + 1,
      행정동: row.dongName,
      노드ID: row.nodeId,
      상태: statusLabel(row.status),
      총점: row.totalScore,
      주소: candidateAddress(row),
      도로명주소: row.roadAddress || "",
      지번주소: row.parcelAddress || "",
      도로명: row.roadName || "",
      도로폭: row.roadEffectiveWidthM ?? row.roadWidthM ?? "",
      인도폭: row.sidewalkWidthM ?? "",
      도로간선도로성점수: scoreOf(row, "major_road"),
      교차로점수: scoreOf(row, "intersection"),
      고령자점수: scoreOf(row, "elderly_density"),
      쉼터점수: scoreOf(row, "cooling_shelter_gap"),
      기존그늘막거리m: Math.round(row.nearestExistingShadeM || 0),
      무더위쉼터거리m: Math.round(row.nearestCoolingShelterM || 0),
      교차로거리m: Math.round(row.nearestIntersectionM || 0),
      제외사유: row.exclusionReason,
      현장확인사항: visibleReviewFlags(row).join("; "),
      경도: row.longitude,
      위도: row.latitude
    }));
    const sheet = XLSX.utils.json_to_sheet(rows);
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, sheet, "후보지");
    XLSX.writeFile(book, `그늘막_후보지_${mode}_${new Date().toISOString().slice(0, 10)}.xlsx`);
  }

  function exportExistingShadesXlsx() {
    const rows = filteredExistingShades.map((row, index) => ({
      연번: index + 1,
      법정동: row.dongName || "",
      관리번호: row.managementNo || "",
      설치장소명: row.name || "",
      주소: existingShadeAddress(row),
      경도: row.longitude,
      위도: row.latitude
    }));
    const sheet = XLSX.utils.json_to_sheet(rows);
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, sheet, "기존그늘막");
    XLSX.writeFile(book, `기존_그늘막_${new Date().toISOString().slice(0, 10)}.xlsx`);
  }

  function visibleReviewFlags(row) {
    return (row?.reviewFlags || []).filter((flag) => !String(flag).includes("MEDIUM"));
  }

  function scoreOf(row, ruleId) {
    return row.breakdown?.[ruleId]?.score ?? 0;
  }

  function roadLabel(row) {
    const width = row.roadEffectiveWidthM ?? row.roadWidthM;
    const widthText = Number.isFinite(width) ? `${Math.round(width * 10) / 10}m` : "-";
    return `${row.roadName || "-"} / ${widthText} (+${scoreOf(row, "major_road")})`;
  }

  function candidateAddress(row) {
    return firstText(row?.roadAddress, row?.parcelAddress) || "-";
  }

  function existingShadeAddress(row) {
    return firstText(row?.roadAddress, row?.lotAddress) || "-";
  }

  function firstText(...values) {
    for (const value of values) {
      const text = String(value ?? "").trim();
      if (text) return text;
    }
    return "";
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

  const tableCandidates = useMemo(() => {
    const rows = result?.candidates || [];
    const query = nodeIdQuery.trim().toLowerCase();
    if (!query) return rows;
    return rows.filter((row) =>
      String(row.nodeId || "").toLowerCase().includes(query) ||
      String(row.dongName || "").toLowerCase().includes(query)
    );
  }, [nodeIdQuery, result]);

  const filteredExistingShades = useMemo(() => {
    const query = nodeIdQuery.trim().toLowerCase();
    if (!query) return existingShades;
    return existingShades.filter((row) => String(row.managementNo || "").toLowerCase().includes(query));
  }, [existingShades, nodeIdQuery]);

  return (
    <div className="app-shell">
      <aside className="nav-rail" aria-label="주요 메뉴">
        <div className="brand-mark">SD</div>
        <button className="nav-button is-active" title="후보지 지도">
          <MapPinned size={20} />
        </button>
      </aside>

      <main className="workspace">
        <header className="topbar">
          <div>
            <h1>서대문구 그늘막 설치 위치 선정 시뮬레이션</h1>
            <p>대로변 횡단보도를 기본 후보로 두고 인도폭, 도로, 교차로, 고령자, 쉼터, 기존 설치 위치를 재평가합니다.</p>
          </div>
          <div className="topbar-actions">
            <span className={`db-badge ${health?.dbAvailable ? "ok" : "warn"}`}>
              {health?.dbAvailable ? "PostgreSQL 연결" : "로컬 데이터 모드"}
            </span>
            <button className="icon-button" onClick={refreshCandidates} title="재계산">
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
                <button key={item.id} className={mode === item.id ? "is-active" : ""} onClick={() => selectTableMode(item.id)}>
                  {item.label}
                </button>
              ))}
            </div>
            <CandidateMap
              candidates={result?.candidates || []}
              mapLayers={mapLayers}
              visibleLayers={visibleLayers}
              focusedUploadBatch={focusedUploadBatch}
              selectedCandidate={selectedCandidate}
              selectedExistingShade={selectedExistingShade}
              onSelect={selectCandidate}
              onSelectExistingShade={selectExistingShade}
              onToggleLayer={toggleMapLayer}
            />
          </div>

          <section className="table-panel">
            <div className="panel-header">
              <div className="tabs" role="tablist">
                {tableModes.map((item) => (
                  <button key={item.id} className={tableMode === item.id ? "is-active" : ""} onClick={() => selectTableMode(item.id)}>
                    {item.label}
                  </button>
                ))}
              </div>
              <div className="panel-tools">
                <label className="node-search">
                  <span>{tableMode === "existing" ? "관리번호" : "노드ID/법정동"}</span>
                  <input
                    type="search"
                    value={nodeIdQuery}
                    onChange={(event) => setNodeIdQuery(event.target.value)}
                    placeholder={tableMode === "existing" ? "예: 천연동-1" : "예: 84526, 홍은동"}
                    aria-label={tableMode === "existing" ? "관리번호 검색" : "노드ID 또는 법정동 검색"}
                  />
                </label>
                <button
                  className="secondary-button"
                  onClick={exportXlsx}
                  disabled={tableMode === "existing" ? !filteredExistingShades.length : !result?.candidates?.length}
                >
                  <Download size={16} />
                  엑셀 다운로드
                </button>
              </div>
            </div>

            <div className="candidate-table-wrap">
              {tableMode === "existing" ? (
                <table className="candidate-table existing-shade-table">
                  <colgroup>
                    <col className="col-rank" />
                    <col className="col-dong" />
                    <col className="col-node" />
                    <col className="col-place" />
                    <col className="col-address" />
                    <col className="col-coordinate" />
                    <col className="col-coordinate" />
                  </colgroup>
                  <thead>
                    <tr>
                      <th>연번</th>
                      <th>법정동</th>
                      <th>관리번호</th>
                      <th>설치장소명</th>
                      <th>주소</th>
                      <th>경도</th>
                      <th>위도</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredExistingShades.length === 0 ? (
                      <tr>
                        <td colSpan="7" className="empty-cell">검색 결과가 없습니다.</td>
                      </tr>
                    ) : (
                      filteredExistingShades.map((row, index) => (
                        <tr
                          key={row.id || row.managementNo || `${row.longitude}-${row.latitude}-${index}`}
                          className={selectedExistingShade?.managementNo === row.managementNo ? "is-current" : ""}
                          onClick={() => selectExistingShade(row)}
                        >
                          <td>{index + 1}</td>
                          <td>
                            <strong>{row.dongName || "-"}</strong>
                          </td>
                          <td>{row.managementNo || "-"}</td>
                          <td>{row.name || "-"}</td>
                          <td>{existingShadeAddress(row)}</td>
                          <td>{row.longitude ?? "-"}</td>
                          <td>{row.latitude ?? "-"}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              ) : (
                <table className="candidate-table">
                  <colgroup>
                    <col className="col-rank" />
                    <col className="col-node" />
                    <col className="col-dong" />
                    <col className="col-status" />
                    <col className="col-score" />
                    <col className="col-sidewalk" />
                    <col className="col-road" />
                    <col className="col-distance" />
                    <col className="col-elderly" />
                    <col className="col-distance" />
                    <col className="col-distance" />
                  </colgroup>
                  <thead>
                    <tr>
                      <th>순위</th>
                      <th>노드ID</th>
                      <th>법정동</th>
                      <th>상태</th>
                      <th>총점</th>
                      <th>인도폭</th>
                      <th>도로/간선</th>
                      <th>교차로</th>
                      <th>고령자</th>
                      <th>쉼터</th>
                      <th>기존</th>
                    </tr>
                  </thead>
                  <tbody>
                    {loading ? (
                      <tr>
                        <td colSpan="11" className="empty-cell">재계산 중...</td>
                      </tr>
                    ) : tableCandidates.length === 0 ? (
                      <tr>
                        <td colSpan="11" className="empty-cell">검색 결과가 없습니다.</td>
                      </tr>
                    ) : (
                      tableCandidates.map((row, index) => (
                        <tr
                          key={row.nodeId}
                          ref={(element) => {
                            if (element) rowRefs.current.set(row.nodeId, element);
                            else rowRefs.current.delete(row.nodeId);
                          }}
                          className={[
                            selectedCandidate?.nodeId === row.nodeId ? "is-current" : "",
                            highlightNodeId === row.nodeId ? "is-flashing" : ""
                          ].filter(Boolean).join(" ")}
                          onClick={() => selectCandidate(row, "table")}
                        >
                          <td>{row.rank || index + 1}</td>
                          <td>{row.nodeId}</td>
                          <td>
                            <strong>{row.dongName || "-"}</strong>
                          </td>
                          <td>
                            <span className={`status-pill ${statusClass(row.status)}`}>{statusLabel(row.status)}</span>
                          </td>
                          <td>{number(row.totalScore)}</td>
                          <td>{row.sidewalkWidthM ? `${row.sidewalkWidthM}m` : "-"}</td>
                          <td>{roadLabel(row)}</td>
                          <td>{`${meters(row.nearestIntersectionM)} (+${scoreOf(row, "intersection")})`}</td>
                          <td>{`+${scoreOf(row, "elderly_density")}`}</td>
                          <td>{`${meters(row.nearestCoolingShelterM)} (+${scoreOf(row, "cooling_shelter_gap")})`}</td>
                          <td>{meters(row.nearestExistingShadeM)}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              )}
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
                <div className="detail-address-row"><dt>주소</dt><dd>{candidateAddress(selectedCandidate)}</dd></div>
                <div><dt>총점</dt><dd>{number(selectedCandidate.totalScore)}</dd></div>
                <div><dt>도로</dt><dd>{roadLabel(selectedCandidate)}</dd></div>
                <div><dt>인도폭</dt><dd>{selectedCandidate.sidewalkWidthM ? `${selectedCandidate.sidewalkWidthM}m` : "데이터 없음"}</dd></div>
                <div><dt>기존 그늘막</dt><dd>{meters(selectedCandidate.nearestExistingShadeM)}</dd></div>
              </dl>
              {(selectedCandidate.exclusionReason || visibleReviewFlags(selectedCandidate).length > 0) && (
                <div className="warning-box">
                  <AlertTriangle size={16} />
                  <span>{selectedCandidate.exclusionReason || visibleReviewFlags(selectedCandidate).join(", ")}</span>
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
          {uploadBatches.length > 0 && (
            <div className="upload-batches">
              <div className="upload-batches-title">최근 업로드 이력</div>
              {uploadBatches.slice(0, 6).map((batch) => (
                <div
                  className={`upload-batch-row ${focusedUploadBatch?.id === batch.id ? "is-focused" : ""}`}
                  key={batch.id}
                >
                  <div>
                    <strong>#{batch.id} {batch.installedYear || "-"}</strong>
                    <span>{new Date(batch.createdAt).toLocaleString("ko-KR")}</span>
                    <small>
                      신규 {batch.insertedCount}, 수정 {batch.updatedCount}, 동일 {batch.skippedCount}, 실패 {batch.failedCount}
                    </small>
                  </div>
                  <button
                    type="button"
                    className="mini-action-button"
                    disabled={Boolean(batch.rolledBackAt)}
                    onClick={() => showUploadBatchOnMap(batch.id)}
                    title={batch.rolledBackAt ? "롤백된 업로드는 지도에 표시하지 않습니다." : "이 업로드 위치를 지도에서 강조 표시합니다."}
                  >
                    지도
                  </button>
                  <button
                    type="button"
                    className="mini-danger-button"
                    disabled={Boolean(batch.rolledBackAt) || rollbackingBatchId === batch.id}
                    onClick={() => handleRollbackUploadBatch(batch.id)}
                    title={batch.rolledBackAt ? "이미 롤백된 업로드입니다." : "이 업로드로 반영된 변경만 되돌립니다."}
                  >
                    {batch.rolledBackAt ? "롤백됨" : rollbackingBatchId === batch.id ? "처리 중" : "롤백"}
                  </button>
                </div>
              ))}
            </div>
          )}
        </section>
      </aside>
    </div>
  );
}
