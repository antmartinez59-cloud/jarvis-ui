// JARVIS Edge Function — search
// Brave Search primary, DuckDuckGo fallback.
// BRAVE_KEY stored in Supabase Vault — never exposed to browser.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
const _db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function stripTags(html: string): string {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ').trim()
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  try {
    const { query } = await req.json()
    if (!query) throw new Error('query required')

    const BRAVE_KEY = Deno.env.get('BRAVE_KEY') || ''
    const results: { title: string; link: string; snippet: string }[] = []
    let engine = 'duckduckgo'

    // ── 1. Brave Search ──────────────────────────────────────────────────
    if (BRAVE_KEY) {
      try {
        const r = await fetch(
          `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=10&safesearch=off`,
          {
            headers: {
              'X-Subscription-Token': BRAVE_KEY,
              'Accept': 'application/json',
            },
          }
        )
        const data = await r.json()
        for (const item of data.web?.results || []) {
          results.push({ title: item.title || '', link: item.url || '', snippet: item.description || '' })
        }
        if (results.length > 0) engine = 'brave'
        console.log(`[Brave] ${results.length} results for: ${query}`)
      } catch (e) {
        console.warn('[Brave] error:', e.message)
      }
    }

    // ── 2. DuckDuckGo instant answer fallback ────────────────────────────
    if (results.length < 4) {
      try {
        const r = await fetch(
          `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_redirect=1&no_html=1&skip_disambig=1`,
          { headers: { 'User-Agent': 'JARVIS/4.0' } }
        )
        const ddg = await r.json()
        if (ddg.AbstractURL) {
          results.push({ title: ddg.Heading || query, link: ddg.AbstractURL, snippet: ddg.AbstractText || '' })
        }
        for (const t of (ddg.RelatedTopics || []).slice(0, 8)) {
          if (t && t.FirstURL) {
            results.push({ title: stripTags(t.Text || '').slice(0, 100), link: t.FirstURL, snippet: stripTags(t.Text || '') })
          }
        }
      } catch (e) {
        console.warn('[DDG] error:', e.message)
      }
    }

    // Deduplicate
    const seen = new Set<string>()
    const dedup = results.filter(r => { if (seen.has(r.link)) return false; seen.add(r.link); return true })

    return new Response(
      JSON.stringify({ results: dedup.slice(0, 10), engine }),
      { headers: { ...CORS, 'Content-Type': 'application/json' } }
    )
  } catch (e) {
    await _db.from('jarvis_errors').insert({ source: 'edge:search', error_type: 'edge_fn', message: String(e?.message||e).slice(0,500) }).catch(()=>{});
    return new Response(
      JSON.stringify({ results: [], error: e.message }),
      { status: 500, headers: { ...CORS, 'Content-Type': 'application/json' } }
    )
  }
})
