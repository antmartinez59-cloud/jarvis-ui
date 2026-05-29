// JARVIS Edge Function — obsidian-write
// Writes markdown files to a private GitHub repo.
// obsidian-git plugin on desktop/mobile syncs that repo → Obsidian vault.
// Works even when your computer is completely off.
//
// Vault: GITHUB_OBSIDIAN_REPO=username/jarvis-vault (set in Supabase Vault)
// Token: GITHUB_TOKEN with contents:write permission on that repo

import { serve } from "https://deno.land/std@0.168.0/http/server.ts"

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

// Encode content to base64 (GitHub API requires this)
function toBase64(str: string): string {
  return btoa(unescape(encodeURIComponent(str)))
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  try {
    const GITHUB_TOKEN = Deno.env.get('GITHUB_TOKEN')
    const GITHUB_REPO  = Deno.env.get('GITHUB_OBSIDIAN_REPO') // e.g. "antmartinez59/jarvis-vault"

    if (!GITHUB_TOKEN || !GITHUB_REPO) {
      return new Response(
        JSON.stringify({ ok: false, error: 'Set GITHUB_TOKEN and GITHUB_OBSIDIAN_REPO in Supabase Vault' }),
        { status: 200, headers: { ...CORS, 'Content-Type': 'application/json' } }
      )
    }

    const { file_name, content } = await req.json()
    if (!file_name) throw new Error('file_name required')

    const apiBase = `https://api.github.com/repos/${GITHUB_REPO}/contents/${file_name}`
    const ghHeaders = {
      'Authorization': `token ${GITHUB_TOKEN}`,
      'Content-Type': 'application/json',
      'User-Agent': 'JARVIS',
      'Accept': 'application/vnd.github.v3+json',
    }

    // Check if file already exists (need SHA for updates)
    let sha: string | undefined
    const check = await fetch(apiBase, { headers: ghHeaders })
    if (check.ok) {
      const existing = await check.json()
      sha = existing.sha
    }

    // Create or update
    const body: Record<string, string> = {
      message: `JARVIS: ${sha ? 'update' : 'create'} ${file_name}`,
      content: toBase64(content || ''),
    }
    if (sha) body.sha = sha

    const put = await fetch(apiBase, {
      method: 'PUT',
      headers: ghHeaders,
      body: JSON.stringify(body),
    })

    if (!put.ok) {
      const err = await put.json().catch(() => ({}))
      throw new Error(`GitHub API ${put.status}: ${err.message || 'unknown error'}`)
    }

    return new Response(
      JSON.stringify({ ok: true, file: file_name, action: sha ? 'updated' : 'created' }),
      { headers: { ...CORS, 'Content-Type': 'application/json' } }
    )
  } catch (e) {
    return new Response(
      JSON.stringify({ ok: false, error: e.message }),
      { status: 500, headers: { ...CORS, 'Content-Type': 'application/json' } }
    )
  }
})
