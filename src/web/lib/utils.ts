import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toFixed(1)} KB`;
}

export function formatTime(ts: number | null): string {
  if (!ts) return '';
  const date = new Date(ts);
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** 列表用的短时间：今天只给时分，更早给月-日。 */
export function formatStamp(ts: number | null): string {
  if (!ts) return '';
  const date = new Date(ts);
  const pad = (value: number) => String(value).padStart(2, '0');
  if (date.toDateString() === new Date().toDateString()) return formatTime(ts);
  return `${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}
