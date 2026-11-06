'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const SCHEMA_DIR = path.join(__dirname, '..', 'schemas');

function loadSchema(type) {
  const file = path.join(SCHEMA_DIR, `${type}.schema.json`);
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function newId(prefix) {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
}

function envelope(type, { runId, taskId = null, parentId = null, role, provider, family }) {
  return {
    protocol_version: '1.0',
    artifact_id: newId('art'),
    type,
    run_id: runId,
    task_id: taskId,
    parent_artifact_id: parentId,
    created_at: new Date().toISOString(),
    producer: { role, provider, family },
  };
}

// Minimal validator: required fields + envelope, per schemas/*.schema.json.
// Deliberately dependency-free; full JSON-Schema validation can be layered on.
function validateArtifact(obj) {
  const errors = [];
  if (!obj || typeof obj !== 'object') return ['artifact is not an object'];
  if (!obj.type) return ['missing type'];
  let schema;
  try { schema = loadSchema(obj.type); } catch { return [`unknown artifact type: ${obj.type}`]; }
  for (const field of schema.required) {
    if (obj[field] === undefined) errors.push(`missing required field: ${field}`);
  }
  if (obj.protocol_version !== '1.0') errors.push(`unsupported protocol_version: ${obj.protocol_version}`);
  if (obj.created_at !== undefined && Number.isNaN(Date.parse(obj.created_at))) {
    errors.push('created_at is not a valid timestamp');
  }
  if (obj.producer !== undefined) {
    if (!obj.producer || typeof obj.producer !== 'object' || typeof obj.producer.role !== 'string' || !obj.producer.role) {
      errors.push('producer.role must be a non-empty string');
    }
  }
  return errors;
}

// Chain validation across one run's artifacts: every parent must exist in
// the same run, and a task-scoped artifact must link to the same task as
// its ancestors. This is what makes an artifact set *trusted-chain-valid*
// rather than merely structurally valid (external audit, 2026-11-06).
function validateChain(artifacts) {
  const errors = [];
  const byId = new Map();
  for (const a of artifacts) {
    if (byId.has(a.artifact_id)) errors.push(`duplicate artifact_id: ${a.artifact_id}`);
    byId.set(a.artifact_id, a);
  }
  for (const a of artifacts) {
    if (!a.parent_artifact_id) continue;
    const parent = byId.get(a.parent_artifact_id);
    if (!parent) { errors.push(`${a.artifact_id}: parent ${a.parent_artifact_id} not found in run`); continue; }
    if (parent.run_id !== a.run_id) errors.push(`${a.artifact_id}: parent is in a different run`);
    if (a.task_id && parent.task_id && a.task_id !== parent.task_id) {
      errors.push(`${a.artifact_id}: task_id does not match parent chain`);
    }
  }
  return errors;
}

function writeArtifact(dir, obj) {
  const errors = validateArtifact(obj);
  if (errors.length) throw new Error(`invalid artifact (${obj.type}): ${errors.join('; ')}`);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${obj.type}-${obj.artifact_id}.json`);
  // Exclusive create: an existing artifact is never silently overwritten.
  fs.writeFileSync(file, JSON.stringify(obj, null, 2), { flag: 'wx' });
  return file;
}

module.exports = { envelope, validateArtifact, validateChain, writeArtifact, newId, loadSchema };
