#!/usr/bin/env python3
"""
JARVIS Local Server v4.0
━━━━━━━━━━━━━━━━━━━━━━━━
Supabase handles all persistent data. This server handles only:
  POST /proxy    → Anthropic API proxy (avoids browser CORS)
  POST /search   → DuckDuckGo web search
  POST /browse   → Fetch + clean any URL
  POST /reflect  → AI insight extraction (frontend saves result to Supabase)
  POST /obsidian → Write markdown files to your local Obsidian vault
  GET  /github   → Fetch public repos from antmartinez59-cloud

Run: python server.py
Open: http://localhost:8080
"""
import http.server
import urllib.request
import urllib.error
import urllib.parse
import json
import os
import re
import sys
from datetime import datetime
from pathlib import Path

PORT = 8080
SCRIPT_DIR = Path(__file__).parent

BROWSER_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
                  '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.5',
}

# ── Helpers ──────────────────────────────────────────────────────────────────

def strip_tags(html):
    """Remove HTML tags, decode common entities, collapse whitespace."""
    html = re.sub(r'<script[^>]*>.*?</script>', '', html, flags=re.DOTALL | re.IGNORECASE)
    html = re.sub(r'<style[^>]*>.*?</style>',  '', html, flags=re.DOTALL | re.IGNORECASE)
    html = re.sub(r'<!--.*?-->',               '', html, flags=re.DOTALL)
    html = re.sub(r'<[^>]+>', ' ', html)
    for entity, char in [('&nbsp;',' '),('&amp;','&'),('&lt;','<'),('&gt;','>'),('&quot;','"'),('&#39;',"'")]:
        html = html.replace(entity, char)
    html = re.sub(r'\s+', ' ', html)
    return html.strip()


def browse_url(url, max_chars=4000):
    """Fetch a URL, attempt to extract main content, return clean text."""
    try:
        req = urllib.request.Request(url, headers=BROWSER_HEADERS)
        with urllib.request.urlopen(req, timeout=12) as r:
            raw = r.read(400_000).decode('utf-8', errors='replace')
        for selector in ['<article', '<main', 'id="content"', 'class="content"', 'id="main"']:
            idx = raw.lower().find(selector.lower())
            if idx > 0:
                tag = 'article' if 'article' in selector else 'main' if 'main' in selector else 'div'
                end = raw.lower().find(f'</{tag}>', idx)
                if end > 0:
                    raw = raw[idx:end + len(tag) + 3]
                    break
        return strip_tags(raw)[:max_chars]
    except Exception as e:
        return f'Error fetching URL: {e}'


def call_anthropic(api_key, prompt, model='claude-haiku-4-5-20251001', max_tokens=500):
    """Server-side Anthropic call — used only by /reflect."""
    body = json.dumps({
        'model': model,
        'max_tokens': max_tokens,
        'messages': [{'role': 'user', 'content': prompt}]
    }).encode()
    req = urllib.request.Request(
        'https://api.anthropic.com/v1/messages',
        data=body,
        headers={
            'x-api-key': api_key,
            'anthropic-version': '2023-06-01',
            'content-type': 'application/json',
            'accept': 'application/json',
        }
    )
    with urllib.request.urlopen(req, timeout=30) as r:
        data = json.loads(r.read())
    return data['content'][0]['text']


# ── Request Handler ───────────────────────────────────────────────────────────

