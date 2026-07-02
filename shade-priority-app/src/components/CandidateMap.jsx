import { useEffect, useMemo, useRef } from "react";
import L from "leaflet";
import "leaflet.markercluster";
import { GeoJSON, MapContainer, TileLayer, useMap } from "react-leaflet";
import selectedIcon from "../assets/icons/candidate-selected.png";
import reviewIcon from "../assets/icons/candidate-review.svg";
import excludedIcon from "../assets/icons/candidate-excluded.png";
import existingShadeIcon from "../assets/icons/existing_shade.png";
import coolingShelterIcon from "../assets/icons/cooling-shelter.png";
import { meters, number, statusClass, statusLabel } from "../lib/format.js";

const center = [37.579, 126.936];

export function CandidateMap({
  candidates,
  mapLayers,
  visibleLayers,
  focusedUploadBatch,
  selectedCandidate,
  selectedExistingShade,
  onSelect,
  onSelectExistingShade,
  onToggleLayer
}) {
  const markerRefs = useRef(new Map());
  const existingMarkerRefs = useRef(new Map());
  const clusterGroupRef = useRef(null);

  return (
    <>
      <MapContainer center={center} zoom={13} className="candidate-map" scrollWheelZoom>
        <TileLayer
          attribution="&copy; OpenStreetMap"
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <MapFocus candidate={selectedCandidate} />
        {visibleLayers.elderly && mapLayers?.elderlyDongs?.features?.length > 0 && (
          <GeoJSON
            key={`elderly-${mapLayers.elderlyDongs.features.length}`}
            data={mapLayers.elderlyDongs}
            style={elderlyDongStyle}
            onEachFeature={bindElderlyPopup}
          />
        )}
        <ClusteredMarkers
          candidates={candidates}
          mapLayers={mapLayers}
          visibleLayers={visibleLayers}
          selectedCandidate={selectedCandidate}
          selectedExistingShade={selectedExistingShade}
          markerRefs={markerRefs}
          existingMarkerRefs={existingMarkerRefs}
          clusterGroupRef={clusterGroupRef}
          onSelect={onSelect}
          onSelectExistingShade={onSelectExistingShade}
        />
        <UploadBatchHighlight batch={focusedUploadBatch} />
      </MapContainer>
      <MapLayerControl visibleLayers={visibleLayers} onToggleLayer={onToggleLayer} />
      {visibleLayers.elderly && <ElderlyLegend legend={mapLayers?.elderlyLegend || []} />}
      <div className="map-attribution-extra">
        Icons by Flaticon. Administrative boundary data from VWorld/국토교통부.
      </div>
    </>
  );
}

