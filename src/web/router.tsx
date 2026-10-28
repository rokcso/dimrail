import {
  createRootRoute,
  createRoute,
  createRouter,
  Navigate,
  Outlet,
  redirect,
  useNavigate,
  useRouterState,
} from '@tanstack/react-router';
import { type ComponentType, type LazyExoticComponent, lazy, Suspense } from 'react';
import { useAuth } from './auth';
import type { PageProps } from './pages/types';

const ConfigsPage = lazy(() =>
  import('./pages/configs').then((module) => ({ default: module.ConfigsPage })),
);
const AirportsPage = lazy(() =>
  import('./pages/airports').then((module) => ({ default: module.AirportsPage })),
);
const PoolsPage = lazy(() =>
  import('./pages/pools').then((module) => ({ default: module.PoolsPage })),
);
const SettingsPage = lazy(() =>
  import('./pages/settings').then((module) => ({ default: module.SettingsPage })),
);

function PageFallback() {
  return (
    <div className="flex h-full items-center justify-center text-[12px] text-muted-foreground">
      载入中
    </div>
  );
}

function usePageProps(selectedId: string | null): PageProps {
  const { token, reject } = useAuth();
  const navigate = useNavigate();
  const path = useRouterState({ select: (state) => state.location.pathname });

  return {
    token,
    path,
    selectedId,
    onNavigate: (to) => navigate({ to } as never),
    onReplace: (to) => navigate({ to, replace: true } as never),
    onReject: reject,
  };
}

function PageRoute({
  Page,
  selectedId = null,
}: {
  Page: LazyExoticComponent<ComponentType<PageProps>>;
  selectedId?: string | null;
}) {
  const props = usePageProps(selectedId);
  return (
    <Suspense fallback={<PageFallback />}>
      <Page {...props} />
    </Suspense>
  );
}

function ConfigDetailRoute() {
  const { id } = configDetailRoute.useParams();
  return <PageRoute Page={ConfigsPage} selectedId={id} />;
}

function AirportDetailRoute() {
  const { id } = airportDetailRoute.useParams();
  return <PageRoute Page={AirportsPage} selectedId={id} />;
}

function PoolDetailRoute() {
  const { id } = poolDetailRoute.useParams();
  return <PageRoute Page={PoolsPage} selectedId={id} />;
}

const rootRoute = createRootRoute({
  component: () => <Outlet />,
  notFoundComponent: () => <Navigate to="/admin/configs" replace />,
});

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  beforeLoad: () => {
    throw redirect({ to: '/admin/configs' });
  },
});

const adminRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/admin',
  beforeLoad: () => {
    throw redirect({ to: '/admin/configs' });
  },
});

const configsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/admin/configs',
  component: () => <PageRoute Page={ConfigsPage} />,
});

const configDetailRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/admin/configs/$id',
  component: ConfigDetailRoute,
});

const airportsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/admin/airports',
  component: () => <PageRoute Page={AirportsPage} />,
});

const airportDetailRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/admin/airports/$id',
  component: AirportDetailRoute,
});

const poolsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/admin/pools',
  component: () => <PageRoute Page={PoolsPage} />,
});

const poolDetailRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/admin/pools/$id',
  component: PoolDetailRoute,
});

const settingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/admin/settings',
  beforeLoad: () => {
    throw redirect({ to: '/admin/settings/base' });
  },
});

const settingsBaseRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/admin/settings/base',
  component: () => <PageRoute Page={SettingsPage} />,
});

const routeTree = rootRoute.addChildren([
  indexRoute,
  adminRoute,
  configsRoute,
  configDetailRoute,
  airportsRoute,
  airportDetailRoute,
  poolsRoute,
  poolDetailRoute,
  settingsRoute,
  settingsBaseRoute,
]);

export const router = createRouter({ routeTree });

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
