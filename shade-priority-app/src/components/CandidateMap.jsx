import { useEffect } from "react";
import { CircleMarker, MapContainer, Popup, TileLayer, useMap } from "react-leaflet";
import { meters, number, statusClass, statusLabel } from "../lib/format.js";

const center = [37.579, 126.936];

export function CandidateMap({ candidates, existingShades = [], selectedCandidate, onSelect }) {
  return (
    <MapContainer center={center} zoom={13} className="candidate-map" scrollWheelZoom>
      <TileLayer
        attribution="&copy; OpenStreetMap"
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      <MapFocus candidate={selectedCandidate} />
      {candidates.map((candidate) => (
        <CircleMarker
          key={candidate.nodeId}
          center={[candidate.latitude, candidate.longitude]}
          radius={selectedCandidate?.nodeId === candidate.nodeId ? 10 : 7}
          pathOptions={markerStyle(candidate)}
          eventHandlers={{ click: () => onSelect(candidate) }}
        >
          <Popup>
            <div className="map-popup">
              <strong>{candidate.dongName || "-"} · {candidate.nodeId}</strong>
              <span className={`status-pill ${statusClass(candidate.status)}`}>{statusLabel(candidate.status)}</span>
              <dl>
                <div><dt>총점</dt><dd>{number(candidate.totalScore)}</dd></div>
                <div><dt>보도폭</dt><dd>{candidate.sidewalkWidthM ? `${candidate.sidewalkWidthM}m` : "데이터 없음"}</dd></div>
                <div><dt>기존 그늘막</dt><dd>{meters(candidate.nearestExistingShadeM)}</dd></div>
                <div><dt>교차로</dt><dd>{meters(candidate.nearestIntersectionM)}</dd></div>
              </dl>
              {(candidate.exclusionReason || candidate.reviewFlags?.length > 0) && (
                <div className={`popup-reason ${candidate.status === "excluded" ? "is-excluded" : "is-review"}`}>
                  <span>{candidate.status === "excluded" ? "제외 사유" : "확인 사유"}</span>
                  <strong>{candidate.exclusionReason || candidate.reviewFlags.join(", ")}</strong>
                </div>
              )}
            </div>
          </Popup>
        </CircleMarker>
      ))}
      {existingShades.map((shade) => (
        <CircleMarker
          key={`shade-${shade.managementNo || shade.name}-${shade.longitude}-${shade.latitude}`}
          center={[shade.latitude, shade.longitude]}
          radius={7}
          pathOptions={{
            color: "#111827",
            weight: 2,
            fillColor: "#111827",
            fillOpacity: 0.86
          }}
        >
          <Popup>
            <div className="map-popup">
              <strong>{shade.managementNo || "기존 그늘막"}</strong>
              <span className="status-pill is-existing">기존 그늘막</span>
              <dl>
                <div><dt>설치장소</dt><dd>{shade.name || "-"}</dd></div>
                <div><dt>경도</dt><dd>{shade.longitude}</dd></div>
                <div><dt>위도</dt><dd>{shade.latitude}</dd></div>
              </dl>
            </div>
          </Popup>
        </CircleMarker>
      ))}
    </MapContainer>
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

function markerStyle(candidate) {
  if (candidate.status === "selected") {
    return {
      color: "#047857",
      weight: 2,
      fillColor: "#10b981",
      fillOpacity: 0.82
    };
  }
  if (candidate.status === "review_required") {
    return {
      color: "#b45309",
      weight: 2,
      fillColor: "#f59e0b",
      fillOpacity: 0.82
    };
  }
  return {
    color: "#b91c1c",
    weight: 2,
    fillColor: "#ef4444",
    fillOpacity: 0.76
  };
}