function ClusteredMarkers({
  candidates,
  mapLayers,
  visibleLayers,
  selectedCandidate,
  selectedExistingShade,
  markerRefs,
  existingMarkerRefs,
  clusterGroupRef,
  onSelect,
  onSelectExistingShade
}) {
  const map = useMap();
  const icons = useMemo(() => createMarkerIcons(), []);

  useEffect(() => {
    markerRefs.current.clear();
    existingMarkerRefs.current.clear();

    const group = L.markerClusterGroup({
      showCoverageOnHover: false,
      spiderfyOnMaxZoom: true,
      disableClusteringAtZoom: 15,
      maxClusterRadius: 30,
      iconCreateFunction: createClusterIcon
    });

    candidates.forEach((candidate) => {
      if (!Number.isFinite(candidate.latitude) || !Number.isFinite(candidate.longitude)) return;

      const marker = L.marker([candidate.latitude, candidate.longitude], {
        icon: icons[candidate.status] || icons.selected,
        title: `${candidate.dongName || ""} ${candidate.nodeId || ""}`.trim()
      });

      marker.bindPopup(candidatePopupHtml(candidate));
      marker.on("click", () => onSelect(candidate, "map"));
      markerRefs.current.set(candidate.nodeId, marker);
      group.addLayer(marker);
    });

    if (visibleLayers.existingShades) {
      (mapLayers?.existingShades || []).forEach((shade) => {
        if (!Number.isFinite(shade.latitude) || !Number.isFinite(shade.longitude)) return;

        const marker = L.marker([shade.latitude, shade.longitude], {
          icon: icons.existingShade,
          title: shade.managementNo || shade.name || "기존 그늘막"
        });

        marker.bindPopup(existingShadePopupHtml(shade));
        marker.on("click", () => onSelectExistingShade?.(shade));
        existingMarkerRefs.current.set(existingShadeKey(shade), marker);
        group.addLayer(marker);
      });
    }

    if (visibleLayers.coolingShelters) {
      (mapLayers?.coolingShelters || []).forEach((shelter) => {
        if (!Number.isFinite(shelter.latitude) || !Number.isFinite(shelter.longitude)) return;

        const marker = L.marker([shelter.latitude, shelter.longitude], {
          icon: icons.coolingShelter,
          title: shelter.name || "무더위쉼터"
        });

        marker.bindPopup(coolingShelterPopupHtml(shelter));
        group.addLayer(marker);
      });
    }

    group.addTo(map);
    clusterGroupRef.current = group;

    return () => {
      markerRefs.current.clear();
      existingMarkerRefs.current.clear();
      clusterGroupRef.current = null;
      map.removeLayer(group);
    };
  }, [candidates, existingMarkerRefs, icons, map, mapLayers, markerRefs, clusterGroupRef, onSelect, onSelectExistingShade, visibleLayers]);

  useEffect(() => {
    if (!selectedCandidate || !clusterGroupRef.current) return;

    const marker = markerRefs.current.get(selectedCandidate.nodeId);
    if (!marker) return;

    clusterGroupRef.current.zoomToShowLayer(marker, () => marker.openPopup());
  }, [clusterGroupRef, markerRefs, selectedCandidate]);

  useEffect(() => {
    if (!selectedExistingShade || !clusterGroupRef.current) return;

    const marker = existingMarkerRefs.current.get(existingShadeKey(selectedExistingShade));
    if (!marker) return;

    clusterGroupRef.current.zoomToShowLayer(marker, () => marker.openPopup());
  }, [clusterGroupRef, existingMarkerRefs, selectedExistingShade]);

  return null;
}

function createMarkerIcons() {
  return {
    selected: markerIcon({ url: selectedIcon, className: "is-selected" }),
    review_required: markerIcon({ url: reviewIcon, className: "is-review" }),
    excluded: markerIcon({ url: excludedIcon, className: "is-excluded" }),
    existingShade: markerIcon({ url: existingShadeIcon, className: "is-existing" }),
    coolingShelter: markerIcon({ url: coolingShelterIcon, className: "is-shelter" })
  };
}

function markerIcon({ url, className }) {
  return L.icon({
    iconUrl: url,
    className: `map-image-icon ${className}`,
    iconSize: [20, 20],
    iconAnchor: [10, 10],
    popupAnchor: [0, -16]
  });
}

function createClusterIcon(cluster) {
  const count = cluster.getChildCount();
  const sizeClass = count >= 100 ? "is-large" : count >= 30 ? "is-medium" : "is-small";

  return L.divIcon({
    className: `map-cluster-icon ${sizeClass}`,
    html: `<span>${count}</span>`,
    iconSize: [42, 42],
    iconAnchor: [21, 21]
  });
}

function MapLayerControl({ visibleLayers, onToggleLayer }) {
  const layers = [
    { id: "elderly", label: "고령자 분포", type: "swatch" },
    { id: "existingShades", label: "기존 그늘막", icon: existingShadeIcon },
    { id: "coolingShelters", label: "무더위쉼터", icon: coolingShelterIcon }
  ];

  return (
    <div className="map-layer-control">
      {layers.map((layer) => (
        <label key={layer.id}>
          <input
            type="checkbox"
            checked={Boolean(visibleLayers[layer.id])}
            onChange={() => onToggleLayer(layer.id)}
          />
          {layer.icon ? (
            <img className="map-layer-icon" src={layer.icon} alt="" aria-hidden="true" />
          ) : (
            <span className="map-layer-swatch" aria-hidden="true" />
          )}
          <span>{layer.label}</span>
        </label>
      ))}
    </div>
  );
}

