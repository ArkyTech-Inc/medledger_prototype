import { timingSafeEqual } from 'node:crypto';

const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: {'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}
});

function matches(value, expected) {
  const actualBytes = Buffer.from(value);
  const expectedBytes = Buffer.from(expected);
  return actualBytes.length === expectedBytes.length && timingSafeEqual(actualBytes, expectedBytes);
}

export default async function adminGate(request) {
  if (request.method !== 'POST') {
    return json({error:'Method not allowed.'}, 405);
  }

  const expectedUsername = process.env.MEDLEDGER_ADMIN_USERNAME;
  const expectedPassword = process.env.MEDLEDGER_ADMIN_PASSWORD;
  if (!expectedUsername || !expectedPassword) {
    return json({error:'Admin access is not configured on the server.'}, 503);
  }

  const rawBody = await request.text();
  if (new TextEncoder().encode(rawBody).byteLength > 1024) {
    return json({error:'Request is too large.'}, 413);
  }

  let credentials;
  try {
    credentials = JSON.parse(rawBody);
  } catch {
    return json({error:'Invalid request.'}, 400);
  }

  if (
    !credentials ||
    typeof credentials.username !== 'string' ||
    typeof credentials.password !== 'string'
  ) {
    return json({error:'Invalid request.'}, 400);
  }

  const username = credentials.username.trim().toLowerCase();
  if (!matches(username, expectedUsername.trim().toLowerCase()) ||
      !matches(credentials.password, expectedPassword)) {
    return json({error:'That username or password was not recognised.'}, 401);
  }

  return json({authenticated:true});
}
