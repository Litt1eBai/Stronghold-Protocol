/** Validate the fixed server origin shared by desktop and Android build entrypoints. */
export function clientServerOrigin(value) {
  let endpoint;
  try { endpoint = new URL(String(value || '').trim()); }
  catch { throw new Error('Set SP_SERVER_URL to an http:// or https:// server origin'); }
  if (!['http:', 'https:'].includes(endpoint.protocol) || endpoint.username || endpoint.password
      || endpoint.pathname !== '/' || endpoint.search || endpoint.hash) {
    throw new Error('SP_SERVER_URL must be an http:// or https:// origin without credentials, a path, query or fragment');
  }
  return endpoint.origin;
}
