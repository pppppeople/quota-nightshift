'use strict';
// OpenAI-compatible adapter: one implementation covers every provider that
// exposes an OpenAI-style /chat/completions endpoint (many overseas and
// domestic providers do, directly or via an aggregator). Configure base_url,
// model and an env var name for the key in nightshift.json — keys are read
// from the environment, never from the config file.
//
// proposer/auditor calls return model text; parsing it into artifact shapes
// is the caller's job, and a parse failure must be reported as a channel
// failure (SPEC §10: no fabricated output).

async function chat({ baseUrl, model, keyEnv, messages }) {
  const key = process.env[keyEnv];
  if (!key) throw new Error(`missing API key env var: ${keyEnv}`);
  const res = await fetch(`${baseUrl.replace(/\/$/, '')}/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
    body: JSON.stringify({ model, messages }),
  });
  if (!res.ok) throw new Error(`provider HTTP ${res.status}`);
  const data = await res.json();
  return data.choices?.[0]?.message?.content ?? '';
}

module.exports = { chat };
