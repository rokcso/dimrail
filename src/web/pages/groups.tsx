import { RiAddLine, RiCheckLine, RiDeleteBinLine, RiLinkM, RiSearchLine } from '@remixicon/react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';
import type {
  NodeGroupDetail,
  NodeGroupListResponse,
  NodeGroupMember,
  NodeGroupSummary,
  NodesResponse,
  NodeView,
} from '@/shared/schema';
import { AppShell } from '../components/app-shell';
import { PageHeader } from '../components/page-header';
import { Dot, Status, type Tone } from '../components/status';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { ApiError, api } from '../lib/api';
import { cn, formatStamp } from '../lib/utils';
import type { PageProps } from './types';

const TONE_LABEL: Record<Tone, string> = {
  saved: '已保存',
  dirty: '有改动',
  saving: '保存中',
  error: '保存失败',
};

/** 节点身份：机场 + 名字 + 类型，和 Worker 里存的成员键一致。 */
function nodeKey(node: NodeGroupMember | NodeView): string {
  return JSON.stringify([node.airportId, node.name, node.type]);
}

function sameSet(a: Set<string>, b: Set<string>): boolean {
  if (a.size !== b.size) return false;
  for (const value of a) if (!b.has(value)) return false;
  return true;
}

export function GroupsPage({ token, path, onNavigate, onReject }: PageProps) {
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState<string | null>(null);
  const [nameDraft, setNameDraft] = useState('');
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
  const [savedKeys, setSavedKeys] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('all');
  const [airportFilter, setAirportFilter] = useState('all');
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState('');
  const [error, setError] = useState('');
  /** 已经灌进本地选择的节点组 id：保存/改名只更新缓存，不重置正在编辑的选择。 */
  const syncedGroupId = useRef<string | null>(null);

  const list = useQuery({
    queryKey: ['groups'],
    queryFn: () => api.get<NodeGroupListResponse>('/api/groups', token),
    retry: false,
    refetchOnWindowFocus: false,
  });

  const nodesQuery = useQuery({
    queryKey: ['nodes'],
    queryFn: () => api.get<NodesResponse>('/api/nodes', token),
    retry: false,
    refetchOnWindowFocus: false,
  });

  const groups = list.data?.groups ?? [];
  const active = groups.find((group) => group.id === selected) ?? null;
  const nodes = nodesQuery.data?.nodes ?? [];

  const detail = useQuery({
    queryKey: ['group', selected],
    queryFn: () => api.get<NodeGroupDetail>(`/api/groups/${selected}`, token),
    enabled: Boolean(selected),
    retry: false,
    refetchOnWindowFocus: false,
  });

  const loaded = detail.data && detail.data.id === selected ? detail.data : null;

  useEffect(() => {
    if (!loaded) return;
    setNameDraft(loaded.name);
    if (syncedGroupId.current !== loaded.id) {
      syncedGroupId.current = loaded.id;
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

  useEffect(() => {
    if (!dirty) return;
    const handler = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty]);

  const refreshGroups = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['groups'] }),
      queryClient.invalidateQueries({ queryKey: ['overview'] }),
    ]);
  };

  const onMutationError = async (err: Error) => {
    setError(err.message);
    if (err instanceof ApiError && err.status === 401) onReject();
  };

  const create = useMutation({
    mutationFn: () => api.post<NodeGroupSummary>('/api/groups', token, { name: newName }),
    onSuccess: async (group) => {
      setAdding(false);
      setNewName('');
      setError('');
      setSelected(group.id);
      await refreshGroups();
    },
    onError: onMutationError,
  });

  const rename = useMutation({
    mutationFn: (input: { id: string; name: string }) =>
      api.patch<NodeGroupSummary>(`/api/groups/${input.id}`, token, { name: input.name }),
    onSuccess: async (_updated, input) => {
      queryClient.setQueryData<NodeGroupDetail>(['group', input.id], (prev) =>
        prev ? { ...prev, name: input.name, updatedAt: Date.now() } : prev,
      );
      setError('');
      await refreshGroups();
    },
    onError: async (err: Error) => {
      setNameDraft(active?.name ?? '');
      await onMutationError(err);
      await refreshGroups();
    },
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.del<{ ok: boolean }>(`/api/groups/${id}`, token),
    onSuccess: async (_data, id) => {
      queryClient.removeQueries({ queryKey: ['group', id] });
      if (selected === id) setSelected(null);
      setError('');
      await refreshGroups();
    },
    onError: onMutationError,
  });

  const saveMembers = useMutation({
    mutationFn: (members: NodeGroupMember[]) =>
      api.put<{ ok: boolean; nodeCount: number }>(`/api/groups/${selected}/nodes`, token, {
        members,
      }),
    onSuccess: async (_data, members) => {
      setSavedKeys(new Set(members.map(nodeKey)));
      queryClient.setQueryData<NodeGroupDetail>(['group', selected], (prev) =>
        prev ? { ...prev, members, nodeCount: members.length, updatedAt: Date.now() } : prev,
      );
      setError('');
      await refreshGroups();
    },
    onError: onMutationError,
  });

  const nodeKeys = useMemo(() => new Set(nodes.map(nodeKey)), [nodes]);

  const staleCount = [...selectedKeys].filter((key) => !nodeKeys.has(key)).length;

  const airports = useMemo(() => {
    const map = new Map<string, string>();
    for (const node of nodes) map.set(node.airportId, node.airportName);
    return [...map.entries()].map(([id, name]) => ({ id, name }));
  }, [nodes]);

  const types = useMemo(() => {
    const set = new Set(nodes.map((node) => node.type).filter(Boolean));
    return [...set].sort();
  }, [nodes]);

  const rows = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    return nodes.filter((node) => {
      if (airportFilter !== 'all' && node.airportId !== airportFilter) return false;
      if (typeFilter !== 'all' && node.type !== typeFilter) return false;
      if (!keyword) return true;
      return (
        node.name.toLowerCase().includes(keyword) || node.server.toLowerCase().includes(keyword)
      );
    });
  }, [nodes, airportFilter, typeFilter, search]);

  const selectGroup = (id: string) => {
    if (id === selected) return;
    if (dirty && !window.confirm('当前节点组的选择还没保存，切换后会丢失。继续？')) return;
    setSelected(id);
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

  const selectVisible = () => {
    setSelectedKeys((prev) => {
      const next = new Set(prev);
      for (const node of rows) next.add(nodeKey(node));
      return next;
    });
  };

  const clearVisible = () => {
    setSelectedKeys((prev) => {
      const next = new Set(prev);
      for (const node of rows) next.delete(nodeKey(node));
      return next;
    });
  };

  const submitSave = () => {
    if (!dirty || saveMembers.isPending) return;
    // 直接提交选择集：暂时不可用的成员（机场停用 / 节点改名）也保留，
    // 免得顺手保存一次就把它们静默删掉；要清理有单独的按钮。
    const members = [...selectedKeys].map((key) => {
      const [airportId, name, type] = JSON.parse(key) as [string, string, string];
      return { airportId, name, type };
    });
    saveMembers.mutate(members);
  };

  const dropStale = () => {
    setSelectedKeys((prev) => new Set([...prev].filter((key) => nodeKeys.has(key))));
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

  const confirmDelete = (group: NodeGroupSummary) => {
    const hint = '正在使用这个节点组的配置需要先改成别的来源，否则删除会被拒绝。';
    if (!window.confirm(`删除节点组「${group.name}」？\n\n${hint}`)) return;
    remove.mutate(group.id);
  };

  const tone: Tone = saveMembers.isPending ? 'saving' : error ? 'error' : dirty ? 'dirty' : 'saved';

  const sidebar = (
    <>
      <div className="flex h-12 shrink-0 items-center justify-between px-3">
        <div className="flex items-baseline gap-1.5">
          <span className="text-[11px] font-medium">节点组</span>
          <span className="text-[11px] tabular-nums text-muted-foreground">
            {list.isPending ? '…' : groups.length}
          </span>
        </div>
        <button
          type="button"
          title="新建节点组"
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
        {groups.map((group) => {
          const isActive = group.id === selected;
          return (
            <div
              key={group.id}
              className={cn(
                'group relative flex h-8 items-center rounded-control pr-7',
                isActive ? 'bg-accent' : 'hover:bg-muted',
              )}
            >
              <button
                type="button"
                onClick={() => selectGroup(group.id)}
                className={cn(
                  'min-w-0 flex-1 truncate px-2 text-left text-[13px]',
                  isActive ? 'text-accent-foreground' : 'text-foreground',
                )}
              >
                {group.name}
              </button>
              <span
                className={cn(
                  'pointer-events-none absolute right-2 text-[11px] tabular-nums transition-opacity duration-150 group-hover:opacity-0',
                  isActive ? 'text-accent-foreground/70' : 'text-muted-foreground',
                )}
              >
                {group.nodeCount}
              </span>
              <button
                type="button"
                title="删除节点组"
                onClick={() => confirmDelete(group)}
                className="absolute right-1 flex size-5 items-center justify-center rounded-control text-muted-foreground opacity-0 outline-none transition-opacity duration-150 hover:text-danger focus-visible:opacity-100 group-hover:opacity-100"
              >
                <RiDeleteBinLine className="size-3.5" />
              </button>
            </div>
          );
        })}

        {list.isPending && <p className="px-2 py-1 text-[11px] text-muted-foreground">载入中</p>}
        {!list.isPending && groups.length === 0 && (
          <p className="px-2 py-1 text-[11px] text-muted-foreground">还没有节点组</p>
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
              className="-mx-1.5 w-full max-w-sm rounded-control bg-transparent px-1.5 text-[15px] font-medium tracking-tight text-foreground outline-none transition-colors hover:bg-muted focus:bg-muted"
            />
          }
          meta={
            <>
              <Status tone={tone} label={TONE_LABEL[tone]} />
              <Dot />
              <span className="tabular-nums">
                {selectedKeys.size} 个已选 · {nodes.length} 个可用
              </span>
              {staleCount > 0 && (
                <>
                  <Dot />
                  <span className="text-warning">{staleCount} 个已选节点当前不可用</span>
                  <button
                    type="button"
                    onClick={dropStale}
                    className="text-[11px] text-muted-foreground underline-offset-2 outline-none hover:text-foreground hover:underline"
                  >
                    清理
                  </button>
                </>
              )}
            </>
          }
          actions={
            <>
              <span className="mr-1 text-[11px] tabular-nums text-muted-foreground">
                更新于 {formatStamp(active.updatedAt)}
              </span>
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
          title="节点组合"
          meta={
            <>
              <span className="tabular-nums">
                {list.isPending ? '载入中' : `${groups.length} 个节点组`}
              </span>
              <Dot />
              <span className="tabular-nums">{nodes.length} 个可用节点</span>
            </>
          }
          actions={
            <Button variant="primary" size="sm" onClick={() => setAdding(true)}>
              <RiAddLine className="size-3.5" />
              新建节点组
            </Button>
          }
        />
      )}

      {adding && (
        <form
          className="flex shrink-0 items-center gap-2 border-b-[0.5px] border-border px-4 py-2"
          onSubmit={(event) => {
            event.preventDefault();
            if (!newName.trim() || create.isPending) return;
            setError('');
            create.mutate();
          }}
        >
          <Input
            value={newName}
            onChange={(event) => setNewName(event.target.value)}
            placeholder="节点组名字，会出现在客户端"
            aria-label="节点组名字"
            className="w-64"
            autoFocus
          />
          <Button
            type="submit"
            variant="primary"
            size="sm"
            disabled={create.isPending || !newName.trim()}
          >
            {create.isPending ? '创建中' : '创建'}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => {
              setAdding(false);
              setNewName('');
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

      {active ? (
        <>
          <div className="flex shrink-0 flex-wrap items-center gap-2 border-b-[0.5px] border-border px-4 py-1.5">
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
              className="h-6 max-w-32 rounded-control bg-transparent px-1 text-[11px] text-muted-foreground outline-none hover:text-foreground"
            >
              <option value="all">全部机场</option>
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
              {rows.length} / {nodes.length}
            </span>
            <span className="mx-1 h-3 w-px bg-border" aria-hidden />
            <button
              type="button"
              onClick={selectVisible}
              className="text-[11px] text-muted-foreground outline-none transition-colors hover:text-foreground"
            >
              全选筛选结果
            </button>
            <button
              type="button"
              onClick={clearVisible}
              className="text-[11px] text-muted-foreground outline-none transition-colors hover:text-foreground"
            >
              清空筛选结果
            </button>
          </div>

          <div className="min-h-0 flex-1 overflow-auto">
            {rows.length > 0 ? (
              <table className="w-full border-collapse text-[12px]">
                <thead className="sticky top-0 z-10 bg-background">
                  <tr className="border-b-[0.5px] border-border text-left text-[11px] text-muted-foreground">
                    <th className="w-9 py-1.5 pl-4">
                      <span className="sr-only">选择</span>
                    </th>
                    <th className="px-2 py-1.5 font-normal">名称</th>
                    <th className="w-20 px-3 py-1.5 font-normal">类型</th>
                    <th className="px-3 py-1.5 font-normal">服务器</th>
                    <th className="w-16 px-3 py-1.5 text-right font-normal">端口</th>
                    <th className="w-32 px-4 py-1.5 font-normal">来源</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((node) => {
                    const key = nodeKey(node);
                    const checked = selectedKeys.has(key);
                    return (
                      <tr
                        key={`${key}`}
                        onClick={() => toggle(node)}
                        className={cn(
                          'cursor-pointer border-b-[0.5px] border-border/60 transition-colors',
                          checked ? 'bg-accent/60 hover:bg-accent' : 'hover:bg-surface',
                        )}
                      >
                        <td className="py-1 pl-4">
                          <input
                            type="checkbox"
                            checked={checked}
                            onClick={(event) => event.stopPropagation()}
                            onChange={() => toggle(node)}
                            aria-label={`选择 ${node.name}`}
                            className="size-3.5 accent-[var(--grass-11)]"
                          />
                        </td>
                        <td className="max-w-0 truncate px-2 py-1 text-foreground">{node.name}</td>
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
                    );
                  })}
                </tbody>
              </table>
            ) : (
              <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
                {nodesQuery.isPending ? (
                  <p className="text-[11px] text-muted-foreground">载入中</p>
                ) : nodes.length === 0 ? (
                  <>
                    <p className="text-[13px] font-medium">还没有可用节点</p>
                    <p className="max-w-xs text-[11px] leading-relaxed text-muted-foreground">
                      先到「机场」添加订阅并拉取节点，再回来圈选。
                    </p>
                  </>
                ) : (
                  <p className="text-[11px] text-muted-foreground">没有匹配的节点</p>
                )}
              </div>
            )}
          </div>
        </>
      ) : (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
          {groups.length === 0 ? (
            <>
              <RiLinkM className="size-5 text-muted-foreground" />
              <p className="text-[13px] font-medium">还没有节点组</p>
              <p className="max-w-sm text-[11px] leading-relaxed text-muted-foreground">
                节点组是一组手选节点的集合，可以跨机场。在配置页把某份配置的节点来源设成节点组，
                客户端就只会拿到这一组节点。
              </p>
              <Button variant="primary" onClick={() => setAdding(true)}>
                新建节点组
              </Button>
            </>
          ) : (
            <>
              <RiCheckLine className="size-5 text-muted-foreground" />
              <p className="text-[11px] text-muted-foreground">
                从左侧选择一个节点组，或者新建一个。
              </p>
            </>
          )}
        </div>
      )}
    </AppShell>
  );
}
