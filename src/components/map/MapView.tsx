import { lazy, Suspense } from 'react';
import { Skeleton } from '../ui/Skeleton';

/**
 * Map abstraction. The MVP implementation is Leaflet + OpenStreetMap, loaded lazily (own chunk).
 * To switch to Google Maps, provide another implementation of MapProps and swap the import.
 */
export interface MapMarker {
  id: string;
  lat: number;
  lng: number;
  label: string;
  href?: string;
}
export interface MapProps {
  markers: MapMarker[];
  center?: { lat: number; lng: number };
  zoom?: number;
  className?: string;
  interactive?: boolean;
}

const LeafletMap = lazy(() => import('./LeafletMap'));

export function MapView(props: MapProps) {
  return (
    <Suspense fallback={<Skeleton className={props.className ?? 'h-80 w-full'} />}>
      <LeafletMap {...props} />
    </Suspense>
  );
}
