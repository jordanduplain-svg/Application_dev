"""Make SAM.gov descriptions readable: paragraphs, bold labels, highlighted keywords.

Descriptions arrive as one long block, sometimes with HTML left in. Everything
here works on plain text and escapes it before building the HTML.
"""
from __future__ import annotations

import html
import re

from markupsafe import Markup

from .scorer import compile_keyword

SENTENCES_PER_PARAGRAPH = 3

# Markers put around a label while splitting, turned into <strong> at the end.
_OPEN, _CLOSE = "\x02", "\x03"

# Section titles written in normal case. A new paragraph starts at each one:
# anywhere when followed by ":", at the start of a sentence otherwise.
HEADINGS = [
    "Background", "Purpose", "Objective", "Objectives", "Scope", "Scope of Work", "Statement of Work",
    "Description", "Requirements", "Requirement", "Deliverables", "Tasks",
    "Contract Type", "Type of Contract", "Period of Performance", "Place of Performance",
    "Set-Aside", "Set Aside", "Solicitation Number", "Notice Type", "Response Date",
    "Submission Instructions", "Submission Requirements", "Instructions", "Response Instructions",
    "Responses", "Evaluation", "Evaluation Criteria", "Questions", "Due Date",
    "Point of Contact", "Points of Contact", "Primary Point of Contact", "Contracting Office",
    "Contracting Officer", "Note", "Notes", "Attachments", "Amendment", "Capability Statement",
    "Disclaimer", "Important",
]
_HEADINGS = "|".join(re.escape(h) for h in sorted(HEADINGS, key=len, reverse=True))
_HEADING_COLON_RE = re.compile(rf"(?<![\w-])({_HEADINGS})\s*:\s*")
_HEADING_START_RE = re.compile(
    rf"(?:^|(?<=[.!?]\s)|(?<=[.!?]\s\s))({_HEADINGS})(\s+-\s+|\s+(?=[A-Z]))", re.MULTILINE
)
# Labels written in capitals, as in many notices: "POINT OF CONTACT:", "NAICS CODE:",
# "PRODUCT SERVICE CODE (PSC):". One to six words, at least 4 letters in total.
_CAPS_WORD = r"\(?[A-Z][A-Z&/'\-]*\)?"  # letters only: "FA2550" is a value, not a label
_CAPS_LABEL_RE = re.compile(rf"(?<![\w(])((?:{_CAPS_WORD}\s+){{0,5}}{_CAPS_WORD})\s*:\s+")
# Numbered list items "1. Company name ... 2. Point of contact": one line each.
_LIST_ITEM_RE = re.compile(r"(?<=[.:;]\s)(?=\d{1,2}[.)]\s+[A-Z])")
# Sentence end: . ! ? followed by space and a capital letter, digit or bracket.
# Not after initials, abbreviations or list numbers: "U.S. Army", "e.g. This", "No. 5", "1. Name".
_SENTENCE_RE = re.compile(
    r"(?<=[.!?])(?<!\b[A-Za-z]\.)(?<!\be\.g\.)(?<!\bi\.e\.)(?<!\bNo\.)(?<!\bMr\.)(?<!\bMs\.)(?<!\bDr\.)"
    r"(?<!\bSt\.)(?<!\bvs\.)(?<!\bInc\.)(?<!\bCo\.)(?<!\b\d\.)(?<!\b\d\d\.)"
    r"\s+(?=[A-Z0-9(\"])"
)
_TAG_RE = re.compile(r"<[^>]+>")
_BLOCK_TAG_RE = re.compile(r"<\s*(br|/p|/div|/li|/h\d|/tr)\b[^>]*>", re.IGNORECASE)


def clean(text: str) -> str:
    """Plain text: HTML removed, entities decoded, broken characters and spaces tidied."""
    text = _BLOCK_TAG_RE.sub("\n", text)
    text = _TAG_RE.sub(" ", text)
    text = html.unescape(text).replace(" ", " ").replace("�", "'")
    # Quotes already broken in SAM.gov's own data ("Woodyâ€? Williams"): show an apostrophe.
    text = text.replace("â€?", "'")
    text = re.sub(r"[\x00-\x08\x0b\x0c\x0e-\x1f]", "", text)  # control characters (and our markers)
    text = re.sub(r"[ \t\f\v]+", " ", text)
    text = re.sub(r" *\n *", "\n", text)
    return text.strip()


def _is_caps_label(label: str) -> bool:
    letters = [c for c in label if c.isalpha()]
    return len(letters) >= 4 and all(c.isupper() for c in letters)


def _mark_labels(block: str) -> str:
    """Start a new line at each label and wrap it in markers."""
    def label(text: str) -> str:
        return f"\n{_OPEN}{text}:{_CLOSE} "

    block = _HEADING_COLON_RE.sub(lambda m: label(m.group(1)), block)
    block = _HEADING_START_RE.sub(lambda m: label(m.group(1)), block)
    block = _CAPS_LABEL_RE.sub(
        lambda m: label(m.group(1)) if _is_caps_label(m.group(1)) else m.group(0), block
    )
    return _LIST_ITEM_RE.sub("\n", block)


def split_paragraphs(text: str) -> list[str]:
    """Keep the author's line breaks when there are some, else group sentences.

    Labels are wrapped in markers (see _OPEN / _CLOSE).
    """
    blocks = [b.strip() for b in re.split(r"\n{2,}", text) if b.strip()]
    if len(blocks) == 1:
        lines = [line.strip() for line in text.split("\n") if line.strip()]
        blocks = lines if len(lines) > 1 else blocks

    paragraphs: list[str] = []
    for block in blocks:
        for part in (p.strip() for p in _mark_labels(block).split("\n")):
            if not part:
                continue
            sentences = _SENTENCE_RE.split(part)
            for i in range(0, len(sentences), SENTENCES_PER_PARAGRAPH):
                paragraphs.append(" ".join(sentences[i:i + SENTENCES_PER_PARAGRAPH]))
    return paragraphs


def plain(paragraph: str) -> str:
    """A paragraph without the label markers."""
    return paragraph.replace(_OPEN, "").replace(_CLOSE, "")


def _highlight(text: str, patterns: list[re.Pattern[str]]) -> str:
    """Escape `text` and wrap keyword matches in <mark>."""
    spans = sorted((m.start(), m.end()) for p in patterns for m in p.finditer(text))
    out, pos = [], 0
    for start, end in spans:
        if start < pos:
            continue  # overlaps a previous match
        out += [html.escape(text[pos:start]), "<mark>", html.escape(text[start:end]), "</mark>"]
        pos = end
    out.append(html.escape(text[pos:]))
    return "".join(out)


def _render(paragraph: str, patterns: list[re.Pattern[str]]) -> str:
    """Escape and highlight; label markers become <strong>."""
    pieces = re.split(f"({_OPEN}|{_CLOSE})", paragraph)
    out = []
    for piece in pieces:
        if piece == _OPEN:
            out.append("<strong>")
        elif piece == _CLOSE:
            out.append("</strong>")
        else:
            out.append(_highlight(piece, patterns))
    return "".join(out)


def format_description(text: str | None, keywords: str | list[str] | None = None) -> Markup:
    """HTML for the offer details. `keywords` = the offer's matched keywords."""
    text = clean(text or "")
    if not text:
        return Markup('<p class="muted">No description available.</p>')
    if isinstance(keywords, str):
        keywords = [k for k in keywords.split(", ") if k]
    patterns = [compile_keyword(k) for k in keywords or []]
    return Markup("".join(f"<p>{_render(p, patterns)}</p>" for p in split_paragraphs(text)))
