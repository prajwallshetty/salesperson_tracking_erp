'use client';

import React from 'react';
import dynamic from 'next/dynamic';

interface RouteMapProps {
  points: Array<{ latitude: number; longitude: number; speed?: number | null; timestamp: string }>;
  events?: {
    visits?: any[];
    orders?: any[];
    payments?: any[];
  };
}

const DynamicRouteMap = dynamic(
  async () => {
    const L = (await import('leaflet')).default;
    const { MapContainer, TileLayer, Polyline, Marker, Popup } = await import('react-leaflet');

    const startIcon = L.divIcon({
      html: `<div style="background-color: #16a34a; width: 22px; height: 22px; border-radius: 50%; border: 2px solid white; display: flex; align-items: center; justify-content: center; color: white; font-weight: bold; font-size: 10px;">S</div>`,
      iconSize: [22, 22],
      iconAnchor: [11, 11],
    });

    const endIcon = L.divIcon({
      html: `<div style="background-color: #dc2626; width: 22px; height: 22px; border-radius: 50%; border: 2px solid white; display: flex; align-items: center; justify-content: center; color: white; font-weight: bold; font-size: 10px;">E</div>`,
      iconSize: [22, 22],
      iconAnchor: [11, 11],
    });

    const visitIcon = L.divIcon({
      html: `<div style="background-color: #8b5cf6; width: 20px; height: 20px; border-radius: 4px; border: 2px solid white; display: flex; align-items: center; justify-content: center; color: white; font-weight: bold; font-size: 9px;">V</div>`,
      iconSize: [20, 20],
      iconAnchor: [10, 10],
    });

    const orderIcon = L.divIcon({
      html: `<div style="background-color: #f59e0b; width: 20px; height: 20px; border-radius: 4px; border: 2px solid white; display: flex; align-items: center; justify-content: center; color: white; font-weight: bold; font-size: 9px;">O</div>`,
      iconSize: [20, 20],
      iconAnchor: [10, 10],
    });

    return function RouteMapComponent({ points, events }: RouteMapProps) {
      if (!points || points.length === 0) {
        return (
          <div className="h-full w-full bg-slate-100 flex items-center justify-center text-xs text-slate-400">
            No GPS points recorded for this date.
          </div>
        );
      }

      const coordinates: [number, number][] = points.map((p) => [p.latitude, p.longitude]);
      const startPoint = points[0];
      const endPoint = points[points.length - 1];

      return (
        <MapContainer center={[startPoint.latitude, startPoint.longitude]} zoom={14} style={{ height: '100%', width: '100%', borderRadius: '0.75rem' }}>
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />

          {/* Polyline route */}
          <Polyline positions={coordinates} pathOptions={{ color: '#0d9488', weight: 4, opacity: 0.8 }} />

          {/* Start Marker */}
          <Marker position={[startPoint.latitude, startPoint.longitude]} icon={startIcon}>
            <Popup>
              <div className="text-xs">
                <p className="font-bold text-emerald-700">Journey Start</p>
                <p className="text-slate-500">{new Date(startPoint.timestamp).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata' })}</p>
              </div>
            </Popup>
          </Marker>

          {/* End Marker */}
          {points.length > 1 && (
            <Marker position={[endPoint.latitude, endPoint.longitude]} icon={endIcon}>
              <Popup>
                <div className="text-xs">
                  <p className="font-bold text-red-600">Latest / End Point</p>
                  <p className="text-slate-500">{new Date(endPoint.timestamp).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata' })}</p>
                </div>
              </Popup>
            </Marker>
          )}

          {/* Visit Stops */}
          {events?.visits?.map((v) => {
            if (!v.latitude || !v.longitude) return null;
            return (
              <Marker key={v.id} position={[v.latitude, v.longitude]} icon={visitIcon}>
                <Popup>
                  <div className="text-xs">
                    <p className="font-bold text-purple-700">Client Visit: {v.clientName}</p>
                    <p className="text-slate-600 mt-0.5">Outcome: {v.outcome}</p>
                    <p className="text-slate-400 text-[10px]">
                      {new Date(v.startedAt).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata' })}
                    </p>
                  </div>
                </Popup>
              </Marker>
            );
          })}

          {/* Order Event Markers */}
          {events?.orders?.map((o) => {
            if (!o.latitude || !o.longitude) return null;
            return (
              <Marker key={o.id} position={[o.latitude, o.longitude]} icon={orderIcon}>
                <Popup>
                  <div className="text-xs">
                    <p className="font-bold text-amber-700">Order #{o.orderNumber}</p>
                    <p className="text-slate-800">Grand Total: ₹{o.grandTotal.toLocaleString('en-IN')}</p>
                    <p className="text-slate-500">{o.clientName}</p>
                  </div>
                </Popup>
              </Marker>
            );
          })}
        </MapContainer>
      );
    };
  },
  { ssr: false, loading: () => <div className="h-full w-full bg-slate-100 flex items-center justify-center text-xs text-slate-400">Loading route map...</div> }
);

export default function RouteMap(props: RouteMapProps) {
  return <DynamicRouteMap {...props} />;
}
