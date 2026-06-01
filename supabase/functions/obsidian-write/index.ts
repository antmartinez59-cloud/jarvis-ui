// JARVIS — Obsidian Write Edge Function
// Writes markdown files to GitHub-backed Obsidian vault
// Vault repo: GITHUB_OBSIDIAN_REPO (e.g. "antmartinez59/jarvis-vault")

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const { file_name, content } = await req.json();
    if (!file_name || content === undefined) return new Response(
      JSON.stringify({ ok: false, error: 'file_name and content required' }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

    const token = Deno.env.get('GITHUB_TOKEN') || '';
    const repo  = Deno.env.get('GITHUB_OBSIDIAN_REPO') || '';
    if (!token || !repo) return new Response(
      JSON.stringify({ ok: false, error: 'GITHUB_TOKEN or GITHUB_OBSIDIAN_REPO not set in Vault' }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

    const encodedContent = btoa(unescape(encodeURIComponent(content)));
    const apiUrl = `https://api.github.com/repos/${repo}/contents/${file_name}`;

    // Check if file exists (need SHA to update)
    let sha: string | undefined;
    const existing = await fetch(apiUrl, {
      headers: { 'Authorization': `token ${token}`, 'User-Agent': 'JARVIS/4.0' },
    });
    if (existing.ok) {
      const data = await existing.json();
      sha = data.sha;
    }

    const body: any = {
      message: `JARVIS: update ${file_name}`,
      content: encodedContent,
      committer: { name: 'JARVIS', email: 'jarvis@ai.local' },
    };
    if (sha) body.sha = sha;

    const res = await fetch(apiUrl, {
      method: 'PUT',
      headers: {
        'Authorization': `token ${token}`,
        'Content-Type': 'application/json',
        'User-Agent': 'JARVIS/4.0',
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const err = await res.json();
      return new Response(JSON.stringify({ ok: false, error: err.message || `GitHub ${res.status}` }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ ok: true, wrote: file_name }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: e.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
