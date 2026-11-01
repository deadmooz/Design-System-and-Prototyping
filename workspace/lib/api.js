/** Workspace ↔ local server. API keys live only on the server. */

async function call(path, body, signal) {
  const res = await fetch(path, {
    method: body ? 'POST' : 'GET',
    headers: body ? { 'content-type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
    signal,
  });
  let json = null;
  try { json = await res.json(); } catch { /* non-JSON error page */ }
  if (!res.ok) throw new Error(json?.error ?? `Request failed (${res.status})`);
  return json;
}

export const api = {
  providers: () => call('/api/providers'),
  extractUrl: (body, signal) => call('/api/extract/url', body, signal),
  extractFigma: (body, signal) => call('/api/extract/figma', body, signal),
  refine: (body) => call('/api/refine', body),
  create: (body, signal) => call('/api/create', body, signal),
  generate: (body, signal) => call('/api/generate', body, signal),
  settings: () => call('/api/settings'),
  saveSetting: (body) => call('/api/settings', body),
  setDefaultProvider: (provider) => call('/api/settings/default', { provider }),
  testProvider: (provider) => call('/api/settings/test', { provider }),
};
