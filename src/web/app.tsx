import { useMutation } from '@tanstack/react-query';
import { useCallback, useEffect, useState } from 'react';
import type { ConfigListResponse } from '@/shared/schema';
import { Button } from './components/ui/button';
import { Input } from './components/ui/input';
import { ApiError, api } from './lib/api';
import { AirportsPage } from './pages/airports';
import { ConfigsPage } from './pages/configs';
import { GroupsPage } from './pages/groups';
import { SettingsPage } from './pages/settings';

const TOKEN_KEY = 'dimrail-admin-token';
const SETTINGS_PATH = '/admin/settings';
const AIRPORTS_PATH = '/admin/airports';
const GROUPS_PATH = '/admin/groups';

function normalizePath(pathname: string): string {
  const path = pathname.replace(/\/+$/, '') || '/';
  // 设置页的所有分组都留在 /admin/settings 一个地址里，旧链接不会失效。
  if (path === SETTINGS_PATH || path.startsWith(`${SETTINGS_PATH}/`)) return SETTINGS_PATH;
  if (path === AIRPORTS_PATH) return AIRPORTS_PATH;
  if (path === GROUPS_PATH) return GROUPS_PATH;
  return '/admin';
}

export function App() {
  const [token, setToken] = useState(() => localStorage.getItem(TOKEN_KEY) ?? '');
  const [path, setPath] = useState(() => normalizePath(location.pathname));

  useEffect(() => {
    if (location.pathname !== path) history.replaceState(null, '', path);
    const onPop = () => setPath(normalizePath(location.pathname));
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, [path]);

  const navigate = useCallback((next: string) => {
    history.pushState(null, '', next);
    setPath(normalizePath(next));
  }, []);

  const reject = useCallback(() => {
    localStorage.removeItem(TOKEN_KEY);
    setToken('');
  }, []);

  if (!token) {
    return (
      <Gate
        onAccept={(value) => {
          localStorage.setItem(TOKEN_KEY, value);
          setToken(value);
        }}
      />
    );
  }

  const props = { token, path, onNavigate: navigate, onReject: reject };
  if (path === SETTINGS_PATH) return <SettingsPage {...props} />;
  if (path === AIRPORTS_PATH) return <AirportsPage {...props} />;
  if (path === GROUPS_PATH) return <GroupsPage {...props} />;
  return <ConfigsPage {...props} />;
}

function Gate({ onAccept }: { onAccept: (token: string) => void }) {
  const [value, setValue] = useState('');
  const [error, setError] = useState('');

  const check = useMutation({
    mutationFn: async (token: string) => {
      await api.get<ConfigListResponse>('/api/configs', token);
      return token;
    },
    onSuccess: onAccept,
    onError: (err: Error) => {
      setError(err instanceof ApiError && err.status === 401 ? '口令不对' : err.message);
    },
  });

  return (
    <div className="flex h-full items-center justify-center px-6 pb-16">
      <form
        className="w-full max-w-[288px]"
        onSubmit={(event) => {
          event.preventDefault();
          if (!value.trim()) return;
          setError('');
          check.mutate(value.trim());
        }}
      >
        <div className="flex items-center gap-2">
          <img src="/favicon.svg" alt="" className="size-5" />
          <span className="text-[15px] font-semibold tracking-tight">Dimrail</span>
        </div>
        <Input
          type="password"
          autoComplete="current-password"
          autoFocus
          aria-label="管理口令"
          placeholder="管理口令"
          className="mt-6 h-8 text-[13px]"
          value={value}
          onChange={(event) => {
            setValue(event.target.value);
            if (error) setError('');
          }}
        />

        <Button
          type="submit"
          variant="primary"
          className="mt-2 h-8 w-full text-[13px]"
          disabled={check.isPending || !value.trim()}
        >
          {check.isPending ? '校验中' : '进入'}
        </Button>

        {error && <p className="mt-2.5 text-[12px] text-danger">{error}</p>}
      </form>
    </div>
  );
}
