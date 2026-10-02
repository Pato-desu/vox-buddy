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
        self.seen = (len(audio), kw)
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


def test_whisper_rejects_wrong_rate():
    with pytest.raises(ValueError):
        WhisperStt(loader=lambda *a, **k: FakeModel("cpu")).transcribe(b"\0\0", 48000)


def test_piper_loads_once_and_joins_chunks():
    class Cfg:
        sample_rate = 16000

    class Voice:
        config = Cfg()

        def synthesize_stream_raw(self, text):
            yield b"ab"
            yield text.encode()

    loads = []
    tts = PiperTts("v.onnx", loader=lambda p: loads.append(p) or Voice())
    assert tts.synthesize("hi") == b"abhi"
    tts.synthesize("again")
    assert loads == ["v.onnx"] and tts.sample_rate == 16000
