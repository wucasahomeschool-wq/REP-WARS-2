import { createCommandHttpServer } from './http';
import { createInMemoryPersistence } from './persistencePort';
import { createSessionHost } from './session';

function resolvePort(): number {
  const raw = process.env.PORT ?? '8787';
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error(`Invalid PORT ${raw}`);
  }
  return port;
}

const persistence = createInMemoryPersistence();
const host = createSessionHost(persistence);
const server = createCommandHttpServer(host);
const port = resolvePort();

server.listen(port, '127.0.0.1', () => {
  console.log(`Rep Wars HTTP bridge listening on http://127.0.0.1:${port}`);
  console.log('In-memory persistence: the empire is lost when this process exits.');
});
