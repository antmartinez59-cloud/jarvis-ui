// ╔══════════════════════════════════════════════════════════╗
// ║  JARVIS — weather Edge Function                          ║
// ║  Provider: OpenWeatherMap free tier                      ║
// ║  Location: Prosper TX 76227 (lat 33.2362, lon -96.8009)  ║
// ║                                                          ║
// ║  CACHING:                                                ║
// ║  - Briefing calls use cached data (30-min TTL)           ║
// ║  - On-demand "what's the weather" always fetches live    ║
// ║  - Cache stored in user_settings as weather_cache        ║
// ╚══════════════════════════════════════════════════════════╝

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const OPENWEATHER_KEY     = Deno.env.get('OPENWEATHER_KEY');
const SUPABASE_URL         = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

// Prosper TX 76227 coordinates
const LAT   = '33.2362';
const LON   = '-96.8009';
const UNITS = 'imperial'; // Fahrenheit + mph

const CACHE_TTL_MINUTES = 30;

// ── Check for cached weather ──────────────────────────────────
async function getCachedWeather(): Promise<any | null> {
  try {
    const { data } = await db
      .from('user_settings')
      .select('value')
      .eq('key', 'weather_cache')
      .maybeSingle();

    if (!data?.value) return null;

    const cached = JSON.parse(data.value);
    const age = (Date.now() - new Date(cached.cached_at).getTime()) / 60000; // minutes
    if (age <= CACHE_TTL_MINUTES) {
      console.log(`[weather] Serving cache (${Math.round(age)} min old)`);
      return { ...cached.weather, from_cache: true, cache_age_minutes: Math.round(age) };
    }
    return null; // cache expired
  } catch {
    return null;
  }
}

// ── Store weather to cache ────────────────────────────────────
async function cacheWeather(weather: any) {
  try {
    await db.from('user_settings').upsert({
      key:   'weather_cache',
      value: JSON.stringify({ weather, cached_at: new Date().toISOString() }),
    }, { onConflict: 'key' });
  } catch (e) {
    console.error('[weather] Cache write error:', e);
  }
}

// ── Fetch live weather from OpenWeatherMap ───────────────────
async function fetchLiveWeather(): Promise<any> {
  if (!OPENWEATHER_KEY) {
    return {
      error: 'OPENWEATHER_KEY not set',
      setup: 'supabase secrets set OPENWEATHER_KEY=YOUR_KEY',
    };
  }

  // Current + forecast + UV in parallel
  const [currentRes, forecastRes, uvRes] = await Promise.allSettled([
    fetch(`https://api.openweathermap.org/data/2.5/weather?lat=${LAT}&lon=${LON}&units=${UNITS}&appid=${OPENWEATHER_KEY}`),
    fetch(`https://api.openweathermap.org/data/2.5/forecast?lat=${LAT}&lon=${LON}&units=${UNITS}&cnt=40&appid=${OPENWEATHER_KEY}`),
    fetch(`https://api.openweathermap.org/data/2.5/uvi?lat=${LAT}&lon=${LON}&appid=${OPENWEATHER_KEY}`),
  ]);

  if (currentRes.status !== 'fulfilled' || !currentRes.value.ok) {
    throw new Error('OpenWeatherMap current weather failed');
  }

  const current     = await currentRes.value.json();
  const forecastRaw = forecastRes.status === 'fulfilled' && forecastRes.value.ok
    ? await forecastRes.value.json()
    : { list: [] };
  const uvData      = uvRes.status === 'fulfilled' && uvRes.value.ok
    ? await uvRes.value.json()
    : null;

  // Group forecast by day
  const dailyMap: Record<string, any[]> = {};
  for (const item of forecastRaw.list || []) {
    const date = new Date(item.dt * 1000).toLocaleDateString('en-US', { timeZone: 'America/Chicago' });
    if (!dailyMap[date]) dailyMap[date] = [];
    dailyMap[date].push(item);
  }

  const forecast = Object.entries(dailyMap).slice(0, 5).map(([date, items]) => {
    const temps = items.map((i: any) => i.main.temp);
    const descs = items.map((i: any) => i.weather[0].description);
    const icons = items.map((i: any) => i.weather[0].icon);
    const pop   = Math.max(...items.map((i: any) => (i.pop || 0) * 100));
    return {
      date,
      high:        Math.round(Math.max(...temps)),
      low:         Math.round(Math.min(...temps)),
      description: descs[Math.floor(descs.length / 2)],
      icon:        icons[Math.floor(icons.length / 2)],
      rain_chance: Math.round(pop),
    };
  });

  const weather = {
    location:    'Prosper, TX',
    fetched_at:  new Date().toISOString(),
    from_cache:  false,
    current: {
      temp:          Math.round(current.main.temp),
      feels_like:    Math.round(current.main.feels_like),
      high:          Math.round(current.main.temp_max),
      low:           Math.round(current.main.temp_min),
      humidity:      current.main.humidity,
      description:   current.weather[0].description,
      icon:          current.weather[0].icon,
      wind_mph:      Math.round(current.wind.speed),
      wind_dir:      current.wind.deg,
      visibility_mi: current.visibility ? Math.round(current.visibility / 1609) : null,
      clouds_pct:    current.clouds.all,
      sunrise:       new Date(current.sys.sunrise * 1000).toLocaleTimeString('en-US', { timeZone: 'America/Chicago', hour: 'numeric', minute: '2-digit' }),
      sunset:        new Date(current.sys.sunset  * 1000).toLocaleTimeString('en-US', { timeZone: 'America/Chicago', hour: 'numeric', minute: '2-digit' }),
      uv_index:      uvData?.value ?? null,
    },
    forecast,
    summary: buildWeatherSummary(current, forecast, uvData?.value ?? null),
  };

  return weather;
}