class JarvisHandler(http.server.BaseHTTPRequestHandler):

    def log_message(self, fmt, *args):
        ts = datetime.now().strftime('%H:%M:%S')
        print(f'[{ts}] {fmt % args}')

    def send_json(self, data, status=200):
        body = json.dumps(data, ensure_ascii=False).encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type',   'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Access-Control-Allow-Origin', '*')
        self.end_headers()
        self.wfile.write(body)

    def send_cors_preflight(self):
        self.send_response(204)
        self.send_header('Access-Control-Allow-Origin',  '*')
        self.send_header('Access-Control-Allow-Methods', 'GET,POST,OPTIONS')
        self.send_header('Access-Control-Allow-Headers', '*')
        self.send_header('Access-Control-Max-Age',       '86400')
        self.end_headers()

    def read_json_body(self):
        length = int(self.headers.get('Content-Length', 0))
        return json.loads(self.rfile.read(length)) if length else {}

    def do_OPTIONS(self):
        self.send_cors_preflight()

    # ── GET ──────────────────────────────────────────────────────────────────

    def do_GET(self):
        path = self.path.split('?')[0]

        # Serve index.html
        if path in ('/', '/index.html'):
            f = SCRIPT_DIR / 'index.html'
            if f.exists():
                content = f.read_bytes()
                self.send_response(200)
                self.send_header('Content-Type', 'text/html; charset=utf-8')
                self.send_header('Content-Length', str(len(content)))
                self.send_header('Access-Control-Allow-Origin', '*')
                self.end_headers()
                self.wfile.write(content)
            else:
                self.send_json({'error': 'index.html not found'}, 404)
            return

        # GitHub repos
        if path == '/github':
            username = 'antmartinez59-cloud'
            if 'user=' in self.path:
                username = self.path.split('user=')[-1].split('&')[0]
            try:
                req = urllib.request.Request(
                    f'https://api.github.com/users/{username}/repos?per_page=50&sort=updated',
                    headers={'User-Agent': 'JARVIS/4.0', 'Accept': 'application/vnd.github.v3+json'}
                )
                with urllib.request.urlopen(req, timeout=12) as r:
                    repos = json.loads(r.read())
                result = [{
                    'id':           r['name'].lower(),
                    'name':         r['name'],
                    'url':          r['html_url'],
                    'description':  r.get('description') or '',
                    'language':     r.get('language') or '',
                    'stars':        r.get('stargazers_count', 0),
                    'last_updated': r.get('updated_at', ''),
                    'topics':       r.get('topics', []),
                } for r in repos]
                self.send_json({'repos': result})
            except Exception as e:
                self.send_json({'error': str(e)}, 500)
            return

        # Static files
        fp = SCRIPT_DIR / self.path.lstrip('/')
        if fp.exists() and fp.is_file():
            suffix_map = {'.html':'text/html','.js':'text/javascript',
                          '.css':'text/css','.json':'application/json'}
            ct = suffix_map.get(fp.suffix, 'application/octet-stream')
            content = fp.read_bytes()
            self.send_response(200)
            self.send_header('Content-Type', ct)
            self.send_header('Content-Length', str(len(content)))
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()
            self.wfile.write(content)
        else:
            self.send_json({'error': 'Not found'}, 404)

    # ── POST ─────────────────────────────────────────────────────────────────

    def do_POST(self):
        path = self.path.split('?')[0]

        # /proxy → forward to Anthropic
        if path == '/proxy':
            try:
                body_bytes = self.rfile.read(int(self.headers.get('Content-Length', 0)))
                api_key = self.headers.get('x-api-key', '')
                req = urllib.request.Request(
                    'https://api.anthropic.com/v1/messages',
                    data=body_bytes,
                    headers={
                        'x-api-key':         api_key,
                        'anthropic-version': self.headers.get('anthropic-version', '2023-06-01'),
                        'content-type':      'application/json',
                        'accept':            'application/json',
                    }
                )
                with urllib.request.urlopen(req, timeout=90) as r:
                    self.send_json(json.loads(r.read()))
            except urllib.error.HTTPError as e:
                try:    err = json.loads(e.read())
                except: err = {'error': {'message': f'HTTP {e.code}'}}
                self.send_json(err, e.code)
            except Exception as e:
                self.send_json({'error': {'message': str(e)}}, 500)

        # /search → Brave Search (primary) with DuckDuckGo fallback
        elif path == '/search':
            data      = self.read_json_body()
            query     = data.get('query', '').strip()
            brave_key = data.get('brave_key', '').strip()
            results   = []

            # ── 1. Brave Search API (if key provided) ────────────────────
            if brave_key:
                try:
                    enc = urllib.parse.quote(query)
                    req = urllib.request.Request(
                        f'https://api.search.brave.com/res/v1/web/search?q={enc}&count=10&safesearch=off',
                        headers={
                            'Accept':               'application/json',
                            'Accept-Encoding':      'gzip',
                            'X-Subscription-Token': brave_key,
                        }
                    )
                    with urllib.request.urlopen(req, timeout=12) as r:
                        raw = r.read()
                        # Brave may return gzip
                        try:
                            import gzip as _gz
                            raw = _gz.decompress(raw)
                        except Exception:
                            pass
                        brave = json.loads(raw)
                    for item in brave.get('web', {}).get('results', []):
                        results.append({
                            'title':   item.get('title', ''),
                            'link':    item.get('url', ''),
                            'snippet': item.get('description', ''),
                        })
                    print(f'[Brave] {len(results)} results for: {query}')
                except Exception as e:
                    print(f'[Brave] Error: {e} — falling back to DuckDuckGo')

            # ── 2. DuckDuckGo fallback (no key / Brave returned nothing) ─
            if len(results) < 4:
                try:
                    enc    = urllib.parse.quote(query)
                    ia_url = f'https://api.duckduckgo.com/?q={enc}&format=json&no_redirect=1&no_html=1&skip_disambig=1'
                    req    = urllib.request.Request(ia_url, headers={'User-Agent': 'JARVIS/4.0'})
                    with urllib.request.urlopen(req, timeout=10) as r:
                        ddg = json.loads(r.read())
                    if ddg.get('AbstractURL'):
                        results.append({'title': ddg.get('Heading', query),
                                        'link':  ddg['AbstractURL'],
                                        'snippet': ddg.get('AbstractText', '')})
                    for t in ddg.get('RelatedTopics', [])[:8]:
                        if isinstance(t, dict) and t.get('FirstURL'):
                            results.append({'title':   strip_tags(t.get('Text', ''))[:100],
                                            'link':    t['FirstURL'],
                                            'snippet': strip_tags(t.get('Text', ''))})
                except Exception:
                    pass

            # ── 3. DuckDuckGo HTML scrape (last resort) ──────────────────
            if len(results) < 4:
                try:
                    enc      = urllib.parse.quote(query)
                    html_req = urllib.request.Request(
                        f'https://html.duckduckgo.com/html/?q={enc}', headers=BROWSER_HEADERS)
                    with urllib.request.urlopen(html_req, timeout=12) as hr:
                        html = hr.read(300_000).decode('utf-8', errors='replace')
                    titles   = re.findall(r'class="result__a"[^>]*>([^<]+)', html)
                    urls     = re.findall(r'class="result__url"[^>]*>\s*([^\s<]+)', html)
                    snippets = re.findall(r'class="result__snippet"[^>]*>(.*?)</a>', html, re.DOTALL)
                    for i in range(min(8, len(urls))):
                        raw_url = urls[i].strip()
                        if not raw_url.startswith('http'):
                            raw_url = 'https://' + raw_url
                        results.append({
                            'title':   strip_tags(titles[i]) if i < len(titles) else raw_url,
                            'link':    raw_url,
                            'snippet': strip_tags(snippets[i]) if i < len(snippets) else '',
                        })
                except Exception:
                    pass

            seen, dedup = set(), []
            for r in results:
                if r['link'] not in seen:
                    seen.add(r['link']); dedup.append(r)
            self.send_json({'results': dedup[:10], 'engine': 'brave' if brave_key and results else 'duckduckgo'})

        # /browse → fetch + clean URL
        elif path == '/browse':
            data = self.read_json_body()
            url  = data.get('url', '').strip()
            if not url:
                self.send_json({'error': 'url required'}, 400); return
            text = browse_url(url, max_chars=int(data.get('max_chars', 4000)))
            self.send_json({'url': url, 'text': text})

        # /reflect → AI insight extraction
        elif path == '/reflect':
            data     = self.read_json_body()
            api_key  = data.get('api_key', '')
            question = data.get('question', '')
            response = data.get('response', '')
            if not api_key:
                self.send_json({'ok': False, 'error': 'No API key'}); return
            prompt = f"""Extract structured insights from this AI conversation.

QUESTION: {question[:600]}
RESPONSE: {response[:2500]}

Return ONLY valid JSON (no markdown fences):
{{
  "summary": "one-sentence learning",
  "traits": ["personality or work trait revealed"],
  "priorities": ["what matters to this person"],
  "projects": ["project or topic mentioned"],
  "preferences": ["style or approach they prefer"],
  "patterns": ["behavioral pattern observed"],
  "date": "{datetime.now().strftime('%Y-%m-%d %H:%M')}"
}}
Max 3 items per array. Only include items clearly evidenced."""
            try:
                raw   = call_anthropic(api_key, prompt)
                clean = re.sub(r'```json?', '', raw).replace('```', '').strip()
                m     = re.search(r'\{.*\}', clean, re.DOTALL)
                insights = json.loads(m.group(0) if m else clean)
                self.send_json({'ok': True, 'insights': insights})
            except Exception as e:
                self.send_json({'ok': False, 'error': str(e)})

        # /obsidian → write markdown to local vault
        elif path == '/obsidian':
            data      = self.read_json_body()
            vault     = data.get('vault_path', '').strip()
            file_name = data.get('file_name', '').strip()   # e.g. "Agents/Stoicism.md"
            content   = data.get('content', '')
            if not vault or not file_name:
                self.send_json({'ok': False, 'error': 'vault_path and file_name required'}); return
            try:
                vault_path = Path(vault)
                if not vault_path.exists():
                    self.send_json({'ok': False,
                        'error': f'Vault path not found: {vault}\n'
                                 'Tip: Open Obsidian → Create New Vault → choose folder → paste that path here.'})
                    return
                full = vault_path / file_name
                full.parent.mkdir(parents=True, exist_ok=True)
                full.write_text(content, encoding='utf-8')
                self.send_json({'ok': True, 'wrote': str(full)})
            except Exception as e:
                self.send_json({'ok': False, 'error': str(e)})

        else:
            self.send_json({'error': f'Unknown endpoint: {path}'}, 404)


# ── Entry point ───────────────────────────────────────────────────────────────

if __name__ == '__main__':
    server = http.server.HTTPServer(('', PORT), JarvisHandler)
    print(f"""
╔══════════════════════════════════════════════════╗
║           JARVIS  Local Server  v4.0             ║
╠══════════════════════════════════════════════════╣
║  http://localhost:{PORT}                            ║
║                                                  ║
║  POST /proxy    →  Anthropic API proxy           ║
║  POST /search   →  DuckDuckGo search             ║
║  POST /browse   →  Fetch + clean any URL         ║
║  POST /reflect  →  AI insight extraction         ║
║  POST /obsidian →  Write to Obsidian vault       ║
║  GET  /github   →  Fetch GitHub repos            ║
║                                                  ║
║  Persistent data → Supabase (configure in UI)    ║
╚══════════════════════════════════════════════════╝
""")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print('\nServer stopped.')
        sys.exit(0)
