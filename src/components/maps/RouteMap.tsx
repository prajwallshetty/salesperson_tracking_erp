'use client';

import React from 'react';
import dynamic from 'next/dynamic';

export interface RoutePoint {
  latitude: number;
  longitude: number;
  speed?: number | null;
  accuracy?: number | null;
  isFiltered?: boolean;
  timestamp: string;
}

interface RouteMapProps {
  /** Polyline segments split at tracking gaps. Each gap is drawn as a break, never bridged. */
  segments: RoutePoint[][];
  events?: { visits?: any[]; expenses?: any[] };
}

const TZ = process.env.NEXT_PUBLIC_DEFAULT_TIMEZONE || 'Asia/Kolkata';
const t = (d: string) => new Date(d).toLocaleTimeString('en-IN', { timeZone: TZ, hour: '2-digit', minute: '2-digit' });

const DynamicRouteMap = dynamic(
  async () => {
    const L = (await import('leaflet')).default;
    const { MapContainer, TileLayer, Polyline, Marker, Popup, useMap } = await import('react-leaflet');

    const badge = (bg: string, label: string, round = true) =>
      L.divIcon({
        html: `<div style="background:${bg};width:22px;height:22px;border-radius:${round ? '50%' : '4px'};border:2px solid #fff;box-shadow:0 1px 3px rgba(0,0,0,.3);display:flex;align-items:center;justify-content:center;color:#fff;font:700 10px Inter,sans-serif">${label}</div>`,
        className: '',
        iconSize: [22, 22],
        iconAnchor: [11, 11],
      });
    const startIcon = badge('#2E6819', 'S');
    const endIcon = badge('#991B1B', 'E');
    const visitIcon = badge('#6D28D9', 'V', false);
    const expenseIcon = badge('#B45309', '₹', false);

    function Fit({ coords }: { coords: [number, number][] }) {
      const map = useMap();
      React.useEffect(() => {
        if (coords.length === 1) map.setView(coords[0], 15);
        else if (coords.length > 1) map.fitBounds(L.latLngBounds(coords), { padding: [30, 30], maxZoom: 17 });
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, [coords.length]);
      return null;
    }

    return function RouteMapComponent({ segments, events }: RouteMapProps) {
      const all = segments.flat();
      const visits = (events?.visits || []).filter((v) => v.latitude != null && v.longitude != null);
      const expenses = (events?.expenses || []).filter((e) => e.latitude != null && e.longitude != null);
      if (all.length === 0 && visits.length === 0) {
        return <div className="h-full w-full bg-[#F3F5F6] rounded-xl flex items-center justify-center text-xs text-[#80909D] p-6 text-center">No GPS points were recorded for this date.</div>;
      }
      const coords: [number, number][] = [...all.map((p) => [p.latitude, p.longitude] as [number, number]), ...visits.map((v) => [v.latitude, v.longitude] as [number, number])];
      const start = all[0];
      const end = all[all.length - 1];

      return (
        <MapContainer center={coords[0]} zoom={14} style={{ height: '100%', width: '100%', borderRadius: '0.75rem' }}>
          <TileLayer attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors' url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
          <Fit coords={coords} />
          {segments.map((seg, i) =>
            seg.length > 1 ? <Polyline key={i} positions={seg.map((p) => [p.latitude, p.longitude] as [number, number])} pathOptions={{ color: '#081224', weight: 4, opacity: 0.75 }} /> : null
          )}
          {start && (
            <Marker position={[start.latitude, start.longitude]} icon={startIcon}>
              <Popup>First fix · {t(start.timestamp)}</Popup>
            </Marker>
          )}
          {end && all.length > 1 && (
            <Marker position={[end.latitude, end.longitude]} icon={endIcon}>
              <Popup>Last fix · {t(end.timestamp)}</Popup>
            </Marker>
          )}
          {visits.map((v) => (
            <Marker key={v.id} position={[v.latitude, v.longitude]} icon={visitIcon}>
              <Popup>
                <div className="text-xs">
                  <p className="font-bold">Visit: {v.clientName}</p>
                  <p>{t(v.startedAt)}{v.endedAt ? ` – ${t(v.endedAt)}` : ' (ongoing)'}</p>
                  <p>Outcome: {String(v.outcome).replace(/_/g, ' ')}</p>
                </div>
              </Popup>
            </Marker>
          ))}
          {expenses.map((e) => (
            <Marker key={e.id} position={[e.latitude, e.longitude]} icon={expenseIcon}>
              <Popup>
                <div className="text-xs">
                  <p className="font-bold">{e.expenseNumber}</p>
                  <p>{String(e.category).replace(/_/g, ' ')} · ₹{Number(e.amount).toLocaleString('en-IN')}</p>
                </div>
              </Popup>
            </Marker>
          ))}
        </MapContainer>
      );
    };
  },
  { ssr: false, loading: () => <div className="h-full w-full bg-[#F3F5F6] animate-pulse rounded-xl" /> }
);

/** Splits API route segments into accepted-point polylines (flagged points excluded). */
export function acceptedSegments(segments: RoutePoint[][] | undefined): RoutePoint[][] {
  return (segments || []).map((s) => s.filter((p) => !p.isFiltered)).filter((s) => s.length > 0);
}

export default function RouteMap(props: RouteMapProps) {
  return <DynamicRouteMap {...props} />;
}
