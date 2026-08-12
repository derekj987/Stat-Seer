"""
Coach presser collector.

Two-stage by design:

  STAGE 1 (this file, runs daily)  -- fetch and store the RAW transcript.
  STAGE 2 (extract_usage.py)       -- LLM extraction into structured statements,
                                      tagged with prompt_version.

Why separate: the extraction prompt will improve for years. If you only store
extractions you can never re-run them over the archive, and the archive is the
asset. Raw text is cheap; a lost season of pressers is not recoverable.

Priority order for what to extract (from the analysis work):
  WORKLOAD_EXPLICIT   "we're going to lean on him"       rare, high value
  ROLE_DEPTH          "he's earned more snaps"           moderate
  AVAILABILITY_HEDGE  how a coach talks around a Q tag   pairs with practice data
  EVALUATIVE_PRAISE   "he's a pro's pro"                 near-zero value

Weight by speaker: coordinators leak more than head coaches, who are heavily
media-trained. Capture speaker_role so this is measurable later rather than
assumed.

TIMING EDGE: props for secondary players often post AFTER Wednesday pressers.
Information can arrive before the market for that player exists.
"""
import hashlib
import os
import re
from datetime import datetime, timezone

import requests

SUPABASE_URL = os.environ.get("SUPABASE_URL")
SUPABASE_KEY = os.environ.get("SUPABASE_SERVICE_KEY")

ROLE_PATTERNS = [
    (r"\bhead coach\b", "HC"),
    (r"\boffensive coordinator\b", "OC"),
    (r"\bdefensive coordinator\b", "DC"),
    (r"\bspecial teams\b", "ST"),
    (r"\bquarterback\b", "QB"),
    (r"\bgeneral manager\b", "GM"),
]


def infer_role(title: str) -> str:
    t = (title or "").lower()
    for pat, role in ROLE_PATTERNS:
        if re.search(pat, t):
            return role
    return "OTHER"


def content_hash(team, speaker, date_str, text):
    h = hashlib.sha256()
    h.update(f"{team}|{speaker}|{date_str}|".encode())
    h.update(re.sub(r"\s+", " ", (text or "")).strip().lower().encode())
    return h.hexdigest()


def clean_transcript(raw: str) -> str:
    """Strip boilerplate without touching the words that matter."""
    if not raw:
        return ""
    t = re.sub(r"\r\n?", "\n", raw)
    t = re.sub(r"\n{3,}", "\n\n", t)
    t = re.sub(r"^\s*(Q\.|Q:|Question:)", "Q:", t, flags=re.M)
    t = re.sub(r"[ \t]{2,}", " ", t)
    return t.strip()


def store_presser(season, week, team, speaker_name, speaker_title,
                  presser_date, source_url, transcript, source_type="TRANSCRIPT"):
    text = clean_transcript(transcript)
    if len(text) < 200:
        return None       # too short to be a real presser
    rec = dict(
        season=season, week=week, team=team,
        speaker_name=speaker_name,
        speaker_role=infer_role(speaker_title),
        presser_date=presser_date,
        source_url=source_url,
        source_type=source_type,
        transcript=text,
        content_hash=content_hash(team, speaker_name, presser_date, text),
    )
    if not SUPABASE_URL:
        return rec
    resp = requests.post(
        f"{SUPABASE_URL}/rest/v1/pressers",
        headers={
            "apikey": SUPABASE_KEY,
            "Authorization": f"Bearer {SUPABASE_KEY}",
            "Content-Type": "application/json",
            "Prefer": "resolution=ignore-duplicates,return=minimal",
        },
        params={"on_conflict": "content_hash"},
        json=[rec], timeout=60,
    )
    resp.raise_for_status()
    return rec


# --------------------------------------------------------------- extraction
EXTRACTION_PROMPT_VERSION = "v1"

EXTRACTION_PROMPT = """You are extracting factual statements about player USAGE
from an NFL coach press conference transcript.

Extract ONLY statements that make a claim about how much a player will play, his
role, or his availability. Do NOT extract praise, character assessment, or
general optimism.

For each statement return:
  subject_name    the player referred to
  statement_type  one of WORKLOAD_EXPLICIT, ROLE_DEPTH, AVAILABILITY_HEDGE, SCHEME
  direction       1 if usage should increase, -1 decrease, 0 unclear
  confidence      0.0-1.0, how literally the statement can be taken
  quote           the exact words, under 25 words

Rules:
- "We're going to lean on him" -> WORKLOAD_EXPLICIT, direction 1
- "He's earned more opportunity" -> ROLE_DEPTH, direction 1
- "We'll see how he looks Friday" -> AVAILABILITY_HEDGE, direction 0
- "He's a pro's pro" -> DO NOT EXTRACT
- If no usage statements exist, return an empty array.

Return ONLY a JSON array, no preamble, no markdown fences.

Transcript:
{transcript}
"""


def extract_usage(transcript, presser_id, resolver, api_key=None):
    """Stage 2. Returns rows for presser_extractions."""
    key = api_key or os.environ.get("ANTHROPIC_API_KEY")
    resp = requests.post(
        "https://api.anthropic.com/v1/messages",
        headers={"x-api-key": key, "anthropic-version": "2023-06-01",
                 "content-type": "application/json"},
        json={"model": "claude-sonnet-4-6", "max_tokens": 2000,
              "messages": [{"role": "user",
                            "content": EXTRACTION_PROMPT.format(
                                transcript=transcript[:100000])}]},
        timeout=120,
    )
    resp.raise_for_status()
    body = resp.json()
    text = "".join(b.get("text", "") for b in body.get("content", [])
                   if b.get("type") == "text")
    text = text.replace("```json", "").replace("```", "").strip()
    import json
    try:
        items = json.loads(text)
    except json.JSONDecodeError:
        return []
    rows = []
    for it in items:
        gsis, score, _ = resolver.resolve(it.get("subject_name", ""))
        rows.append(dict(
            presser_id=presser_id,
            prompt_version=EXTRACTION_PROMPT_VERSION,
            model="claude-sonnet-4-6",
            gsis_id=gsis,
            subject_name=it.get("subject_name"),
            statement_type=it.get("statement_type", "OTHER"),
            direction=it.get("direction", 0),
            confidence=it.get("confidence"),
            quote=(it.get("quote") or "")[:400],
        ))
    return rows


if __name__ == "__main__":
    sample = """
    Q: How do you plan to handle the backfield this week?
    COACH: We like what the young guy gives us. He's earned more opportunity,
    so you'll see him in there more on early downs. We're going to lean on him.
    Q: And the receiver situation?
    COACH: He's a pro's pro, we love his approach every day.
    Q: Is he going to play Sunday?
    COACH: We'll see how he looks Friday and go from there.
    """
    rec = store_presser(2026, 1, "KC", "Andy Reid", "Head Coach",
                        "2026-09-09", "https://example.com/presser", sample)
    print("record built (not written, no SUPABASE_URL set):")
    for k, v in rec.items():
        if k == "transcript":
            print(f"  {k}: {len(v)} chars")
        else:
            print(f"  {k}: {v}")
    print("\nExpected extraction from this sample:")
    print("  1 WORKLOAD_EXPLICIT  (+1, 'we're going to lean on him')")
    print("  1 ROLE_DEPTH         (+1, 'he's earned more opportunity')")
    print("  1 AVAILABILITY_HEDGE ( 0, 'we'll see how he looks Friday')")
    print("  0 from 'pro's pro'   (correctly ignored)")
