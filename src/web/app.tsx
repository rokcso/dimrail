import { RiCheckLine, RiLockLine } from '@remixicon/react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import type { ConfigResponse, SaveResponse } from '@/shared/schema';
import { Button } from './components/ui/button';
import { Input } from './components/ui/input';
import { Label } from './components/ui/label';
import { ApiError, api } from './lib/api';
import { cn, formatBytes, formatTime } from './lib/utils';

// 编辑器（CodeMirror）单独成块：口令页与骨架不必等它下载
const YamlEditor = lazy(() =>
  import('./components/yaml-editor').then((mod) => ({ default: mod.YamlEditor })),
);

const TOKEN_KEY = 'dimrail-admin-token';
const IS_MAC = typeof navigator !== 'undefined' && /mac/i.test(navigator.platform);
const SAVE_HINT = IS_MAC ? '⌘S' : 'Ctrl S';

type Tone = 'saved' | 'dirty' | 'saving' | 'error';

export function App() {
  const [token, setToken] = useState(() => localStorage.getItem(TOKEN_KEY) ?? '');

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

  return (
    <Editor
      token={token}
      onReject={() => {
        localStorage.removeItem(TOKEN_KEY);
        setToken('');
      }}
    />
  );
}

function Gate({ onAccept }: { onAccept: (token: string) => void }) {
  const [value, setValue] = useState('');
  const [error, setError] = useState('');

  const check = useMutation({
    mutationFn: async (token: string) => {
      await api.get<ConfigResponse>('/api/config', token);
      return token;
    },
    onSuccess: onAccept,
    onError: (err: Error) => {
      setError(err instanceof ApiError && err.status === 401 ? '口令错误' : err.message);
    },
  });

  return (
    <div className="flex h-full items-center justify-center px-4">
      <form
        className="w-72 rounded-card border-[0.5px] border-border p-5"
        onSubmit={(event) => {
          event.preventDefault();
          if (!value.trim()) return;
          setError('');
          check.mutate(value.trim());
        }}
      >
        <div className="flex items-center gap-2">
          <RiLockLine className="size-4 text-muted-foreground" />
          <h1 className="text-sm font-semibold">管理口令</h1>
        </div>
        <Label htmlFor="token" className="mt-4">
          口令
        </Label>
        <Input
          id="token"
          type="password"
          autoComplete="current-password"
          autoFocus
          className="mt-1.5"
          value={value}
          onChange={(event) => setValue(event.target.value)}
        />
        <Button
          type="submit"
          variant="primary"
          className="mt-4 w-full"
          disabled={check.isPending || !value.trim()}
        >
          {check.isPending ? '校验中' : '进入'}
        </Button>
        {error && <p className="mt-2 text-xs text-danger">{error}</p>}
      </form>
    </div>
  );
}

function Editor({ token, onReject }: { token: string; onReject: () => void }) {
  const [yaml, setYaml] = useState('');
  const [saved, setSaved] = useState('');
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [notices, setNotices] = useState<string[]>([]);
  const [error, setError] = useState('');

  const query = useQuery({
    queryKey: ['config', token],
    queryFn: () => api.get<ConfigResponse>('/api/config', token),
    retry: false,
    refetchOnWindowFocus: false,
  });

  useEffect(() => {
    if (query.error instanceof ApiError && query.error.status === 401) onReject();
  }, [query.error, onReject]);

  useEffect(() => {
    if (!query.data) return;
    setYaml(query.data.yaml);
    setSaved(query.data.yaml);
    setSavedAt(query.data.updatedAt);
  }, [query.data]);

  const save = useMutation({
    mutationFn: () => api.put<SaveResponse>('/api/config', token, { yaml }),
    onSuccess: (response) => {
      setSaved(yaml);
      setSavedAt(response.updatedAt);
      setNotices(response.notices);
      setError('');
    },
    onError: (err: Error) => {
      setError(err.message);
      if (err instanceof ApiError && err.status === 401) onReject();
    },
  });

  const dirty = saved !== '' && yaml !== saved;

  useEffect(() => {
    if (!dirty) return;
    const handler = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty]);

  const tone: Tone = save.isPending ? 'saving' : error ? 'error' : dirty ? 'dirty' : 'saved';

  const label = {
    saved: '已保存',
    dirty: '未保存',
    saving: '保存中',
    error: '保存失败',
  }[tone];

  const metrics = useMemo(() => {
    const lines = yaml === '' ? 0 : yaml.split('\n').length;
    return { lines, bytes: new TextEncoder().encode(yaml).length };
  }, [yaml]);

  const ready = Boolean(query.data);

  return (
    <div className="flex h-full flex-col">
      <header className="flex h-12 shrink-0 items-center gap-2 border-b-[0.5px] border-border px-4">
        <img src="/favicon.svg" alt="" className="size-5" />
        <span className="text-sm font-semibold tracking-tight">Dimrail</span>

        <div className="ml-auto flex items-center gap-4">
          <Status tone={tone} label={label} time={tone === 'saved' ? formatTime(savedAt) : ''} />
          <Button
            variant="primary"
            onClick={() => save.mutate()}
            disabled={!ready || !dirty || save.isPending}
            title={`保存 (${SAVE_HINT})`}
          >
            保存
          </Button>
        </div>
      </header>

      <main className="min-h-0 flex-1">
        {ready && (
          <Suspense fallback={null}>
            <YamlEditor
              className="h-full"
              value={yaml}
              onChange={(next) => {
                setYaml(next);
                if (error) setError('');
              }}
              onSave={() => {
                if (dirty && !save.isPending) save.mutate();
              }}
            />
          </Suspense>
        )}
      </main>

      <footer className="flex h-7 shrink-0 items-center gap-4 border-t-[0.5px] border-border px-4 text-xs text-muted-foreground">
        <span>{metrics.lines} 行</span>
        <span>{formatBytes(metrics.bytes)}</span>
        {error ? (
          <span className="min-w-0 truncate text-danger">{error}</span>
        ) : (
          notices.length > 0 && (
            <span className="min-w-0 truncate text-warning">{notices.join('，')}</span>
          )
        )}
      </footer>
    </div>
  );
}

function Status({ tone, label, time }: { tone: Tone; label: string; time: string }) {
  return (
    <span className="flex items-center gap-1.5 text-xs">
      <span
        className={cn(
          'size-1.5 shrink-0 rounded-full transition-colors duration-[250ms] ease-out',
          tone === 'error'
            ? 'bg-danger'
            : tone === 'dirty'
              ? 'bg-warning'
              : tone === 'saved'
                ? 'bg-primary'
                : 'bg-muted-foreground',
        )}
      />
      <span className={tone === 'error' ? 'text-danger' : 'text-muted-foreground'}>
        {tone === 'saved' ? (
          <span className="flex items-center gap-1">
            <RiCheckLine className="size-3 text-primary" />
            {label}
          </span>
        ) : (
          label
        )}
      </span>
      {time && <span className="text-muted-foreground tabular-nums">{time}</span>}
    </span>
  );
}
