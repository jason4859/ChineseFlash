#!/usr/bin/env python3
"""
youtube_to_flashcards.py
────────────────────────
Fetches the Chinese transcript from a YouTube video (works great with
@xiaoguachinese), extracts vocabulary using Claude, and outputs cards
ready to paste into the flashcard app's "+ Add Vocabulary" panel.

Usage:
    python3 scripts/youtube_to_flashcards.py <youtube-url-or-video-id>
    python3 scripts/youtube_to_flashcards.py <youtube-url> --output cards.txt
    python3 scripts/youtube_to_flashcards.py <youtube-url> --max-words 30

Requirements:
    pip install youtube-transcript-api yt-dlp anthropic
    export ANTHROPIC_API_KEY=your_key_here   # get from console.anthropic.com
"""

import argparse
import os
import re
import sys
import warnings

warnings.filterwarnings('ignore')

# ── Dependencies check ────────────────────────────────────────

def require(module, install_name=None):
    import importlib
    try:
        return importlib.import_module(module)
    except ImportError:
        pkg = install_name or module
        print(f"Missing dependency: {pkg}\nInstall with: pip install {pkg}")
        sys.exit(1)


# ── Helpers ───────────────────────────────────────────────────

def extract_video_id(url_or_id: str) -> str:
    """Extract a YouTube video ID from a URL or return as-is if already an ID."""
    patterns = [
        r'(?:v=|youtu\.be/|/embed/)([A-Za-z0-9_-]{11})',
        r'^([A-Za-z0-9_-]{11})$',
    ]
    for pattern in patterns:
        match = re.search(pattern, url_or_id)
        if match:
            return match.group(1)
    print(f"Could not extract video ID from: {url_or_id}")
    sys.exit(1)


def get_video_title(video_id: str) -> str:
    """Use yt-dlp to get the video title (used as the flashcard category)."""
    try:
        import subprocess
        result = subprocess.run(
            ['python3', '-m', 'yt_dlp', '--print', '%(title)s',
             f'https://www.youtube.com/watch?v={video_id}'],
            capture_output=True, text=True, timeout=30
        )
        title = result.stdout.strip()
        # Trim to a clean category name (strip level/episode info after '|')
        title = title.split('|')[0].strip()
        return title or f'Video {video_id}'
    except Exception:
        return f'Video {video_id}'


def fetch_transcript(video_id: str) -> str:
    """Fetch Chinese transcript and return as a single string."""
    yta = require('youtube_transcript_api', 'youtube-transcript-api')
    from youtube_transcript_api import YouTubeTranscriptApi, NoTranscriptFound

    api = YouTubeTranscriptApi()

    # Prefer manually created transcripts; fall back to auto-generated
    for lang in ['zh-CN', 'zh-Hans', 'zh-TW', 'zh']:
        try:
            transcript = api.fetch(video_id, languages=[lang])
            lines = [entry.text.strip() for entry in transcript if entry.text.strip()]
            return '\n'.join(lines)
        except Exception:
            continue

    print(f"No Chinese transcript found for video {video_id}.")
    print("Available transcripts:")
    try:
        for t in api.list(video_id):
            print(f"  {t.language} ({t.language_code})")
    except Exception:
        pass
    sys.exit(1)


