/**
 * Latency is a flow-weighted histogram, not a single number. Each bucket is
 * "this much flow experienced this much latency". This replaces the
 * prototype's maxLat, which let a trickle path set p99 and meant a cache could
 * never improve it.
 */
export interface Bucket { lat: number; flow: number }
export type Buckets = Bucket[];

export function total(b: Buckets): number {
  let s = 0;
  for (let i = 0; i < b.length; i++) s += (b[i] as Bucket).flow;
  return s;
}
export function scaleTo(b: Buckets, target: number): Buckets {
  const t = total(b);
  if (!(t > 0) || !(target > 0)) return [];
  const k = target / t;
  return b.map((x) => ({ lat: x.lat, flow: x.flow * k }));
}
export function shift(b: Buckets, ms: number): Buckets {
  return b.map((x) => ({ lat: x.lat + ms, flow: x.flow }));
}

/** Merge two histograms, then coalesce to a bounded size. Deterministic. */
export function merge(a: Buckets, b: Buckets, maxBuckets: number): Buckets {
  if (b.length === 0) return a;
  if (a.length === 0) return b.slice();
  const all = a.concat(b).sort((x, y) => x.lat - y.lat);
  const out: Buckets = [];
  for (const x of all) {
    const last = out[out.length - 1];
    if (last && x.lat - last.lat < 1) {
      const f = last.flow + x.flow;
      last.lat = f > 0 ? (last.lat * last.flow + x.lat * x.flow) / f : last.lat;
      last.flow = f;
    } else out.push({ lat: x.lat, flow: x.flow });
  }
  while (out.length > maxBuckets) {
    let bi = 1, bg = Infinity;
    for (let i = 1; i < out.length; i++) {
      const g = (out[i] as Bucket).lat - (out[i - 1] as Bucket).lat;
      if (g < bg) { bg = g; bi = i; }
    }
    const l = out[bi - 1] as Bucket, r = out[bi] as Bucket;
    const f = l.flow + r.flow;
    l.lat = f > 0 ? (l.lat * l.flow + r.lat * r.flow) / f : l.lat;
    l.flow = f;
    out.splice(bi, 1);
  }
  return out;
}

export function percentile(b: Buckets, q: number): number {
  const t = total(b);
  if (!(t > 0)) return 0;
  const s = b.slice().sort((x, y) => x.lat - y.lat);
  const target = q * t;
  let cum = 0;
  for (const x of s) { cum += x.flow; if (cum >= target) return x.lat; }
  return (s[s.length - 1] as Bucket).lat;
}

export function flowAbove(b: Buckets, lat: number): number {
  let s = 0;
  for (const x of b) if (x.lat > lat) s += x.flow;
  return s;
}
export function flowBetween(b: Buckets, lo: number, hi: number): number {
  let s = 0;
  for (const x of b) if (x.lat > lo && x.lat <= hi) s += x.flow;
  return s;
}