// ── Main handler ─────────────────────────────────────────────
Deno.serve(async (req) => {
  try {
    // Check if this is an on-demand (live) request or a briefing (cached ok) request
    let forceLive = false;
    try {
      const body = await req.json();
      forceLive = body?.live === true; // Pass { live: true } for on-demand queries
    } catch { /* default: use cache */ }

    let weather: any;

    if (!forceLive) {
      // Try cache first (briefing calls, background fetches)
      weather = await getCachedWeather();
    }

    if (!weather) {
      // Cache miss, expired, or forced live — fetch from OpenWeatherMap
      console.log('[weather] Fetching live data...');
      weather = await fetchLiveWeather();

      // Store to cache for next call (only if successful)
      if (!weather.error) {
        await cacheWeather(weather);
      }
    }

    return new Response(JSON.stringify({ ok: !weather.error, weather }), {
      headers: { 'Content-Type': 'application/json' },
    });

  } catch (err) {
    console.error('[weather] Error:', err);
    return new Response(JSON.stringify({ ok: false, error: String(err), weather: null }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
});

// ── Human-readable weather summary ───────────────────────────
function buildWeatherSummary(current: any, forecast: any[], uvIndex: number | null): string {
  const temp     = Math.round(current.main.temp);
  const desc     = current.weather[0].description;
  const high     = Math.round(current.main.temp_max);
  const low      = Math.round(current.main.temp_min);
  const wind     = Math.round(current.wind.speed);
  const humidity = current.main.humidity;

  let summary = `${temp}°F and ${desc} in Prosper. High ${high}°F, low ${low}°F.`;

  if (wind > 15) summary += ` Windy at ${wind} mph.`;
  if (humidity > 80) summary += ` Humid (${humidity}%).`;
  if (uvIndex !== null && uvIndex > 6) summary += ` High UV (${uvIndex}) — sunscreen recommended.`;

  const rainyDays = forecast.filter(d => d.rain_chance > 40);
  if (rainyDays.length > 0) {
    summary += ` Rain expected ${rainyDays.slice(0, 2).map(d => d.date).join(' and ')}.`;
  }

  const isNice = temp >= 65 && temp <= 88 && !['Rain','Thunderstorm','Snow'].includes(current.weather[0].main) && wind < 20;
  if (isNice) summary += ` Great day to be outside.`;
  else if (['Rain','Thunderstorm'].includes(current.weather[0].main)) summary += ` Stay dry — indoor day.`;

  return summary;
}
