// ============================
// 0) Map init
// ============================
const map = L.map("map").setView([37.579, 126.936], 13);

L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  attribution: "© OpenStreetMap"
}).addTo(map);

// ============================
// 1) Choropleth (행정동 + 고령자)
// ============================
function getColor(value) {
  return value > 5000 ? "#800026" :
         value > 4000 ? "#BD0026" :
         value > 3000 ? "#E31A1C" :
         value > 2000 ? "#FC4E2A" :
         value > 1000 ? "#FD8D3C" :
                        "#FFEDA0";
}

function styleDong(feature) {
  const elderly = feature.properties.ELDERLY || 0;
  return {
    fillColor: getColor(elderly),
    weight: 1,
    opacity: 1,
    color: "#555",
    fillOpacity: 0.55
  };
}

const info = L.control({ position: "topright" });
info.onAdd = function () {
  this._div = L.DomUtil.create("div", "info");
  this.update();
  return this._div;
};
info.update = function (props) {
  const title = "서대문구 고령인구 (행정동)";
  if (!props) {
    this._div.innerHTML = `<h4>${title}</h4><div>행정동 위에 마우스를 올리면 값이 보여.</div>`;
    return;
  }
  const nm = props.ADM_NM || "행정동";
  const v = (props.ELDERLY || 0).toLocaleString();
  this._div.innerHTML = `<h4>${title}</h4><b>${nm}</b><br/>고령자: ${v}명`;
};
info.addTo(map);

let geojsonLayer = null;
function highlightFeature(e) {
  const layer = e.target;
  layer.setStyle({ weight: 2, color: "#111", fillOpacity: 0.7 });
  layer.bringToFront();
  info.update(layer.feature.properties);
}
function resetHighlight(e) {
  geojsonLayer.resetStyle(e.target);
  info.update();
}
function zoomToFeature(e) { map.fitBounds(e.target.getBounds()); }
function onEachDong(feature, layer) {
  layer.on({ mouseover: highlightFeature, mouseout: resetHighlight, click: zoomToFeature });
  const nm = feature.properties.ADM_NM || "";
  const v = (feature.properties.ELDERLY || 0).toLocaleString();
  layer.bindTooltip(`<b>${nm}</b><br/>고령자: ${v}명`, { sticky: true });
}

fetch("seodaemun_dongs_elderly.geojson")
  .then(res => res.json())
  .then(geojson => {
    geojsonLayer = L.geoJSON(geojson, { style: styleDong, onEachFeature: onEachDong }).addTo(map);
  });

// Legend
const legend = L.control({ position: "bottomright" });
legend.onAdd = function () {
  const div = L.DomUtil.create("div", "info legend");
  const grades = [0, 1000, 2000, 3000, 4000, 5000];
  div.innerHTML += `<h4 style="margin:0 0 6px;">고령자 수</h4>`;
  for (let i = 0; i < grades.length; i++) {
    const from = grades[i];
    const to = grades[i + 1];
    div.innerHTML += `<i style="background:${getColor(from + 1)}"></i> ${from}${to ? `–${to}<br>` : "+"}`;
  }
  div.innerHTML += `<div style="margin-top:8px; font-size:12px; color:#666;">(행정동 단위)</div>`;
  return div;
};
legend.addTo(map);

// ============================
// 2) Marker layers (횡단보도/그늘막) - 서로 "분리" 표시 + 각각 토글
// ============================

function svgIconDataUri(svg) {
  return "data:image/svg+xml;charset=UTF-8," + encodeURIComponent(svg);
}

const crosswalkIcon = L.icon({
  iconUrl: svgIconDataUri(`
<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32">
  <circle cx="16" cy="16" r="13" fill="#2b6cb0"/>
  <path d="M9 20h14v2H9zm1-3h12v2H10zm2-3h8v2h-8z" fill="white"/>
  <path d="M12 10c1.2 0 2 .9 2 2.1 0 1.2-.8 2.1-2 2.1s-2-.9-2-2.1c0-1.2.8-2.1 2-2.1z" fill="white"/>
  <path d="M15 22l3-7 2 1-2 6z" fill="white" opacity="0.9"/>
</svg>`),
  iconSize: [26, 26],
  iconAnchor: [13, 13],
  popupAnchor: [0, -10]
});

