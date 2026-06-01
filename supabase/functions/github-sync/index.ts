// JARVIS — GitHub Sync Edge Function
// Fetches public repos for the configured GitHub user

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const url = new URL(req.url);
    const username = url.searchParams.get('user') || 'antmartinez59-cloud';
    const token = Deno.env.get('GITHUB_TOKEN') || '';

    const headers: Record<string, string> = {
      'User-Agent': 'JARVIS/4.0',
      'Accept': 'application/vnd.github.v3+json',
    };
    if (token) headers['Authorization'] = `token ${token}`;

    const res = await fetch(
      `https://api.github.com/users/${username}/repos?per_page=50&sort=updated`,
      { headers }
    );
    if (!res.ok) throw new Error(`GitHub API ${res.status}`);

    const raw = await res.json();
    const repos = raw.map((r: any) => ({
      id: r.name.toLowerCase(),
      name: r.name,
      url: r.html_url,
      description: r.description || '',
      language: r.language || '',
      stars: r.stargazers_count || 0,
      last_updated: r.updated_at || '',
      topics: r.topics || [],
    }));

    return new Response(JSON.stringify({ repos }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message, repos: [] }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
