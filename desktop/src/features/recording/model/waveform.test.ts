import { describe, expect, it } from "vitest";
import { bucketPeaks, formatTime } from "./waveform";

describe("bucketPeaks", () => {
  it("returns zero bars for silence", () => {
    expect(bucketPeaks(new Float32Array(64), 8)).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
  });

  it("returns zero bars for empty input", () => {
    expect(bucketPeaks(new Float32Array(0), 8)).toEqual(new Array<number>(8).fill(0));
  });

  it("keeps the loudest sample per bucket and normalizes to 1", () => {
    const samples = new Float32Array([0, 0.5, -0.25, 0.5, -0.75]);

    const peaks = bucketPeaks(samples, 2);

    expect(peaks[0]).toBeCloseTo(0.5 / 0.75);
    expect(peaks[1]).toBeCloseTo(1);
  });

  it("handles fewer samples than buckets", () => {
    const peaks = bucketPeaks(new Float32Array([1]), 4);

    expect(peaks[0]).toBe(1);
    expect(peaks.slice(1)).toEqual([0, 0, 0]);
  });
});

describe("formatTime", () => {
  it("renders m:ss", () => {
    expect(formatTime(0)).toBe("0:00");
    expect(formatTime(65.4)).toBe("1:05");
    expect(formatTime(3600)).toBe("60:00");
  });
});
