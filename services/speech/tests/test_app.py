import pytest
from fastapi.testclient import TestClient

from app.audio import decode_wav, encode_wav, sine_pcm
from app.main import create_app


@pytest.fixture
def client():
    return TestClient(create_app())


def test_wav_roundtrip():
    pcm = sine_pcm(0.1, 16000)
    out, rate = decode_wav(encode_wav(pcm, 16000))
    assert out == pcm and rate == 16000


def test_decode_rejects_garbage_and_stereo():
    with pytest.raises(ValueError):
        decode_wav(b"not a wav")


def test_health(client):
    r = client.get("/health")
    assert r.status_code == 200 and r.json() == {"ok": True, "stt": "fake", "tts": "fake", "clone": None, "gpu": None}


def test_stt_is_deterministic(client):
    wav = encode_wav(sine_pcm(1.5, 16000), 16000)
    assert client.post("/stt", content=wav).json() == {"text": "heard 1.5 seconds"}


def test_stt_bad_body(client):
    assert client.post("/stt", content=b"nope").status_code == 400


def test_tts_returns_wav_of_expected_length(client):
    r = client.post("/tts", json={"text": "hello"})
    assert r.status_code == 200 and r.headers["content-type"] == "audio/wav"
    pcm, rate = decode_wav(r.content)
    assert rate == 16000 and len(pcm) // 2 == int(0.05 * 5 * 16000)


@pytest.mark.parametrize("text", ["", "   ", "x" * 1001])
def test_tts_rejects_bad_text(client, text):
    assert client.post("/tts", json={"text": text}).status_code == 400


def test_health_reports_clone_availability():
    from app.engines import FakeClone

    assert TestClient(create_app()).get("/health").json()["clone"] is None
    assert TestClient(create_app(clone=FakeClone())).get("/health").json()["clone"] == "fake-clone"


def test_clone_voice_routes_to_clone_engine_and_rejects_when_missing():
    from app.engines import FakeClone

    plain = TestClient(create_app())
    assert plain.post("/tts", json={"text": "hi there", "voice": "clone"}).status_code == 409
    c = TestClient(create_app(clone=FakeClone()))
    r = c.post("/tts", json={"text": "hi there", "voice": "clone", "sample": "me"})
    assert r.status_code == 200
    _, rate = decode_wav(r.content)
    assert rate == 24000  # the clone engine's rate, not the fast voice's 16000
    assert c.post("/tts", json={"text": "hi", "voice": "robot"}).status_code == 400


def test_low_vram_clone_is_a_409_with_the_reason():
    from app.real_engines import LowVramError

    class Broke:
        name = "xtts-v2"
        sample_rate = 24000

        def gpu(self):
            return {"free_mb": 900, "total_mb": 8000}

        def synthesize(self, text, sample):
            raise LowVramError("low vram: 900 MB free")

    c = TestClient(create_app(clone=Broke()))
    assert c.get("/health").json()["gpu"] == {"free_mb": 900, "total_mb": 8000}
    r = c.post("/tts", json={"text": "hi there", "voice": "clone", "sample": "me"})
    assert r.status_code == 409 and "low vram" in r.json()["detail"]
