// JARVIS — News Edge Function
// Fetches top headlines via NewsAPI, falls back to search-based headlines

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const newsKey = Deno.env.get('NEWS_API_KEY') || '';
    const braveKey = Deno.env.get('BRAVE_KEY') || '';
    let articles: any[] = [];
    let source = 'none';

    // 1. Try NewsAPI
    if (newsKey) {
      try {
        const res = await fetch(
          `https://newsapi.org/v2/top-headlines?country=us&pageSize=8&apiKey=${newsKey}`,
          { headers: { 'User-Agent': 'JARVIS/4.0' } }
        );
        if (res.ok) {
          const data = await res.json();
          articles = (data.articles || []).slice(0, 6).map((a: any) => ({
            title: a.title || '',
            source: a.source?.name || '',
            url: a.url || '',
            description: a.description || '',
            publishedAt: a.publishedAt || '',
          }));
          source = 'newsapi';
        }
      } catch (e) { console.warn('NewsAPI failed:', e.message); }
    }

    // 2. Brave News fallback
    if (articles.length < 3 && braveKey) {
      try {
        const res = await fetch(
          `https://api.search.brave.com/res/v1/news/search?q=today+news&count=8&freshness=pd`,
          { headers: { 'Accept': 'application/json', 'X-Subscription-Token': braveKey } }
        );
        if (res.ok) {
          const data = await res.json();
          const brave = (data.results || []).slice(0, 6).map((a: any) => ({
            title: a.title || '',
            source: a.meta_url?.hostname || '',
            url: a.url || '',
            description: a.description || '',
            publishedAt: a.age || '',
          }));
          articles = [...articles, ...brave].slice(0, 6);
          source = articles.length > 0 ? 'brave' : 'none';
        }
      } catch (e) { console.warn('Brave news failed:', e.message); }
    }

    return new Response(JSON.stringify({ ok: true, articles, source }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: e.message, articles: [] }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
