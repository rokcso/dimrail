/** 去掉 l/i/o/0/1，链接里的 id 好念也好抄。 */
const ID_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';

export function generateId(length = 8): string {
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  let id = '';
  for (const byte of bytes) id += ID_ALPHABET.charAt(byte % ID_ALPHABET.length);
  return id;
}

/** 订阅密钥：18 字节随机 → 36 位十六进制。 */
export function generateToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(18));
  let token = '';
  for (const byte of bytes) token += byte.toString(16).padStart(2, '0');
  return token;
}