const shadeIcon = L.icon({
  iconUrl: svgIconDataUri(`
<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32">
  <circle cx="16" cy="16" r="13" fill="#2f855a"/>
  <path d="M9 18c4-7 10-7 14 0" stroke="white" stroke-width="2" fill="none" stroke-linecap="round"/>
  <path d="M16 12v10" stroke="white" stroke-width="2" stroke-linecap="round"/>
  <path d="M13 22h6" stroke="white" stroke-width="2" stroke-linecap="round"/>
</svg>`),
  iconSize: [26, 26],
  iconAnchor: [13, 13],
  popupAnchor: [0, -10]
});

// ✅ 분리된 클러스터 그룹 (서로 섞지 않음)
const crosswalkCluster = L.markerClusterGroup({
  showCoverageOnHover: false,
  maxClusterRadius: 45
});
const shadeCluster = L.markerClusterGroup({
  showCoverageOnHover: false,
  maxClusterRadius: 45
});

function toNum(v) {
  if (v === null || v === undefined) return null;
  const n = Number(String(v).trim());
  return Number.isFinite(n) ? n : null;
}

function addCrosswalkMarkers(csvUrl) {
  return fetch(csvUrl)
    .then(res => res.text())
    .then(text => {
      const parsed = Papa.parse(text, { header: true, skipEmptyLines: true });
      const rows = parsed.data || [];
      let added = 0;

      rows.forEach(r => {
        const lat = toNum(r["위도"]);
        const lng = toNum(r["경도"]);
        if (lat === null || lng === null) return;

        const dong = r["읍면동명"] || "";
        const nodeId = r["노드 ID"] || "";
        const m = L.marker([lat, lng], { icon: crosswalkIcon })
          .bindPopup(`<b>횡단보도 노드</b><br/>동: ${dong}<br/>노드ID: ${nodeId}`);
        crosswalkCluster.addLayer(m);
        added++;
      });

      return added;
    });
}

function addShadeMarkers(csvUrl) {
  return fetch(csvUrl)
    .then(res => res.text())
    .then(text => {
      const parsed = Papa.parse(text, { header: true, skipEmptyLines: true });
      const rows = parsed.data || [];
      let added = 0;

      rows.forEach(r => {
        const lat = toNum(r["위도"]);
        const lng = toNum(r["경도"]);
        if (lat === null || lng === null) return;

        const name = r["설치장소명"] || "그늘막";
        const id = r["관리번호"] || "";
        const m = L.marker([lat, lng], { icon: shadeIcon })
          .bindPopup(`<b>기존 그늘막</b><br/>${name}${id ? `<br/>관리번호: ${id}` : ""}`);
        shadeCluster.addLayer(m);
        added++;
      });

      return added;
    });
}

// ============================
// 3) Candidate TOP100 layer + Sidebar list
// ============================

const candidateLayer = L.layerGroup();
const candidateByRank = new Map(); // rank -> marker
let candidateFeatures = []; // for list rendering
let activeRank = null;

const candidateIcon = L.icon({
  iconUrl: svgIconDataUri(`
<svg xmlns="http://www.w3.org/2000/svg" width="36" height="36">
  <path d="M18 2l4.2 10.4 11.1.9-8.4 7.2 2.6 10.8L18 25.5 8.5 31.3 11.1 20.5 2.7 13.3l11.1-.9z"
        fill="#d9480f" stroke="white" stroke-width="2" />
</svg>`),
  iconSize: [28, 28],
  iconAnchor: [14, 14],
  popupAnchor: [0, -12]
});

function buildCandidatePopup(props) {
  const parts = [
    `<b>후보지 #${props.rank}</b> (총점: <b>${props.score_total}</b>)`,
    `노드ID: ${props.node_id}`,
    `동: ${props.adm_dong || props.dong || "-"}`,
    `<hr style="margin:8px 0;">`,
    `도로(0~3): ${props.score_road} / 교차로(0~3): ${props.score_intersection}`,
    `대로변일치(0~2): ${props.score_boulevard_match} / 고령(0~2): ${props.score_elderly} / 쉼터(0~2): ${props.score_shelter_gap}`,
    `<hr style="margin:8px 0;">`,
    `기존 그늘막 거리: ${Math.round(props.d_shade_m)}m`,
    `대로변 지점 거리: ${Math.round(props.d_boulevard_m)}m`,
    `교차로(대형) 거리: ${Math.round(props.d_major_int_m)}m`,
    `무더위쉼터 거리: ${Math.round(props.d_shelter_m)}m`,
  ];
  return parts.join("<br/>");
}

