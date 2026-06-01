// JARVIS Search — Brave primary, DuckDuckGo fallback
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  try {
    const { query, brave_key } = await req.json();
    if (!query) return new Response(JSON.stringify({ results: [], engine: 'none' }), { headers: { ...cors, 'Content-Type': 'application/json' } });

    // Read key: Vault → request body
    const key = Deno.env.get('BRAVE_KEY') || brave_key || '';
    let results: any[] = [];
    let engine = 'none';

    // 1. Brave Search
    if (key) {
      try {
        const r = await fetch(`https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=10`, {
          headers: { 'Accept': 'application/json', 'X-Subscription-Token': key }
        });
        if (r.ok) {
          const d = await r.json();
          results = (d?.web?.results || []).map((x: any) => ({ title: x.title, link: x.url, snippet: x.description || '' }));
          engine = 'brave';
        } else {
          const err = await r.text();
          console.error('Brave error:', r.status, err.slice(0, 100));
        }
      } catch (e) { console.error('Brave exception:', e.message); }
    }

    // 2. DuckDuckGo fallback
    if (results.length < 3) {
      try {
        const r = await fetch(`https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_redirect=1&no_html=1`, {
          headers: { 'User-Agent': 'JARVIS/4.0' }
        });
        if (r.ok) {
          const d = await r.json();
          if (d.AbstractURL) results.push({ title: d.Heading || query, link: d.AbstractURL, snippet: d.AbstractText || '' });
          for (const t of (d.RelatedTopics || []).slice(0, 6)) {
            if (t.FirstURL) results.push({ title: (t.Text || '').slice(0, 80), link: t.FirstURL, snippet: t.Text || '' });
          }
          engine = results.length > 0 ? (engine === 'brave' ? 'brave+ddg' : 'duckduckgo') : engine;
        }
      } catch (e) { console.error('DDG exception:', e.message); }
    }

    return new Response(JSON.stringify({ results: results.slice(0, 10), engine }), {
      headers: { ...cors, 'Content-Type': 'application/json' }
    });
  } catch (e) {
    return new Response(JSON.stringify({ results: [], engine: 'error', error: e.message }), {
      status: 500, headers: { ...cors, 'Content-Type': 'application/json' }
    });
  }
});
