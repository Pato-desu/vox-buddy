"""Speech sidecar: /health, /stt, /tts over engine interfaces."""
import os

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import Response
from pydantic import BaseModel

from .audio import decode_wav, encode_wav
from .engines import FakeStt, FakeTts, SttEngine, TtsEngine

MAX_TEXT = 1000


class TtsRequest(BaseModel):
    text: str
    voice: str = "fast"


def create_app(stt: SttEngine | None = None, tts: TtsEngine | None = None) -> FastAPI:
    stt = stt or FakeStt()
    tts = tts or FakeTts()
    app = FastAPI(title="vox-buddy speech sidecar")

    @app.get("/health")
    def health() -> dict:
        return {"ok": True, "stt": stt.name, "tts": tts.name}

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
        return Response(content=encode_wav(tts.synthesize(text), tts.sample_rate), media_type="audio/wav")

    return app


def _default_app() -> FastAPI:
    """SPEECH_ENGINES=real uses faster-whisper and Piper (lazy-loaded); anything else uses fakes."""
    if os.environ.get("SPEECH_ENGINES") == "real":
        from .real_engines import PiperTts, WhisperStt

        return create_app(WhisperStt(), PiperTts())
    return create_app()


app = _default_app()
