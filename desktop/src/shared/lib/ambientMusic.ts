import { log } from "./logger";

/**
 * The setup playlist — three open-licensed lo-fi tracks that play while the
 * onboarding screen is open and stop the moment it closes.
 *
 * The files live in public/music (bundled, no network); licenses and
 * sources are in public/music/CREDITS.md and Settings → About.
 */

export interface Track {
  /** File name under public/music/. */
  file: string;
  title: string;
  artist: string;
  /** The open license the track ships under. */
  license: string;
  /** Where the track came from, for verification. */
  source: string;
}

export const TRACKS: Track[] = [
  {
    file: "nightingale-lofi-mellow.mp3",
    title: "Mellow",
    artist: "Nightingale Lofi",
    license: "CC BY-SA 4.0",
    source: "https://archive.org/details/jamendo-469945",
  },
  {
    file: "nightingale-lofi-distant-memory.mp3",
    title: "Distant Memory",
    artist: "Nightingale Lofi",
    license: "CC BY-SA 4.0",
    source: "https://archive.org/details/jamendo-469637",
  },
  {
    file: "nightingale-lofi-cloud-nine.mp3",
    title: "Cloud Nine",
    artist: "Nightingale Lofi",
    license: "CC BY-SA 4.0",
    source: "https://archive.org/details/jamendo-469739",
  },
];

/** The playlist rolls forward forever. */
export function nextTrack(index: number): number {
  return (index + 1) % TRACKS.length;
}

/** The bundled asset URL of a track (public/ is served at the app root). */
function trackUrl(file: string): string {
  return `music/${file}`;
}

/** Quiet, like a café in the corner of the room. */
const MUSIC_VOLUME = 0.35;

/**
 * One HTMLAudioElement playing the playlist end to end. Created when the
 * onboarding mounts, dropped when it unmounts — nothing lingers.
 */
export class AmbientMusic {
  private audio: HTMLAudioElement | null = null;
  private index = 0;
  private playing = false;

  /** The track playing now (or next), for the canvas chip. */
  get title(): string {
    return TRACKS[this.index].title;
  }

  /** Start playback; a no-op while already playing. */
  start(): void {
    if (this.playing) return;
    this.playing = true;
    this.ensureAudio();
    this.audio?.play().catch((error: unknown) => {
      // Autoplay without a user gesture is refused in some webviews — the
      // onboarding retries start() on the first pointer/key press.
      this.playing = false;
      log.info("music.autoplay_blocked", { errorType: typeof error });
    });
  }

  /** Stop for good: the setup is over. Safe to call at any time. */
  stop(): void {
    this.playing = false;
    this.audio?.pause();
    this.audio = null;
    this.index = 0;
  }

  /** Mute/unmute; returns the new state (true = muted). */
  toggleMute(): boolean {
    this.ensureAudio();
    if (this.audio === null) return true;
    this.audio.muted = !this.audio.muted;
    return this.audio.muted;
  }

  /** Lazily create the element — no audio machinery until start()/mute. */
  private ensureAudio(): void {
    if (this.audio !== null) return;
    this.audio = new Audio(trackUrl(TRACKS[this.index].file));
    this.audio.volume = MUSIC_VOLUME;
    this.audio.addEventListener("ended", () => this.advance());
    this.audio.addEventListener("error", () => {
      log.warn("music.load_failed", { trackTitle: TRACKS[this.index].title });
      this.advance();
    });
  }

  /** Roll to the next track; skipping lets one bad file not kill the mood. */
  private advance(): void {
    if (!this.playing || this.audio === null) return;
    this.index = nextTrack(this.index);
    this.audio.src = trackUrl(TRACKS[this.index].file);
    this.audio.play().catch(() => undefined);
  }
}
