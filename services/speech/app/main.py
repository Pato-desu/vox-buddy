"""Speech sidecar: /health, /stt, /tts over engine interfaces."""
import os

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import Response
from pydantic import BaseModel

from .audio import decode_wav, encode_wav
from .engines import CloneEngine, FakeStt, FakeTts, SttEngine, TtsEngine

MAX_TEXT = 1000


class TtsRequest(BaseModel):
    text: str
    voice: str = "fast"
    sample: str | None = None


class WarmupRequest(BaseModel):
    sample: str | None = None


def _gpu(clone: object) -> dict | None:
    probe = getattr(clone, "gpu", None)
    return probe() if probe else None


def create_app(
    stt: SttEngine | None = None, tts: TtsEngine | None = None, clone: CloneEngine | None = None
) -> FastAPI:
    stt = stt or FakeStt()
    tts = tts or FakeTts()
    app = FastAPI(title="vox-buddy speech sidecar")

    @app.get("/health")
    def health() -> dict:
        return {"ok": True, "stt": stt.name, "tts": tts.name, "clone": clone.name if clone else None, "gpu": _gpu(clone)}

    @app.post("/stt")
    async def stt_route(request: Request) -> dict:
        """Body: a 16-bit mono wav."""
        try:
            pcm, rate = decode_wav(await request.body())
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e)) from e
        return {"text": stt.transcribe(pcm, rate).strip()}

    @app.post("/tts")
    def tts_route(req: TtsRequest) -> Response:
        text = req.text.strip()
        if not text or len(text) > MAX_TEXT:
            raise HTTPException(status_code=400, detail="text must be 1..1000 characters")
        if req.voice == "clone":
            if clone is None:
                raise HTTPException(status_code=409, detail="clone voice unavailable")
            try:
                pcm = clone.synthesize(text, req.sample)
            except ValueError as e:
                raise HTTPException(status_code=409, detail=str(e)) from e
            return Response(content=encode_wav(pcm, clone.sample_rate), media_type="audio/wav")
        if req.voice != "fast":
            raise HTTPException(status_code=400, detail="voice must be 'fast' or 'clone'")
        return Response(content=encode_wav(tts.synthesize(text), tts.sample_rate), media_type="audio/wav")

    @app.post("/warmup")
    def warmup_route(req: WarmupRequest) -> dict:
        """Preloads the clone voice (called when someone switches to it)."""
        if clone is None:
            raise HTTPException(status_code=409, detail="clone voice unavailable")
        try:
            clone.warmup(req.sample)
        except ValueError as e:
            raise HTTPException(status_code=409, detail=str(e)) from e
        return {"ok": True}

    return app


def warm_up(stt: SttEngine, tts: TtsEngine) -> None:
    """Loads both models with one tiny request each, so the first real utterance isn't slow. Never raises."""
    try:
        stt.transcribe(b"\0\0" * 4800, 16000)  # 0.3 s of silence
        tts.synthesize("Okay.")
    except Exception as e:  # the first real request will load the models instead
        print(f"warm-up failed: {e}")


def _default_app() -> FastAPI:
    """SPEECH_ENGINES=real uses faster-whisper and Piper (lazy-loaded); anything else uses fakes."""
    if os.environ.get("SPEECH_ENGINES") == "real":
        import threading

        from .real_engines import PiperTts, WhisperStt, XttsClone

        # Default: the repo-root voices/ folder, the same one the bot scans.
        voices_dir = os.environ.get("VOICES_DIR") or os.path.join(os.path.dirname(__file__), "..", "..", "..", "voices")
        clone = XttsClone(voices_dir=voices_dir)

        def reaper() -> None:
            import time

            while True:
                time.sleep(30)
                clone.unload_if_idle()

        threading.Thread(target=reaper, daemon=True).start()
        stt, tts = WhisperStt(), PiperTts()
        threading.Thread(target=warm_up, args=(stt, tts), daemon=True).start()
        return create_app(stt, tts, clone)
    return create_app()


app = _default_app()