function ElderlyLegend({ legend }) {
  if (!legend.length) return null;

  return (
    <div className="elderly-legend">
      <strong>65세 이상 인구 비율</strong>
      {legend.map((item) => (
        <div key={`${item.color}-${item.label}`}>
          <span style={{ background: item.color }} />
          <em>{item.label}</em>
        </div>
      ))}
    </div>
  );
}

function MapFocus({ candidate }) {
  const map = useMap();

  useEffect(() => {
    if (!candidate) return;
    map.flyTo([candidate.latitude, candidate.longitude], Math.max(map.getZoom(), 15), {
      duration: 0.5
    });
  }, [candidate, map]);

  return null;
}

function UploadBatchHighlight({ batch }) {
  const map = useMap();

  useEffect(() => {
    const shades = batch?.shades || [];
    if (!shades.length) return undefined;

    const layer = L.layerGroup();
    const latLngs = [];

    shades.forEach((shade) => {
      if (!Number.isFinite(shade.latitude) || !Number.isFinite(shade.longitude)) return;
      const latLng = [shade.latitude, shade.longitude];
      latLngs.push(latLng);
      const ring = L.circleMarker(latLng, {
        radius: 14,
        color: "#7c3aed",
        weight: 3,
        opacity: 0.95,
        fillColor: "#c4b5fd",
        fillOpacity: 0.24,
        className: "upload-highlight-ring"
      });
      ring.bindPopup(uploadedShadePopupHtml(shade, batch.id));
      layer.addLayer(ring);
    });

    layer.addTo(map);
    if (latLngs.length === 1) {
      map.flyTo(latLngs[0], Math.max(map.getZoom(), 16), { duration: 0.55 });
    } else if (latLngs.length > 1) {
      map.fitBounds(L.latLngBounds(latLngs), { padding: [42, 42], maxZoom: 16 });
    }

    return () => {
      map.removeLayer(layer);
    };
  }, [batch, map]);

  return null;
}

function elderlyDongStyle(feature) {
  return {
    color: "#7f1d1d",
    weight: 1,
    opacity: 0.65,
    fillColor: feature.properties.color || "#fee2e2",
    fillOpacity: 0.32
  };
}

function uploadedShadePopupHtml(shade, batchId) {
  return `
    <div class="map-popup">
      <strong>${escapeHtml(shade.managementNo || "업로드 그늘막")}</strong>
      <span class="status-pill is-uploaded">최근 업로드 #${escapeHtml(batchId)}</span>
      <dl>
        <div><dt>처리</dt><dd>${escapeHtml(shade.action === "inserted" ? "신규" : "수정")}</dd></div>
        <div><dt>설치장소</dt><dd>${escapeHtml(shade.name || "-")}</dd></div>
        <div><dt>읍면동</dt><dd>${escapeHtml(shade.adminDongName || "-")}</dd></div>
      </dl>
    </div>
  `;
}

function bindElderlyPopup(feature, layer) {
  const ratio = Number.isFinite(feature.properties.elderlyRatio)
    ? `${Math.round(feature.properties.elderlyRatio * 1000) / 10}%`
    : "데이터 없음";

  layer.bindPopup(`
    <div class="map-popup">
      <strong>${escapeHtml(feature.properties.dongName)}</strong>
      <dl>
        <div><dt>65세 이상 비율</dt><dd>${escapeHtml(ratio)}</dd></div>
        <div><dt>대상 행정동</dt><dd>${escapeHtml(feature.properties.sourceDongName || "-")}</dd></div>
      </dl>
    </div>
  `);
}

