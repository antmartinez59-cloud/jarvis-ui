// ╔══════════════════════════════════════════════════════════╗
// ║  JARVIS — news Edge Function                             ║
// ║  Sources: NewsAPI + DuckDuckGo fallback                  ║
// ║  Topics: Finance/markets, Tech/AI, Sports, Headlines     ║
// ║  Also: random fact + Wordle link                         ║
// ╚══════════════════════════════════════════════════════════╝

const NEWS_API_KEY = Deno.env.get('NEWS_API_KEY');
const BRAVE_KEY    = Deno.env.get('BRAVE_KEY');

// Tony's sports teams
const SPORTS_QUERY = 'Cowboys OR Mavericks OR Rangers OR NFL';

// Random facts for daily briefing (cycles through — add more anytime)
const RANDOM_FACTS = [
  'A day on Venus is longer than a year on Venus.',
  'Honey never spoils — archaeologists found 3000-year-old honey in Egyptian tombs still edible.',
  'The shortest war in history lasted 38-45 minutes (Anglo-Zanzibar War, 1896).',
  'A group of flamingos is called a flamboyance.',
  'Bananas are berries, but strawberries are not.',
  'The human brain uses about 20% of the body\'s total energy.',
  'Cleopatra lived closer in time to the Moon landing than to the building of the Great Pyramid.',
  'There are more possible iterations of a chess game than atoms in the observable universe.',
  'A cloud can weigh more than 1 million pounds.',
  'Octopuses have three hearts and blue blood.',
  'The average person walks about 100,000 miles in their lifetime.',
  'A single strand of DNA from one human cell would stretch 6 feet if uncoiled.',
  'Sharks are older than trees — sharks have existed for 450 million years.',
  'The Eiffel Tower grows about 6 inches taller in summer due to thermal expansion.',
  'Your eyes are the same size from birth — but your nose and ears never stop growing.',
  'More people die from vending machine accidents each year than shark attacks.',
  'The word \'muscle\' comes from the Latin \'musculus\' meaning \'little mouse\'.',
  'A snail can sleep for 3 years.',
  'All the ants on Earth weigh about the same as all the humans.',
  'The tongue is the strongest muscle in the body relative to its size.',
];

function getRandomFact(): string {
  const dayOfYear = Math.floor((Date.now() - new Date(new Date().getFullYear(), 0, 0).getTime()) / 86400000);
  return RANDOM_FACTS[dayOfYear % RANDOM_FACTS.length];
}

function getTodayWordleLink(): string {
  // Wordle URL — always just the main page
  return 'https://www.nytimes.com/games/wordle/index.html';
}

// ── Fetch from NewsAPI ───────────────────────────────────────
async function fetchNewsAPI(query: string, category?: string, pageSize = 5): Promise<any[]> {
  if (!NEWS_API_KEY) return [];

  let url: string;
  if (category) {
    url = `https://newsapi.org/v2/top-headlines?country=us&category=${category}&pageSize=${pageSize}&apiKey=${NEWS_API_KEY}`;
  } else {
    url = `https://newsapi.org/v2/everything?q=${encodeURIComponent(query)}&sortBy=publishedAt&pageSize=${pageSize}&language=en&apiKey=${NEWS_API_KEY}`;
  }

  try {
    const res = await fetch(url);
    if (!res.ok) return [];
    const data = await res.json();
    return (data.articles || []).map((a: any) => ({
      title:       a.title,
      source:      a.source?.name || 'Unknown',
      url:         a.url,
      published:   a.publishedAt,
      description: a.description,
    }));
  } catch {
    return [];
  }
}

