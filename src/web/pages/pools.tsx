import {
  RiAddLine,
  RiCloseLine,
  RiDeleteBinLine,
  RiMagicLine,
  RiSearchLine,
} from '@remixicon/react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useBlocker } from '@tanstack/react-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import type {
  NodePoolDetail,
  NodePoolListResponse,
  NodePoolMember,
  NodePoolSummary,
  NodesResponse,
  NodeView,
} from '@/shared/schema';
import { AppShell } from '../components/app-shell';
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
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { ApiError, api } from '../lib/api';
import { cn } from '../lib/utils';
import type { PageProps } from './types';

const TONE_LABEL: Record<Tone, string> = {
  saved: '已保存',
  dirty: '有改动',
  saving: '保存中',
  error: '保存失败',
};

/** 节点身份：机场 + 名字 + 类型，和 Worker 里存的成员键一致。 */
function nodeKey(node: NodePoolMember | NodeView): string {
  return JSON.stringify([node.airportId, node.name, node.type]);
}

function sameSet(a: Set<string>, b: Set<string>): boolean {
  if (a.size !== b.size) return false;
  for (const value of a) if (!b.has(value)) return false;
  return true;
}

function HeaderCheckbox({
  checked,
  indeterminate,
  disabled,
  onChange,
}: {
  checked: boolean;
  indeterminate: boolean;
  disabled: boolean;
  onChange: () => void;
}) {
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (ref.current) ref.current.indeterminate = indeterminate;
  }, [indeterminate]);

  return (
    <input
      ref={ref}
      type="checkbox"
      checked={checked}
      disabled={disabled}
      onChange={onChange}
      aria-label="全选当前节点"
      className="size-3.5 accent-primary disabled:opacity-40"
    />
  );
}

