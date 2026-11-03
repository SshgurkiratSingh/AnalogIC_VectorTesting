/**
 * DSP / signal processing utilities for in-browser parameter extraction.
 */

import { SweepPoint } from '@/types/protocol';

/**
 * Compute the linear regression (least-squares) slope & intercept of y vs x.
 */
export function linregress(xs: number[], ys: number[]): { slope: number; intercept: number; r2: number } {
  const n = xs.length;
  if (n < 2) return { slope: 0, intercept: 0, r2: 0 };
  const meanX = xs.reduce((a, b) => a + b, 0) / n;
  const meanY = ys.reduce((a, b) => a + b, 0) / n;
  let ssXY = 0, ssXX = 0, ssYY = 0;
  for (let i = 0; i < n; i++) {
    ssXY += (xs[i] - meanX) * (ys[i] - meanY);
    ssXX += (xs[i] - meanX) ** 2;
    ssYY += (ys[i] - meanY) ** 2;
  }
  const slope = ssXX === 0 ? 0 : ssXY / ssXX;
  const intercept = meanY - slope * meanX;
  const r2 = ssYY === 0 ? 1 : (ssXY ** 2) / (ssXX * ssYY);
  return { slope, intercept, r2 };
}

/** Compute closed-loop gain (Vout/Vin) for each sweep point, filtering near-zero inputs. */
export function computeGains(pts: SweepPoint[]): number[] {
  return pts.map(p => (Math.abs(p.vin) < 0.01 ? 0 : p.vout / p.vin));
}

/** Linear gain to dB. */
export function gainTodB(linear: number): number {
  if (linear <= 0) return -Infinity;
  return 20 * Math.log10(Math.abs(linear));
}

/** Estimate input offset voltage from zero-differential test (mV). */
export function estimateVos(vDiff: number, benchGain: number): number {
  return (vDiff / benchGain) * 1000; // mV
}

/** Compute simple n-point moving average. */
export function movingAverage(data: number[], n: number): number[] {
  return data.map((_, i) => {
    const start = Math.max(0, i - n + 1);
    const slice = data.slice(start, i + 1);
    return slice.reduce((a, b) => a + b, 0) / slice.length;
  });
}

/** Estimate slew rate (V/µs) from the steepest consecutive pair in a sweep. */
export function estimateSlewRate(pts: SweepPoint[]): number {
  let maxSlew = 0;
  for (let i = 1; i < pts.length; i++) {
    const dvout = Math.abs(pts[i].vout - pts[i - 1].vout);
    const dts = (pts[i].timestamp ?? i) - (pts[i - 1].timestamp ?? i - 1);
    if (dts > 0) {
      const slew = dvout / (dts * 1e-3); // convert ms→µs if timestamp in ms
      if (slew > maxSlew) maxSlew = slew;
    }
  }
  return maxSlew;
}

/** Export sweep data as a CSV string. */
export function sweepToCSV(pts: SweepPoint[]): string {
  const header = 'vin_V,vout_V,gain';
  const rows = pts.map(p => `${p.vin.toFixed(5)},${p.vout.toFixed(5)},${(p.gain ?? (p.vin !== 0 ? p.vout / p.vin : 0)).toFixed(4)}`);
  return [header, ...rows].join('\n');
}

/** Trigger a browser download of a string as a file. */
export function downloadString(content: string, filename: string, mime = 'text/csv') {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/** Format a timestamp offset (ms) as HH:MM:SS.mmm */
export function formatTs(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600).toString().padStart(2, '0');
  const m = Math.floor((totalSec % 3600) / 60).toString().padStart(2, '0');
  const s = (totalSec % 60).toString().padStart(2, '0');
  const msStr = (ms % 1000).toString().padStart(3, '0');
  return `${h}:${m}:${s}.${msStr}`;
}
