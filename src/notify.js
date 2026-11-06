'use strict';
// Notification adapters (SPEC: the morning report must reach the human;
// delivery failure must never fail or duplicate the run itself).
// Shapes: file (built-in), generic webhook, Discord/Slack (webhook
// flavours), ntfy. Email/IM gateways plug into the same send() shape.
const fs = require('fs');
const path = require('path');

function buildEvent(runId, reportPath, severity = 'info') {
  return { event: 'run.completed', run_id: runId, report: reportPath, severity };
}

function payloadFor(kind, event, reportText) {
  switch (kind) {
    case 'discord': return { content: reportText.slice(0, 1900) };
    case 'slack': return { text: reportText.slice(0, 3500) };
    case 'ntfy': return null; // plain-text body, topic in the URL
    default: return event; // generic webhook: the event JSON
  }
}

async function send(kind, target, event, reportText) {
  if (kind === 'file') {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, reportText);
    return { ok: true, via: 'file', target };
  }
  const body = payloadFor(kind, event, reportText);
  const res = await fetch(target, {
    method: 'POST',
    headers: { 'content-type': kind === 'ntfy' ? 'text/plain' : 'application/json', title: 'quota-nightshift morning report' },
    body: kind === 'ntfy' ? reportText : JSON.stringify(body),
  });
  return { ok: res.ok, via: kind, status: res.status };
}

const NOTIFIERS = ['file', 'webhook', 'discord', 'slack', 'ntfy'];

module.exports = { buildEvent, payloadFor, send, NOTIFIERS };
