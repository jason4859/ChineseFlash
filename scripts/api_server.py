#!/usr/bin/env python3
"""
api_server.py — Local API server for the Chinese Flashcard app
───────────────────────────────────────────────────────────────
Runs on http://localhost:8001

Endpoints:
  GET  /health
  POST /extract    { "url": "...", "max_words": 20 }
       → { "category": "...", "cards": [{ "zh", "pinyin", "en" }, ...] }
  POST /sentences  { "zh": "...", "en": "...", "pinyin": "..." }
       → { "sentences": [{ "zh", "pinyin", "en" }, ...] }

Start with:
  python3 scripts/api_server.py

Requirements:
  pip install youtube-transcript-api yt-dlp anthropic
  export ANTHROPIC_API_KEY=your_key   (get from console.anthropic.com)
"""

import json
import os
import re
import subprocess
import sys
import warnings
from http.server import BaseHTTPRequestHandler, HTTPServer
from urllib.parse import urlparse, parse_qs

warnings.filterwarnings('ignore')

PORT = 8001

# ── Load .env from project root (one level up from scripts/) ──

def _load_env_file():
    env_path = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), '.env')
    if not os.path.exists(env_path):
        return
    with open(env_path) as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith('#') or '=' not in line:
                continue
            key, _, val = line.partition('=')
            key = key.strip()
            val = val.strip().strip('"\'')
            if key and not os.environ.get(key):   # overwrite missing OR empty env vars
                os.environ[key] = val

_load_env_file()

# ── Helpers ───────────────────────────────────────────────────

def extract_video_id(url_or_id: str) -> str:
    patterns = [
        r'(?:v=|youtu\.be/|/embed/)([A-Za-z0-9_-]{11})',
        r'^([A-Za-z0-9_-]{11})$',
    ]
    for p in patterns:
        m = re.search(p, url_or_id)
        if m:
            return m.group(1)
    return None


def get_video_title(video_id: str) -> str:
    try:
        result = subprocess.run(
            [sys.executable, '-m', 'yt_dlp', '--print', '%(title)s',
             f'https://www.youtube.com/watch?v={video_id}'],
            capture_output=True, text=True, timeout=30
        )
        title = result.stdout.strip().split('|')[0].strip()
        return title or f'Video {video_id}'
    except Exception:
        return f'Video {video_id}'


def fetch_transcript(video_id: str) -> str:
    from youtube_transcript_api import YouTubeTranscriptApi
    api = YouTubeTranscriptApi()
    for lang in ['zh-CN', 'zh-Hans', 'zh-TW', 'zh']:
        try:
            t = api.fetch(video_id, languages=[lang])
            return '\n'.join(e.text.strip() for e in t if e.text.strip())
        except Exception:
            continue
    raise ValueError(f'No Chinese transcript found for video {video_id}')


def extract_vocab(transcript: str, category: str, max_words: int, api_key: str = '') -> list:
    import anthropic as ant

    # Prefer key passed from UI, fall back to env var
    key = api_key.strip() or os.environ.get('ANTHROPIC_API_KEY', '').strip()
    if not key:
        raise EnvironmentError(
            'No Anthropic API key found. Enter your key in the app UI or set ANTHROPIC_API_KEY.'
        )

    client = ant.Anthropic(api_key=key)

    prompt = f"""You are a Chinese language teacher. Below is a transcript from a Mandarin Chinese podcast for learners.

Extract the {max_words} most useful vocabulary words or short phrases. Prefer:
- Words that appear multiple times or are explained in the transcript
- A mix of nouns, verbs, adjectives, and common expressions
- Skip filler particles (的, 了, 吗) unless meaningful in context

Output EXACTLY one line per word in this format (tab-separated):
Chinese（pīnyīn）\tEnglish definition

Rules:
- Chinese characters, then pinyin in （full-width parentheses）, tab, then English
- English: concise 1-5 words
- No numbering, headers, or blank lines between entries — vocabulary lines ONLY

Transcript:
{transcript[:6000]}"""

    msg = client.messages.create(
        model='claude-opus-4-5',
        max_tokens=1024,
        messages=[{'role': 'user', 'content': prompt}]
    )

    cards = []
    for line in msg.content[0].text.strip().splitlines():
        line = line.strip()
        if not line:
            continue
        m = re.match(r'^([^（）]+)[（]([^）]+)[）]\t(.+)$', line)
        if m:
            cards.append({
                'zh':     m.group(1).strip(),
                'pinyin': m.group(2).strip(),
                'en':     m.group(3).strip(),
            })
    return cards


