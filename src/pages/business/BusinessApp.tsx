import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useApp } from '@/app/AppContext';
import { Splash } from '@/app/Splash';
import { BusinessLayout } from './BusinessLayout';
import { BusinessProvider } from './BusinessContext';
import Today from './Today';

const Calendar = lazy(() => import('./Calendar'));
const Bookings = lazy(() => import('./Bookings'));
const Clients = lazy(() => import('./Clients'));
const Services = lazy(() => import('./Services'));
const Team = lazy(() => import('./Team'));
const Hours = lazy(() => import('./Hours'));
const Reviews = lazy(() => import('./Reviews'));
const Settings = lazy(() => import('./Settings'));
const Onboarding = lazy(() => import('./Onboarding'));
const Signup = lazy(() => import('./Signup'));

export default function BusinessApp() {
  const { api, profile } = useApp();
  const mine = useQuery({ queryKey: ['me', 'business', profile?.id], queryFn: () => api.getMyBusiness(profile!.id), enabled: !!profile });

  return (
    <Suspense fallback={<Splash />}>
      <Routes>
        <Route path="signup" element={profile ? <Navigate to="/business" replace /> : <Signup />} />
        <Route path="onboarding" element={!profile ? <Navigate to="/business/signup" replace /> : <Onboarding />} />
        <Route
          path="*"
          element={
            !profile ? (
              <Navigate to="/login?next=/business" replace />
            ) : mine.isPending ? (
              <Splash />
            ) : !mine.data ? (
              <Navigate to={profile.role === 'admin' ? '/admin' : '/business/onboarding'} replace />
            ) : (
              <BusinessProvider business={mine.data}>
                <BusinessLayout>
                  <Suspense fallback={<div className="p-6"><div className="skeleton h-40 w-full" /></div>}>
                    <Routes>
                      <Route index element={<Today />} />
                      <Route path="calendar" element={<Calendar />} />
                      <Route path="bookings" element={<Bookings />} />
                      <Route path="clients" element={<Clients />} />
                      <Route path="services" element={<Services />} />
                      <Route path="team" element={<Team />} />
                      <Route path="hours" element={<Hours />} />
                      <Route path="reviews" element={<Reviews />} />
                      <Route path="settings" element={<Settings />} />
                      <Route path="*" element={<Navigate to="/business" replace />} />
                    </Routes>
                  </Suspense>
                </BusinessLayout>
              </BusinessProvider>
            )
          }
        />
      </Routes>
    </Suspense>
  );
}
