// JARVIS Edge Function — github-sync
// Fetches repos from antmartinez59-cloud GitHub account.
// Optional GITHUB_TOKEN in Vault increases rate limit from 60 to 5000 req/hour.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
const _db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  try {
    const GITHUB_TOKEN = Deno.env.get('GITHUB_TOKEN') || ''
    const body = req.method === 'POST' ? await req.json().catch(() => ({})) : {}
    const username = body.username || 'antmartinez59-cloud'

    const headers: Record<string, string> = {
      'User-Agent': 'JARVIS/4.0',
      'Accept': 'application/vnd.github.v3+json',
    }
    if (GITHUB_TOKEN) headers['Authorization'] = `token ${GITHUB_TOKEN}`

    const r = await fetch(
      `https://api.github.com/users/${username}/repos?per_page=50&sort=updated`,
      { headers }
    )

    if (!r.ok) throw new Error(`GitHub API error: ${r.status}`)
    const raw: any[] = await r.json()

    const repos = raw.map(repo => ({
      id: repo.name.toLowerCase(),
      name: repo.name,
      url: repo.html_url,
      description: repo.description || '',
      language: repo.language || '',
      stars: repo.stargazers_count || 0,
      last_updated: repo.updated_at || '',
      topics: repo.topics || [],
    }))

    return new Response(
      JSON.stringify({ repos }),
      { headers: { ...CORS, 'Content-Type': 'application/json' } }
    )
  } catch (e) {
    await _db.from('jarvis_errors').insert({ source: 'edge:github-sync', error_type: 'edge_fn', message: String(e?.message||e).slice(0,500) }).catch(()=>{});
    return new Response(
      JSON.stringify({ repos: [], error: e.message }),
      { status: 500, headers: { ...CORS, 'Content-Type': 'application/json' } }
    )
  }
})
