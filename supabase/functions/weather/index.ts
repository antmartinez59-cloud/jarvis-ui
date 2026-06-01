// JARVIS — Weather Edge Function
// Gets current weather + forecast for Prosper, TX using OpenWeatherMap

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const CITY = 'Prosper,TX,US';
const UNITS = 'imperial'; // Fahrenheit

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const key = Deno.env.get('OPENWEATHER_KEY') || '';
    if (!key) return new Response(JSON.stringify({ error: 'OPENWEATHER_KEY not set in Vault' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

    // Current weather
    const [currentRes, forecastRes] = await Promise.all([
      fetch(`https://api.openweathermap.org/data/2.5/weather?q=${CITY}&units=${UNITS}&appid=${key}`),
      fetch(`https://api.openweathermap.org/data/2.5/forecast?q=${CITY}&units=${UNITS}&cnt=8&appid=${key}`),
    ]);

    const current = await currentRes.json();
    const forecast = await forecastRes.json();

    const weather = {
      temp: Math.round(current.main?.temp || 0),
      feels_like: Math.round(current.main?.feels_like || 0),
      condition: current.weather?.[0]?.description || '',
      icon: current.weather?.[0]?.icon || '',
      humidity: current.main?.humidity || 0,
      wind_mph: Math.round((current.wind?.speed || 0)),
      city: current.name || 'Prosper',
      high: Math.round(current.main?.temp_max || 0),
      low: Math.round(current.main?.temp_min || 0),
      forecast: (forecast.list || []).slice(0, 4).map((f: any) => ({
        time: f.dt_txt?.slice(11, 16) || '',
        temp: Math.round(f.main?.temp || 0),
        condition: f.weather?.[0]?.description || '',
        icon: f.weather?.[0]?.icon || '',
      })),
      activity_suggestion: getActivitySuggestion(
        Math.round(current.main?.temp || 0),
        current.weather?.[0]?.main || '',
        current.wind?.speed || 0
      ),
    };

    return new Response(JSON.stringify({ ok: true, weather }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: e.message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

function getActivitySuggestion(temp: number, condition: string, wind: number): string {
  const cond = condition.toLowerCase();
  if (cond.includes('rain') || cond.includes('storm') || cond.includes('snow')) {
    return 'Stay in — good day for indoor workout, reading, or meal prep.';
  }
  if (temp > 95) return 'Very hot — early morning run only, stay hydrated, consider indoor workout.';
  if (temp > 85) return `Warm at ${temp}°F — morning walk or evening outdoor workout recommended.`;
  if (temp >= 65 && temp <= 85 && wind < 20) return `Perfect at ${temp}°F — great day for a run, park walk, or outdoor activity.`;
  if (temp < 40) return `Cold at ${temp}°F — layer up or take workout indoors.`;
  return `${temp}°F — decent conditions for outdoor activity.`;
}
