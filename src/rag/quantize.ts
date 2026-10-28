export interface Quantized {
  v: string;
  s: number;
}

export function quantizeInt8(vec: Float32Array): Quantized {
  let max = 0;
  for (const x of vec) max = Math.max(max, Math.abs(x));
  const s = max === 0 ? 1 : max / 127;
  const q = new Int8Array(vec.length);
  for (let i = 0; i < vec.length; i++) q[i] = Math.round(vec[i]! / s);
  return { v: bytesToBase64(new Uint8Array(q.buffer)), s };
}

export function dequantizeInt8(v: string, s: number): Float32Array {
  const q = new Int8Array(base64ToBytes(v).buffer);
  const out = new Float32Array(q.length);
  for (let i = 0; i < q.length; i++) out[i] = q[i]! * s;
  return out;
}

export function normalize(vec: Float32Array): Float32Array {
  let n = 0;
  for (const x of vec) n += x * x;
  n = Math.sqrt(n);
  if (n > 0) for (let i = 0; i < vec.length; i++) vec[i]! /= n;
  return vec;
}

export function dot(a: Float32Array, b: Float32Array): number {
  let d = 0;
  for (let i = 0; i < a.length; i++) d += a[i]! * b[i]!;
  return d;
}

function bytesToBase64(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(bin);
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}
