"""Real engines. Heavy imports happen lazily so the sidecar and its tests start without the models."""
from __future__ import annotations

import array
import os
from typing import Any, Callable


def _pcm_to_float(pcm: bytes) -> list[float]:
    a = array.array("h")
    a.frombytes(pcm)
    return [s / 32768.0 for s in a]


class WhisperStt:
    """faster-whisper; tries CUDA first and falls back to CPU."""

    name = "faster-whisper"

    def __init__(self, model_size: str = "small.en", loader: Callable[..., Any] | None = None) -> None:
        self.model_size = model_size
        self._loader = loader
        self._model: Any = None
        self.device: str | None = None

    def _load(self) -> Any:
        if self._model is not None:
            return self._model
        loader = self._loader
        if loader is None:
            from faster_whisper import WhisperModel  # type: ignore

            loader = WhisperModel
        try:
            self._model, self.device = loader(self.model_size, device="cuda", compute_type="float16"), "cuda"
        except Exception:  # no CUDA / missing cuDNN: CPU is slower but works
            self._model, self.device = loader(self.model_size, device="cpu", compute_type="int8"), "cpu"
        return self._model

    def transcribe(self, pcm: bytes, sample_rate: int) -> str:
        if sample_rate != 16000:
            raise ValueError("whisper expects 16 kHz audio")
        segments, _info = self._load().transcribe(_pcm_to_float(pcm), language="en", vad_filter=False)
        return " ".join(s.text.strip() for s in segments).strip()


class PiperTts:
    """Piper voice from a local .onnx file (see download_models.py)."""

    name = "piper"

    def __init__(self, voice_path: str | None = None, loader: Callable[[str], Any] | None = None) -> None:
        self.voice_path = voice_path or os.environ.get("PIPER_VOICE", "models/en_US-lessac-medium.onnx")
        self._loader = loader
        self._voice: Any = None
        self.sample_rate = 22050

    def _load(self) -> Any:
        if self._voice is None:
            loader = self._loader
            if loader is None:
                from piper import PiperVoice  # type: ignore

                loader = PiperVoice.load
            self._voice = loader(self.voice_path)
            self.sample_rate = int(self._voice.config.sample_rate)
        return self._voice

    def synthesize(self, text: str) -> bytes:
        voice = self._load()
        return b"".join(voice.synthesize_stream_raw(text))
