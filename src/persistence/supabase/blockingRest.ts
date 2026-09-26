import { spawnSync } from 'child_process';
import { PersistenceError } from '../errors';
import { readSupabaseServerConfig, SupabaseServerConfig } from './config';

export interface RestCall {
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  path: string;
  body?: unknown;
  prefer?: string;
}

export interface RestResult {
  status: number;
  text: string;
}

const CHILD = `
const fs = require('fs');
const input = JSON.parse(fs.readFileSync(0, 'utf8'));
const base = String(process.env.SUPABASE_URL || '').replace(/\\/$/, '');
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const headers = {
  apikey: key,
  Authorization: 'Bearer ' + key,
  'Content-Type': 'application/json',
  Prefer: input.prefer || 'return=representation',
};
fetch(base + '/rest/v1/' + input.path, {
  method: input.method,
  headers,
  body: input.body === undefined ? undefined : JSON.stringify(input.body),
}).then(async (res) => {
  const text = await res.text();
  process.stdout.write(JSON.stringify({ status: res.status, text }));
}).catch((err) => {
  const message = err && err.message ? String(err.message) : 'request failed';
  process.stdout.write(JSON.stringify({ status: 0, text: message }));
});
`;

function redact(text: string): string {
  return text
    .replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, '[redacted]')
    .slice(0, 500);
}

export function supabaseRest(call: RestCall, config: SupabaseServerConfig = readSupabaseServerConfig()): RestResult {
  const child = spawnSync(process.execPath, ['-e', CHILD], {
    input: JSON.stringify({ method: call.method, path: call.path, body: call.body, prefer: call.prefer }),
    encoding: 'utf8',
    env: {
      ...process.env,
      SUPABASE_URL: config.url,
      SUPABASE_SERVICE_ROLE_KEY: config.serviceRoleKey,
    },
    windowsHide: true,
    maxBuffer: 32 * 1024 * 1024,
    timeout: 30_000,
  });
  if (child.error) {
    throw new PersistenceError('persistence.save_failed', 'Supabase request could not be started');
  }
  const stdout = child.stdout?.trim() ?? '';
  if (!stdout) {
    throw new PersistenceError(
      'persistence.save_failed',
      `Supabase request failed (${child.status ?? 'no status'})`,
    );
  }
  let parsed: RestResult;
  try {
    parsed = JSON.parse(stdout) as RestResult;
  } catch {
    throw new PersistenceError('persistence.save_failed', 'Supabase returned an unreadable response');
  }
  if (parsed.status === 401 || parsed.status === 403) {
    throw new PersistenceError('persistence.not_configured', 'Supabase rejected the service role credential');
  }
  if (parsed.status === 0) {
    throw new PersistenceError('persistence.save_failed', `Supabase request failed: ${redact(parsed.text)}`);
  }
  return parsed;
}

export function restJson<T>(call: RestCall, config?: SupabaseServerConfig): T {
  const result = supabaseRest(call, config);
  if (result.status === 409) {
    throw new PersistenceError('persistence.conflict', 'Supabase row conflict');
  }
  if (result.status < 200 || result.status >= 300) {
    throw new PersistenceError('persistence.save_failed', `Supabase request failed (${result.status})`);
  }
  if (!result.text) return [] as T;
  try {
    return JSON.parse(result.text) as T;
  } catch {
    throw new PersistenceError('persistence.corrupt', 'Supabase returned malformed JSON');
  }
}

export function eqFilter(column: string, value: string): string {
  return `${column}=eq.${encodeURIComponent(value)}`;
}