export function PoolsPage({ token, path, selectedId, onNavigate, onReplace, onReject }: PageProps) {
  const queryClient = useQueryClient();
  const [nameDraft, setNameDraft] = useState('');
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
  const [savedKeys, setSavedKeys] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('all');
  const [airportFilter, setAirportFilter] = useState('');
  const [renderLimit, setRenderLimit] = useState(200);
  const [createOpen, setCreateOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const [createError, setCreateError] = useState('');
  const [ruleOpen, setRuleOpen] = useState(false);
  const [ruleAirport, setRuleAirport] = useState('');
  const [ruleType, setRuleType] = useState('all');
  const [ruleKeyword, setRuleKeyword] = useState('');
  const [ruleError, setRuleError] = useState('');
  const [error, setError] = useState('');
  /** 已经灌进本地选择的节点池 id：保存/改名只更新缓存，不重置正在编辑的选择。 */
  const syncedPoolId = useRef<string | null>(null);

  const list = useQuery({
    queryKey: ['pools'],
    queryFn: () => api.get<NodePoolListResponse>('/api/pools', token),
    retry: false,
    refetchOnWindowFocus: false,
  });

  const nodesQuery = useQuery({
    queryKey: ['nodes'],
    queryFn: () => api.get<NodesResponse>('/api/nodes', token),
    retry: false,
    refetchOnWindowFocus: false,
  });

  const pools = list.data?.pools ?? [];
  const active = pools.find((pool) => pool.id === selectedId) ?? null;
  const nodes = nodesQuery.data?.nodes ?? [];

  const detail = useQuery({
    queryKey: ['pool', selectedId],
    queryFn: () => api.get<NodePoolDetail>(`/api/pools/${selectedId}`, token),
    enabled: Boolean(selectedId),
    retry: false,
    refetchOnWindowFocus: false,
  });

  const loaded = detail.data && detail.data.id === selectedId ? detail.data : null;

  useEffect(() => {
    if (list.isPending || !selectedId || active) return;
    onReplace('/admin/pools');
  }, [list.isPending, selectedId, active, onReplace]);

  useEffect(() => {
    if (!loaded) return;
    setNameDraft(loaded.name);
    if (syncedPoolId.current !== loaded.id) {
      syncedPoolId.current = loaded.id;
      const keys = new Set(loaded.members.map(nodeKey));
      setSelectedKeys(keys);
      setSavedKeys(new Set(keys));
    }
    setError('');
  }, [loaded]);

  useEffect(() => {
    const failure = list.error ?? nodesQuery.error ?? detail.error;
    if (failure instanceof ApiError && failure.status === 401) onReject();
  }, [list.error, nodesQuery.error, detail.error, onReject]);

  const dirty = Boolean(loaded) && !sameSet(selectedKeys, savedKeys);

  const blocker = useBlocker({
    shouldBlockFn: () => dirty,
    withResolver: true,
    enableBeforeUnload: dirty,
  });

  useEffect(() => {
    if (blocker.status !== 'blocked') return;
    if (window.confirm('当前节点池的选择还没保存，离开会丢失。继续？')) blocker.proceed();
    else blocker.reset();
  }, [blocker]);

  const refreshPools = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['pools'] }),
      queryClient.invalidateQueries({ queryKey: ['overview'] }),
    ]);
  };

  const onMutationError = async (err: Error) => {
    setError(err.message);
    if (err instanceof ApiError && err.status === 401) onReject();
  };

  const openCreate = () => {
    setNewName('');
    setCreateError('');
    setCreateOpen(true);
  };

  const create = useMutation({
    mutationFn: () => api.post<NodePoolSummary>('/api/pools', token, { name: newName }),
    onSuccess: async (pool) => {
      setCreateOpen(false);
      setNewName('');
      setCreateError('');
      setError('');
      await refreshPools();
      onNavigate(`/admin/pools/${pool.id}`);
    },
    onError: (err: Error) => {
      setCreateError(err.message);
      if (err instanceof ApiError && err.status === 401) onReject();
    },
  });

  const rename = useMutation({
    mutationFn: (input: { id: string; name: string }) =>
      api.patch<NodePoolSummary>(`/api/pools/${input.id}`, token, { name: input.name }),
    onSuccess: async (updated, input) => {
      queryClient.setQueryData<NodePoolDetail>(['pool', input.id], (prev) =>
        prev ? { ...prev, name: input.name, updatedAt: updated.updatedAt } : prev,
      );
      setError('');
      await refreshPools();
    },
    onError: async (err: Error) => {
      setNameDraft(active?.name ?? '');
      await onMutationError(err);
      await refreshPools();
    },
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.del<{ ok: boolean }>(`/api/pools/${id}`, token),
    onSuccess: async (_data, id) => {
      queryClient.removeQueries({ queryKey: ['pool', id] });
      setError('');
      await refreshPools();
    },
    onError: onMutationError,
  });

  const reconcile = useMutation({
    mutationFn: () =>
      api.post<{ removed: number; nodeCount: number; availableCount: number; updatedAt: number }>(
        `/api/pools/${selectedId}/reconcile`,
        token,
      ),
    onSuccess: async (data) => {
      const prune = (keys: Set<string>) => new Set([...keys].filter((key) => nodeKeys.has(key)));
      setSelectedKeys((prev) => prune(prev));
      setSavedKeys((prev) => prune(prev));
      queryClient.setQueryData<NodePoolDetail>(['pool', selectedId], (prev) =>
        prev
          ? {
              ...prev,
              members: prev.members.filter((member) => nodeKeys.has(nodeKey(member))),
              nodeCount: data.nodeCount,
              availableCount: data.availableCount,
              updatedAt: data.updatedAt,
            }
          : prev,
      );
      setError('');
      await refreshPools();
    },
    onError: onMutationError,
  });

  const saveMembers = useMutation({
    mutationFn: (input: { members: NodePoolMember[]; expectedUpdatedAt: number | null }) =>
      api.put<{ ok: boolean; nodeCount: number; updatedAt: number }>(
        `/api/pools/${selectedId}/nodes`,
        token,
        input,
      ),
    onSuccess: async (data, input) => {
      setSavedKeys(new Set(input.members.map(nodeKey)));
      queryClient.setQueryData<NodePoolDetail>(['pool', selectedId], (prev) =>
        prev
          ? {
              ...prev,
              members: input.members,
              nodeCount: input.members.length,
              updatedAt: data.updatedAt,
            }
          : prev,
      );
      setError('');
      await refreshPools();
    },
    onError: onMutationError,
  });

  // biome-ignore lint/correctness/useExhaustiveDependencies: 筛选变化时重置显示数量
  useEffect(() => {
    setRenderLimit(200);
  }, [search, airportFilter, typeFilter, selectedId]);

  const nodeKeys = useMemo(() => new Set(nodes.map(nodeKey)), [nodes]);

  const airports = useMemo(() => {
    const map = new Map<string, string>();
    for (const node of nodes) map.set(node.airportId, node.airportName);
    return [...map.entries()].map(([id, name]) => ({ id, name }));
  }, [nodes]);

  useEffect(() => {
    if (airports.length === 0) return;
    if (airports.some((airport) => airport.id === airportFilter)) return;
    setAirportFilter(airports[0]?.id ?? '');
  }, [airports, airportFilter]);

  const types = useMemo(() => {
    const set = new Set(nodes.map((node) => node.type).filter(Boolean));
    return [...set].sort();
  }, [nodes]);

  const rows = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    return nodes.filter((node) => {
      if (airportFilter && node.airportId !== airportFilter) return false;
      if (typeFilter !== 'all' && node.type !== typeFilter) return false;
      if (!keyword) return true;
      return (
        node.name.toLowerCase().includes(keyword) || node.server.toLowerCase().includes(keyword)
      );
    });
  }, [nodes, airportFilter, typeFilter, search]);

  const selectPool = (id: string) => {
    if (id === selectedId) return;
    onNavigate(`/admin/pools/${id}`);
  };

  const toggle = (node: NodeView) => {
    const key = nodeKey(node);
    setSelectedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
    if (error) setError('');
  };

  const visibleSelected = rows.filter((node) => selectedKeys.has(nodeKey(node))).length;
  const allVisibleSelected = rows.length > 0 && visibleSelected === rows.length;
  const someVisibleSelected = visibleSelected > 0 && !allVisibleSelected;

  const toggleVisible = () => {
    setSelectedKeys((prev) => {
      const next = new Set(prev);
      for (const node of rows) {
        const key = nodeKey(node);
        if (allVisibleSelected) next.delete(key);
        else next.add(key);
      }
      return next;
    });
    if (error) setError('');
  };

  const submitSave = () => {
    if (!dirty || saveMembers.isPending) return;
    // 直接提交选择集：暂时不可用的成员（机场停用 / 节点改名）也保留，
    // 免得顺手保存一次就把它们静默删掉；要清理有单独的按钮。
    const members = [...selectedKeys].map((key) => {
      const [airportId, name, type] = JSON.parse(key) as [string, string, string];
      return { airportId, name, type };
    });
    saveMembers.mutate({ members, expectedUpdatedAt: loaded?.updatedAt ?? null });
  };

  const openRule = () => {
    setRuleAirport('');
    setRuleType('all');
    setRuleKeyword('');
    setRuleError('');
    setRuleOpen(true);
  };

  const applyRule = (mode: 'replace' | 'append') => {
    const keyword = ruleKeyword.trim().toLowerCase();
    const matches = nodes.filter((node) => {
      if (ruleAirport && node.airportId !== ruleAirport) return false;
      if (ruleType !== 'all' && node.type !== ruleType) return false;
      if (!keyword) return true;
      return (
        node.name.toLowerCase().includes(keyword) || node.server.toLowerCase().includes(keyword)
      );
    });

    if (matches.length === 0) {
      setRuleError('没有匹配的节点');
      return;
    }

    setSelectedKeys((prev) => {
      const next = mode === 'replace' ? new Set<string>() : new Set(prev);
      for (const node of matches) next.add(nodeKey(node));
      return next;
    });
    setRuleOpen(false);
    setError('');
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

  const confirmDelete = (pool: NodePoolSummary) => {
    if (!window.confirm(`删除节点池「${pool.name}」？正在使用它的配置需要先改成别的节点来源。`))
      return;
    remove.mutate(pool.id);
  };

  const tone: Tone = saveMembers.isPending ? 'saving' : error ? 'error' : dirty ? 'dirty' : 'saved';

  const sidebar = (
    <>
      <div className="flex h-12 shrink-0 items-center justify-between pr-2 pl-4">
        <div className="flex items-baseline gap-1.5">
          <span className="text-[12px] font-medium">节点池</span>
          <span className="text-[12px] tabular-nums text-muted-foreground">
            {list.isPending ? '…' : pools.length}
          </span>
        </div>
        <button
          type="button"
          title="新建节点池"
          onClick={openCreate}
          className="flex size-5 items-center justify-center rounded-control text-muted-foreground outline-none hover:bg-muted hover:text-foreground"
        >
          <RiAddLine className="size-3.5" />
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
        {pools.map((pool) => {
          const isActive = pool.id === selectedId;
          return (
            <div
              key={pool.id}
              className={cn(
                'group relative flex h-8 items-center rounded-control pr-7',
                isActive ? 'bg-accent' : 'hover:bg-muted',
              )}
            >
              <button
                type="button"
                onClick={() => selectPool(pool.id)}
                className={cn(
                  'min-w-0 flex-1 truncate px-2 text-left text-[13px]',
                  isActive ? 'text-accent-foreground' : 'text-foreground',
                )}
              >
                {pool.name}
              </button>
              <span
                className={cn(
                  'pointer-events-none absolute right-2 text-[12px] tabular-nums group-hover:opacity-0',
                  isActive ? 'text-accent-foreground/70' : 'text-muted-foreground',
                  pool.availableCount < pool.nodeCount && 'text-warning',
                )}
                title={`${pool.availableCount} 可用 / ${pool.nodeCount} 已选`}
              >
                {pool.availableCount}
              </span>
              <button
                type="button"
                title="删除节点池"
                onClick={() => confirmDelete(pool)}
                className="absolute right-1 flex size-5 items-center justify-center rounded-control text-muted-foreground opacity-0 outline-none hover:text-danger focus-visible:opacity-100 group-hover:opacity-100"
              >
                <RiDeleteBinLine className="size-3.5" />
              </button>
            </div>
          );
        })}

        {list.isPending && <p className="px-2 py-1 text-[12px] text-muted-foreground">载入中</p>}
        {!list.isPending && pools.length === 0 && (
          <p className="px-2 py-1 text-[12px] text-muted-foreground">还没有节点池</p>
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
              <Status tone={tone} label={TONE_LABEL[tone]} />
              <span className="tabular-nums">{selectedKeys.size} 个已选</span>
              <span className="tabular-nums">{nodes.length} 个节点</span>
              {active.nodeCount > active.availableCount && (
                <>
                  <span className="text-warning">
                    {active.nodeCount - active.availableCount} 个成员已失效
                  </span>
                  <button
                    type="button"
                    onClick={() => reconcile.mutate()}
                    disabled={reconcile.isPending}
                    className="text-[12px] text-muted-foreground underline-offset-2 outline-none hover:text-foreground hover:underline disabled:opacity-50"
                  >
                    {reconcile.isPending ? '清理中' : '清理失效成员'}
                  </button>
                </>
              )}
            </>
          }
          actions={
            <>
              <Button variant="outline" onClick={openRule}>
                <RiMagicLine className="size-3.5" />
                按规则选择
              </Button>
              <Button
                variant="primary"
                onClick={submitSave}
                disabled={!dirty || saveMembers.isPending}
              >
                {saveMembers.isPending ? '保存中' : '保存选择'}
              </Button>
            </>
          }
        />
      ) : (
        <PageHeader
          title="节点池"
          meta={<span className="tabular-nums">{nodes.length} 个节点</span>}
          actions={
            <Button variant="primary" onClick={openCreate}>
              <RiAddLine className="size-3.5" />
              新建节点池
            </Button>
          }
        />
      )}

      {error && (
        <div className="shrink-0 border-b-[0.5px] border-border px-6 py-1.5 text-[12px] text-danger">
          {error}
        </div>
      )}

      {active ? (
        <>
          <div className="flex shrink-0 flex-wrap items-center gap-2 border-b-[0.5px] border-border px-6 py-1.5">
            <RiSearchLine className="size-3.5 shrink-0 text-muted-foreground" />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="搜索节点名或服务器"
              aria-label="搜索节点"
              className="h-6 min-w-0 flex-1 bg-transparent text-[12px] text-foreground outline-none placeholder:text-muted-foreground"
            />
            <select
              value={airportFilter}
              onChange={(event) => setAirportFilter(event.target.value)}
              aria-label="机场"
              className="h-6 max-w-32 rounded-control bg-transparent px-1 text-[12px] text-muted-foreground outline-none hover:text-foreground"
            >
              {airports.map((airport) => (
                <option key={airport.id} value={airport.id}>
                  {airport.name}
                </option>
              ))}
            </select>
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
              {rows.length} / {nodes.length}
            </span>
          </div>

          <div className="min-h-0 flex-1 overflow-auto">
            {rows.length > 0 ? (
              <>
                <table className="w-full border-collapse text-[12px]">
                  <thead className="sticky top-0 z-10 bg-background">
                    <tr className="border-b-[0.5px] border-border text-left text-[12px] text-muted-foreground">
                      <th className="w-9 py-1.5 pl-6">
                        <HeaderCheckbox
                          checked={allVisibleSelected}
                          indeterminate={someVisibleSelected}
                          disabled={rows.length === 0}
                          onChange={toggleVisible}
                        />
                      </th>
                      <th className="px-2 py-1.5 font-normal">名称</th>
                      <th className="w-20 px-3 py-1.5 font-normal">类型</th>
                      <th className="px-3 py-1.5 font-normal">服务器</th>
                      <th className="w-16 px-3 py-1.5 text-right font-normal">端口</th>
                      <th className="w-32 py-1.5 pr-6 pl-3 font-normal">来源</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.slice(0, renderLimit).map((node) => {
                      const key = nodeKey(node);
                      const checked = selectedKeys.has(key);
                      return (
                        <tr
                          key={`${key}`}
                          onClick={() => toggle(node)}
                          title={node.airportEnabled ? undefined : '机场已停用，不会进入订阅'}
                          className={cn(
                            'cursor-pointer border-b-[0.5px] border-border/60',
                            checked ? 'bg-accent/60 hover:bg-accent' : 'hover:bg-surface',
                            !node.airportEnabled && 'opacity-50',
                          )}
                        >
                          <td className="py-1 pl-6">
                            <input
                              type="checkbox"
                              checked={checked}
                              onClick={(event) => event.stopPropagation()}
                              onChange={() => toggle(node)}
                              aria-label={`选择 ${node.name}`}
                              className="size-3.5 accent-primary"
                            />
                          </td>
                          <td className="max-w-0 truncate px-2 py-1 text-foreground">
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
                      );
                    })}
                  </tbody>
                </table>
                {rows.length > renderLimit && (
                  <div className="border-t-[0.5px] border-border px-6 py-2 text-center">
                    <button
                      type="button"
                      onClick={() => setRenderLimit((value) => value + 200)}
                      className="text-[12px] text-muted-foreground outline-none hover:text-foreground"
                    >
                      显示更多（剩余 {rows.length - renderLimit}）
                    </button>
                  </div>
                )}
              </>
            ) : (
              <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
                {nodesQuery.isPending ? (
                  <p className="text-[12px] text-muted-foreground">载入中</p>
                ) : nodes.length === 0 ? (
                  <p className="text-[13px] font-medium">还没有节点</p>
                ) : (
                  <p className="text-[12px] text-muted-foreground">没有匹配的节点</p>
                )}
              </div>
            )}
          </div>
        </>
      ) : (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
          {pools.length === 0 ? (
            <>
              <p className="text-[13px] font-medium">还没有节点池</p>
              <Button variant="primary" onClick={openCreate}>
                新建节点池
              </Button>
            </>
          ) : (
            <p className="text-[12px] text-muted-foreground">未选择节点池</p>
          )}
        </div>
      )}

      <DialogRoot
        open={ruleOpen}
        onOpenChange={(open) => {
          setRuleOpen(open);
          if (!open) setRuleError('');
        }}
      >
        <DialogContent>
          <div className="flex items-start justify-between gap-4">
            <DialogTitle>按规则选择</DialogTitle>
            <DialogClose
              render={
                <Button type="button" variant="ghost" size="icon" aria-label="关闭">
                  <RiCloseLine className="size-4" />
                </Button>
              }
            />
          </div>

          <div className="mt-4 space-y-3">
            <div>
              <Label htmlFor="rule-airport">机场</Label>
              <select
                id="rule-airport"
                value={ruleAirport}
                onChange={(event) => setRuleAirport(event.target.value)}
                className="mt-1.5 h-7 w-full rounded-control border-[0.5px] border-input bg-background px-2 text-[12px] text-foreground outline-none"
              >
                <option value="">全部机场</option>
                {airports.map((airport) => (
                  <option key={airport.id} value={airport.id}>
                    {airport.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <Label htmlFor="rule-type">类型</Label>
              <select
                id="rule-type"
                value={ruleType}
                onChange={(event) => setRuleType(event.target.value)}
                className="mt-1.5 h-7 w-full rounded-control border-[0.5px] border-input bg-background px-2 text-[12px] text-foreground outline-none"
              >
                <option value="all">全部类型</option>
                {types.map((type) => (
                  <option key={type} value={type}>
                    {type}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <Label htmlFor="rule-keyword">名称包含</Label>
              <Input
                id="rule-keyword"
                className="mt-1.5"
                value={ruleKeyword}
                onChange={(event) => setRuleKeyword(event.target.value)}
                placeholder="例如 US、0.5x"
              />
            </div>

            {ruleError && <p className="text-[12px] text-danger">{ruleError}</p>}
          </div>

          <DialogFooter className="mt-5">
            <DialogClose
              render={
                <Button type="button" variant="ghost">
                  取消
                </Button>
              }
            />
            <Button type="button" variant="outline" onClick={() => applyRule('replace')}>
              替换选择
            </Button>
            <Button type="button" variant="primary" onClick={() => applyRule('append')}>
              追加选择
            </Button>
          </DialogFooter>
        </DialogContent>
      </DialogRoot>

      <DialogRoot
        open={createOpen}
        onOpenChange={(open) => {
          setCreateOpen(open);
          if (!open) setCreateError('');
        }}
      >
        <DialogContent>
          <div className="flex items-start justify-between gap-4">
            <DialogTitle>新建节点池</DialogTitle>
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
              if (!newName.trim() || create.isPending) return;
              setCreateError('');
              create.mutate();
            }}
          >
            <Label htmlFor="pool-name">名称</Label>
            <Input
              id="pool-name"
              className="mt-1.5"
              value={newName}
              onChange={(event) => setNewName(event.target.value)}
              autoFocus
            />

            {createError && <p className="mt-3 text-[12px] text-danger">{createError}</p>}

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
                disabled={create.isPending || !newName.trim()}
              >
                {create.isPending ? '创建中' : '创建'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </DialogRoot>
    </AppShell>
  );
}
