#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const campaign = require('./levels-expanded-1000.campaign.json');

function prepareCampaign(projectId) {
  if (!projectId || !/^[A-Za-z0-9_-]+$/.test(projectId)) {
    throw new Error('A valid RuStore project ID is required');
  }
  return {
    campaignId: campaign.id,
    status: campaign.status,
    audience: campaign.audience,
    audienceSize: 'unknown: subscriptions live in RuStore, not in the game backend',
    url: `https://vkpns-topics.rustore.ru/v1/projects/${projectId}/topics/${campaign.topic}/publish`,
    body: campaign.request,
  };
}

/** One attempted publication per campaign/project on the designated operator host. */
async function runCampaign({ projectId, send = false, stateDir, serviceToken, releaseVersionCode, fetchImpl = globalThis.fetch }) {
  const prepared = prepareCampaign(projectId);
  if (!send) return { ...prepared, dryRun: true };
  if (!stateDir || !path.isAbsolute(stateDir)) throw new Error('Send requires an absolute, persistent state directory');
  if (!serviceToken) throw new Error('Send requires RUSTORE_PUSH_SERVICE_TOKEN');
  if (!Number.isSafeInteger(releaseVersionCode) || releaseVersionCode < 1) {
    throw new Error('Send requires the verified, published Android release versionCode');
  }
  fs.mkdirSync(stateDir, { recursive: true });
  const stateFile = path.join(stateDir, `${campaign.id}.${projectId}.json`);
  const record = {
    campaignId: campaign.id,
    projectId,
    releaseVersionCode,
    status: 'attempted',
    attemptedAt: new Date().toISOString(),
  };
  // Reserve before any network action. A crash/timeout must never cause an automatic retry.
  let handle;
  try {
    handle = fs.openSync(stateFile, 'wx', 0o600);
  } catch (error) {
    if (error.code === 'EEXIST') throw new Error(`Campaign already attempted; reconcile the existing record: ${stateFile}`);
    throw error;
  }
  try {
    fs.writeFileSync(handle, `${JSON.stringify(record, null, 2)}\n`);
    fs.fsyncSync(handle);
  } finally {
    fs.closeSync(handle);
  }

  try {
    const response = await fetchImpl(prepared.url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${serviceToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(prepared.body),
      signal: AbortSignal.timeout(30_000),
      redirect: 'error',
    });
    record.status = response.ok ? 'accepted' : 'rejected';
    record.httpStatus = response.status;
    record.finishedAt = new Date().toISOString();
    fs.writeFileSync(stateFile, `${JSON.stringify(record, null, 2)}\n`);
    if (!response.ok) throw new Error(`RuStore rejected publication (HTTP ${response.status}); no retry was made`);
    return { campaignId: campaign.id, status: record.status, stateFile };
  } catch (error) {
    if (record.status === 'attempted') {
      record.status = 'unknown';
      fs.writeFileSync(stateFile, `${JSON.stringify(record, null, 2)}\n`);
    }
    throw error;
  }
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const allowed = new Set(['--dry-run', '--send']);
  if (args.some((arg) => !allowed.has(arg)) || args.includes('--send') && args.includes('--dry-run')) {
    console.error('Usage: node backend/scripts/levels-expanded-campaign.cjs [--dry-run | --send]');
    process.exitCode = 1;
  } else {
    runCampaign({
      projectId: process.env.RUSTORE_PUSH_PROJECT_ID,
      send: args.includes('--send'),
      stateDir: process.env.SLOVA_PUSH_CAMPAIGN_STATE_DIR,
      serviceToken: process.env.RUSTORE_PUSH_SERVICE_TOKEN,
      releaseVersionCode: Number(process.env.SLOVA_PUSH_RELEASE_VERSION_CODE),
    }).then((result) => console.log(JSON.stringify(result, null, 2)))
      .catch((error) => { console.error(error.message); process.exitCode = 1; });
  }
}

module.exports = { prepareCampaign, runCampaign };
