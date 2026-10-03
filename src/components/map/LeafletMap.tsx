import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import type { MapProps } from './MapView';

const pin = L.divIcon({
  className: '',
  html: '<span style="display:block;width:20px;height:20px;border-radius:999px;background:#C4532D;border:3px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.3)"></span>',
  iconSize: [20, 20],
  iconAnchor: [10, 10],
});

export default function LeafletMap({ markers, center, zoom = 13, className, interactive = true }: MapProps) {
  const el = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  useEffect(() => {
    if (!el.current) return;
    const map = L.map(el.current, { zoomControl: interactive, dragging: interactive, scrollWheelZoom: false, attributionControl: true });
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 18, attribution: '© OpenStreetMap' }).addTo(map);
    const group = L.featureGroup();
    for (const m of markers) {
      const marker = L.marker([m.lat, m.lng], { icon: pin, title: m.label, keyboard: true }).bindTooltip(m.label, { direction: 'top', offset: [0, -10] });
      if (m.href) marker.on('click', () => navigate(m.href!));
      group.addLayer(marker);
    }
    group.addTo(map);
    if (center) map.setView([center.lat, center.lng], zoom);
    else if (markers.length) map.fitBounds(group.getBounds(), { padding: [32, 32], maxZoom: 14 });
    else map.setView([0, 10], 3);
    return () => {
      map.remove();
    };
  }, [markers, center, zoom, interactive, navigate]);
  return <div ref={el} className={className ?? 'h-80 w-full'} />;
}
