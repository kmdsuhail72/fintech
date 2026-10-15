import React from 'react';
import ReactDOM from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import App from './App.js';
import { subscribeAuth } from './authToken.js';
import { refreshSession } from './api.js';
import './styles.css';
import { initWebTracing } from './tracing.js';

initWebTracing();

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      refetchOnWindowFocus: false,
    },
  },
});

subscribeAuth(() => {
  void queryClient.cancelQueries();
  queryClient.clear();
});
void refreshSession();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </React.StrictMode>,
);
