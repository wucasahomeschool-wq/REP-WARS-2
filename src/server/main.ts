import { createCommandHttpServer } from './http';
import { createDevelopmentPersistence } from './persistencePort';
import { createSessionHost } from './session';

function resolvePort(): number {
  const raw = process.env.PORT ?? '8787';
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error(`Invalid PORT ${raw}`);
  }
  return port;
}

if (process.env.NODE_ENV === 'production') {
  throw new Error('Production requires a configured trusted identity adapter; the development entry point cannot serve it');
}
if (process.env.REP_WARS_ALLOW_DEVELOPMENT_IDENTITY !== 'true') {
  throw new Error('Local development requires explicit REP_WARS_ALLOW_DEVELOPMENT_IDENTITY=true');
}
const persistence = createDevelopmentPersistence();
const host = createSessionHost(persistence);
const server = createCommandHttpServer(host, { identity: { mode: 'development' } });
const port = resolvePort();

server.listen(port, '127.0.0.1', () => {
  console.log(`Rep Wars HTTP bridge listening on http://127.0.0.1:${port}`);
  if (persistence.name === 'supabase') {
    console.log('Supabase persistence: this empire reloads after the process exits.');
  } else {
    console.log('In-memory persistence: the empire is lost when this process exits.');
  }
});
