"""Real engines. Heavy imports happen lazily so the sidecar and its tests start without the models."""
from __future__ import annotations

import array
import os
import threading
from typing import Any, Callable

from .lang import detect_language


def _pcm_to_float(pcm: bytes) -> Any:
    """16-bit mono PCM as a float32 numpy array in [-1, 1]. faster-whisper reads a plain list as a file path, so it must be an array."""
    import numpy as np

    return np.frombuffer(pcm, dtype=np.int16).astype(np.float32) / 32768.0


def _nvidia_bin_dirs(roots: list[str]) -> list[str]:
    """`bin` folders of the pip-installed CUDA libraries (nvidia-cublas-cu12, nvidia-cudnn-cu12, ...) under `roots`."""
    dirs: list[str] = []
    for root in roots:
        for pkg in sorted(os.listdir(root)) if os.path.isdir(root) else []:
            b = os.path.join(root, pkg, "bin")
            if os.path.isdir(b):
                dirs.append(b)
    return dirs


_dll_dirs_added = False


def _add_nvidia_dll_dirs() -> None:
    """On Windows, lets ctranslate2 find the CUDA 12 DLLs that pip installs under site-packages/nvidia/*/bin."""
    global _dll_dirs_added
    if _dll_dirs_added or os.name != "nt":
        return
    _dll_dirs_added = True
    try:
        import nvidia  # type: ignore  # namespace package shared by the nvidia-*-cu12 wheels
    except ImportError:
        return
    for d in _nvidia_bin_dirs(list(nvidia.__path__)):
        os.add_dll_directory(d)
        os.environ["PATH"] = d + os.pathsep + os.environ.get("PATH", "")


class WhisperStt:
    """faster-whisper; tries CUDA first and falls back to CPU."""

    name = "faster-whisper"

    def __init__(self, model_size: str = "small", loader: Callable[..., Any] | None = None) -> None:
        self.model_size = model_size
        self._loader = loader
        self._model: Any = None
        self.device: str | None = None

    def _load(self, force_cpu: bool = False) -> Any:
        if self._model is not None and not force_cpu:
            return self._model
        loader = self._loader
        if loader is None:
            _add_nvidia_dll_dirs()
            from faster_whisper import WhisperModel  # type: ignore

            loader = WhisperModel
        if not force_cpu:
            try:
                self._model, self.device = loader(self.model_size, device="cuda", compute_type="float16"), "cuda"
                return self._model
            except Exception:  # no CUDA / missing cuDNN: CPU is slower but works
                pass
        self._model, self.device = loader(self.model_size, device="cpu", compute_type="int8"), "cpu"
        return self._model

    def _run(self, audio: Any) -> str:
        segments, _info = self._load().transcribe(audio, language=None, vad_filter=False)  # language=None: whisper detects English or Spanish per utterance
        return " ".join(s.text.strip() for s in segments).strip()  # segments is lazy: inference happens here

    def transcribe(self, pcm: bytes, sample_rate: int) -> str:
        if sample_rate != 16000:
            raise ValueError("whisper expects 16 kHz audio")
        audio = _pcm_to_float(pcm)
        try:
            return self._run(audio)
        except Exception:
            if self.device != "cuda":
                raise
            # The model loads fine on CUDA but the first inference fails when the CUDA 12 runtime
            # libraries (e.g. cublas64_12.dll) are missing, so fall back here and stay on CPU.
            self._load(force_cpu=True)
            return self._run(audio)


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
        # piper-tts >= 1.3: synthesize() yields one AudioChunk per sentence.
        return b"".join(chunk.audio_int16_bytes for chunk in voice.synthesize(text))


class LowVramError(ValueError):
    """Not enough free GPU memory to load the clone model."""


def nvidia_smi_memory() -> tuple[int, int] | None:
    """(free_mb, total_mb) of the first GPU via nvidia-smi, or None without an NVIDIA GPU."""
    import subprocess

    try:
        out = subprocess.run(
            ["nvidia-smi", "--query-gpu=memory.free,memory.total", "--format=csv,noheader,nounits"],
            capture_output=True,
            text=True,
            timeout=5,
            check=True,
        ).stdout.splitlines()[0]
        free, total = (int(x.strip()) for x in out.split(","))
        return free, total
    except Exception:
        return None


