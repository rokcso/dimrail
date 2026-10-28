import {
  RiAddLine,
  RiCheckLine,
  RiCloseLine,
  RiDeleteBinLine,
  RiEyeLine,
  RiFileCopyLine,
  RiMore2Line,
  RiRefreshLine,
} from '@remixicon/react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useBlocker } from '@tanstack/react-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import type {
  ConfigDetail,
  ConfigListResponse,
  ConfigSummary,
  NodePoolListResponse,
  SaveResponse,
  TokenResponse,
} from '@/shared/schema';
import { AppShell } from '../components/app-shell';
import { LazyYamlEditor } from '../components/lazy-editor';
import { PageHeader } from '../components/page-header';
import { Status, type Tone } from '../components/status';
import { Button } from '../components/ui/button';
import {
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogRoot,
  DialogTitle,
} from '../components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../components/ui/dropdown-menu';
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

export function ConfigsPage({
  token,
  path,
  selectedId,
  onNavigate,
  onReplace,
  onReject,
}: PageProps) {
  const queryClient = useQueryClient();
  const [yaml, setYaml] = useState('');
  const [savedYaml, setSavedYaml] = useState('');
  const [name, setName] = useState('');
  const [savedName, setSavedName] = useState('');
  /** 节点来源：'' = 全部节点，否则是节点池 id。 */
  const [scope, setScope] = useState('');
  const [notices, setNotices] = useState<string[]>([]);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewYaml, setPreviewYaml] = useState('');
  const [previewError, setPreviewError] = useState('');
  const copyTimer = useRef<number | null>(null);
  /** 已经同步进编辑器的配置 id：换节点来源会更新缓存，不该覆盖未保存的 YAML。 */
  const syncedConfigId = useRef<string | null>(null);

  const list = useQuery({
    queryKey: ['configs'],
    queryFn: () => api.get<ConfigListResponse>('/api/configs', token),
    retry: false,
    refetchOnWindowFocus: false,
  });

  const pools = useQuery({
    queryKey: ['pools'],
    queryFn: () => api.get<NodePoolListResponse>('/api/pools', token),
    retry: false,
    refetchOnWindowFocus: false,
  });

  const configs = list.data?.configs ?? [];
  const activeId = selectedId ?? configs[0]?.id ?? null;
  const active = configs.find((item) => item.id === activeId) ?? null;
  const poolOptions = pools.data?.pools ?? [];

  const detail = useQuery({
    queryKey: ['config', activeId],
    queryFn: () => api.get<ConfigDetail>(`/api/configs/${activeId}`, token),
    enabled: Boolean(activeId),
    retry: false,
    refetchOnWindowFocus: false,
  });

  const loaded = detail.data && detail.data.id === activeId ? detail.data : null;

  // 地址里的 id 被删掉或本来就不存在时，回到列表。
  useEffect(() => {
    if (list.isPending || !selectedId || active) return;
    onReplace('/admin/configs');
  }, [list.isPending, selectedId, active, onReplace]);

  useEffect(() => {
    if (!loaded || syncedConfigId.current === loaded.id) return;
    syncedConfigId.current = loaded.id;
    setYaml(loaded.yaml);
    setSavedYaml(loaded.yaml);
    setName(loaded.name);
    setSavedName(loaded.name);
    setScope(loaded.poolId ?? '');
    setNotices([]);
    setError('');
  }, [loaded]);

  useEffect(() => {
    const failure = list.error ?? detail.error ?? pools.error;
    if (failure instanceof ApiError && failure.status === 401) onReject();
  }, [list.error, detail.error, pools.error, onReject]);

  useEffect(
    () => () => {
      if (copyTimer.current) window.clearTimeout(copyTimer.current);
    },
    [],
  );

  const dirty = Boolean(loaded) && (yaml !== savedYaml || name.trim() !== savedName);

  const blocker = useBlocker({
    shouldBlockFn: () => dirty,
    withResolver: true,
    enableBeforeUnload: dirty,
  });

  useEffect(() => {
    if (blocker.status !== 'blocked') return;
    if (window.confirm('当前配置有未保存的修改，离开会丢失。继续？')) blocker.proceed();
    else blocker.reset();
  }, [blocker]);

  const save = useMutation({
    mutationFn: () =>
      api.put<SaveResponse>(`/api/configs/${activeId}`, token, {
        yaml,
        name: name.trim(),
        expectedUpdatedAt: loaded?.updatedAt ?? null,
      }),
    onSuccess: (response) => {
      setSavedYaml(yaml);
      setSavedName(name.trim());
      setName(name.trim());
      setNotices(response.notices);
      setError('');
      queryClient.setQueryData<ConfigDetail>(['config', activeId], (prev) =>
        prev ? { ...prev, yaml, name: name.trim(), updatedAt: response.updatedAt } : prev,
      );
      void queryClient.invalidateQueries({ queryKey: ['configs'] });
      void queryClient.invalidateQueries({ queryKey: ['overview'] });
    },
    onError: (err: Error) => {
      setError(err.message);
      if (err instanceof ApiError && err.status === 401) onReject();
    },
  });

  const create = useMutation({
    mutationFn: () => api.post<ConfigDetail>('/api/configs', token, {}),
    onSuccess: async (created) => {
      queryClient.setQueryData(['config', created.id], created);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['configs'] }),
        queryClient.invalidateQueries({ queryKey: ['overview'] }),
      ]);
      onNavigate(`/admin/configs/${created.id}`);
    },
    onError: (err: Error) => {
      setError(err.message);
      if (err instanceof ApiError && err.status === 401) onReject();
    },
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.del<{ ok: boolean }>(`/api/configs/${id}`, token),
    onSuccess: async (_data, id) => {
      queryClient.removeQueries({ queryKey: ['config', id] });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['configs'] }),
        queryClient.invalidateQueries({ queryKey: ['overview'] }),
      ]);
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

  const changeScope = useMutation({
    mutationFn: (poolId: string | null) =>
      api.put<SaveResponse>(`/api/configs/${activeId}`, token, {
        poolId,
        expectedUpdatedAt: loaded?.updatedAt ?? null,
      }),
    onSuccess: (response, poolId) => {
      setScope(poolId ?? '');
      queryClient.setQueryData<ConfigDetail>(['config', activeId], (prev) =>
        prev ? { ...prev, poolId, updatedAt: response.updatedAt } : prev,
      );
      setError('');
      void queryClient.invalidateQueries({ queryKey: ['configs'] });
    },
    onError: (err: Error) => {
      setError(err.message);
      if (err instanceof ApiError && err.status === 401) onReject();
    },
  });

  const preview = useMutation({
    mutationFn: () => api.get<{ yaml: string }>(`/api/configs/${activeId}/preview`, token),
    onSuccess: (data) => {
      setPreviewYaml(data.yaml);
      setPreviewError('');
      setPreviewOpen(true);
    },
    onError: (err: Error) => {
      setPreviewError(err.message);
      setPreviewOpen(true);
      if (err instanceof ApiError && err.status === 401) onReject();
    },
  });

  const select = (id: string) => {
    if (id === activeId) return;
    onNavigate(`/admin/configs/${id}`);
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

  const feed = active ? `${location.origin}/sub/${active.id}?token=${active.token}` : '';

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
      <div className="flex h-12 shrink-0 items-center justify-between pr-2 pl-4">
        <div className="flex items-baseline gap-1.5">
          <span className="text-[12px] font-medium">配置</span>
          <span className="text-[12px] tabular-nums text-muted-foreground">
            {list.isPending ? '…' : configs.length}
          </span>
        </div>
        <button
          type="button"
          title="新建配置"
          onClick={() => create.mutate()}
          disabled={create.isPending}
          className="flex size-5 items-center justify-center rounded-control text-muted-foreground outline-none hover:bg-muted hover:text-foreground disabled:opacity-40"
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
                'group relative flex h-8 items-center rounded-control pr-7',
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
                  'pointer-events-none absolute right-2 text-[12px] tabular-nums group-hover:opacity-0',
                  isActive ? 'text-accent-foreground/70' : 'text-muted-foreground',
                )}
              >
                {formatStamp(item.updatedAt)}
              </span>
              <button
                type="button"
                title="删除"
                onClick={() => confirmDelete(item)}
                className="absolute right-1 flex size-5 items-center justify-center rounded-control text-muted-foreground opacity-0 outline-none hover:text-danger focus-visible:opacity-100 group-hover:opacity-100"
              >
                <RiDeleteBinLine className="size-3.5" />
              </button>
            </div>
          );
        })}

        {list.isPending && <p className="px-2 py-1 text-[12px] text-muted-foreground">载入中</p>}
        {!list.isPending && configs.length === 0 && (
          <p className="px-2 py-1 text-[12px] text-muted-foreground">还没有配置</p>
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
              className="-mx-1.5 w-full max-w-sm rounded-control bg-transparent px-1.5 text-[15px] font-medium tracking-tight text-foreground outline-none hover:bg-muted focus:bg-muted"
            />
          }
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
              <select
                aria-label="节点来源"
                value={scope}
                onChange={(event) => changeScope.mutate(event.target.value || null)}
                disabled={changeScope.isPending || !loaded}
                className="h-7 max-w-44 rounded-control border-[0.5px] border-input bg-background px-2 text-[12px] text-foreground outline-none disabled:opacity-50"
              >
                <option value="">全部节点</option>
                {scope && !poolOptions.some((pool) => pool.id === scope) && (
                  <option value={scope}>{pools.isPending ? '载入中…' : '节点池已失效'}</option>
                )}
                {poolOptions.map((pool) => (
                  <option key={pool.id} value={pool.id}>
                    {pool.name}（{pool.nodeCount}）
                  </option>
                ))}
              </select>
              <Button variant="outline" onClick={copyFeed} title={feed}>
                {copied ? (
                  <RiCheckLine className="size-3.5 text-primary" />
                ) : (
                  <RiFileCopyLine className="size-3.5" />
                )}
                {copied ? '已复制' : '订阅链接'}
              </Button>
              <Button
                variant="primary"
                onClick={() => save.mutate()}
                disabled={!canSave}
                title={`保存 (${SAVE_HINT})`}
              >
                保存
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label="更多操作"
                      title="更多操作"
                    >
                      <RiMore2Line className="size-4" />
                    </Button>
                  }
                />
                <DropdownMenuContent>
                  <DropdownMenuItem onClick={() => preview.mutate()} disabled={preview.isPending}>
                    <RiEyeLine className="size-3.5" />
                    预览订阅
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={confirmRegenerate} disabled={regenerate.isPending}>
                    <RiRefreshLine className="size-3.5" />
                    重新生成订阅链接
                  </DropdownMenuItem>
                  <DropdownMenuSeparator className="my-1 h-[0.5px] bg-border" />
                  <DropdownMenuItem
                    danger
                    onClick={() => confirmDelete(active)}
                    disabled={remove.isPending}
                  >
                    <RiDeleteBinLine className="size-3.5" />
                    删除配置
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </>
          }
        />
      ) : (
        <PageHeader title="配置" />
      )}

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

      {loaded ? (
        <div className="min-h-0 flex-1 px-6">
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
            <p className="text-[12px] text-muted-foreground">载入中</p>
          ) : (
            <>
              <p className="text-[13px] font-medium">还没有配置</p>
              <Button variant="primary" onClick={() => create.mutate()} disabled={create.isPending}>
                新建配置
              </Button>
            </>
          )}
        </div>
      )}

      <DialogRoot
        open={previewOpen}
        onOpenChange={(open) => {
          setPreviewOpen(open);
          if (!open) setPreviewError('');
        }}
      >
        <DialogContent className="max-w-3xl">
          <div className="flex items-start justify-between gap-4">
            <DialogTitle>订阅预览</DialogTitle>
            <DialogClose
              render={
                <Button type="button" variant="ghost" size="icon" aria-label="关闭">
                  <RiCloseLine className="size-4" />
                </Button>
              }
            />
          </div>

          {previewError ? (
            <p className="mt-4 text-[12px] text-danger">{previewError}</p>
          ) : (
            <pre className="mt-4 max-h-[60vh] overflow-auto rounded-control border-[0.5px] border-border bg-surface p-3 font-mono text-[12px] leading-relaxed break-all whitespace-pre-wrap">
              {previewYaml}
            </pre>
          )}

          <DialogFooter className="mt-4">
            <DialogClose
              render={
                <Button type="button" variant="outline">
                  关闭
                </Button>
              }
            />
          </DialogFooter>
        </DialogContent>
      </DialogRoot>
    </AppShell>
  );
}
