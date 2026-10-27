import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import type { BaseConfigResponse, OverviewResponse, SaveResponse } from '@/shared/schema';
import { AppShell } from '../components/app-shell';
import { LazyYamlEditor } from '../components/lazy-editor';
import { PageHeader } from '../components/page-header';
import { Dot, Status, type Tone } from '../components/status';
import { Button } from '../components/ui/button';
import { ApiError, api } from '../lib/api';
import { cn, formatBytes, formatTime } from '../lib/utils';
import type { PageProps } from './types';

const IS_MAC = typeof navigator !== 'undefined' && /mac/i.test(navigator.platform);
const SAVE_HINT = IS_MAC ? '⌘S' : 'Ctrl S';
const TONE_LABEL: Record<Tone, string> = {
  saved: '已保存',
  dirty: '未保存',
  saving: '保存中',
  error: '保存失败',
};

export function SettingsPage({ token, path, onNavigate, onReject }: PageProps) {
  const queryClient = useQueryClient();
  const [yaml, setYaml] = useState('');
  const [savedYaml, setSavedYaml] = useState('');
  const [notices, setNotices] = useState<string[]>([]);
  const [error, setError] = useState('');

  const overview = useQuery({
    queryKey: ['overview'],
    queryFn: () => api.get<OverviewResponse>('/api/overview', token),
    retry: false,
    refetchOnWindowFocus: false,
  });

  const base = useQuery({
    queryKey: ['base-config'],
    queryFn: () => api.get<BaseConfigResponse>('/api/base-config', token),
    retry: false,
    refetchOnWindowFocus: false,
  });

  const loaded = base.data ?? null;

  useEffect(() => {
    if (!loaded) return;
    setYaml(loaded.yaml);
    setSavedYaml(loaded.yaml);
    setNotices([]);
    setError('');
  }, [loaded]);

  useEffect(() => {
    const failure = overview.error ?? base.error;
    if (failure instanceof ApiError && failure.status === 401) onReject();
  }, [overview.error, base.error, onReject]);

  const dirty = Boolean(loaded) && yaml !== savedYaml;

  useEffect(() => {
    if (!dirty) return;
    const handler = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty]);

  const save = useMutation({
    mutationFn: () => api.put<SaveResponse>('/api/base-config', token, { yaml }),
    onSuccess: (response) => {
      setSavedYaml(yaml);
      setNotices(response.notices);
      setError('');
      queryClient.setQueryData(['base-config'], {
        yaml,
        updatedAt: response.updatedAt,
        seeded: false,
      } satisfies BaseConfigResponse);
      void queryClient.invalidateQueries({ queryKey: ['overview'] });
    },
    onError: (err: Error) => {
      setError(err.message);
      if (err instanceof ApiError && err.status === 401) onReject();
    },
  });

  const reset = useMutation({
    mutationFn: () => api.post<{ ok: boolean }>('/api/base-config/reset', token),
    onSuccess: async () => {
      queryClient.removeQueries({ queryKey: ['base-config'] });
      await queryClient.invalidateQueries({ queryKey: ['overview'] });
      setNotices([]);
      setError('');
    },
    onError: (err: Error) => {
      setError(err.message);
      if (err instanceof ApiError && err.status === 401) onReject();
    },
  });

  const confirmReset = () => {
    if (!window.confirm('恢复为出厂模板？当前基础配置会被丢弃，已存在的配置不受影响。')) return;
    reset.mutate();
  };

  const metrics = useMemo(() => {
    const lines = yaml === '' ? 0 : yaml.split('\n').length;
    return { lines, bytes: new TextEncoder().encode(yaml).length };
  }, [yaml]);

  const tone: Tone = save.isPending ? 'saving' : error ? 'error' : dirty ? 'dirty' : 'saved';
  const message = error || notices.join('，');
  const info = overview.data;
  const canSave = Boolean(loaded) && dirty && !save.isPending;

  return (
    <AppShell path={path} onNavigate={onNavigate}>
      <PageHeader
        title="设置"
        meta={
          <>
            <Status
              tone={tone}
              label={TONE_LABEL[tone]}
              time={tone === 'saved' ? `更新于 ${formatTime(loaded?.updatedAt ?? null)}` : ''}
            />
            <Dot />
            <span className="tabular-nums">
              {metrics.lines} 行 · {formatBytes(metrics.bytes)}
            </span>
          </>
        }
        actions={
          <>
            <Button
              variant="ghost"
              size="sm"
              onClick={confirmReset}
              disabled={!loaded || reset.isPending}
            >
              恢复出厂模板
            </Button>
            <Button
              variant="primary"
              onClick={() => save.mutate()}
              disabled={!canSave}
              title={`保存 (${SAVE_HINT})`}
            >
              保存
            </Button>
          </>
        }
      />

      <div className="flex shrink-0 flex-wrap items-center gap-x-7 gap-y-1.5 border-b-[0.5px] border-border px-6 py-2.5 text-[11px]">
        <Field label="机场" value={info ? info.providers.names.join('、') || '未配置' : '—'} />
        <Field label="配置" value={info ? `${info.configCount} 份` : '—'} />
        <Field
          label="基础配置"
          value={
            info
              ? info.base.seeded
                ? '出厂模板'
                : `已保存 ${formatTime(info.base.updatedAt)}`
              : '—'
          }
        />
        <Field
          label="管理口令"
          value={info ? (info.adminTokenConfigured ? '已配置' : '未配置') : '—'}
          danger={info ? !info.adminTokenConfigured : false}
        />
        {info?.providers.error && (
          <span className="text-danger">PROVIDERS_JSON：{info.providers.error}</span>
        )}
      </div>

      {message && (
        <div
          className={cn(
            'shrink-0 border-b-[0.5px] border-border px-6 py-1.5 text-[11px]',
            error ? 'text-danger' : 'text-warning',
          )}
        >
          {message}
        </div>
      )}

      <div className="min-h-0 flex-1 px-3">
        {loaded ? (
          <LazyYamlEditor
            className="h-full"
            value={yaml}
            onChange={(next) => {
              setYaml(next);
              if (error) setError('');
            }}
            onSave={() => {
              if (canSave) save.mutate();
            }}
          />
        ) : (
          <div className="flex h-full items-center justify-center">
            <p className="text-[11px] text-muted-foreground">
              {base.isPending ? '载入中' : '没能载入基础配置'}
            </p>
          </div>
        )}
      </div>

      {loaded?.seeded && !message && (
        <div className="shrink-0 border-t-[0.5px] border-border px-6 py-1.5 text-[11px] text-muted-foreground">
          现在显示的是出厂模板，保存后开始使用 D1 里的版本。
        </div>
      )}
    </AppShell>
  );
}

function Field({ label, value, danger }: { label: string; value: string; danger?: boolean }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className="text-muted-foreground">{label}</span>
      <span className={cn('truncate', danger ? 'text-danger' : 'text-foreground')}>{value}</span>
    </span>
  );
}
