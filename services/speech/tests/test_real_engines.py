import numpy as np
import pytest

from app.audio import sine_pcm
from app.real_engines import PiperTts, WhisperStt


class Seg:
    def __init__(self, text):
        self.text = text


class FakeModel:
    def __init__(self, device):
        self.device = device
        self.seen = None

    def transcribe(self, audio, **kw):
        # Like the real faster-whisper: anything but a float32 array is treated as a file path/object and fails.
        assert isinstance(audio, np.ndarray) and audio.dtype == np.float32, "faster-whisper needs a float32 numpy array"
        self.seen = (len(audio), kw)
        self.audio = audio
        return [Seg(" hello"), Seg("there ")], None


def test_whisper_prefers_cuda():
    calls = []

    def loader(size, device, compute_type):
        calls.append(device)
        return FakeModel(device)

    stt = WhisperStt(loader=loader)
    assert stt.transcribe(sine_pcm(0.5, 16000), 16000) == "hello there"
    assert calls == ["cuda"] and stt.device == "cuda"


def test_whisper_falls_back_to_cpu_and_loads_lazily():
    calls = []

    def loader(size, device, compute_type):
        calls.append(device)
        if device == "cuda":
            raise RuntimeError("no cuda")
        return FakeModel(device)

    stt = WhisperStt(loader=loader)
    assert calls == []  # lazy
    stt.transcribe(sine_pcm(0.1, 16000), 16000)
    stt.transcribe(sine_pcm(0.1, 16000), 16000)
    assert calls == ["cuda", "cpu"] and stt.device == "cpu"


def test_whisper_falls_back_to_cpu_when_cuda_fails_at_inference():
    # Real failure on a PC without the CUDA 12 runtime: the model loads on cuda, then the lazy segments blow up.
    class BrokenCudaModel(FakeModel):
        def transcribe(self, audio, **kw):
            def segments():
                raise RuntimeError("Library cublas64_12.dll is not found or cannot be loaded")
                yield  # pragma: no cover

            return segments(), None

    calls = []

    def loader(size, device, compute_type):
        calls.append(device)
        return BrokenCudaModel(device) if device == "cuda" else FakeModel(device)

    stt = WhisperStt(loader=loader)
    assert stt.transcribe(sine_pcm(0.2, 16000), 16000) == "hello there"
    assert stt.device == "cpu"
    assert stt.transcribe(sine_pcm(0.2, 16000), 16000) == "hello there"
    assert calls == ["cuda", "cpu"]  # stays on cpu, no repeated cuda attempts


def test_whisper_does_not_swallow_errors_on_cpu():
    class BrokenModel(FakeModel):
        def transcribe(self, audio, **kw):
            raise RuntimeError("boom")

    stt = WhisperStt(loader=lambda size, device, compute_type: BrokenModel(device))
    with pytest.raises(RuntimeError, match="boom"):
        stt.transcribe(sine_pcm(0.2, 16000), 16000)


def test_nvidia_bin_dirs_finds_only_packages_with_a_bin_folder(tmp_path):
    from app.real_engines import _nvidia_bin_dirs

    (tmp_path / "cublas" / "bin").mkdir(parents=True)
    (tmp_path / "cudnn" / "bin").mkdir(parents=True)
    (tmp_path / "other" / "lib").mkdir(parents=True)
    found = _nvidia_bin_dirs([str(tmp_path), str(tmp_path / "missing")])
    assert [d.replace("\\", "/").split("/")[-2] for d in found] == ["cublas", "cudnn"]


def test_whisper_gets_samples_scaled_to_unit_range():
    model = FakeModel("cpu")
    pcm = np.array([0, 16384, -32768, 32767], dtype=np.int16).tobytes()
    WhisperStt(loader=lambda *a, **k: model).transcribe(pcm, 16000)
    assert model.audio.tolist() == [0.0, 0.5, -1.0, 32767 / 32768]


def test_whisper_rejects_wrong_rate():
    with pytest.raises(ValueError):
        WhisperStt(loader=lambda *a, **k: FakeModel("cpu")).transcribe(b"\0\0", 48000)


