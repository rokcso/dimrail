import {
  RiAddLine,
  RiCheckLine,
  RiDeleteBinLine,
  RiRefreshLine,
  RiSearchLine,
} from '@remixicon/react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import type {
  AirportListResponse,
  AirportSummary,
  NodesResponse,
  RefreshResponse,
} from '@/shared/schema';
import { AppShell } from '../components/app-shell';
import { PageHeader } from '../components/page-header';
import { Dot, Status } from '../components/status';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { ApiError, api } from '../lib/api';
import { cn, formatStamp } from '../lib/utils';
import type { PageProps } from './types';

export function AirportsPage({ token, path, onNavigate, onReject }: PageProps) {
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState<string | null>(null);
  const [nameDraft, setNameDraft] = useState('');
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('all');
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState('');
  const [newUrl, setNewUrl] = useState('');
  const [error, setError] = useState('');

  const list = useQuery({
    queryKey: ['airports'],
    queryFn: () => api.get<AirportListResponse>('/api/airports', token),
    retry: false,
    refetchOnWindowFocus: false,
  });

  const nodesQuery = useQuery({
    queryKey: ['nodes'],
    queryFn: () => api.get<NodesResponse>('/api/nodes', token),
    retry: false,
    refetchOnWindowFocus: false,
  });

  const airports = list.data?.airports ?? [];
  const active = airports.find((airport) => airport.id === selected) ?? null;
  const nodes = nodesQuery.data?.nodes ?? [];

  useEffect(() => {
    setNameDraft(active?.name ?? '');
  }, [active?.name]);

  useEffect(() => {
    const failure = list.error ?? nodesQuery.error;
    if (failure instanceof ApiError && failure.status === 401) onReject();
  }, [list.error, nodesQuery.error, onReject]);

  const refreshStores = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['airports'] }),
      queryClient.invalidateQueries({ queryKey: ['nodes'] }),
      queryClient.invalidateQueries({ queryKey: ['overview'] }),
    ]);
  };

  const onMutationError = (err: Error) => {
    setError(err.message);
    if (err instanceof ApiError && err.status === 401) onReject();
  };

  const create = useMutation({
    mutationFn: () =>
      api.post<AirportSummary>('/api/airports', token, { name: newName, url: newUrl }),
    onSuccess: async (airport) => {
      setAdding(false);
      setNewName('');
      setNewUrl('');
      setError('');
      setSelected(airport.id);
      await refreshStores();
    },
    onError: onMutationError,
  });

  const refreshOne = useMutation({
    mutationFn: (id: string) => api.post<AirportSummary>(`/api/airports/${id}/refresh`, token),
    onSuccess: async (airport) => {
      setError(airport.error ?? '');
      await refreshStores();
    },
    onError: onMutationError,
  });

  const refreshAll = useMutation({
    mutationFn: () => api.post<RefreshResponse>('/api/airports/refresh', token),
    onSuccess: async (result) => {
      setError(result.failed ? `${result.failed} 个机场拉取失败` : '');
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
      setSelected(null);
      setError('');
      await refreshStores();
    },
    onError: onMutationError,
  });

  const types = useMemo(() => {
    const set = new Set(nodes.map((node) => node.type).filter(Boolean));
    return [...set].sort();
  }, [nodes]);

  const rows = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    return nodes.filter((node) => {
      if (active && node.airportId !== active.id) return false;
      if (typeFilter !== 'all' && node.type !== typeFilter) return false;
      if (!keyword) return true;
      return (
        node.name.toLowerCase().includes(keyword) || node.server.toLowerCase().includes(keyword)
      );
    });
  }, [nodes, active, typeFilter, search]);

  const submitNew = () => {
    if (!newName.trim() || !newUrl.trim() || create.isPending) return;
    setError('');
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
    const hint = `${airport.name} 会从所有配置的下发结果里消失。它的缓存节点也会一起删掉。`;
    if (!window.confirm(`删除机场「${airport.name}」？\n\n${hint}`)) return;
    remove.mutate(airport.id);
  };

  const totalNodes = nodes.length;

  const sidebar = (
    <>
      <div className="flex h-12 shrink-0 items-center justify-between px-3">
        <div className="flex items-baseline gap-1.5">
          <span className="text-[11px] font-medium">机场</span>
          <span className="text-[11px] tabular-nums text-muted-foreground">
            {list.isPending ? '…' : airports.length}
          </span>
        </div>
        <button
          type="button"
          title="添加机场"
          onClick={() => {
            setAdding(true);
            setError('');
          }}
          className="flex size-5 items-center justify-center rounded-control text-muted-foreground outline-none transition-colors hover:bg-muted hover:text-foreground"
        >
          <RiAddLine className="size-3.5" />
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
        <button
          type="button"
          onClick={() => setSelected(null)}
          className={cn(
            'flex h-8 w-full items-center rounded-control px-2 text-left text-[13px] outline-none transition-colors',
            selected === null
              ? 'bg-accent text-accent-foreground'
              : 'text-foreground hover:bg-muted',
          )}
        >
          <span className="min-w-0 flex-1 truncate">全部节点</span>
          <span className="ml-2 text-[11px] tabular-nums opacity-70">{totalNodes}</span>
        </button>

        {airports.map((airport) => {
          const isActive = airport.id === selected;
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
                onClick={() => setSelected(airport.id)}
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
                  'pointer-events-none absolute right-2 text-[11px] tabular-nums transition-opacity duration-150 group-hover:opacity-0',
                  isActive ? 'text-accent-foreground/70' : 'text-muted-foreground',
                )}
              >
                {airport.nodeCount}
              </span>
              <button
                type="button"
                title="删除机场"
                onClick={() => confirmDelete(airport)}
                className="absolute right-1 flex size-5 items-center justify-center rounded-control text-muted-foreground opacity-0 outline-none transition-opacity duration-150 hover:text-danger focus-visible:opacity-100 group-hover:opacity-100"
              >
                <RiDeleteBinLine className="size-3.5" />
              </button>
            </div>
          );
        })}

        {list.isPending && <p className="px-2 py-1 text-[11px] text-muted-foreground">载入中</p>}
      </div>
    </>
  );

  const failed = airports.filter((airport) => airport.error).length;

  return (
    <AppShell path={path} onNavigate={onNavigate} sidebar={sidebar}>
      {active ? (
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
              className="-mx-1.5 w-full max-w-sm rounded-control bg-transparent px-1.5 text-[15px] font-medium tracking-tight text-foreground outline-none transition-colors hover:bg-muted focus:bg-muted"
            />
          }
          meta={
            <>
              <Status
                tone={active.error ? 'error' : 'saved'}
                label={active.error ? '拉取失败' : active.enabled ? '正常' : '已停用'}
              />
              <Dot />
              <span className="tabular-nums">{active.nodeCount} 个节点</span>
              <Dot />
              <span className="tabular-nums">
                {active.fetchedAt ? `更新于 ${formatStamp(active.fetchedAt)}` : '还没拉过'}
              </span>
              <Dot />
              <span className="min-w-0 truncate" title={active.url}>
                {active.url}
              </span>
            </>
          }
          actions={
            <>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => toggle.mutate({ id: active.id, enabled: !active.enabled })}
                disabled={toggle.isPending}
              >
                {active.enabled ? '停用' : '启用'}
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => refreshOne.mutate(active.id)}
                disabled={refreshOne.isPending}
              >
                <RiRefreshLine className="size-3.5" />
                {refreshOne.isPending ? '拉取中' : '刷新'}
              </Button>
            </>
          }
        />
      ) : (
        <PageHeader
          title="机场"
          meta={
            <>
              <span className="tabular-nums">
                {list.isPending ? '载入中' : `${airports.length} 个机场 · ${totalNodes} 个节点`}
              </span>
              {failed > 0 && (
                <>
                  <Dot />
                  <span className="text-danger">{failed} 个拉取失败</span>
                </>
              )}
            </>
          }
          actions={
            <>
              <Button
                variant="outline"
                size="sm"
                onClick={() => refreshAll.mutate()}
                disabled={refreshAll.isPending || airports.length === 0}
              >
                <RiRefreshLine className="size-3.5" />
                {refreshAll.isPending ? '拉取中' : '全部刷新'}
              </Button>
              <Button variant="primary" size="sm" onClick={() => setAdding(true)}>
                <RiAddLine className="size-3.5" />
                添加机场
              </Button>
            </>
          }
        />
      )}

      {adding && (
        <form
          className="flex shrink-0 items-center gap-2 border-b-[0.5px] border-border px-4 py-2"
          onSubmit={(event) => {
            event.preventDefault();
            submitNew();
          }}
        >
          <Input
            value={newName}
            onChange={(event) => setNewName(event.target.value)}
            placeholder="机场名，会显示在客户端"
            aria-label="机场名"
            className="w-44"
          />
          <Input
            value={newUrl}
            onChange={(event) => setNewUrl(event.target.value)}
            placeholder="订阅链接 https://…"
            aria-label="订阅链接"
            className="flex-1"
          />
          <Button
            type="submit"
            variant="primary"
            size="sm"
            disabled={create.isPending || !newName.trim() || !newUrl.trim()}
          >
            {create.isPending ? '拉取中' : '添加并拉取'}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => {
              setAdding(false);
              setError('');
            }}
          >
            取消
          </Button>
        </form>
      )}

      {error && (
        <div className="shrink-0 border-b-[0.5px] border-border px-6 py-1.5 text-[11px] text-danger">
          {error}
        </div>
      )}

      <div className="flex shrink-0 items-center gap-2 border-b-[0.5px] border-border px-4 py-1.5">
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
          className="h-6 rounded-control bg-transparent px-1 text-[11px] text-muted-foreground outline-none hover:text-foreground"
        >
          <option value="all">全部类型</option>
          {types.map((type) => (
            <option key={type} value={type}>
              {type}
            </option>
          ))}
        </select>
        <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
          {rows.length} / {totalNodes}
        </span>
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        {rows.length > 0 ? (
          <table className="w-full border-collapse text-[12px]">
            <thead className="sticky top-0 z-10 bg-background">
              <tr className="border-b-[0.5px] border-border text-left text-[11px] text-muted-foreground">
                <th className="px-4 py-1.5 font-normal">名称</th>
                <th className="w-20 px-3 py-1.5 font-normal">类型</th>
                <th className="px-3 py-1.5 font-normal">服务器</th>
                <th className="w-16 px-3 py-1.5 text-right font-normal">端口</th>
                <th className="w-32 px-4 py-1.5 font-normal">来源</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((node) => (
                <tr
                  key={`${node.airportId}:${node.name}:${node.server}:${node.port}`}
                  className="border-b-[0.5px] border-border/60 transition-colors hover:bg-surface"
                >
                  <td className="max-w-0 truncate px-4 py-1 text-foreground">{node.name}</td>
                  <td className="px-3 py-1">
                    <span className="rounded-[3px] bg-muted px-1 py-px text-[10px] text-muted-foreground">
                      {node.type || '—'}
                    </span>
                  </td>
                  <td className="max-w-0 truncate px-3 py-1 font-mono text-[11px] text-muted-foreground">
                    {node.server}
                  </td>
                  <td className="px-3 py-1 text-right tabular-nums text-muted-foreground">
                    {node.port}
                  </td>
                  <td className="max-w-0 truncate px-4 py-1 text-muted-foreground">
                    {node.airportName}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
            {nodesQuery.isPending || list.isPending ? (
              <p className="text-[11px] text-muted-foreground">载入中</p>
            ) : airports.length === 0 ? (
              <>
                <p className="text-[13px] font-medium">还没有机场</p>
                <p className="max-w-xs text-[11px] leading-relaxed text-muted-foreground">
                  贴一个订阅链接进来，节点会拉下来存进数据库，配置里和下发的订阅都会用上它。
                </p>
                <Button variant="primary" onClick={() => setAdding(true)}>
                  添加第一个机场
                </Button>
              </>
            ) : (
              <p className="text-[11px] text-muted-foreground">
                {totalNodes > 0 ? '没有匹配的节点' : '这些机场还没有节点，点「全部刷新」拉一次'}
              </p>
            )}
          </div>
        )}
      </div>

      {active?.error && (
        <div className="flex shrink-0 items-center gap-2 border-t-[0.5px] border-border px-6 py-1.5 text-[11px] text-danger">
          <span>上次拉取失败：{active.error}</span>
          {active.nodeCount > 0 && (
            <span className="flex items-center gap-1 text-muted-foreground">
              <RiCheckLine className="size-3.5" />
              显示的是 {formatStamp(active.fetchedAt)} 缓存的节点
            </span>
          )}
        </div>
      )}
    </AppShell>
  );
}
