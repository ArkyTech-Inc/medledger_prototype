import test from 'node:test';
import assert from 'node:assert/strict';
import adminGate from '../netlify/functions/admin-gate.mjs';

const request = (body, method = 'POST') => new Request('https://medledger.example/.netlify/functions/admin-gate', {
  method,
  headers: {'Content-Type':'application/json'},
  body: body === undefined ? undefined : JSON.stringify(body)
});

test('admin gate validates credentials from server environment and fails closed', async () => {
  const previousUsername = process.env.MEDLEDGER_ADMIN_USERNAME;
  const previousPassword = process.env.MEDLEDGER_ADMIN_PASSWORD;

  try {
    process.env.MEDLEDGER_ADMIN_USERNAME = 'medledger';
    process.env.MEDLEDGER_ADMIN_PASSWORD = 'test-secret';

    const accepted = await adminGate(request({username:'MedLedger',password:'test-secret'}));
    assert.equal(accepted.status, 200);
    assert.deepEqual(await accepted.json(), {authenticated:true});
    assert.equal(accepted.headers.get('Cache-Control'), 'no-store');

    const rejected = await adminGate(request({username:'medledger',password:'wrong'}));
    assert.equal(rejected.status, 401);

    const invalid = await adminGate(new Request('https://medledger.example/.netlify/functions/admin-gate', {
      method:'POST',
      body:'not json'
    }));
    assert.equal(invalid.status, 400);

    const methodNotAllowed = await adminGate(request(undefined, 'GET'));
    assert.equal(methodNotAllowed.status, 405);

    delete process.env.MEDLEDGER_ADMIN_USERNAME;
    delete process.env.MEDLEDGER_ADMIN_PASSWORD;
    const unconfigured = await adminGate(request({username:'medledger',password:'test-secret'}));
    assert.equal(unconfigured.status, 503);
  } finally {
    if (previousUsername === undefined) delete process.env.MEDLEDGER_ADMIN_USERNAME;
    else process.env.MEDLEDGER_ADMIN_USERNAME = previousUsername;
    if (previousPassword === undefined) delete process.env.MEDLEDGER_ADMIN_PASSWORD;
    else process.env.MEDLEDGER_ADMIN_PASSWORD = previousPassword;
  }
});