// ── Fallback: DuckDuckGo search ──────────────────────────────
async function fetchDDG(query: string): Promise<any[]> {
  try {
    const res = await fetch(
      `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`
    );
    if (!res.ok) return [];
    const data = await res.json();
    const results: any[] = [];

    if (data.AbstractText) {
      results.push({
        title:       data.Heading || query,
        source:      data.AbstractSource || 'DuckDuckGo',
        url:         data.AbstractURL || '',
        published:   new Date().toISOString(),
        description: data.AbstractText,
      });
    }

    for (const topic of (data.RelatedTopics || []).slice(0, 4)) {
      if (topic.Text && topic.FirstURL) {
        results.push({
          title:       topic.Text.slice(0, 100),
          source:      'DuckDuckGo',
          url:         topic.FirstURL,
          published:   new Date().toISOString(),
          description: topic.Text,
        });
      }
    }
    return results;
  } catch {
    return [];
  }
}

// ── Brave Search fallback ────────────────────────────────────
async function fetchBrave(query: string): Promise<any[]> {
  if (!BRAVE_KEY) return [];
  try {
    const res = await fetch(
      `https://api.search.brave.com/res/v1/news/search?q=${encodeURIComponent(query)}&count=5&freshness=day`,
      { headers: { 'Accept': 'application/json', 'X-Subscription-Token': BRAVE_KEY } }
    );
    if (!res.ok) return [];
    const data = await res.json();
    return (data.results || []).map((r: any) => ({
      title:       r.title,
      source:      r.meta_url?.hostname || 'Unknown',
      url:         r.url,
      published:   r.age || new Date().toISOString(),
      description: r.description,
    }));
  } catch {
    return [];
  }
}

// ── Fetch news with best available source ───────────────────
async function getNews(query: string, category?: string): Promise<any[]> {
  // Try NewsAPI first
  if (NEWS_API_KEY) {
    const results = await fetchNewsAPI(query, category);
    if (results.length > 0) return results;
  }
  // Try Brave
  if (BRAVE_KEY) {
    const results = await fetchBrave(query);
    if (results.length > 0) return results;
  }
  // Fallback to DuckDuckGo
  return fetchDDG(query);
}

// ── Main handler ─────────────────────────────────────────────
Deno.serve(async (req) => {
  try {
    // Parse optional request body (can request specific sections)
    let sections = ['finance', 'tech', 'sports', 'headlines'];
    try {
      const body = await req.json();
      if (body?.sections) sections = body.sections;
    } catch { /* use defaults */ }

    console.log('[news] Fetching news for sections:', sections);

    const result: any = {
      ok:          true,
      fetched_at:  new Date().toISOString(),
      random_fact: getRandomFact(),
      wordle_link: getTodayWordleLink(),
    };

    // Fetch all requested sections in parallel
    const fetches = await Promise.allSettled([
      sections.includes('headlines') ? getNews('', 'general')         : Promise.resolve([]),
      sections.includes('finance')   ? getNews('stock market finance investing economy') : Promise.resolve([]),
      sections.includes('tech')      ? getNews('AI technology artificial intelligence') : Promise.resolve([]),
      sections.includes('sports')    ? getNews(SPORTS_QUERY)          : Promise.resolve([]),
    ]);

    result.headlines = fetches[0].status === 'fulfilled' ? fetches[0].value : [];
    result.finance   = fetches[1].status === 'fulfilled' ? fetches[1].value : [];
    result.tech      = fetches[2].status === 'fulfilled' ? fetches[2].value : [];
    result.sports    = fetches[3].status === 'fulfilled' ? fetches[3].value : [];

    // Build a quick summary count
    result.counts = {
      headlines: result.headlines.length,
      finance:   result.finance.length,
      tech:      result.tech.length,
      sports:    result.sports.length,
    };

    // Note which API was used
    result.source = NEWS_API_KEY ? 'NewsAPI' : BRAVE_KEY ? 'Brave' : 'DuckDuckGo (free)';
    if (!NEWS_API_KEY) {
      result.setup_hint = 'Add NEWS_API_KEY for better results: supabase secrets set NEWS_API_KEY=YOUR_KEY';
    }

    console.log('[news] Fetched:', result.counts);

    return new Response(JSON.stringify(result), {
      headers: { 'Content-Type': 'application/json' },
    });

  } catch (err) {
    console.error('[news] Error:', err);
    return new Response(JSON.stringify({ ok: false, error: String(err) }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
});
