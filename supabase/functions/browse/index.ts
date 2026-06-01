// JARVIS — Browse Edge Function
// Fetches a URL and returns clean extracted text for Mastery research

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function stripTags(html: string): string {
  html = html.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '');
  html = html.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '');
  html = html.replace(/<!--[\s\S]*?-->/g, '');
  html = html.replace(/<[^>]+>/g, ' ');
  html = html.replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<')
             .replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
  return html.replace(/\s+/g, ' ').trim();
}

function extractMainContent(html: string): string {
  const selectors = ['<article', '<main', 'id="content"', 'id="main"', 'class="content"'];
  for (const sel of selectors) {
    const idx = html.toLowerCase().indexOf(sel.toLowerCase());
    if (idx > 0) {
      const tag = sel.includes('article') ? 'article' : sel.includes('main') ? 'main' : 'div';
      const end = html.toLowerCase().indexOf(`</${tag}>`, idx);
      if (end > 0) return html.slice(idx, end + tag.length + 3);
    }
  }
  return html;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const { url, max_chars = 4000 } = await req.json();
    if (!url) return new Response(JSON.stringify({ error: 'url required' }), {
      status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
      },
      signal: AbortSignal.timeout(12000),
    });

    if (!res.ok) return new Response(JSON.stringify({ error: `HTTP ${res.status}`, text: '' }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

    const raw = await res.text();
    const main = extractMainContent(raw);
    const text = stripTags(main).slice(0, max_chars);

    return new Response(JSON.stringify({ url, text }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message, text: '' }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
