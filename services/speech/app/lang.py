"""Tells Spanish from English in one short sentence, so the clone voice can be told which language to speak."""
import re

_ES = frozenset(
    "el la los las un una unos unas y o pero que de del al en es son soy eres era fue está estoy estás están "
    "no sí si por para con sin sobre como cómo qué quién cuándo dónde porque muy más menos ya aquí ahí "
    "yo tú él ella nosotros ellos me te se nos mi tu su este esta eso esto hay tengo tiene tienes quiero "
    "puedo puedes vamos va voy bien gracias hola claro pues vale tambien también todo nada algo".split()
)
_EN = frozenset(
    "the a an and or but that of to in is are am was were be been it its this these those i you he she we they "
    "me my your his her our their not no yes so for with without about as how what who when where why because "
    "very more less just here there do does did have has had can will would should okay hey thanks thank "
    "really going gonna like well all nothing something".split()
)
_WORD = re.compile(r"[a-záéíóúüñ']+")


def detect_language(text: str) -> str:
    """'es' or 'en'. Spanish-only punctuation and letters decide it outright; otherwise the commoner stopwords win. Ties are English."""
    lowered = text.lower()
    if "¿" in lowered or "¡" in lowered or "ñ" in lowered:
        return "es"
    words = _WORD.findall(lowered)
    es = sum(w in _ES for w in words) + sum(any(c in w for c in "áéíóú") for w in words)
    en = sum(w in _EN for w in words)
    return "es" if es > en else "en"
