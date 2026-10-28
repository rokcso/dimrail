import { RiDashboardLine, RiFileCodeLine } from '@remixicon/react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useBlocker } from '@tanstack/react-router';
import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import type { BaseConfigResponse, OverviewResponse, SaveResponse } from '@/shared/schema';
import { AppShell } from '../components/app-shell';
import { LazyYamlEditor } from '../components/lazy-editor';
import { PageHeader } from '../components/page-header';
import { Status, type Tone } from '../components/status';
import { Button } from '../components/ui/button';
import { ApiError, api } from '../lib/api';
import { cn, formatBytes, formatStamp, formatTime } from '../lib/utils';
import type { PageProps } from './types';

const IS_MAC = typeof navigator !== 'undefined' && /mac/i.test(navigator.platform);
const SAVE_HINT = IS_MAC ? '⌘S' : 'Ctrl S';
const TONE_LABEL: Record<Tone, string> = {
  saved: '已保存',
  dirty: '未保存',
  saving: '保存中',
  error: '保存失败',
};

const SECTIONS = [
  { id: 'base', label: '基础配置', to: '/admin/settings/base', icon: RiFileCodeLine },
  { id: 'overview', label: '概览', to: '/admin/settings/overview', icon: RiDashboardLine },
] as const;

export function SettingsPage({ token, path, onNavigate, onReject }: PageProps) {
  const queryClient = useQueryClient();
  const [yaml, setYaml] = useState('');
  const [savedYaml, setSavedYaml] = useState('');
  const [notices, setNotices] = useState<string[]>([]);
  const [error, setError] = useState('');
  /** 已灌进编辑器的数据版本：保存时更新缓存不该把提示和未保存内容冲掉。 */
  const syncedSource = useRef<string | null>(null);
  const section = path === '/admin/settings/overview' ? 'overview' : 'base';

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
    const signature = `${loaded.updatedAt ?? 'seeded'}:${loaded.seeded}`;
    if (syncedSource.current === signature) return;
    syncedSource.current = signature;
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

  const blocker = useBlocker({
    shouldBlockFn: () => dirty,
    withResolver: true,
    enableBeforeUnload: dirty,
  });

  useEffect(() => {
    if (blocker.status !== 'blocked') return;
    if (window.confirm('基础配置有未保存的修改，离开会丢失。继续？')) blocker.proceed();
    else blocker.reset();
  }, [blocker]);

  const save = useMutation({
    mutationFn: () =>
      api.put<SaveResponse>('/api/base-config', token, {
        yaml,
        expectedUpdatedAt: loaded?.updatedAt ?? null,
      }),
    onSuccess: (response) => {
      setSavedYaml(yaml);
      setNotices(response.notices);
      setError('');
      syncedSource.current = `${response.updatedAt}:false`;
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

  const sidebar = (
    <>
      <div className="flex h-12 shrink-0 items-center pr-2 pl-4">
        <span className="text-[12px] font-medium">设置</span>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-px overflow-y-auto px-2 pb-2">
        {SECTIONS.map(({ id, label, to, icon: Icon }) => {
          const active = section === id;
          return (
            <button
              key={id}
              type="button"
              onClick={() => onNavigate(to)}
              aria-current={active ? 'page' : undefined}
              className={cn(
                'flex h-8 items-center gap-2 rounded-control px-2 text-left text-[13px] outline-none',
                active ? 'bg-accent text-accent-foreground' : 'text-foreground hover:bg-muted',
              )}
            >
              <Icon className="size-3.5 shrink-0" />
              <span className="min-w-0 flex-1 truncate">{label}</span>
            </button>
          );
        })}
      </div>
    </>
  );

  return (
    <AppShell path={path} onNavigate={onNavigate} sidebar={sidebar}>
      {section === 'base' ? (
        <>
          <PageHeader
            title="基础配置"
            meta={
              <>
                <Status
                  tone={tone}
                  label={TONE_LABEL[tone]}
                  time={tone === 'saved' ? `更新于 ${formatTime(loaded?.updatedAt ?? null)}` : ''}
                />
                <span className="flex items-center gap-1.5 tabular-nums">
                  <span>{metrics.lines} 行</span>
                  <span>{formatBytes(metrics.bytes)}</span>
                </span>
              </>
            }
            actions={
              <>
                <Button
                  variant="ghost"
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

          {message && (
            <div
              className={cn(
                'shrink-0 border-b-[0.5px] border-border px-6 py-1.5 text-[12px]',
                error ? 'text-danger' : 'text-warning',
              )}
            >
              {message}
            </div>
          )}

          <div className="min-h-0 flex-1 px-6">
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
                <p className="text-[12px] text-muted-foreground">
                  {base.isPending ? '载入中' : '没能载入基础配置'}
                </p>
              </div>
            )}
          </div>

          {loaded?.seeded && !message && (
            <div className="shrink-0 border-t-[0.5px] border-border px-6 py-1.5 text-[12px] text-muted-foreground">
              当前显示出厂模板，保存后生效。
            </div>
          )}
        </>
      ) : (
        <OverviewSection info={info} />
      )}
    </AppShell>
  );
}

function OverviewSection({ info }: { info: OverviewResponse | undefined }) {
  return (
    <>
      <PageHeader title="概览" />

      <div className="min-h-0 flex-1 overflow-auto px-6 py-5">
        <div className="grid max-w-4xl grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          <StatCard
            label="机场"
            value={info ? `${info.airports.count} 个` : '—'}
            detail={
              info
                ? `${info.airports.nodeCount} 个节点${
                    info.airports.failed > 0 ? `，${info.airports.failed} 个机场拉取失败` : ''
                  }`
                : undefined
            }
            danger={Boolean(info && info.airports.failed > 0)}
          />
          <StatCard label="配置" value={info ? `${info.configCount} 份` : '—'} />
          <StatCard label="节点池" value={info ? `${info.poolCount} 个` : '—'} />
          <StatCard
            label="基础配置"
            value={info ? (info.base.seeded ? '出厂模板' : '已保存') : '—'}
            detail={
              info && !info.base.seeded ? `更新于 ${formatStamp(info.base.updatedAt)}` : undefined
            }
          />
          <StatCard
            label="管理口令"
            value={info ? (info.adminTokenConfigured ? '已配置' : '未配置') : '—'}
            danger={Boolean(info && !info.adminTokenConfigured)}
          />
        </div>
      </div>
    </>
  );
}

interface StatCardProps {
  label: string;
  value: ReactNode;
  detail?: string;
  danger?: boolean;
}

function StatCard({ label, value, detail, danger }: StatCardProps) {
  return (
    <div className="rounded-card border-[0.5px] border-border bg-surface px-4 py-3">
      <span className="text-[12px] text-muted-foreground">{label}</span>
      <p
        className={cn(
          'mt-1 text-[15px] font-medium tabular-nums tracking-tight',
          danger ? 'text-danger' : 'text-foreground',
        )}
      >
        {value}
      </p>
      {detail && (
        <p className="mt-0.5 text-[12px] leading-relaxed text-muted-foreground">{detail}</p>
      )}
    </div>
  );
}
