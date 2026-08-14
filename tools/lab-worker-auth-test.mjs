#!/usr/bin/env node

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const workerUrl = new URL('../lab/_worker.js', import.meta.url);
const workerSource = await readFile(workerUrl, 'utf8');
const workerModule = await import(
  `data:text/javascript;base64,${Buffer.from(workerSource).toString('base64')}`
);
const worker = workerModule.default;

function makeEnv(overrides = {}) {
  let assetFetchCount = 0;
  const env = {
    ASSETS: {
      async fetch() {
        assetFetchCount += 1;
        return new Response('asset', { status: 200 });
      }
    },
    ...overrides
  };
  return { env, getAssetFetchCount: () => assetFetchCount };
}

function authHeader(user, password) {
  return `Basic ${btoa(`${user}:${password}`)}`;
}

async function runCase(name, envOverrides, authorization, expectedStatus, expectedFetches) {
  const { env, getAssetFetchCount } = makeEnv(envOverrides);
  const headers = authorization ? { Authorization: authorization } : {};
  const response = await worker.fetch(new Request('https://example.test/', { headers }), env);
  assert.equal(response.status, expectedStatus, `${name}: status`);
  assert.equal(getAssetFetchCount(), expectedFetches, `${name}: ASSETS.fetch count`);
  return response;
}

const missing = await runCase('missing secret', {}, null, 503, 0);
assert.equal(missing.headers.get('Cache-Control'), 'no-store');

const unauthorized = await runCase('missing authorization', { LAB_PASS: 'test-pass' }, null, 401, 0);
assert.equal(
  unauthorized.headers.get('WWW-Authenticate'),
  'Basic realm="Kantoku private beta", charset="UTF-8"'
);
assert.equal(unauthorized.headers.get('Cache-Control'), 'no-store');

await runCase(
  'wrong authorization',
  { LAB_PASS: 'test-pass' },
  authHeader('kantoku', 'wrong-pass'),
  401,
  0
);

await runCase(
  'configured user mismatch',
  { LAB_USER: 'manager', LAB_PASS: 'test-pass' },
  authHeader('kantoku', 'test-pass'),
  401,
  0
);

await runCase(
  'default user success',
  { LAB_PASS: 'test-pass' },
  authHeader('kantoku', 'test-pass'),
  200,
  1
);

await runCase(
  'configured user success',
  { LAB_USER: 'manager', LAB_PASS: 'test-pass' },
  authHeader('manager', 'test-pass'),
  200,
  1
);

console.log('lab worker auth: 6/6 PASS');
