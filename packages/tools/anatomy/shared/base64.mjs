// Uint8Array-only compatibility for upstream turn-build; no global Buffer shim.
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
export function encodeBytesBase64(bytes) {
  if (!(bytes instanceof Uint8Array)) throw new TypeError('Se esperaba Uint8Array');
  let encoded = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i], b = bytes[i + 1] || 0, c = bytes[i + 2] || 0;
    encoded += ALPHABET[a >>> 2] + ALPHABET[((a & 3) << 4) | (b >>> 4)] + (i + 1 < bytes.length ? ALPHABET[((b & 15) << 2) | (c >>> 6)] : '=') + (i + 2 < bytes.length ? ALPHABET[c & 63] : '=');
  }
  return encoded;
}
