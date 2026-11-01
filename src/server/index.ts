import { existsSync } from 'node:fs';
import { createServer } from 'node:http';
import { resolve } from 'node:path';
import { ProviderRegistry } from '../llm/registry.ts';
import { createHandler } from './app.ts';

const envFile = resolve(import.meta.dirname, '../../.env');
if (existsSync(envFile)) process.loadEnvFile(envFile);

const env = process.env;
const port = Number(env.PORT) || 4310;
const host = env.HOST || '127.0.0.1';
const registry = new ProviderRegistry(env);

createServer(createHandler({ env, registry })).listen(port, host, () => {
  const ready = registry.list().filter((p) => p.configured).map((p) => p.id).join(', ');
  console.log(`Design System & Prototyping workspace → http://${host === '0.0.0.0' ? 'localhost' : host}:${port}`);
  console.log(`LLM providers ready: ${ready} (default: ${registry.defaultId})`);
  if (host !== '127.0.0.1' && host !== 'localhost') console.warn('Warning: listening beyond localhost. The API can spend your LLM credits; put it behind authentication.');
});