function renderList(items) {
  const listEl = document.getElementById("candidateList");
  listEl.innerHTML = "";

  if (!items.length) {
    listEl.innerHTML = `<div style="padding:14px; color:#666; font-size:13px;">검색 결과가 없어.</div>`;
    return;
  }

  items.forEach(f => {
    const p = f.properties;
    const div = document.createElement("div");
    div.className = "item" + (activeRank === p.rank ? " active" : "");
    div.dataset.rank = p.rank;

    const place = (p.adm_dong || p.dong || "-");
    const detail = `노드ID: ${p.node_id} · 도로 ${p.score_road} / 교차로 ${p.score_intersection} / 대로 ${p.score_boulevard_match} / 고령 ${p.score_elderly} / 쉼터 ${p.score_shelter_gap}`;

    div.innerHTML = `
      <div class="row1">
        <div class="rank">#${p.rank}</div>
        <div class="score">총점 ${p.score_total}</div>
      </div>
      <div class="place">${place}</div>
      <div class="detail">${detail}</div>
    `;

    div.addEventListener("click", () => focusCandidate(p.rank));
    listEl.appendChild(div);
  });
}

function setActiveRank(rank) {
  activeRank = rank;
  const listEl = document.getElementById("candidateList");
  listEl.querySelectorAll(".item").forEach(el => {
    el.classList.toggle("active", Number(el.dataset.rank) === rank);
  });
}

function focusCandidate(rank) {
  const marker = candidateByRank.get(rank);
  if (!marker) return;

  setActiveRank(rank);

  const latlng = marker.getLatLng();
  map.setView(latlng, Math.max(map.getZoom(), 16), { animate: true });
  marker.openPopup();
}

function initSearchUI() {
  const input = document.getElementById("searchInput");
  const clearBtn = document.getElementById("clearBtn");

  function apply() {
    const q = (input.value || "").trim().toLowerCase();
    if (!q) { renderList(candidateFeatures); return; }
    const filtered = candidateFeatures.filter(f => {
      const p = f.properties;
      const s = `${p.rank} ${p.node_id} ${p.dong || ""} ${p.adm_dong || ""}`.toLowerCase();
      return s.includes(q);
    });
    renderList(filtered);
  }

  input.addEventListener("input", apply);
  clearBtn.addEventListener("click", () => {
    input.value = "";
    renderList(candidateFeatures);
  });
}


function initDownloadBtn() {
  const btn = document.getElementById("downloadBtn");
  if (!btn) return;

  btn.addEventListener("click", async () => {
    try {
      const res = await fetch("data/candidate_top100_download.csv");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "서대문구_그늘막_후보지_TOP100.csv";
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      alert("CSV 다운로드에 실패했어. 콘솔을 확인해줘.");
      console.error(e);
    }
  });
}


function loadCandidates() {
  return fetch("data/candidate_top100.geojson")
    .then(r => r.json())
    .then(gj => {
      candidateFeatures = (gj.features || []).slice().sort((a, b) => {
        const sa = Number(a.properties.score_total) || 0;
        const sb = Number(b.properties.score_total) || 0;
        if (sb !== sa) return sb - sa;
        return (Number(a.properties.rank) || 0) - (Number(b.properties.rank) || 0);
      });

      candidateFeatures.forEach(f => {
        const p = f.properties;
        const coords = f.geometry.coordinates; // [lng, lat]
        const latlng = L.latLng(coords[1], coords[0]);

        const marker = L.marker(latlng, { icon: candidateIcon })
          .bindPopup(buildCandidatePopup(p));

        marker.on("click", () => setActiveRank(p.rank));

        candidateLayer.addLayer(marker);
        candidateByRank.set(p.rank, marker);
      });

      renderList(candidateFeatures);
      initSearchUI();
      initDownloadBtn();
    });
}

// ============================
// 4) Bootstrapping + Layer control
// ============================
Promise.all([
  addCrosswalkMarkers("data/crosswalk_nodes_437.csv"),
  addShadeMarkers("data/shade_existing.csv"),
  loadCandidates()
]).then(([crossAdded, shadeAdded]) => {
  // Default: show all
  map.addLayer(crosswalkCluster);
  map.addLayer(shadeCluster);
  map.addLayer(candidateLayer);

  const overlays = {
    "🚸 횡단보도(클러스터)": crosswalkCluster,
    "🌳 기존 그늘막(클러스터)": shadeCluster,
    "⭐ 후보지 TOP100": candidateLayer
  };

  L.control.layers({}, overlays, { collapsed: false }).addTo(map);

  console.log("Loaded markers:", { crossAdded, shadeAdded, candidates: candidateFeatures.length });
}).catch(err => {
  console.error("Failed to load layers:", err);
});
