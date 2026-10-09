'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { runCampaign, prepareCampaign } = require('../levels-expanded-campaign.cjs');

function options(t, fetchImpl) {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'slova-push-campaign-'));
  t.after(() => fs.rmSync(stateDir, { recursive: true, force: true }));
  return { projectId: 'test-project', send: true, stateDir, serviceToken: 'fake-test-token', releaseVersionCode: 42, fetchImpl };
}

test('defaults to an offline draft without state or service credentials', async () => {
  let sent = false;
  const result = await runCampaign({ projectId: 'test-project', fetchImpl: async () => { sent = true; } });
  assert.equal(result.dryRun, true);
  assert.equal(result.status, 'draft');
  assert.equal(sent, false);
  assert.equal(result.body.message.data.value, '/');
});

test('rejects malformed project ids before generating a destination', () => {
  assert.throws(() => prepareCampaign('../other-project'), /valid RuStore project ID/);
});

test('publishes once and blocks a second attempt', async (t) => {
  let requests = 0;
  const config = options(t, async (url, init) => {
    requests++;
    assert.match(url, /topics\/slova_levels_expanded_1000_v1\/publish$/);
    assert.equal(init.redirect, 'error');
    assert.equal(JSON.parse(init.body).message.data.campaignId, 'levels-expanded-1000-v1');
    return { ok: true, status: 200 };
  });
  const result = await runCampaign(config);
  assert.equal(result.status, 'accepted');
  assert.equal(fs.readFileSync(result.stateFile, 'utf8').includes('fake-test-token'), false);
  await assert.rejects(runCampaign(config), /already attempted/);
  assert.equal(requests, 1);
});

test('an atomic claim blocks concurrent publication', async (t) => {
  let requests = 0;
  const config = options(t, async () => { requests++; return { ok: true, status: 200 }; });
  const results = await Promise.allSettled([runCampaign(config), runCampaign(config)]);
  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
  assert.equal(requests, 1);
});

test('a timeout leaves an unknown record and cannot trigger a duplicate retry', async (t) => {
  let requests = 0;
  const config = options(t, async () => { requests++; throw new Error('timeout'); });
  await assert.rejects(runCampaign(config), /timeout/);
  const record = JSON.parse(fs.readFileSync(path.join(config.stateDir, fs.readdirSync(config.stateDir)[0]), 'utf8'));
  assert.equal(record.status, 'unknown');
  await assert.rejects(runCampaign(config), /already attempted/);
  assert.equal(requests, 1);
});

test('a rejected request is recorded and is not retried automatically', async (t) => {
  const config = options(t, async () => ({ ok: false, status: 403 }));
  await assert.rejects(runCampaign(config), /HTTP 403/);
  const record = JSON.parse(fs.readFileSync(path.join(config.stateDir, fs.readdirSync(config.stateDir)[0]), 'utf8'));
  assert.equal(record.status, 'rejected');
  await assert.rejects(runCampaign(config), /already attempted/);
});
