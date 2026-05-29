// ╔══════════════════════════════════════════════════════════╗
// ║  JARVIS — automation-builder Edge Function               ║
// ║                                                          ║
// ║  Conversational agent that turns plain English into      ║
// ║  live automations. Called from Council when Tony says    ║
// ║  "automate X", "remind me to Y", "alert me when Z".     ║
// ║                                                          ║
// ║  Flow:                                                   ║
// ║  1. Tony describes what he wants                         ║
// ║  2. Agent asks clarifying questions (max 4)              ║
// ║  3. Agent generates the rule JSON                        ║
// ║  4. Saves to custom_automations table                    ║
// ║  5. Active on next cron cycle — no deployment needed     ║
// ╚══════════════════════════════════════════════════════════╝

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const ANTHROPIC_KEY       = Deno.env.get('ANTHROPIC_KEY')!;
const SUPABASE_URL         = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

// ── Claude call ──────────────────────────────────────────────
async function callClaude(system: string, messages: any[], maxTokens = 800): Promise<string> {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': ANTHROPIC_KEY,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: maxTokens,
      system,
      messages,
    }),
  });
  if (!res.ok) throw new Error(`Claude error: ${await res.text()}`);
  const data = await res.json();
  return data.content[0].text;
}

// ── System prompt for the builder agent ─────────────────────
const BUILDER_SYSTEM = `You are JARVIS's automation builder. Your job is to turn Tony's plain English requests into structured automation rules.

Tony lives in Prosper TX, uses Central Time, gets SMS on his AT&T phone via Twilio, and has Apple Reminders on his iPhone.

JARVIS tracks: water (oz), sleep (hours + quality), workouts (type + sets/reps), meals (calories + macros), todos (priority levels), transactions, subscriptions, saving goals, body stats, and stock portfolio.

You ask SHORT clarifying questions to nail down:
- WHEN: what time / how often / which days / what event triggers it
- CONDITION: only fire if something is true (behind on water, missed workout, low balance, etc.) OR always fire regardless
- MESSAGE: what the SMS and Apple Reminder should say

Rules for questions:
- Maximum 3 questions total before generating the rule
- Make questions specific and easy to answer (offer options when helpful)
- If the request is clear enough, skip straight to generating the rule
- Don't ask about things you can reasonably infer

When you have enough information, output EXACTLY this format:

RULE_READY
{
  "name": "short name",
  "description": "what this does in plain English",
  "trigger": {
    "type": "schedule",
    "ct_hour": 8,
    "ct_minute": 0,
    "days": [0,1,2,3,4,5,6]
  },
  "condition": { "type": "always" },
  "action": {
    "sms": "the SMS text Tony will receive",
    "reminder_title": "title in Apple Reminders",
    "reminder_notes": "optional extra context",
    "priority": "urgent|high|medium|low",
    "dedup_daily": true,
    "dedup_key": "unique_key_for_dedup"
  },
  "tags": ["category"]
}

Trigger types:
- schedule: { "type": "schedule", "ct_hour": H, "ct_minute": M, "days": [0-6] }
- interval: { "type": "interval", "every_hours": N, "start_hour": 9, "end_hour": 21, "days": [0-6] }

Condition types:
- always: { "type": "always" }
- query_below: { "type": "query_below", "table": "water_logs", "filter": "today", "threshold": 40 }
- query_above: same but fires when above threshold
- has_no_entry: { "type": "has_no_entry", "table": "sleep_logs", "filter": "today" }

Days array: 0=Sun 1=Mon 2=Tue 3=Wed 4=Thu 5=Fri 6=Sat

Priority: urgent (red), high (orange), medium (yellow), low (gray)

The sms and reminder_title should sound natural — like JARVIS is talking to Tony personally, not like a generic notification.`;

// ── Detect if a conversation message is an automation request
export function isAutomationRequest(text: string): boolean {
  const triggers = [
    'automate', 'remind me', 'reminder', 'alert me', 'notify me',
    'every day', 'every morning', 'every night', 'every week',
    'when i', 'if i forget', 'automatically', 'set up an automation',
    'make jarvis', 'have jarvis', 'schedule a',
  ];
  const lower = text.toLowerCase();
  return triggers.some(t => lower.includes(t));
}

