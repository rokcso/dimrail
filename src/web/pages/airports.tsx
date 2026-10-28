import {
  RiAddLine,
  RiCheckLine,
  RiCloseLine,
  RiDeleteBinLine,
  RiRefreshLine,
  RiSearchLine,
} from '@remixicon/react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import type { AirportListResponse, AirportSummary, NodesResponse } from '@/shared/schema';
import { AppShell } from '../components/app-shell';
import { PageHeader } from '../components/page-header';
import { Status } from '../components/status';
import { Button } from '../components/ui/button';
import {
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogRoot,
  DialogTitle,
} from '../components/ui/dialog';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { ApiError, api } from '../lib/api';
import { cn, formatStamp } from '../lib/utils';
import type { PageProps } from './types';

export function AirportsPage({
  token,
  path,
  selectedId,
  onNavigate,
  onReplace,
  onReject,
}: PageProps) {
  const queryClient = useQueryClient();
  const [nameDraft, setNameDraft] = useState('');
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('all');
  const [addOpen, setAddOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const [newUrl, setNewUrl] = useState('');
  const [addError, setAddError] = useState('');
  const [error, setError] = useState('');

  const list = useQuery({
    queryKey: ['airports'],
    queryFn: () => api.get<AirportListResponse>('/api/airports', token),
    retry: false,
    refetchOnWindowFocus: false,
  });

  const airports = list.data?.airports ?? [];
  const activeId = selectedId ?? airports[0]?.id ?? null;
  const active = airports.find((airport) => airport.id === activeId) ?? null;

  const nodesQuery = useQuery({
    queryKey: ['nodes', activeId],
    queryFn: () =>
      api.get<NodesResponse>(
        `/api/nodes${activeId ? `?airportId=${encodeURIComponent(activeId)}` : ''}`,
        token,
      ),
    enabled: Boolean(activeId),
    retry: false,
    refetchOnWindowFocus: false,
  });

  const nodes = nodesQuery.data?.nodes ?? [];

  const airportNodes = useMemo(
    () => (active ? nodes.filter((node) => node.airportId === active.id) : []),
    [nodes, active],
  );

  useEffect(() => {
    setNameDraft(active?.name ?? '');
  }, [active?.name]);

  useEffect(() => {
    if (list.isPending || !selectedId || active) return;
    onReplace('/admin/airports');
  }, [list.isPending, selectedId, active, onReplace]);

  useEffect(() => {
    const failure = list.error ?? nodesQuery.error;
    if (failure instanceof ApiError && failure.status === 401) onReject();
  }, [list.error, nodesQuery.error, onReject]);

  const refreshStores = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['airports'] }),
      queryClient.invalidateQueries({ queryKey: ['nodes'] }),
    ]);
  };

  const onMutationError = (err: Error) => {
    setError(err.message);
    if (err instanceof ApiError && err.status === 401) onReject();
  };

  const openAdd = () => {
    setNewName('');
    setNewUrl('');
    setAddError('');
    setAddOpen(true);
  };

  const create = useMutation({
    mutationFn: () =>
      api.post<AirportSummary>('/api/airports', token, { name: newName, url: newUrl }),
    onSuccess: async (airport) => {
      setAddOpen(false);
      setNewName('');
      setNewUrl('');
      setAddError('');
      setError('');
      await refreshStores();
      onNavigate(`/admin/airports/${airport.id}`);
    },
    onError: (err: Error) => {
      setAddError(err.message);
      if (err instanceof ApiError && err.status === 401) onReject();
    },
  });

  const refreshOne = useMutation({
    mutationFn: (id: string) => api.post<AirportSummary>(`/api/airports/${id}/refresh`, token),
    onSuccess: async (airport) => {
      setError(airport.error ?? '');
      await refreshStores();
    },
    onError: onMutationError,
  });

  const rename = useMutation({
    mutationFn: (input: { id: string; name: string }) =>
      api.patch<AirportSummary>(`/api/airports/${input.id}`, token, { name: input.name }),
    onSuccess: async () => {
      setError('');
      await refreshStores();
    },
    onError: async (err: Error) => {
      setError(err.message);
      setNameDraft(active?.name ?? '');
      if (err instanceof ApiError && err.status === 401) onReject();
      await refreshStores();
    },
  });

  const toggle = useMutation({
    mutationFn: (input: { id: string; enabled: boolean }) =>
      api.patch<AirportSummary>(`/api/airports/${input.id}`, token, { enabled: input.enabled }),
    onSuccess: async () => {
      setError('');
      await refreshStores();
    },
    onError: onMutationError,
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.del<{ ok: boolean }>(`/api/airports/${id}`, token),
    onSuccess: async () => {
      setError('');
      await refreshStores();
    },
    onError: onMutationError,
  });

  const types = useMemo(() => {
    const set = new Set(airportNodes.map((node) => node.type).filter(Boolean));
    return [...set].sort();
  }, [airportNodes]);

  const rows = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    return airportNodes.filter((node) => {
      if (typeFilter !== 'all' && node.type !== typeFilter) return false;
      if (!keyword) return true;
      return (
        node.name.toLowerCase().includes(keyword) || node.server.toLowerCase().includes(keyword)
      );
    });
  }, [airportNodes, typeFilter, search]);

  const submitNew = () => {
    if (!newName.trim() || !newUrl.trim() || create.isPending) return;
    setAddError('');
    create.mutate();
  };

  const commitRename = () => {
    if (!active) return;
    const next = nameDraft.trim();
    if (!next || next === active.name) {
      setNameDraft(active.name);
      return;
    }
    rename.mutate({ id: active.id, name: next });
  };

  const confirmDelete = (airport: AirportSummary) => {
    if (
      !window.confirm(
        `删除机场「${airport.name}」？它的缓存节点会一起删除，所有配置都会失去这个机场的节点。`,
      )
    )
      return;
    remove.mutate(airport.id);
  };

  const sidebar = (
    <>
      <div className="flex h-12 shrink-0 items-center justify-between pr-2 pl-4">
        <div className="flex items-baseline gap-1.5">
          <span className="text-[12px] font-medium">机场</span>
          <span className="text-[12px] tabular-nums text-muted-foreground">
            {list.isPending ? '…' : airports.length}
          </span>
        </div>
        <button
          type="button"
          title="添加机场"
          onClick={openAdd}
          className="flex size-5 items-center justify-center rounded-control text-muted-foreground outline-none hover:bg-muted hover:text-foreground"
        >
          <RiAddLine className="size-3.5" />
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
        {airports.map((airport) => {
          const isActive = airport.id === activeId;
          return (
            <div
              key={airport.id}
              className={cn(
                'group relative flex h-8 items-center rounded-control pr-7',
                isActive ? 'bg-accent' : 'hover:bg-muted',
              )}
            >
              <button
                type="button"
                onClick={() => onNavigate(`/admin/airports/${airport.id}`)}
                className={cn(
                  'flex min-w-0 flex-1 items-center gap-1.5 px-2 text-left text-[13px]',
                  isActive ? 'text-accent-foreground' : 'text-foreground',
                  !airport.enabled && 'opacity-50',
                )}
              >
                <span className="min-w-0 flex-1 truncate">{airport.name}</span>
                {airport.error && !airport.nodeCount ? (
                  <span className="size-1.5 shrink-0 rounded-full bg-danger" aria-hidden />
                ) : null}
              </button>
              <span
                className={cn(
                  'pointer-events-none absolute right-2 text-[12px] tabular-nums group-hover:opacity-0',
                  isActive ? 'text-accent-foreground/70' : 'text-muted-foreground',
                )}
              >
                {airport.nodeCount}
              </span>
              <button
                type="button"
                title="删除机场"
                onClick={() => confirmDelete(airport)}
                className="absolute right-1 flex size-5 items-center justify-center rounded-control text-muted-foreground opacity-0 outline-none hover:text-danger focus-visible:opacity-100 group-hover:opacity-100"
              >
                <RiDeleteBinLine className="size-3.5" />
              </button>
            </div>
          );
        })}

        {list.isPending && <p className="px-2 py-1 text-[12px] text-muted-foreground">载入中</p>}
      </div>
    </>
  );

  const emptyText = list.isPending ? '载入中' : airports.length === 0 ? '还没有机场' : '选择机场';

  return (
    <AppShell path={path} onNavigate={onNavigate} sidebar={sidebar}>
      {active ? (
        <>
          <PageHeader
            title={
              <input
                value={nameDraft}
                onChange={(event) => setNameDraft(event.target.value)}
                onBlur={commitRename}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') event.currentTarget.blur();
                  if (event.key === 'Escape') setNameDraft(active.name);
                }}
                maxLength={40}
                className="-mx-1.5 w-full max-w-sm rounded-control bg-transparent px-1.5 text-[15px] font-medium tracking-tight text-foreground outline-none hover:bg-muted focus:bg-muted"
              />
            }
            meta={
              <>
                <Status
                  tone={active.error ? 'error' : 'saved'}
                  label={active.error ? '拉取失败' : active.enabled ? '正常' : '已停用'}
                />
                <span className="tabular-nums">{active.nodeCount} 个节点</span>
                <span className="tabular-nums">
                  {active.fetchedAt ? `更新于 ${formatStamp(active.fetchedAt)}` : '还没拉过'}
                </span>
                {active.truncated && <span className="text-warning">节点已截断</span>}
                <span className="min-w-0 truncate" title={active.url}>
                  {active.url}
                </span>
              </>
            }
            actions={
              <>
                <Button
                  variant="ghost"
                  onClick={() => toggle.mutate({ id: active.id, enabled: !active.enabled })}
                  disabled={toggle.isPending}
                >
                  {active.enabled ? '停用' : '启用'}
                </Button>
                <Button
                  variant="outline"
                  onClick={() => refreshOne.mutate(active.id)}
                  disabled={refreshOne.isPending}
                >
                  <RiRefreshLine className="size-3.5" />
                  {refreshOne.isPending ? '拉取中' : '刷新'}
                </Button>
              </>
            }
          />

          {error && (
            <div className="shrink-0 border-b-[0.5px] border-border px-6 py-1.5 text-[12px] text-danger">
              {error}
            </div>
          )}

          <div className="flex shrink-0 items-center gap-2 border-b-[0.5px] border-border px-6 py-1.5">
            <RiSearchLine className="size-3.5 shrink-0 text-muted-foreground" />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="搜索节点名或服务器"
              aria-label="搜索节点"
              className="h-6 min-w-0 flex-1 bg-transparent text-[12px] text-foreground outline-none placeholder:text-muted-foreground"
            />
            <select
              value={typeFilter}
              onChange={(event) => setTypeFilter(event.target.value)}
              aria-label="节点类型"
              className="h-6 rounded-control bg-transparent px-1 text-[12px] text-muted-foreground outline-none hover:text-foreground"
            >
              <option value="all">全部类型</option>
              {types.map((type) => (
                <option key={type} value={type}>
                  {type}
                </option>
              ))}
            </select>
            <span className="shrink-0 text-[12px] tabular-nums text-muted-foreground">
              {rows.length} / {airportNodes.length}
            </span>
          </div>

          <div className="min-h-0 flex-1 overflow-auto">
            {rows.length > 0 ? (
              <table className="w-full border-collapse text-[12px]">
                <thead className="sticky top-0 z-10 bg-background">
                  <tr className="border-b-[0.5px] border-border text-left text-[12px] text-muted-foreground">
                    <th className="py-1.5 pr-3 pl-6 font-normal">名称</th>
                    <th className="w-20 px-3 py-1.5 font-normal">类型</th>
                    <th className="px-3 py-1.5 font-normal">服务器</th>
                    <th className="w-16 px-3 py-1.5 text-right font-normal">端口</th>
                    <th className="w-32 py-1.5 pr-6 pl-3 font-normal">来源</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((node) => (
                    <tr
                      key={`${node.airportId}:${node.name}:${node.server}:${node.port}`}
                      className="border-b-[0.5px] border-border/60 hover:bg-surface"
                    >
                      <td className="max-w-0 truncate py-1 pr-3 pl-6 text-foreground">
                        {node.name}
                      </td>
                      <td className="px-3 py-1 text-muted-foreground">{node.type || '—'}</td>
                      <td className="max-w-0 truncate px-3 py-1 font-mono text-[12px] text-muted-foreground">
                        {node.server}
                      </td>
                      <td className="px-3 py-1 text-right tabular-nums text-muted-foreground">
                        {node.port}
                      </td>
                      <td className="max-w-0 truncate py-1 pr-6 pl-3 text-muted-foreground">
                        {node.airportName}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <div className="flex h-full items-center justify-center px-6 text-center">
                <p className="text-[12px] text-muted-foreground">
                  {nodesQuery.isPending
                    ? '载入中'
                    : airportNodes.length === 0
                      ? '还没有拉取到节点'
                      : '没有匹配的节点'}
                </p>
              </div>
            )}
          </div>

          {active.error && (
            <div className="flex shrink-0 items-center gap-2 border-t-[0.5px] border-border px-6 py-1.5 text-[12px] text-danger">
              <span>上次拉取失败：{active.error}</span>
              {active.nodeCount > 0 && (
                <span className="flex items-center gap-1 text-muted-foreground">
                  <RiCheckLine className="size-3.5" />
                  当前使用 {formatStamp(active.fetchedAt)} 的缓存
                </span>
              )}
            </div>
          )}
        </>
      ) : (
        <>
          <PageHeader title="机场" />
          {error && (
            <div className="shrink-0 border-b-[0.5px] border-border px-6 py-1.5 text-[12px] text-danger">
              {error}
            </div>
          )}
          <div className="flex flex-1 items-center justify-center px-6 text-center">
            <p className="text-[12px] text-muted-foreground">{emptyText}</p>
          </div>
        </>
      )}

      <DialogRoot
        open={addOpen}
        onOpenChange={(open) => {
          setAddOpen(open);
          if (!open) setAddError('');
        }}
      >
        <DialogContent>
          <div className="flex items-start justify-between gap-4">
            <DialogTitle>添加机场</DialogTitle>
            <DialogClose
              render={
                <Button type="button" variant="ghost" size="icon" aria-label="关闭">
                  <RiCloseLine className="size-4" />
                </Button>
              }
            />
          </div>

          <form
            className="mt-4"
            onSubmit={(event) => {
              event.preventDefault();
              submitNew();
            }}
          >
            <Label htmlFor="airport-name">机场名</Label>
            <Input
              id="airport-name"
              className="mt-1.5"
              value={newName}
              onChange={(event) => setNewName(event.target.value)}
              autoFocus
            />

            <Label htmlFor="airport-url" className="mt-3">
              订阅链接
            </Label>
            <Input
              id="airport-url"
              className="mt-1.5"
              value={newUrl}
              onChange={(event) => setNewUrl(event.target.value)}
            />

            {addError && <p className="mt-3 text-[12px] text-danger">{addError}</p>}

            <DialogFooter className="mt-5">
              <DialogClose
                render={
                  <Button type="button" variant="ghost">
                    取消
                  </Button>
                }
              />
              <Button
                type="submit"
                variant="primary"
                disabled={create.isPending || !newName.trim() || !newUrl.trim()}
              >
                {create.isPending ? '拉取中' : '添加并拉取'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </DialogRoot>
    </AppShell>
  );
}
