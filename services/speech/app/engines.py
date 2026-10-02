"""Engine interfaces. Real engines (faster-whisper, Piper, XTTS) and fakes implement these."""
from typing import Protocol


class SttEngine(Protocol):
    name: str

    def transcribe(self, pcm: bytes, sample_rate: int) -> str: ...


class TtsEngine(Protocol):
    name: str
    sample_rate: int

    def synthesize(self, text: str) -> bytes:
        """Returns 16-bit mono PCM at `sample_rate`."""
        ...


class CloneEngine(Protocol):
    """Voice cloning TTS: speaks in the voice of a reference sample from voices/."""

    name: str
    sample_rate: int

    def synthesize(self, text: str, sample: str | None) -> bytes:
        """Returns 16-bit mono PCM. Raises ValueError if the voice cannot be used right now."""
        ...

    def warmup(self, sample: str | None) -> None:
        """Loads models and runs a short phrase. Raises ValueError like `synthesize`."""
        ...


class FakeStt:
    """Deterministic: describes the audio it was given."""

    name = "fake"

    def transcribe(self, pcm: bytes, sample_rate: int) -> str:
        return f"heard {len(pcm) / 2 / sample_rate:.1f} seconds"


class FakeTts:
    """Deterministic: 50 ms of tone per character."""

    name = "fake"
    sample_rate = 16000

    def synthesize(self, text: str) -> bytes:
        from .audio import sine_pcm

        return sine_pcm(0.05 * len(text), self.sample_rate)


class FakeClone:
    """Deterministic clone stand-in: a higher tone than FakeTts so tests can tell them apart."""

    name = "fake-clone"
    sample_rate = 24000
    warmed: list = []

    def warmup(self, sample: str | None) -> None:
        self.warmed.append(sample)

    def synthesize(self, text: str, sample: str | None) -> bytes:
        from .audio import sine_pcm

        return sine_pcm(0.05 * len(text), self.sample_rate, 440.0)