// ── Parse the RULE_READY block from Claude's response ────────
function parseRule(response: string): any | null {
  if (!response.includes('RULE_READY')) return null;
  const jsonMatch = response.split('RULE_READY')[1]?.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return null;
  try {
    return JSON.parse(jsonMatch[0]);
  } catch {
    return null;
  }
}

// ── Save a completed rule to the database ────────────────────
async function saveRule(rule: any, sessionId?: string): Promise<{ id: string; name: string }> {
  const { data, error } = await db
    .from('custom_automations')
    .insert({
      name:        rule.name,
      description: rule.description,
      enabled:     true,
      trigger:     rule.trigger,
      condition:   rule.condition || { type: 'always' },
      action:      rule.action,
      created_by:  'jarvis',
      tags:        rule.tags || [],
    })
    .select('id, name')
    .single();

  if (error) throw error;

  // Update the session as complete if we have one
  if (sessionId) {
    await db.from('automation_sessions').update({
      status:    'complete',
      result_id: data.id,
    }).eq('id', sessionId);
  }

  return data;
}

// ── Save / update a builder session ─────────────────────────
async function upsertSession(id: string | null, update: any): Promise<string> {
  if (id) {
    await db.from('automation_sessions').update({ ...update, updated_at: new Date().toISOString() }).eq('id', id);
    return id;
  }
  const { data } = await db.from('automation_sessions').insert(update).select('id').single();
  return data.id;
}

// ══════════════════════════════════════════════════════════════
// MAIN HANDLER
// ══════════════════════════════════════════════════════════════
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Authorization, Content-Type',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
      },
    });
  }

  try {
    const body = await req.json();

    // Called from Council with the full conversation so far
    const {
      message,           // Tony's latest message
      session_id,        // existing builder session (null = new)
      conversation = [], // prior messages in this builder session
    } = body;

    if (!message) {
      return new Response(JSON.stringify({ ok: false, error: 'message required' }), {
        status: 400, headers: { ...CORS, 'Content-Type': 'application/json' },
      });
    }

    // Build message history for Claude
    const messages = [
      ...conversation,
      { role: 'user', content: message },
    ];

    // Call Claude to continue the conversation
    const response = await callClaude(BUILDER_SYSTEM, messages, 1000);

    // Check if Claude has enough info to generate the rule
    const rule = parseRule(response);

    if (rule) {
      // Rule is ready — save it
      const saved = await saveRule(rule, session_id || undefined);

      // Update session
      const sid = await upsertSession(session_id, {
        status:      'complete',
        description: message,
        draft_rule:  rule,
        result_id:   saved.id,
      });

      // Format a clean confirmation message (strip the JSON block)
      const confirmMsg = response.split('RULE_READY')[0].trim() ||
        `Done — "${rule.name}" is live. It'll run automatically on the next cycle. You can see all your automations in JARVIS or ask me to list them.`;

      return new Response(JSON.stringify({
        ok:        true,
        status:    'created',
        message:   confirmMsg,
        rule_id:   saved.id,
        rule_name: saved.name,
        session_id: sid,
        // Return the updated conversation for Council to store
        conversation: [
          ...messages,
          { role: 'assistant', content: response },
        ],
      }), { headers: { ...CORS, 'Content-Type': 'application/json' } });

    } else {
      // Still gathering info — return Claude's question
      const sid = await upsertSession(session_id, {
        description: conversation.length === 0 ? message : undefined,
        questions:   messages,
        updated_at:  new Date().toISOString(),
      });

      return new Response(JSON.stringify({
        ok:         true,
        status:     'needs_info',
        message:    response,
        session_id: sid,
        conversation: [
          ...messages,
          { role: 'assistant', content: response },
        ],
      }), { headers: { ...CORS, 'Content-Type': 'application/json' } });
    }

  } catch (err) {
    console.error('[automation-builder] Error:', err);
    return new Response(JSON.stringify({ ok: false, error: String(err) }), {
      status: 500, headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }
});
