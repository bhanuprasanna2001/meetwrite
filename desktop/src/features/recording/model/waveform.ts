/**
 * Waveform math for the audio player: the saved recording is decoded by the
 * browser's AudioContext and reduced to a handful of peak buckets, which the
 * canvas draws as the classic red bar waveform.
 */

/** How many bars the player's waveform draws — thin bars need a lot. */
export const WAVEFORM_BUCKETS = 160;

/** The loudest sample magnitude per bucket, normalized to 0..1. */
export function bucketPeaks(samples: Float32Array, buckets: number): number[] {
  const peaks = new Array<number>(buckets).fill(0);
  if (samples.length === 0 || buckets === 0) return peaks;
  const width = samples.length / buckets;
  for (let bucket = 0; bucket < buckets; bucket += 1) {
    const start = Math.ceil(bucket * width);
    const end = Math.max(start + 1, Math.ceil((bucket + 1) * width));
    let peak = 0;
    for (let index = start; index < Math.min(end, samples.length); index += 1) {
      peak = Math.max(peak, Math.abs(samples[index]));
    }
    peaks[bucket] = peak;
  }
  const loudest = Math.max(...peaks);
  return loudest === 0 ? peaks : peaks.map((peak) => peak / loudest);
}

/** 0:00-style timestamps for the player. */
export { formatTime } from "../../../shared/lib/time";
