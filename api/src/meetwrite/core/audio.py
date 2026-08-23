"""The audio format shared by recording storage and live transcription."""

import struct

SAMPLE_RATE_HZ = 24_000
CHANNELS = 1
SAMPLE_WIDTH_BYTES = 2
MAX_REALTIME_CHUNK_BYTES = 15 * 1024 * 1024
MAX_REALTIME_CHUNK_BASE64_CHARACTERS = 4 * ((MAX_REALTIME_CHUNK_BYTES + 2) // 3)


def validate_pcm16(pcm: bytes) -> None:
    if not pcm or len(pcm) % SAMPLE_WIDTH_BYTES:
        raise ValueError("audio must contain complete 16-bit PCM samples")


def pcm_duration_seconds(pcm: bytes) -> float:
    return len(pcm) / (SAMPLE_RATE_HZ * CHANNELS * SAMPLE_WIDTH_BYTES)


def pcm_to_wav(pcm: bytes) -> bytes:
    byte_rate = SAMPLE_RATE_HZ * CHANNELS * SAMPLE_WIDTH_BYTES
    return (
        struct.pack(
            "<4sI4s4sIHHIIHH4sI",
            b"RIFF",
            36 + len(pcm),
            b"WAVE",
            b"fmt ",
            16,
            1,
            CHANNELS,
            SAMPLE_RATE_HZ,
            byte_rate,
            CHANNELS * SAMPLE_WIDTH_BYTES,
            SAMPLE_WIDTH_BYTES * 8,
            b"data",
            len(pcm),
        )
        + pcm
    )