class XttsClone:
    """Coqui XTTS-v2 voice cloning from a reference wav in `voices_dir`.

    The model is big, so it loads on first use and unloads after `idle_unload_s` without requests
    (`unload_if_idle` is polled by the sidecar).
    """

    name = "xtts-v2"
    sample_rate = 24000

    def __init__(
        self,
        voices_dir: str = "voices",
        idle_unload_s: float = 600.0,
        loader: Callable[[], Any] | None = None,
        clock: Callable[[], float] | None = None,
        on_unload: Callable[[], None] | None = None,
        vram_probe: Callable[[], tuple[int, int] | None] = nvidia_smi_memory,
        min_free_mb: int = 3000,  # measured on an RTX 3060 Ti: XTTS-v2 peaks near 2.1 GB, plus CUDA overhead
    ) -> None:
        import time

        self.voices_dir = voices_dir
        self.idle_unload_s = idle_unload_s
        self._loader = loader
        self._clock = clock or time.monotonic
        self._on_unload = on_unload
        self._vram_probe = vram_probe
        self.min_free_mb = min_free_mb
        self._lock = threading.Lock()
        self._model: Any = None
        self._last_used = 0.0

    def gpu(self) -> dict | None:
        """Free and total GPU memory in MB, for /health. None when there is no NVIDIA GPU."""
        mem = self._vram_probe()
        return None if mem is None else {"free_mb": mem[0], "total_mb": mem[1]}

    @property
    def loaded(self) -> bool:
        return self._model is not None

    def _sample_path(self, sample: str | None) -> str:
        if not sample or sample != os.path.basename(sample) or sample.startswith("."):
            raise ValueError("no voice sample selected")
        path = os.path.join(self.voices_dir, sample if sample.endswith(".wav") else sample + ".wav")
        if not os.path.isfile(path):
            raise ValueError(f"voice sample not found: {sample}")
        return path

    def _load(self) -> Any:
        if self._model is None:
            mem = self._vram_probe()
            if mem is not None and mem[0] < self.min_free_mb:
                raise LowVramError(f"low vram: {mem[0]} MB free, clone voice needs {self.min_free_mb} MB")
            loader = self._loader
            if loader is None:

                def loader() -> Any:
                    import torch
                    from TTS.api import TTS  # type: ignore

                    # TTS() loads on the CPU unless moved; XTTS on CPU is far too slow for conversation.
                    return TTS("tts_models/multilingual/multi-dataset/xtts_v2").to("cuda" if torch.cuda.is_available() else "cpu")

            self._model = loader()
        return self._model

    def synthesize(self, text: str, sample: str | None) -> bytes:
        path = self._sample_path(sample)
        # One call at a time: XTTS keeps generation state in the model, and overlapping calls (a warmup plus a
        # real sentence, or a client retry after a timeout) corrupt it ("IndexError: index out of range").
        with self._lock:
            model = self._load()
            try:
                samples = model.tts(text=text, speaker_wav=path, language=detect_language(text))
            finally:
                self._last_used = self._clock()
        a = array.array("h", (max(-32768, min(32767, int(s * 32767))) for s in samples))
        return a.tobytes()

    def warmup(self, sample: str | None) -> None:
        """Loads the model and runs one short phrase, so the first real sentence isn't slow."""
        self.synthesize("Okay.", sample)

    def synthesize_chunks(self, text: str, sample: str | None, chunk_s: float = 0.5):
        """Same audio as `synthesize`, in ~chunk_s pieces (so callers can start playback early)."""
        pcm = self.synthesize(text, sample)
        step = int(self.sample_rate * chunk_s) * 2
        for i in range(0, len(pcm), step):
            yield pcm[i : i + step]

    def unload_if_idle(self) -> bool:
        """Frees the model once idle for long enough. Returns True if it unloaded."""
        if self._model is None or self._clock() - self._last_used < self.idle_unload_s:
            return False
        if not self._lock.acquire(blocking=False):
            return False  # a sentence is being spoken
        try:
            self._model = None
            if self._on_unload:
                self._on_unload()  # e.g. release GPU memory
        finally:
            self._lock.release()
        return True
