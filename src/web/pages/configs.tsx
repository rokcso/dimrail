import {
  RiAddLine,
  RiCheckLine,
  RiDeleteBinLine,
  RiFileCopyLine,
  RiRefreshLine,
} from '@remixicon/react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';
import type {
  ConfigDetail,
  ConfigListResponse,
  ConfigSummary,
  SaveResponse,
  TokenResponse,
} from '@/shared/schema';
import { AppShell } from '../components/app-shell';
import { LazyYamlEditor } from '../components/lazy-editor';
import { PageHeader } from '../components/page-header';
import { Dot, Status, type Tone } from '../components/status';
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

export function ConfigsPage({ token, path, onNavigate, onReject }: PageProps) {
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState<string | null>(null);
  const [yaml, setYaml] = useState('');
  const [savedYaml, setSavedYaml] = useState('');
  const [name, setName] = useState('');
  const [savedName, setSavedName] = useState('');
  const [notices, setNotices] = useState<string[]>([]);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const copyTimer = useRef<number | null>(null);

  const list = useQuery({
    queryKey: ['configs'],
    queryFn: () => api.get<ConfigListResponse>('/api/configs', token),
    retry: false,
    refetchOnWindowFocus: false,
  });

  const configs = list.data?.configs ?? [];
  const activeId = selected ?? configs[0]?.id ?? null;
  const active = configs.find((item) => item.id === activeId) ?? null;

  const detail = useQuery({
    queryKey: ['config', activeId],
    queryFn: () => api.get<ConfigDetail>(`/api/configs/${activeId}`, token),
    enabled: Boolean(activeId),
    retry: false,
    refetchOnWindowFocus: false,
  });

  const loaded = detail.data && detail.data.id === activeId ? detail.data : null;

  useEffect(() => {
    if (!loaded) return;
    setYaml(loaded.yaml);
    setSavedYaml(loaded.yaml);
    setName(loaded.name);
    setSavedName(loaded.name);
    setNotices([]);
    setError('');
  }, [loaded]);

  useEffect(() => {
    const failure = list.error ?? detail.error;
    if (failure instanceof ApiError && failure.status === 401) onReject();
  }, [list.error, detail.error, onReject]);

  useEffect(
    () => () => {
      if (copyTimer.current) window.clearTimeout(copyTimer.current);
    },
    [],
  );

  const dirty = Boolean(loaded) && (yaml !== savedYaml || name.trim() !== savedName);

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
    mutationFn: () =>
      api.put<SaveResponse>(`/api/configs/${activeId}`, token, { yaml, name: name.trim() }),
    onSuccess: (response) => {
      setSavedYaml(yaml);
      setSavedName(name.trim());
      setName(name.trim());
      setNotices(response.notices);
      setError('');
      void queryClient.invalidateQueries({ queryKey: ['configs'] });
    },
    onError: (err: Error) => {
      setError(err.message);
      if (err instanceof ApiError && err.status === 401) onReject();
    },
  });

  const create = useMutation({
    mutationFn: () => api.post<ConfigDetail>('/api/configs', token, {}),
    onSuccess: (created) => {
      queryClient.setQueryData(['config', created.id], created);
      setSelected(created.id);
      void queryClient.invalidateQueries({ queryKey: ['configs'] });
    },
    onError: (err: Error) => {
      setError(err.message);
      if (err instanceof ApiError && err.status === 401) onReject();
    },
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.del<{ ok: boolean }>(`/api/configs/${id}`, token),
    onSuccess: (_data, id) => {
      queryClient.removeQueries({ queryKey: ['config', id] });
      if (selected === id) setSelected(null);
      void queryClient.invalidateQueries({ queryKey: ['configs'] });
    },
    onError: (err: Error) => {
      setError(err.message);
      if (err instanceof ApiError && err.status === 401) onReject();
    },
  });

  const regenerate = useMutation({
    mutationFn: (id: string) => api.post<TokenResponse>(`/api/configs/${id}/token`, token),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['configs'] });
    },
    onError: (err: Error) => {
      setError(err.message);
      if (err instanceof ApiError && err.status === 401) onReject();
    },
  });

  const select = (id: string) => {
    if (id === activeId) return;
    if (dirty && !window.confirm('当前配置有未保存的修改，切换后会丢失。继续？')) return;
    setSelected(id);
  };

  const confirmDelete = (item: ConfigSummary) => {
    if (!window.confirm(`删除「${item.name}」？它的订阅链接会立即失效。`)) return;
    remove.mutate(item.id);
  };

  const confirmRegenerate = () => {
    if (!active) return;
    if (!window.confirm('重新生成后旧链接立即失效，需要重新导入客户端。继续？')) return;
    regenerate.mutate(active.id);
  };

  const feed = active ? `${location.origin}/p/${active.id}?token=${active.token}` : '';

  const copyFeed = async () => {
    if (!feed) return;
    try {
      await navigator.clipboard.writeText(feed);
      setCopied(true);
      if (copyTimer.current) window.clearTimeout(copyTimer.current);
      copyTimer.current = window.setTimeout(() => setCopied(false), 1500);
    } catch {
      setError('复制失败，请手动选择链接');
    }
  };

  const metrics = useMemo(() => {
    const lines = yaml === '' ? 0 : yaml.split('\n').length;
    return { lines, bytes: new TextEncoder().encode(yaml).length };
  }, [yaml]);

  const tone: Tone = save.isPending ? 'saving' : error ? 'error' : dirty ? 'dirty' : 'saved';
  const message = error || notices.join('，');
  const canSave = Boolean(loaded) && dirty && Boolean(name.trim()) && !save.isPending;

  const sidebar = (
    <>
      <div className="flex shrink-0 items-center justify-between pr-2 pb-1 pl-4">
        <span className="text-[11px] font-medium">配置</span>
        <button
          type="button"
          title="新建配置"
          onClick={() => create.mutate()}
          disabled={create.isPending}
          className="flex size-5 items-center justify-center rounded-control text-muted-foreground outline-none transition-colors hover:bg-muted hover:text-foreground disabled:opacity-40"
        >
          <RiAddLine className="size-3.5" />
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
        {configs.map((item) => {
          const isActive = item.id === activeId;
          return (
            <div
              key={item.id}
              className={cn(
                'group relative flex h-7 items-center rounded-control pr-7',
                isActive ? 'bg-accent' : 'hover:bg-muted',
              )}
            >
              <button
                type="button"
                onClick={() => select(item.id)}
                className={cn(
                  'min-w-0 flex-1 truncate px-2 text-left text-[13px]',
                  isActive ? 'text-accent-foreground' : 'text-foreground',
                )}
              >
                {item.name}
              </button>
              <span
                className={cn(
                  'pointer-events-none absolute right-2 text-[11px] tabular-nums transition-opacity duration-150 group-hover:opacity-0',
                  isActive ? 'text-accent-foreground/70' : 'text-muted-foreground',
                )}
              >
                {formatStamp(item.updatedAt)}
              </span>
              <button
                type="button"
                title="删除"
                onClick={() => confirmDelete(item)}
                className="absolute right-1 flex size-5 items-center justify-center rounded-control text-muted-foreground opacity-0 outline-none transition-opacity duration-150 hover:text-danger focus-visible:opacity-100 group-hover:opacity-100"
              >
                <RiDeleteBinLine className="size-3.5" />
              </button>
            </div>
          );
        })}

        {list.isPending && <p className="px-2 py-1 text-[11px] text-muted-foreground">载入中</p>}
        {!list.isPending && configs.length === 0 && (
          <p className="px-2 py-1 text-[11px] text-muted-foreground">还没有配置</p>
        )}
      </div>
    </>
  );

  return (
    <AppShell path={path} onNavigate={onNavigate} sidebar={sidebar}>
      {active ? (
        <PageHeader
          title={
            <input
              value={name}
              onChange={(event) => {
                setName(event.target.value);
                if (error) setError('');
              }}
              placeholder="未命名配置"
              maxLength={40}
              className="-mx-1.5 w-full max-w-sm rounded-control bg-transparent px-1.5 text-[15px] font-medium tracking-tight text-foreground outline-none transition-colors hover:bg-muted focus:bg-muted"
            />
          }
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
              <Button variant="outline" size="sm" onClick={copyFeed} title={feed}>
                {copied ? (
                  <RiCheckLine className="size-3.5 text-primary" />
                ) : (
                  <RiFileCopyLine className="size-3.5" />
                )}
                {copied ? '已复制' : '订阅链接'}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={confirmRegenerate}
                disabled={regenerate.isPending}
                title="重新生成订阅链接，旧链接立即失效"
              >
                <RiRefreshLine className="size-3.5" />
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
      ) : (
        <PageHeader
          title="配置"
          meta={
            <span className="tabular-nums">
              {list.isPending ? '载入中' : `${configs.length} 份`}
            </span>
          }
        />
      )}

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

      {loaded ? (
        <div className="min-h-0 flex-1 px-3">
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
        </div>
      ) : (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
          {activeId ? (
            <p className="text-[11px] text-muted-foreground">载入中</p>
          ) : (
            <>
              <p className="text-[13px] font-medium">还没有配置</p>
              <p className="max-w-xs text-[11px] leading-relaxed text-muted-foreground">
                新建的配置会以「设置 → 基础配置」为起点，每份有独立的订阅链接。
              </p>
              <Button variant="primary" onClick={() => create.mutate()} disabled={create.isPending}>
                新建配置
              </Button>
            </>
          )}
        </div>
      )}
    </AppShell>
  );
}
