import '@radix-ui/colors/gray.css';
import '@radix-ui/colors/gray-dark.css';
import '@radix-ui/colors/grass.css';
import '@radix-ui/colors/grass-dark.css';
import '@radix-ui/colors/amber.css';
import '@radix-ui/colors/amber-dark.css';
import '@radix-ui/colors/red.css';
import '@radix-ui/colors/red-dark.css';
import './styles.css';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from '@tanstack/react-router';
import { createRoot } from 'react-dom/client';
import { AuthProvider } from './auth';
import { router } from './router';
import { applyTheme, getTheme } from './theme';

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: Number.POSITIVE_INFINITY } },
});

applyTheme(getTheme());

const container = document.getElementById('root');
if (!container) throw new Error('#root 不存在');

createRoot(container).render(
  <QueryClientProvider client={queryClient}>
    <AuthProvider>
      <RouterProvider router={router} />
    </AuthProvider>
  </QueryClientProvider>,
);