def extract_vocab_with_claude(transcript: str, category: str, max_words: int) -> list[dict]:
    """
    Send the transcript to Claude and extract vocabulary cards.
    Returns a list of {zh, pinyin, en, cat} dicts.
    """
    anthropic = require('anthropic')
    import anthropic as ant

    api_key = os.environ.get('ANTHROPIC_API_KEY')
    if not api_key:
        print("Error: ANTHROPIC_API_KEY environment variable not set.")
        print("Export it with:  export ANTHROPIC_API_KEY=your_key_here")
        sys.exit(1)

    client = ant.Anthropic(api_key=api_key)

    prompt = f"""You are a Chinese language teacher. Below is a transcript from a Mandarin Chinese learning video.

Your task:
1. Identify the {max_words} most useful vocabulary words or short phrases for a learner to study.
   - Prefer words that appear multiple times or are explicitly explained in the transcript.
   - Include a mix of nouns, verbs, adjectives, and common expressions.
   - Skip filler words (的, 了, 吗, etc.) unless they carry important meaning in context.

2. For each word output EXACTLY one line in this format (tab-separated):
   Chinese（pīnyīn）\tEnglish definition

Rules:
- Chinese characters first, then pinyin in （full-width parentheses）, then TAB, then English.
- English should be concise: 1–5 words.
- No numbering, no extra commentary, no blank lines between entries.
- Output ONLY the vocabulary lines, nothing else.

Transcript:
{transcript[:6000]}
"""

    message = client.messages.create(
        model='claude-opus-4-5',
        max_tokens=1024,
        messages=[{'role': 'user', 'content': prompt}]
    )

    raw = message.content[0].text.strip()
    cards = []

    for line in raw.splitlines():
        line = line.strip()
        if not line:
            continue

        # Parse: 汉字（pinyin）\tEnglish
        match = re.match(r'^([^（）]+)[（]([^）]+)[）]\t(.+)$', line)
        if match:
            cards.append({
                'zh':     match.group(1).strip(),
                'pinyin': match.group(2).strip(),
                'en':     match.group(3).strip(),
                'cat':    category,
            })

    return cards


def format_for_import(cards: list[dict]) -> str:
    """Format cards as tab-separated lines for pasting into the app."""
    lines = []
    for c in cards:
        lines.append(f"{c['zh']}（{c['pinyin']}）\t{c['en']}")
    return '\n'.join(lines)


def format_as_js(cards: list[dict], category: str) -> str:
    """Format cards as JavaScript array entries for adding directly to cards.js."""
    lines = [f'  // ── {category} ']
    for c in cards:
        zh      = c['zh'].ljust(6)
        pinyin  = c['pinyin'].ljust(20)
        en      = c['en']
        cat     = c['cat']
        lines.append(f'  {{ en: "{en}", zh: "{zh.strip()}", pinyin: "{pinyin.strip()}", cat: "{cat}" }},')
    return '\n'.join(lines)


# ── Main ──────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(
        description='Extract Chinese vocabulary from a YouTube video transcript.'
    )
    parser.add_argument('url', help='YouTube URL or video ID')
    parser.add_argument('--output', '-o', help='Save output to a file instead of printing')
    parser.add_argument('--max-words', '-n', type=int, default=20,
                        help='Maximum number of vocab cards to extract (default: 20)')
    parser.add_argument('--format', choices=['import', 'js'], default='import',
                        help='"import" = paste-ready format for the app (default); "js" = cards.js snippet')
    args = parser.parse_args()

    video_id = extract_video_id(args.url)
    print(f"Video ID : {video_id}")

    print("Fetching title...")
    title = get_video_title(video_id)
    print(f"Title    : {title}")

    print("Fetching transcript...")
    transcript = fetch_transcript(video_id)
    word_count = len(transcript.replace('\n', ' ').split())
    print(f"Transcript: {len(transcript.splitlines())} lines, ~{word_count} words")

    print(f"Extracting up to {args.max_words} vocab cards with Claude...")
    cards = extract_vocab_with_claude(transcript, title, args.max_words)
    print(f"Extracted : {len(cards)} cards")

    if not cards:
        print("No cards extracted. The transcript may not have parseable vocabulary.")
        sys.exit(1)

    if args.format == 'js':
        output = format_as_js(cards, title)
    else:
        output = format_for_import(cards)

    if args.output:
        with open(args.output, 'w', encoding='utf-8') as f:
            f.write(f"# Category: {title}\n")
            f.write(output + '\n')
        print(f"\nSaved to: {args.output}")
    else:
        print(f"\n{'─'*60}")
        print(f"Category: {title}")
        print(f"{'─'*60}")
        print(output)
        print(f"{'─'*60}")
        print("\nPaste the lines above into the app's '+ Add Vocabulary' panel.")
        print(f"Set the category name to: {title}")


if __name__ == '__main__':
    main()
