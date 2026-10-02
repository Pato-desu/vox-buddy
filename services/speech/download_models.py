"""Downloads the default models into ./models (run once: python download_models.py).

Whisper weights are fetched by faster-whisper on first use; this script handles the Piper voice.
"""
import pathlib
import urllib.request

BASE = "https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/lessac/medium/"
FILES = ["en_US-lessac-medium.onnx", "en_US-lessac-medium.onnx.json"]


def main() -> None:
    out = pathlib.Path(__file__).parent / "models"
    out.mkdir(exist_ok=True)
    for name in FILES:
        dest = out / name
        if dest.exists():
            print(f"have {name}")
            continue
        print(f"downloading {name} ...")
        urllib.request.urlretrieve(BASE + name, dest)  # noqa: S310 (fixed https URL)
    print("done")


if __name__ == "__main__":
    main()
