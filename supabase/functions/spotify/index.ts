// JARVIS — Spotify Edge Function
// Handles OAuth token refresh + proxies all Spotify Web API calls
// Vault keys: SPOTIFY_CLIENT_ID, SPOTIFY_CLIENT_SECRET
// Never exposes credentials to the browser

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const SPOTIFY_TOKEN_URL = 'https://accounts.spotify.com/api/token';
const SPOTIFY_API = 'https://api.spotify.com/v1';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });

  try {
    const CLIENT_ID     = Deno.env.get('SPOTIFY_CLIENT_ID') || '';
    const CLIENT_SECRET = Deno.env.get('SPOTIFY_CLIENT_SECRET') || '';

    if (!CLIENT_ID || !CLIENT_SECRET) {
      return new Response(JSON.stringify({ ok: false, error: 'SPOTIFY_CLIENT_ID or SPOTIFY_CLIENT_SECRET not set in Vault' }), {
        status: 500, headers: { ...CORS, 'Content-Type': 'application/json' },
      });
    }

    const body = await req.json();
    const { action } = body;

    // ── Auth: exchange authorization code for tokens ──────────────────────
    if (action === 'exchange_code') {
      const { code, redirect_uri } = body;
      const params = new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri,
      });
      const res = await fetch(SPOTIFY_TOKEN_URL, {
        method: 'POST',
        headers: {
          'Authorization': 'Basic ' + btoa(CLIENT_ID + ':' + CLIENT_SECRET),
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: params.toString(),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error_description || 'Token exchange failed');
      return new Response(JSON.stringify({ ok: true, ...data }), {
        headers: { ...CORS, 'Content-Type': 'application/json' },
      });
    }

    // ── Auth: refresh access token ─────────────────────────────────────────
    if (action === 'refresh_token') {
      const { refresh_token } = body;
      const params = new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token,
      });
      const res = await fetch(SPOTIFY_TOKEN_URL, {
        method: 'POST',
        headers: {
          'Authorization': 'Basic ' + btoa(CLIENT_ID + ':' + CLIENT_SECRET),
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: params.toString(),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error_description || 'Token refresh failed');
      return new Response(JSON.stringify({ ok: true, ...data }), {
        headers: { ...CORS, 'Content-Type': 'application/json' },
      });
    }

    // ── Get auth URL (client builds it, we just provide the client_id) ─────
    if (action === 'get_client_id') {
      return new Response(JSON.stringify({ ok: true, client_id: CLIENT_ID }), {
        headers: { ...CORS, 'Content-Type': 'application/json' },
      });
    }

    // ── Proxy any Spotify API call ─────────────────────────────────────────
    if (action === 'api') {
      const { endpoint, method = 'GET', access_token, payload } = body;
      if (!access_token) throw new Error('access_token required');
      const fetchOpts: RequestInit = {
        method,
        headers: {
          'Authorization': 'Bearer ' + access_token,
          'Content-Type': 'application/json',
        },
      };
      if (payload && method !== 'GET') fetchOpts.body = JSON.stringify(payload);
      const res = await fetch(SPOTIFY_API + endpoint, fetchOpts);
      // 204 No Content (play/pause/skip return this)
      if (res.status === 204) return new Response(JSON.stringify({ ok: true }), {
        headers: { ...CORS, 'Content-Type': 'application/json' },
      });
      const text = await res.text();
      let data: Record<string, unknown> = {};
      try { data = text ? JSON.parse(text) : {}; } catch(_) { data = {}; }
      // Return soft error instead of throwing — lets client handle gracefully
      if (!res.ok) return new Response(JSON.stringify({ ok: false, status: res.status, error: (data.error as Record<string,unknown>)?.message || 'Spotify API error ' + res.status }), {
        headers: { ...CORS, 'Content-Type': 'application/json' },
      });
      return new Response(JSON.stringify({ ok: true, ...data }), {
        headers: { ...CORS, 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ ok: false, error: 'Unknown action: ' + action }), {
      status: 400, headers: { ...CORS, 'Content-Type': 'application/json' },
    });

  } catch (e) {
    console.error('[spotify]', e.message);
    return new Response(JSON.stringify({ ok: false, error: e.message }), {
      status: 200, headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }
});
