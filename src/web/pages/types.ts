export interface PageProps {
  token: string;
  path: string;
  /** 当前路由里的资源 id（配置 / 机场 / 节点池），没有则为 null。 */
  selectedId?: string | null;
  onNavigate: (to: string) => void;
  /** 地址修正（例如未知 id 回列表），不新增历史记录。 */
  onReplace: (to: string) => void;
  onReject: () => void;
}