def generate_sentences(zh: str, en: str, pinyin: str) -> list:
    """Use Claude to generate 3 example sentences for a vocabulary word."""
    import anthropic as ant

    key = os.environ.get('ANTHROPIC_API_KEY', '').strip()
    if not key:
        raise EnvironmentError('No Anthropic API key found. Set ANTHROPIC_API_KEY.')

    client = ant.Anthropic(api_key=key)

    prompt = f"""Generate 3 example sentences in Mandarin Chinese using the word "{zh}" ({pinyin}, meaning: {en}).

Requirements:
- Every sentence must naturally include "{zh}"
- Keep vocabulary at beginner-intermediate level (roughly HSK 2-4)
- Make sentences practical and conversational
- Vary sentence structures (e.g. statement, question, negative)

Return ONLY a JSON array with exactly 3 objects — no other text:
[
  {{"zh": "Chinese sentence here", "pinyin": "full sentence pinyin with tone marks", "en": "English translation"}},
  {{"zh": "...", "pinyin": "...", "en": "..."}},
  {{"zh": "...", "pinyin": "...", "en": "..."}}
]"""

    msg = client.messages.create(
        model='claude-opus-4-5',
        max_tokens=600,
        messages=[{'role': 'user', 'content': prompt}]
    )

    text = msg.content[0].text.strip()
    match = re.search(r'\[.*?\]', text, re.DOTALL)
    if not match:
        raise ValueError('Could not parse sentences from Claude response')
    return json.loads(match.group())


# ── Request handler ───────────────────────────────────────────

class Handler(BaseHTTPRequestHandler):

    def log_message(self, format, *args):
        print(f'  {self.address_string()} {format % args}')

    def send_json(self, status: int, data: dict):
        body = json.dumps(data, ensure_ascii=False).encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Access-Control-Allow-Origin', '*')
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type, X-API-Key')
        self.end_headers()

    def do_GET(self):
        if self.path == '/health':
            self.send_json(200, {'status': 'ok', 'port': PORT})
        else:
            self.send_json(404, {'error': 'Not found'})

    def do_POST(self):
        path = self.path.split('?')[0]
        if path not in ('/extract', '/sentences'):
            self.send_json(404, {'error': 'Not found'})
            return

        length = int(self.headers.get('Content-Length', 0))
        try:
            body = json.loads(self.rfile.read(length))
        except Exception:
            self.send_json(400, {'error': 'Invalid JSON body'})
            return

        # ── /sentences ────────────────────────────────────────────
        if path == '/sentences':
            zh     = body.get('zh', '').strip()
            en     = body.get('en', '').strip()
            pinyin = body.get('pinyin', '').strip()

            if not zh:
                self.send_json(400, {'error': 'Missing "zh" field'})
                return

            try:
                print(f'  Generating example sentences for "{zh}"...')
                sentences = generate_sentences(zh, en, pinyin)
                print(f'  Done — {len(sentences)} sentences generated')
                self.send_json(200, {'sentences': sentences})
            except EnvironmentError as e:
                self.send_json(500, {'error': str(e)})
            except Exception as e:
                self.send_json(500, {'error': f'Unexpected error: {e}'})
            return

        # ── /extract ──────────────────────────────────────────────
        url       = body.get('url', '').strip()
        max_words = int(body.get('max_words', 20))

        if not url:
            self.send_json(400, {'error': 'Missing "url" field'})
            return

        video_id = extract_video_id(url)
        if not video_id:
            self.send_json(400, {'error': f'Could not parse a YouTube video ID from: {url}'})
            return

        try:
            print(f'  Fetching title for {video_id}...')
            category = get_video_title(video_id)

            print(f'  Fetching transcript...')
            transcript = fetch_transcript(video_id)

            print(f'  Extracting up to {max_words} vocab words with Claude...')
            cards = extract_vocab(transcript, category, max_words)

            print(f'  Done — {len(cards)} cards extracted')
            self.send_json(200, {'category': category, 'cards': cards})

        except EnvironmentError as e:
            self.send_json(500, {'error': str(e)})
        except ValueError as e:
            self.send_json(422, {'error': str(e)})
        except Exception as e:
            self.send_json(500, {'error': f'Unexpected error: {e}'})


# ── Entry point ───────────────────────────────────────────────

if __name__ == '__main__':
    api_key = os.environ.get('ANTHROPIC_API_KEY', '').strip()
    if not api_key:
        print('⚠️  WARNING: ANTHROPIC_API_KEY is not set.')
        print('   Export it before starting: export ANTHROPIC_API_KEY=your_key')
        print('   Get your key at: https://console.anthropic.com\n')

    server = HTTPServer(('localhost', PORT), Handler)
    print(f'✅  Flashcard API server running on http://localhost:{PORT}')
    print(f'   POST /extract    {{ "url": "...", "max_words": 20 }}')
    print(f'   POST /sentences  {{ "zh": "...", "en": "...", "pinyin": "..." }}')
    print('   Press Ctrl+C to stop\n')
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print('\nServer stopped.')
