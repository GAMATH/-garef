import { lazy, Suspense, type ReactNode } from 'react';
import { createBrowserRouter, Navigate, Outlet, ScrollRestoration } from 'react-router-dom';
import { ClientLayout } from './ClientLayout';
import { RouteError } from './RouteError';
import { Splash } from './Splash';
import { OfflineBanner } from '@/components/ui/OfflineBanner';
import Home from '@/pages/client/Home';

// Route-level code splitting: every screen except the home page is its own chunk;
// the pro space and the admin are separate bundles never loaded by clients.
const Search = lazy(() => import('@/pages/client/Search'));
const Salon = lazy(() => import('@/pages/client/Salon'));
const Booking = lazy(() => import('@/pages/client/Booking'));
const BookingSuccess = lazy(() => import('@/pages/client/BookingSuccess'));
const Login = lazy(() => import('@/pages/client/Login'));
const Account = lazy(() => import('@/pages/client/Account'));
const NotFound = lazy(() => import('@/pages/client/NotFound'));
const BusinessApp = lazy(() => import('@/pages/business/BusinessApp'));
const AdminApp = lazy(() => import('@/pages/admin/AdminApp'));

const s = (el: ReactNode) => <Suspense fallback={<PageFallback />}>{el}</Suspense>;

function PageFallback() {
  return (
    <div className="container-app py-8" aria-busy="true">
      <div className="skeleton h-8 w-1/2" />
      <div className="skeleton mt-4 h-40 w-full" />
    </div>
  );
}

function Root() {
  return (
    <>
      <OfflineBanner />
      <ScrollRestoration />
      <Outlet />
    </>
  );
}

export const router = createBrowserRouter([
  {
    element: <Root />,
    errorElement: <RouteError />,
    children: [
      {
        element: <ClientLayout />,
        children: [
          { path: '/', element: <Home /> },
          { path: '/search', element: s(<Search />) },
          { path: '/salon/:slug', element: s(<Salon />) },
          { path: '/login', element: s(<Login />) },
          { path: '/account', element: <Navigate to="/account/appointments" replace /> },
          { path: '/account/:tab', element: s(<Account />) },
          { path: '/:city/:category', element: s(<Search />) },
          { path: '*', element: s(<NotFound />) },
        ],
      },
      { path: '/booking/success/:reference', element: s(<BookingSuccess />) },
      { path: '/booking/:slug', element: s(<Booking />) },
      { path: '/business/*', element: <Suspense fallback={<Splash />}>{<BusinessApp />}</Suspense> },
      { path: '/admin/*', element: <Suspense fallback={<Splash />}>{<AdminApp />}</Suspense> },
    ],
  },
]);