function candidatePopupHtml(candidate) {
  const reviewFlags = visibleReviewFlags(candidate);
  const reason = candidate.exclusionReason || reviewFlags.join(", ");

  return `
    <div class="map-popup">
      <strong>${escapeHtml(candidate.dongName || "-")} · ${escapeHtml(candidate.nodeId)}</strong>
      <span class="status-pill ${statusClass(candidate.status)}">${escapeHtml(statusLabel(candidate.status))}</span>
      <dl>
        <div><dt>총점</dt><dd>${escapeHtml(number(candidate.totalScore))}</dd></div>
        <div><dt>도로</dt><dd>${escapeHtml(roadText(candidate))}</dd></div>
        <div><dt>인도폭</dt><dd>${escapeHtml(candidate.sidewalkWidthM ? `${candidate.sidewalkWidthM}m` : "데이터 없음")}</dd></div>
        <div><dt>기존 그늘막</dt><dd>${escapeHtml(meters(candidate.nearestExistingShadeM))}</dd></div>
        <div><dt>무더위쉼터</dt><dd>${escapeHtml(meters(candidate.nearestCoolingShelterM))}</dd></div>
        <div><dt>교차로</dt><dd>${escapeHtml(meters(candidate.nearestIntersectionM))}</dd></div>
      </dl>
      ${
        reason
          ? `<div class="popup-reason ${candidate.status === "excluded" ? "is-excluded" : "is-review"}">
              <span>${candidate.status === "excluded" ? "제외 사유" : "확인 사유"}</span>
              <strong>${escapeHtml(reason)}</strong>
            </div>`
          : ""
      }
    </div>
  `;
}

function existingShadePopupHtml(shade) {
  return `
    <div class="map-popup">
      <strong>${escapeHtml(shade.managementNo || "기존 그늘막")}</strong>
      <span class="status-pill is-existing">기존 그늘막</span>
      <dl>
        <div><dt>설치장소</dt><dd>${escapeHtml(shade.name || "-")}</dd></div>
        <div><dt>주소</dt><dd>${escapeHtml(existingShadeAddress(shade))}</dd></div>
        <div><dt>경도</dt><dd>${escapeHtml(shade.longitude)}</dd></div>
        <div><dt>위도</dt><dd>${escapeHtml(shade.latitude)}</dd></div>
      </dl>
    </div>
  `;
}

function coolingShelterPopupHtml(shelter) {
  return `
    <div class="map-popup">
      <strong>${escapeHtml(shelter.name || "무더위쉼터")}</strong>
      <span class="status-pill is-shelter">무더위쉼터</span>
      <dl>
        <div><dt>주소</dt><dd>${escapeHtml(shelter.roadAddress || "-")}</dd></div>
        <div><dt>경도</dt><dd>${escapeHtml(shelter.longitude)}</dd></div>
        <div><dt>위도</dt><dd>${escapeHtml(shelter.latitude)}</dd></div>
      </dl>
    </div>
  `;
}

function roadText(candidate) {
  const width = candidate.roadEffectiveWidthM ?? candidate.roadWidthM;
  const widthText = Number.isFinite(width) ? `${Math.round(width * 10) / 10}m` : "-";
  return `${candidate.roadName || "-"} / ${widthText}`;
}

function existingShadeKey(shade) {
  return shade?.id || shade?.managementNo || `${shade?.longitude}-${shade?.latitude}`;
}

function existingShadeAddress(shade) {
  return firstText(shade?.roadAddress, shade?.lotAddress) || "-";
}

function firstText(...values) {
  for (const value of values) {
    const text = String(value ?? "").trim();
    if (text) return text;
  }
  return "";
}

function visibleReviewFlags(candidate) {
  return (candidate?.reviewFlags || []).filter((flag) => !String(flag).includes("MEDIUM"));
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
