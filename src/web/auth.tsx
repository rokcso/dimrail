import { useMutation, useQueryClient } from '@tanstack/react-query';
import { createContext, type ReactNode, useCallback, useContext, useState } from 'react';
import type { ConfigListResponse } from '@/shared/schema';
import { Button } from './components/ui/button';
import { Input } from './components/ui/input';
import { ApiError, api } from './lib/api';

const TOKEN_KEY = 'dimrail-admin-token';

interface AuthValue {
  token: string;
  reject: () => void;
}

const AuthContext = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [token, setToken] = useState(() => localStorage.getItem(TOKEN_KEY) ?? '');

  const reject = useCallback(() => {
    localStorage.removeItem(TOKEN_KEY);
    queryClient.clear();
    setToken('');
  }, [queryClient]);

  if (!token) {
    return (
      <Gate
        onAccept={(value) => {
          localStorage.setItem(TOKEN_KEY, value);
          setToken(value);
        }}
      />
    );
  }

  return <AuthContext.Provider value={{ token, reject }}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error('AuthProvider 未挂载');
  return value;
}

function Gate({ onAccept }: { onAccept: (token: string) => void }) {
  const [value, setValue] = useState('');
  const [error, setError] = useState('');

  const check = useMutation({
    mutationFn: async (token: string) => {
      await api.get<ConfigListResponse>('/api/configs', token);
      return token;
    },
    onSuccess: onAccept,
    onError: (err: Error) => {
      setError(err instanceof ApiError && err.status === 401 ? '口令不对' : err.message);
    },
  });

  return (
    <div className="flex h-full items-center justify-center px-6 pb-16">
      <form
        className="w-full max-w-[288px]"
        onSubmit={(event) => {
          event.preventDefault();
          if (!value.trim()) return;
          setError('');
          check.mutate(value.trim());
        }}
      >
        <div className="flex items-center gap-2">
          <img src="/favicon.svg" alt="" className="size-5" />
          <span className="text-[15px] font-semibold tracking-tight">Dimrail</span>
        </div>

        <Input
          type="password"
          autoComplete="current-password"
          autoFocus
          aria-label="管理口令"
          placeholder="管理口令"
          className="mt-6 h-8 text-[13px]"
          value={value}
          onChange={(event) => {
            setValue(event.target.value);
            if (error) setError('');
          }}
        />

        <Button
          type="submit"
          variant="primary"
          className="mt-2 h-8 w-full text-[13px]"
          disabled={check.isPending || !value.trim()}
        >
          {check.isPending ? '校验中' : '进入'}
        </Button>

        {error && <p className="mt-2.5 text-[12px] text-danger">{error}</p>}
      </form>
    </div>
  );
}
