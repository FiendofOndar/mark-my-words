import React from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter } from 'react-router-dom';
import './styles.css';
import { App } from './App';
import { DbProvider } from './ui/DbProvider';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Reads hit a local synchronous database; nothing goes stale on its own.
      staleTime: Infinity,
      refetchOnWindowFocus: false,
      retry: false,
    },
  },
});

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <DbProvider>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </DbProvider>
    </QueryClientProvider>
  </React.StrictMode>,
);
