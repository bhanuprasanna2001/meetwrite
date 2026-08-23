import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type MouseEvent,
} from "react";
import {
  entryAudioFileUrl,
  getEntryAudio,
  getEntryAudioFile,
} from "../../../shared/api/sidecar";
import { bucketPeaks, formatTime, WAVEFORM_BUCKETS } from "../model/waveform";
import { AUDIO_BOX, CloseIcon } from "../../../shared/ui/meetingBox";
import { log } from "../../../shared/lib/logger";

/**
 * The audio box: the entry's saved recording as a minimal red-bar player.
 * A circle play/pause button, the waveform (played part full red, the rest
 * a whisper), and a time readout. Every recording appends, so the waveform
 * only ever grows.
 */

/** The app's accent red (Tailwind red-500) and its played-out whisper. */
const WAVE_RED = "#ef4444";
const WAVE_MUTE = "rgba(239, 68, 68, 0.22)";

interface AudioBoxProps {
  entryId: number;
  recording: boolean;
  /** When present, an explicit close control (collapse is never an outside click). */
  onClose?: () => void;
}

/** Decode the WAV into waveform bars (peaks normalized to 0..1). */
async function decodePeaks(entryId: number): Promise<number[]> {
  const context = new AudioContext();
  try {
    const decoded = await context.decodeAudioData(await getEntryAudioFile(entryId));
    return bucketPeaks(decoded.getChannelData(0), WAVEFORM_BUCKETS);
  } finally {
    void context.close();
  }
}

/** Paint the bars: the played portion full red, the rest a whisper. */
function drawWave(canvas: HTMLCanvasElement, peaks: number[], progress: number): void {
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  const scale = window.devicePixelRatio || 1;
  canvas.width = Math.round(width * scale);
  canvas.height = Math.round(height * scale);
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.scale(scale, scale);
  ctx.clearRect(0, 0, width, height);

  const step = width / peaks.length;
  const gap = Math.max(0.75, step * 0.28);
  const drawBars = (color: string) => {
    for (let index = 0; index < peaks.length; index += 1) {
      // 6 px of air above and below, so the bars never touch the edges.
      const barHeight = Math.max(2, peaks[index] * (height - 12));
      const x = index * step + gap / 2;
      const y = (height - barHeight) / 2;
      const barWidth = step - gap;
      ctx.fillStyle = color;
      ctx.beginPath();
      if (typeof ctx.roundRect === "function") {
        ctx.roundRect(x, y, barWidth, barHeight, barWidth / 2);
      } else {
        ctx.rect(x, y, barWidth, barHeight);
      }
      ctx.fill();
    }
  };
  drawBars(WAVE_MUTE);
  const playedX = Math.min(1, Math.max(0, progress)) * width;
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, playedX, height);
  ctx.clip();
  drawBars(WAVE_RED);
  ctx.restore();
}

function PlayGlyph() {
  return (
    <svg className="ml-0.5 h-3 w-3" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M4 2.5v11l9-5.5-9-5.5Z" fill="currentColor" />
    </svg>
  );
}

function PauseGlyph() {
  return (
    <svg className="h-3 w-3" viewBox="0 0 16 16" aria-hidden="true">
      <rect x="3.5" y="2.5" width="3" height="11" rx="1" fill="currentColor" />
      <rect x="9.5" y="2.5" width="3" height="11" rx="1" fill="currentColor" />
    </svg>
  );
}

