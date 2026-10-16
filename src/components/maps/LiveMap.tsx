'use client';

import React from 'react';
import dynamic from 'next/dynamic';
import { formatAge } from '@/lib/client/format';

interface LiveMapProps {
  salespersons: any[];
}

const TZ = process.env.NEXT_PUBLIC_DEFAULT_TIMEZONE || 'Asia/Kolkata';
/** Used only to frame an empty map; no marker is ever placed without a reported fix. */
const FALLBACK_CENTER: [number, number] = [12.9716, 77.5946];

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

const DynamicMap = dynamic(
  async () => {
    const L = (await import('leaflet')).default;
    const { MapContainer, TileLayer, Marker, Popup, Circle, useMap } = await import('react-leaflet');

    const spIcon = (initials: string, online: boolean) =>
      L.divIcon({
        className: 'sg-sp-marker',
        html: `<div style="background:${online ? '#2E6819' : '#80909D'};width:30px;height:30px;border-radius:50%;border:3px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,.3);display:flex;align-items:center;justify-content:center;color:#fff;font:700 11px Inter,sans-serif">${escapeHtml(initials)}</div>`,
        iconSize: [30, 30],
        iconAnchor: [15, 15],
      });
    const clientIcon = L.divIcon({
      className: 'sg-client-marker',
      html: `<div style="background:#259DC3;width:20px;height:20px;border-radius:4px;border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.25)"></div>`,
      iconSize: [20, 20],
      iconAnchor: [10, 10],
    });

    function FitBounds({ points }: { points: [number, number][] }) {
      const map = useMap();
      const key = points.map((p) => p.join(',')).join('|');
      React.useEffect(() => {
        if (points.length === 1) map.setView(points[0], 15);
        else if (points.length > 1) map.fitBounds(L.latLngBounds(points), { padding: [40, 40], maxZoom: 16 });
        // Re-frame only when the set of positions changes.
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, [key]);
      return null;
    }

    return function MapComponent({ salespersons }: LiveMapProps) {
      const located = salespersons.filter((s) => s.currentLocation?.latitude != null && s.currentLocation?.longitude != null);
      const points: [number, number][] = located.map((s) => [s.currentLocation.latitude, s.currentLocation.longitude]);
      const clients = salespersons.flatMap((s) => (s.assignedClients || []).map((c: any) => ({ ...c, owner: s.name })));
      const framePoints = points.length ? points : clients.map((c) => [c.latitude, c.longitude] as [number, number]);

      return (
        <div className="relative h-full w-full">
          <MapContainer center={framePoints[0] || FALLBACK_CENTER} zoom={framePoints.length ? 13 : 5} style={{ height: '100%', width: '100%', borderRadius: '0.75rem' }}>
            <TileLayer attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors' url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
            <FitBounds points={framePoints} />

            {located.map((s) => {
              const loc = s.currentLocation;
              const initials = String(s.name || '?').split(' ').map((w: string) => w[0]).join('').slice(0, 2).toUpperCase();
              return (
                <React.Fragment key={s.salespersonId}>
                  <Marker position={[loc.latitude, loc.longitude]} icon={spIcon(initials, Boolean(s.isOnline))} zIndexOffset={s.isOnline ? 1000 : 0}>
                    <Popup>
                      <div className="text-xs min-w-[180px]">
                        <p className="font-bold text-sm text-[#0B1320]">
                          {s.name} <span className="font-normal text-[#586570]">({s.employeeCode})</span>
                        </p>
                        <p className={`mt-0.5 font-semibold ${s.isOnline ? 'text-[#2E6819]' : 'text-[#B45309]'}`}>
                          {s.isOnline ? 'Live' : s.dutyStatus === 'ON_DUTY' ? 'On duty — signal stale' : 'Off duty — last known position'}
                        </p>
                        <dl className="mt-2 space-y-0.5 text-[11px] text-[#586570]">
                          <div><dt className="inline font-semibold">Last fix: </dt><dd className="inline">{formatAge(loc.timestamp)} · {new Date(loc.timestamp).toLocaleString('en-IN', { timeZone: TZ, dateStyle: 'short', timeStyle: 'short' })}</dd></div>
                          <div><dt className="inline font-semibold">Accuracy: </dt><dd className="inline">{loc.accuracy != null ? `±${Math.round(loc.accuracy)} m` : 'Not reported'}</dd></div>
                          <div><dt className="inline font-semibold">Speed: </dt><dd className="inline">{loc.speed != null ? `${Math.round(loc.speed)} km/h` : 'Not reported'}</dd></div>
                          <div><dt className="inline font-semibold">Battery: </dt><dd className="inline">{loc.batteryLevel != null ? `${Math.round(loc.batteryLevel)}%` : 'Not reported'}</dd></div>
                          {s.phone && <div><dt className="inline font-semibold">Phone: </dt><dd className="inline"><a href={`tel:${s.phone}`}>{s.phone}</a></dd></div>}
                        </dl>
                      </div>
                    </Popup>
                  </Marker>
                  {loc.accuracy != null && loc.accuracy > 0 && (
                    <Circle
                      center={[loc.latitude, loc.longitude]}
                      radius={Math.min(loc.accuracy, 2000)}
                      pathOptions={{ color: s.isOnline ? '#2E6819' : '#80909D', fillOpacity: 0.12, weight: 1 }}
                    />
                  )}
                </React.Fragment>
              );
            })}

            {clients.map((c: any) => (
              <Marker key={`${c.owner}-${c.id}`} position={[c.latitude, c.longitude]} icon={clientIcon}>
                <Popup>
                  <div className="text-xs">
                    <p className="font-bold text-[#0B1320]">{c.name}</p>
                    <p className="text-[#586570] mt-0.5">Assigned to {c.owner}</p>
                    <p className="mt-1">Outstanding: ₹{Number(c.outstanding || 0).toLocaleString('en-IN')}</p>
                  </div>
                </Popup>
              </Marker>
            ))}
          </MapContainer>
          {located.length === 0 && (
            <div className="absolute inset-x-0 top-3 mx-auto w-fit max-w-[90%] z-[500] bg-white/95 border border-[#CBD2D7] rounded-lg px-3 py-2 text-xs text-[#586570] shadow-sm text-center">
              No GPS positions reported yet. Salespersons appear here once their device sends a location during an active duty session.
            </div>
          )}
        </div>
      );
    };
  },
  {
    ssr: false,
    loading: () => <div className="h-full w-full bg-[#F3F5F6] animate-pulse rounded-xl flex items-center justify-center text-xs text-[#80909D]">Loading map…</div>,
  }
);

export default function LiveMap({ salespersons }: LiveMapProps) {
  return <DynamicMap salespersons={salespersons} />;
}
