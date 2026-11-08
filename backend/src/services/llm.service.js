const AiCallLog = require('../models/AiCallLog');

// Shared JSON-only gateway. Callers must validate returned IDs against their own data.
async function completeJson({ feature, userId, sessionId, system, input, fetchImpl = fetch }) {
  if (!process.env.GROQ_API_KEY) return null;
  const model = process.env.GROQ_MODEL || 'openai/gpt-oss-120b';
  const started = Date.now();
  let status = 'error', usage = {};
  try {
    const response = await fetchImpl('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST', signal: AbortSignal.timeout(8000),
      headers: { Authorization: `Bearer ${process.env.GROQ_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, temperature: 0, max_completion_tokens: 600,
        response_format: { type: 'json_object' },
        messages: [{ role: 'system', content: system }, { role: 'user', content: JSON.stringify(input) }] })
    });
    if (!response.ok) { status = response.status === 429 ? 'rate_limited' : 'error'; return null; }
    const body = await response.json();
    usage = body.usage || {};
    const result = JSON.parse(body.choices?.[0]?.message?.content || 'null');
    status = 'success';
    return result;
  } catch (error) {
    if (['TimeoutError', 'AbortError'].includes(error.name)) status = 'timeout';
    return null;
  } finally {
    await AiCallLog.create({ feature, user_id: userId || null, session_id: sessionId || null, model, status,
      prompt_tokens: usage.prompt_tokens || 0, completion_tokens: usage.completion_tokens || 0,
      total_tokens: usage.total_tokens || 0, latency_ms: Date.now() - started,
      input_summary: 'Catalog-constrained product tag matching', output_summary: status }).catch(error => {
      console.error('Could not persist AI usage log:', error.message);
    });
  }
}

module.exports = { completeJson };