export default function AudioBox({ entryId, recording, onClose }: AudioBoxProps) {
  const [durationS, setDurationS] = useState<number | null>(null);
  const [peaks, setPeaks] = useState<number[] | null>(null);
  const [playing, setPlaying] = useState(false);
  const [timeS, setTimeS] = useState(0);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const peaksRef = useRef<number[] | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const frameRef = useRef<number | null>(null);
  const loadIdRef = useRef(0);
  const playIdRef = useRef(0);

  /** One shared paint: the rAF loop (while playing) and resize both use it. */
  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const peaksNow = peaksRef.current;
    if (!canvas || !peaksNow) return;
    const audio = audioRef.current;
    const duration = audio?.duration ?? 0;
    drawWave(canvas, peaksNow, audio && duration ? audio.currentTime / duration : 0);
  }, []);

  const stopPlayback = useCallback(() => {
    ++playIdRef.current;
    const audio = audioRef.current;
    if (frameRef.current !== null) {
      cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    }
    if (audio) {
      audio.pause();
      audio.currentTime = 0;
    }
    setPlaying(false);
    setTimeS(0);
    draw();
  }, [draw]);

  const onTime = useCallback(() => {
    setTimeS(audioRef.current?.currentTime ?? 0);
  }, []);

  const tick = useCallback(function animate() {
    if (audioRef.current) {
      draw();
      frameRef.current = requestAnimationFrame(animate);
    }
  }, [draw]);

  const load = useCallback(async () => {
    const loadId = ++loadIdRef.current;
    const previous = audioRef.current;
    if (previous) {
      previous.pause();
      previous.removeEventListener("ended", stopPlayback);
      previous.removeEventListener("timeupdate", onTime);
    }
    audioRef.current = null;
    peaksRef.current = null;
    setDurationS(null);
    setPeaks(null);
    setPlaying(false);
    setTimeS(0);

    const duration = await getEntryAudio(entryId).catch(() => null);
    if (loadId !== loadIdRef.current) return;
    setDurationS(duration);
    if (!duration) return; // Nothing recorded yet — the player stays at 0:00.

    const audio = new Audio(entryAudioFileUrl(entryId));
    audio.addEventListener("ended", stopPlayback);
    audio.addEventListener("timeupdate", onTime);
    if (loadId === loadIdRef.current) audioRef.current = audio;
    const decoded = await decodePeaks(entryId).catch(() => null);
    if (loadId !== loadIdRef.current) return;
    if (decoded === null) log.warn("audio.waveform_decode_failed", { entryId });
    peaksRef.current = decoded;
    setPeaks(decoded);
  }, [entryId, onTime, stopPlayback]);

  useEffect(() => {
    void load();
  }, [load]);

  // A stopped recording grew the file — reload so the waveform catches up.
  const wasRecording = useRef(false);
  useEffect(() => {
    const justStopped = wasRecording.current && !recording;
    wasRecording.current = recording;
    if (justStopped) void load();
  }, [recording, load]);

  // Draw on load and whenever the box resizes.
  useEffect(() => {
    if (!peaks) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    draw();
    const observer = new ResizeObserver(() => draw());
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [peaks, draw]);

  useEffect(
    () => () => {
      const audio = audioRef.current;
      if (audio) {
        audio.pause();
        audio.removeEventListener("ended", stopPlayback);
        audio.removeEventListener("timeupdate", onTime);
      }
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    },
    [onTime, stopPlayback],
  );

  const toggle = () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) {
      const playId = ++playIdRef.current;
      void audio.play()
        .then(() => {
          if (playId !== playIdRef.current || audioRef.current !== audio) return;
          setPlaying(true);
          frameRef.current = requestAnimationFrame(tick);
        })
        .catch((error) => {
          if (playId !== playIdRef.current) return;
          setPlaying(false);
          log.warn("audio.play_failed", { entryId }, error);
        });
    } else {
      ++playIdRef.current;
      audio.pause();
      setPlaying(false);
      if (frameRef.current !== null) {
        cancelAnimationFrame(frameRef.current);
        frameRef.current = null;
      }
      draw();
    }
  };

  const seek = (event: MouseEvent<HTMLCanvasElement>) => {
    const audio = audioRef.current;
    const canvas = canvasRef.current;
    const duration = audio?.duration ?? 0;
    if (!audio || !canvas || !duration) return;
    audio.currentTime = (event.nativeEvent.offsetX / canvas.clientWidth) * duration;
    setTimeS(audio.currentTime);
    draw();
  };

  const ready = peaks !== null;

  return (
    <section className={AUDIO_BOX} aria-label="Audio">
      <div className="flex h-full items-center gap-3">
        <button
          type="button"
          onClick={toggle}
          disabled={!ready}
          aria-label={playing ? "Pause" : "Play"}
          className="flex h-8 w-8 flex-none cursor-pointer items-center justify-center rounded-full bg-red-500 text-ink hover:bg-red-600 disabled:cursor-default disabled:opacity-40 dark:text-paper"
        >
          {playing ? <PauseGlyph /> : <PlayGlyph />}
        </button>
        <canvas
          ref={canvasRef}
          onClick={seek}
          className="h-full min-w-0 flex-1 cursor-pointer"
        />
        <span className="flex-none text-[11px] font-medium tabular-nums text-ink-mute dark:text-paper-mute">
          {formatTime(timeS)} / {formatTime(durationS ?? 0)}
        </span>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            aria-label="Close audio"
            title="Close audio"
            className="flex h-6 w-6 flex-none cursor-pointer items-center justify-center rounded text-ink-faint hover:text-ink dark:text-paper-mute dark:hover:text-paper"
          >
            <CloseIcon />
          </button>
        )}
      </div>
    </section>
  );
}
