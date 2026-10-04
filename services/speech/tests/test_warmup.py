from app.main import warm_up


class RecordingStt:
    name = "rec"

    def __init__(self):
        self.calls = []

    def transcribe(self, pcm, sample_rate):
        self.calls.append((len(pcm), sample_rate))
        return ""


class RecordingTts:
    name = "rec"
    sample_rate = 22050

    def __init__(self):
        self.calls = []

    def synthesize(self, text):
        self.calls.append(text)
        return b"\0\0"


def test_warm_up_runs_one_request_through_each_engine():
    stt, tts = RecordingStt(), RecordingTts()
    warm_up(stt, tts)
    assert stt.calls == [(9600, 16000)] and tts.calls == ["Okay."]


def test_warm_up_never_raises(capsys):
    class Broken(RecordingStt):
        def transcribe(self, pcm, sample_rate):
            raise RuntimeError("no model")

    tts = RecordingTts()
    warm_up(Broken(), tts)  # must not propagate: the server has to keep starting
    assert "warm-up failed: no model" in capsys.readouterr().out