def test_piper_loads_once_and_joins_chunks():
    class Cfg:
        sample_rate = 16000

    class Chunk:  # piper-tts >= 1.3 yields one AudioChunk per sentence
        def __init__(self, data):
            self.audio_int16_bytes = data

    class Voice:
        config = Cfg()

        def synthesize(self, text):
            yield Chunk(b"ab")
            yield Chunk(text.encode())

    loads = []
    tts = PiperTts("v.onnx", loader=lambda p: loads.append(p) or Voice())
    assert tts.synthesize("hi") == b"abhi"
    tts.synthesize("again")
    assert loads == ["v.onnx"] and tts.sample_rate == 16000


class FakeXtts:
    def __init__(self):
        self.calls = []

    def tts(self, text, speaker_wav, language):
        self.calls.append((text, speaker_wav, language))
        return [0.0, 0.5, -0.5, 1.0] * 6000  # 1 s at 24 kHz


def make_clone(tmp_path, clock, loads):
    from app.real_engines import XttsClone

    (tmp_path / "me.wav").write_bytes(b"RIFF")
    model = FakeXtts()

    def loader():
        loads.append(1)
        return model

    return XttsClone(voices_dir=str(tmp_path), idle_unload_s=100, loader=loader, clock=clock), model


def test_xtts_loads_lazily_and_converts_to_pcm(tmp_path):
    t, loads = [0.0], []
    clone, model = make_clone(tmp_path, lambda: t[0], loads)
    assert not clone.loaded and loads == []
    pcm = clone.synthesize("hello", "me")
    assert loads == [1] and clone.loaded
    assert len(pcm) == 24000 * 2
    assert model.calls[0][1].endswith("me.wav") and model.calls[0][2] == "en"


def test_xtts_unloads_after_idle(tmp_path):
    t, loads = [0.0], []
    clone, _ = make_clone(tmp_path, lambda: t[0], loads)
    clone.synthesize("hello", "me")
    t[0] = 99
    assert clone.unload_if_idle() is False and clone.loaded
    t[0] = 101
    assert clone.unload_if_idle() is True and not clone.loaded
    clone.synthesize("again", "me")  # reloads on demand
    assert loads == [1, 1]


def test_xtts_chunks_cover_the_whole_clip(tmp_path):
    clone, _ = make_clone(tmp_path, lambda: 0.0, [])
    chunks = list(clone.synthesize_chunks("hello", "me", chunk_s=0.4))
    assert len(chunks) == 3 and sum(len(c) for c in chunks) == 24000 * 2


@pytest.mark.parametrize("sample", [None, "", "../etc/passwd", ".hidden", "missing"])
def test_xtts_rejects_bad_samples(tmp_path, sample):
    clone, _ = make_clone(tmp_path, lambda: 0.0, [])
    with pytest.raises(ValueError):
        clone.synthesize("hello", sample)


def test_xtts_refuses_to_load_when_vram_is_low(tmp_path):
    from app.real_engines import LowVramError, XttsClone

    (tmp_path / "me.wav").write_bytes(b"RIFF")
    loads = []
    clone = XttsClone(voices_dir=str(tmp_path), loader=lambda: loads.append(1) or FakeXtts(), vram_probe=lambda: (1200, 8000), min_free_mb=4000)
    with pytest.raises(LowVramError, match="low vram"):
        clone.synthesize("hello", "me")
    assert loads == [] and clone.gpu() == {"free_mb": 1200, "total_mb": 8000}


def test_xtts_loads_when_vram_is_enough_or_unknown(tmp_path):
    from app.real_engines import XttsClone

    (tmp_path / "me.wav").write_bytes(b"RIFF")
    for probe in (lambda: (6000, 8000), lambda: None):
        clone = XttsClone(voices_dir=str(tmp_path), loader=FakeXtts, vram_probe=probe)
        assert clone.synthesize("hello", "me")


def test_xtts_warmup_loads_the_model(tmp_path):
    t, loads = [0.0], []
    clone, model = make_clone(tmp_path, lambda: t[0], loads)
    clone.warmup("me")
    assert clone.loaded and model.calls[0][0] == "Okay."
