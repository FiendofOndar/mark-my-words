import React from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter } from 'react-router-dom';
import './styles.css';
import { App } from './App';
import { DbProvider } from './ui/DbProvider';
import { initVerifierConfig } from './lib/keyStore';

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

// Credentials come from an async store on device, so they are read before the
// first render rather than leaving the app briefly believing there is no key.
// Deliberately not a top-level await: this ships into a WebView, and an async
// entry point is one less thing to depend on the runtime supporting.
void initVerifierConfig().then(() => {
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
});
