import { describe, expect, it } from 'vitest';
import { generateId, generateToken } from '@/worker/config-store';

describe('generateId', () => {
  it('固定长度且只用链接安全字符', () => {
    for (let i = 0; i < 50; i += 1) {
      const id = generateId();
      expect(id).toHaveLength(8);
      expect(id).toMatch(/^[a-z2-9]+$/);
      // 容易看错的字符不进 id
      expect(id).not.toMatch(/[ilo01]/);
    }
  });

  it('不重复', () => {
    const ids = new Set(Array.from({ length: 500 }, () => generateId()));
    expect(ids.size).toBe(500);
  });
});

describe('generateToken', () => {
  it('36 位十六进制，且不重复', () => {
    const token = generateToken();
    expect(token).toMatch(/^[0-9a-f]{36}$/);
    expect(generateToken()).not.toBe(token);
  });
});
