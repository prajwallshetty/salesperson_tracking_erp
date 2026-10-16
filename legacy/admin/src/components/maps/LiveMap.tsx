'use client';

import React, { useEffect, useState } from 'react';
import dynamic from 'next/dynamic';

interface LiveMapProps {
  salespersons: any[];
}

const DynamicMap = dynamic(
  async () => {
    const L = (await import('leaflet')).default;
    const { MapContainer, TileLayer, Marker, Popup, Circle } = await import('react-leaflet');

    // Fix default marker icon missing in Leaflet + Webpack
    const defaultIcon = L.icon({
      iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
      iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
      shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
      iconSize: [25, 41],
      iconAnchor: [12, 41],
      popupAnchor: [1, -34],
    });

    const activeSpIcon = L.divIcon({
      className: 'custom-sp-marker',
      html: `<div style="background-color: #0f766e; width: 28px; height: 28px; border-radius: 50%; border: 3px solid white; box-shadow: 0 4px 6px rgba(0,0,0,0.3); display: flex; align-items: center; justify-content: center; color: white; font-weight: bold; font-size: 11px;">SP</div>`,
      iconSize: [28, 28],
      iconAnchor: [14, 14],
    });

    const clientIcon = L.divIcon({
      className: 'custom-client-marker',
      html: `<div style="background-color: #3b82f6; width: 22px; height: 22px; border-radius: 4px; border: 2px solid white; box-shadow: 0 2px 4px rgba(0,0,0,0.25); display: flex; align-items: center; justify-content: center; color: white; font-weight: bold; font-size: 10px;">CL</div>`,
      iconSize: [22, 22],
      iconAnchor: [11, 11],
    });

    return function MapComponent({ salespersons }: LiveMapProps) {
      // Find initial center from first available salesperson or default to Mangalore
      const firstValidSp = salespersons.find(
        (s) => s.currentLocation && s.currentLocation.latitude && s.currentLocation.longitude
      );
      const center: [number, number] = firstValidSp
        ? [firstValidSp.currentLocation.latitude, firstValidSp.currentLocation.longitude]
        : [12.8715, 74.8432];

      return (
        <MapContainer center={center} zoom={13} style={{ height: '100%', width: '100%', borderRadius: '0.75rem' }}>
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />

          {/* Salesperson markers */}
          {salespersons.map((s) => {
            if (!s.currentLocation?.latitude || !s.currentLocation?.longitude) return null;
            return (
              <React.Fragment key={s.salespersonId}>
                <Marker
                  position={[s.currentLocation.latitude, s.currentLocation.longitude]}
                  icon={activeSpIcon}
                >
                  <Popup>
                    <div className="p-1 text-xs">
                      <div className="flex items-center gap-1.5 font-bold text-slate-800 text-sm">
                        <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                        <span>{s.name} ({s.employeeCode})</span>
                      </div>
                      <p className="text-slate-500 mt-0.5">{s.territory}</p>
                      <div className="mt-2 space-y-1 border-t border-slate-100 pt-1 text-[11px] text-slate-600">
                        <p><strong>Duty Status:</strong> {s.dutyStatus}</p>
                        <p><strong>Speed:</strong> {s.currentLocation.speed || 0} km/h</p>
                        <p><strong>Battery:</strong> {s.currentLocation.batteryLevel ? `${s.currentLocation.batteryLevel}%` : 'N/A'}</p>
                        <p><strong>Phone:</strong> {s.phone}</p>
                        <p><strong>Last Ping:</strong> {new Date(s.currentLocation.timestamp).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata' })}</p>
                      </div>
                    </div>
                  </Popup>
                </Marker>
                {/* Accuracy radius */}
                {s.currentLocation.accuracy && (
                  <Circle
                    center={[s.currentLocation.latitude, s.currentLocation.longitude]}
                    radius={Math.min(100, s.currentLocation.accuracy)}
                    pathOptions={{ color: '#0f766e', fillColor: '#14b8a6', fillOpacity: 0.15 }}
                  />
                )}
              </React.Fragment>
            );
          })}

          {/* Assigned Client Markers */}
          {salespersons.flatMap((s) =>
            (s.assignedClients || []).map((c: any) => (
              <Marker key={c.id} position={[c.latitude, c.longitude]} icon={clientIcon}>
                <Popup>
                  <div className="p-1 text-xs">
                    <p className="font-bold text-slate-900">{c.name}</p>
                    <p className="text-slate-500 mt-0.5">Assigned to: {s.name}</p>
                    <p className="mt-1 text-slate-700">
                      <strong>Outstanding:</strong> ₹{c.outstanding.toLocaleString('en-IN')}
                    </p>
                  </div>
                </Popup>
              </Marker>
            ))
          )}
        </MapContainer>
      );
    };
  },
  { ssr: false, loading: () => <div className="h-full w-full bg-slate-100 flex items-center justify-center text-xs text-slate-400">Loading map provider...</div> }
);

export default function LiveMap({ salespersons }: LiveMapProps) {
  return <DynamicMap salespersons={salespersons} />;
}
