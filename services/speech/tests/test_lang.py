import pytest

from app.lang import detect_language


@pytest.mark.parametrize(
    "text",
    [
        "Hola, ¿cómo estás?",
        "Estoy bien, gracias. ¿Y tú?",
        "No sé qué hacer con esto",
        "Mañana vamos al cine",
        "Pues claro que sí, es muy bueno",
        "¡Qué bueno!",
    ],
)
def test_spanish(text):
    assert detect_language(text) == "es"


@pytest.mark.parametrize(
    "text",
    [
        "Hey, what is going on?",
        "I was just thinking about that game we played yesterday.",
        "Okay.",
        "That sounds really good to me",
        "",
        "Hmm",
    ],
)
def test_english_and_unknown_default_to_english(text):
    assert detect_language(text) == "en"


def test_clone_gets_the_detected_language(tmp_path):
    from app.real_engines import XttsClone

    (tmp_path / "me.wav").write_bytes(b"RIFF")
    seen = []

    class Model:
        def tts(self, text, speaker_wav, language):
            seen.append(language)
            return [0.0] * 10

    clone = XttsClone(voices_dir=str(tmp_path), loader=Model)
    clone.synthesize("Hola, ¿qué tal?", "me")
    clone.synthesize("Hey, how is it going?", "me")
    assert seen == ["es", "en"]
