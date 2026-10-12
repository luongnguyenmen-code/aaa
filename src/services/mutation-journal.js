const { AsyncLocalStorage } = require('node:async_hooks');
const fs = require('node:fs');
const crypto = require('node:crypto');
const { mutationJournalFile } = require('../core/config');
const { writeJSON } = require('../models/json-store');
const Persistent = require('../models/persistent-state');
const scope = new AsyncLocalStorage();
let records;
let stamp;

function read() {
  if (Persistent.current()) return Persistent.get('journal');
  let currentStamp = null;
  try { const stat = fs.statSync(mutationJournalFile); currentStamp = `${stat.mtimeMs}:${stat.size}`; }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (!records || currentStamp !== stamp) {
    try {
      records = JSON.parse(fs.readFileSync(mutationJournalFile, 'utf8'));
      if (!Array.isArray(records)) throw Error('Invalid journal');
    } catch (error) {
      if (error.code !== 'ENOENT') throw Object.assign(Error('Không thể đọc nhật ký giao dịch.'), { status: 503, cause: error });
      records = [];
    }
    stamp = currentStamp;
  }
  return records;
}
async function save() {
  // Keep unresolved operations indefinitely, plus the latest 500 finished receipts.
  const all = read();
  const finished = all.filter(row => ['completed', 'failed'].includes(row.status)).slice(-500);
  const trimmed = [...all.filter(row => !['completed', 'failed', 'resolved'].includes(row.status)), ...finished];
  if (Persistent.set('journal', trimmed)) return Persistent.flush();
  records = trimmed;
  writeJSON(mutationJournalFile, records);
  const stat = fs.statSync(mutationJournalFile);
  stamp = `${stat.mtimeMs}:${stat.size}`;
}
function unresolved(keys) {
  const wanted = new Set(keys);
  return read().find(row => !['completed', 'failed', 'resolved'].includes(row.status) && row.keys.some(key => wanted.has(key)));
}
function reviewError(row) {
  return Object.assign(Error(`Giao dịch ${row.id} chưa được xác nhận đầy đủ. Kiểm tra trong game và liên hệ BQT để đối soát; không gửi lại.`), { status: 409, operationId: row.id });
}
async function run(req, res, pending, task) {
  const keys = new Set([req.authenticatedSteamId, ...(req.mutationLocks || [])].filter(Boolean));
  const blocked = unresolved(keys);
  if (blocked) throw reviewError(blocked);
  const state = { keys, pending, additional: new Set(), req, row: null };
  return scope.run(state, async () => {
    let failed = false;
    try { return await task(); }
    catch (error) { failed = true; throw error; }
    finally {
      try {
        if (state.row) {
          const steps = state.row.steps;
          const uncertain = steps.some(step => ['inflight', 'uncertain'].includes(step.status));
          const partial = !state.compensated && (failed || res.statusCode >= 400 || res.mutationFailed || res.destroyed || steps.some(step => step.status === 'failed')) && steps.some(step => step.status === 'confirmed');
          state.row.status = uncertain || partial ? 'review' : (failed || res.statusCode >= 400 || res.mutationFailed ? 'failed' : 'completed');
          state.row.updatedAt = Date.now();
          await save();
        }
      } finally { for (const key of state.additional) pending.delete(key); }
    }
  });
}
async function before(endpoint, method, body) {
  const state = scope.getStore();
  // Announcements have no wallet/inventory effect and must not stall financial recovery.
  if (!state || method === 'GET' || (endpoint === '/commands' && body?.action === 'announce')) return null;
  const sid = endpoint.match(/^\/players\/(\d{17})(?:\/|$)/)?.[1] || body?.steamId;
  if (sid && !state.keys.has(sid)) {
    const blocked = unresolved([sid]);
    if (blocked) throw reviewError(blocked);
    if (state.pending.has(sid)) throw Object.assign(Error('Tài khoản liên quan đang có giao dịch. Vui lòng chờ.'), { status: 429 });
    state.pending.add(sid);
    state.keys.add(sid);
    state.additional.add(sid);
  }
  if (!state.row) {
    state.row = { id: crypto.randomUUID(), path: state.req.originalUrl.split('?')[0], keys: [...state.keys], input: state.req.body, details: state.details, status: 'running', createdAt: Date.now(), steps: [] };
    read().push(state.row);
  }
  state.row.keys = [...state.keys];
  const step = { endpoint, method, body, status: 'inflight', startedAt: Date.now() };
  state.row.steps.push(step);
  await save(); // Persist BEFORE a side effect can reach IslePilot.
  return step;
}
async function after(step, result) {
  if (!step) return;
  step.status = result?._uncertain ? 'uncertain' : (!result || result.error || result._status || result.ok === false || result.success === false || result.applied === false ? 'failed' : 'confirmed');
  step.result = result;
  step.finishedAt = Date.now();
  await save();
}
async function annotate(details) { const state = scope.getStore(); if (state) { state.details = details; if (state.row) { state.row.details = details; await save(); } } }
async function compensated() { const state = scope.getStore(); if (state) { state.compensated = true; if (state.row) { state.row.compensated = true; await save(); } } }
module.exports = { run, before, after, unresolved, annotate, compensated, active: () => !!scope.getStore() };
