export interface PageProps {
  token: string;
  path: string;
  onNavigate: (to: string) => void;
  onReject: () => void;
}
