import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from 'react-router-dom';
import './index.css';
import './i18n';
import { loadApi } from './data/client';
import { AppProvider } from './app/AppContext';
import { router } from './app/router';
import { ToastProvider } from './components/ui/Toast';
import { Splash } from './app/Splash';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 30_000, gcTime: 10 * 60_000, retry: 1, refetchOnWindowFocus: true, networkMode: 'offlineFirst' },
    mutations: { networkMode: 'offlineFirst' },
  },
});

const root = createRoot(document.getElementById('root')!);
root.render(<Splash />);

loadApi().then((api) => {
  root.render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <ToastProvider>
          <AppProvider api={api} fallback={<Splash />}>
            <RouterProvider router={router} />
          </AppProvider>
        </ToastProvider>
      </QueryClientProvider>
    </StrictMode>,
  );
});
