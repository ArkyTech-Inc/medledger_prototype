import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

const [app, sw, config, netlify, schema, edge, readme] = await Promise.all([
  read('app.js'), read('sw.js'), read('config.js'), read('netlify.toml'),
  read('supabase/migrations/001_initial_schema.sql'),
  read('supabase/functions/send-clinical-alert/index.ts'), read('README.md'),
]);

test('frontend does not persist authentication tokens or patient records in browser storage', () => {
  assert.doesNotMatch(app, /localStorage|sessionStorage|indexedDB/);
  assert.match(app, /Auth tokens intentionally remain in memory only/);
  assert.match(app, /IDLE_TIMEOUT_MS\s*=\s*15 \* 60 \* 1000/);
});

test('workspace groups care tasks and communicates the limits of live offline use', () => {
  assert.match(app, /label:'Worklist'/);
  assert.match(app, /function renderCare\(\)/);
  assert.match(app, /function renderSyncStatus\(\)/);
  assert.match(app, /Live records cannot be changed offline in this prototype/);
  assert.match(app, /Live patient and clinical records are not stored on this device/);
});

test('construction page opens only the fictional demo through its temporary admin gate', () => {
  assert.match(app, /function renderAdminGate\(\)/);
  assert.match(app, /src="\/logo2\.png"/);
  assert.match(app, /\/\.netlify\/functions\/admin-gate/);
  assert.doesNotMatch(app, /ADMIN_GATE_PASSWORD/);
  assert.match(app, /if \(!adminGatePassed\) return renderAdminGate\(\)/);
  assert.match(app, /Temporary prototype gate only — demo records are fictional/);
  assert.match(app, /Facility staff\? Sign in with your account/);
});

test('provided MedLedger mark is used in the app shell and cached as a static asset', async () => {
  const [html, logo] = await Promise.all([read('index.html'), read('assets/medledger-logo.svg')]);
  const image = await readFile(new URL('../assets/medledger-logo.png', import.meta.url));
  assert.match(html, /assets\/medledger-logo\.svg/);
  assert.match(app, /src="\/assets\/medledger-logo\.svg"/);
  assert.match(sw, /\/assets\/medledger-logo\.svg/);
  assert.match(sw, /\/assets\/medledger-logo\.png/);
  assert.match(logo, /href="\/assets\/medledger-logo\.png"/);
  assert.equal(image.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
});

test('patient demographic editing is separate from clinical write permissions', () => {
  assert.match(app, /type === 'edit-patient' && !canManagePatientDemographics\(\)/);
  assert.match(app, /function updatePatient\(data\)/);
  assert.match(app, /name=\"record_id\"/);
});

test('frontend API calls are not cached and patient loading is bounded', () => {
  assert.match(app, /cache:\s*'no-store'/);
  assert.match(app, /order=created_at\.desc&limit=100/);
});

test('browser config contains only public Supabase configuration placeholders', () => {
  assert.match(config, /SUPABASE_PUBLISHABLE_KEY/);
  assert.doesNotMatch(config, /service_role|sb_secret_|RESEND_API_KEY|re_[A-Za-z0-9]/i);
});

test('service worker caches only the static app shell and never intercepts cross-origin APIs', () => {
  assert.match(sw, /url\.origin !== self\.location\.origin/);
  assert.match(sw, /API responses and patient information are never cached/);
  assert.doesNotMatch(sw, /\/rest\/v1|\/auth\/v1|functions\/v1/);
});

test('Netlify headers include anti-framing, no-sniff, HSTS and a restrictive CSP', () => {
  assert.match(netlify, /X-Content-Type-Options\s*=\s*"nosniff"/);
  assert.match(netlify, /X-Frame-Options\s*=\s*"DENY"/);
  assert.match(netlify, /Strict-Transport-Security/);
  assert.match(netlify, /frame-ancestors 'none'/);
  assert.match(netlify, /object-src 'none'/);
  assert.doesNotMatch(netlify, /unsafe-eval|unsafe-inline/);
  assert.doesNotMatch(app, /\sstyle=/i);
  assert.match(netlify, /style-src 'self'/);
  assert.match(netlify, /script-src-attr 'none'/);
  assert.match(netlify, /style-src-attr 'none'/);
});

test('all clinical tables enable RLS and clinical reads are restricted to clinical roles', () => {
  for (const table of ['facilities','facility_members','patients','encounters','referrals','follow_ups','audit_events','email_alert_log']) {
    assert.match(schema, new RegExp(`alter table public\\.${table} enable row level security`, 'i'));
  }
  assert.match(schema, /clinical staff read encounters[\s\S]*?can_document_clinical_care/);
  assert.match(schema, /clinical staff read referrals[\s\S]*?can_document_clinical_care/);
  assert.match(schema, /clinical staff read followups[\s\S]*?can_document_clinical_care/);
  assert.match(schema, /audit_facility_members after insert or update on public\.facility_members/i);
});

test('database starts from explicit deny and restricts immutable ownership columns', () => {
  assert.match(schema, /revoke all on public\.facilities[\s\S]*?from public, anon, authenticated/i);
  assert.match(schema, /grant update \(destination_name, reason, urgency, referral_status\)[\s\S]*?on public\.referrals to authenticated/i);
  assert.match(schema, /grant update \(due_date, followup_status, outcome\)[\s\S]*?on public\.follow_ups to authenticated/i);
  assert.match(schema, /revoke all on function public\.consume_email_alert_quota\(uuid, uuid, text\) from public, anon, authenticated/i);
});

test('email function verifies identity, facility membership, record ownership and quota before sending', () => {
  assert.match(edge, /\/auth\/v1\/user/);
  assert.match(edge, /facility_members\?select=id/);
  assert.match(edge, /facility_id=eq\.\$\{facilityId\}&id=eq\.\$\{recordId\}/);
  assert.match(edge, /rpc\/consume_email_alert_quota/);
  assert.match(edge, /new TextEncoder\(\)\.encode\(rawBody\)\.byteLength > 4_096/);
  assert.doesNotMatch(edge, /responseText\.slice|detail\.slice/);
  assert.match(edge, /SUPABASE_SECRET_KEYS/);
  assert.match(edge, /SUPABASE_PUBLISHABLE_KEYS/);
});

test('email content is generic and does not interpolate patient fields', () => {
  const start = edge.indexOf('// Never include patient IDs');
  const emailBlock = edge.slice(start);
  assert.match(emailBlock, /This alert intentionally contains no patient details/);
  assert.doesNotMatch(emailBlock, /patient\.first_name|patient\.last_name|diagnosis|referral\.reason/);
});

test('deployment instructions distinguish source-level checks from real security validation', () => {
  assert.match(readme, /do not start with real patient data/i);
  assert.match(readme, /RLS/);
  assert.match(readme, /security assessment/);
  assert.match(readme, /supabase\/functions\/\.env/);
});
