"""WAV encode/decode helpers (16-bit mono PCM)."""
import io
import struct
import wave


def encode_wav(pcm: bytes, sample_rate: int) -> bytes:
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(sample_rate)
        w.writeframes(pcm)
    return buf.getvalue()


def decode_wav(data: bytes) -> tuple[bytes, int]:
    """Returns (pcm bytes, sample rate). Raises ValueError for anything but 16-bit mono."""
    try:
        with wave.open(io.BytesIO(data), "rb") as w:
            if w.getnchannels() != 1 or w.getsampwidth() != 2:
                raise ValueError("expected 16-bit mono wav")
            return w.readframes(w.getnframes()), w.getframerate()
    except (wave.Error, EOFError) as e:
        raise ValueError(f"invalid wav: {e}") from e


def sine_pcm(seconds: float, sample_rate: int, freq: float = 440.0) -> bytes:
    import math

    n = int(seconds * sample_rate)
    return b"".join(struct.pack("<h", int(8000 * math.sin(2 * math.pi * freq * i / sample_rate))) for i in range(n))
