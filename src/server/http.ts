import { IncomingMessage, Server, ServerResponse, createServer } from 'node:http';
import { CommandRequest } from '../orchestration/protocol';
import { BadRequestError, resolvePlayerId } from './identity';
import { GameplaySessionReceiptError } from './gameplaySessionLifecycle';
import { CommandNotExposedError, CommandSessionHost, PersistenceFailedError } from './session';
import { ErrorCode, publicOrchestrationError } from '../orchestration/errors';

const MAX_BODY_BYTES = 1024 * 1024;
type InternalErrorReporter=(diagnostic:unknown)=>void;
function reportInternalError(report:InternalErrorReporter,diagnostic:unknown):void {
  try{report(diagnostic);}catch{/* Logging cannot change command or HTTP results. */}
}
function sendInternalError(res:ServerResponse,report:InternalErrorReporter,diagnostic:unknown):void {
  reportInternalError(report,diagnostic);
  sendJson(res,500,{error:'INTERNAL',message:'Internal server error. Please retry.'});
}
function sendPersistenceError(res:ServerResponse,report:InternalErrorReporter,err:PersistenceFailedError):void {
  reportInternalError(report,err);
  sendJson(res,500,{error:'PERSISTENCE_FAILED',message:'Unable to save game state. Please retry.',code:err.code});
}
/** World/catch-up results can contain nested error bodies as well as top-level
 * command errors. Project every JSON error surface; retain originals for logs. */
function publicErrorProjection(value:unknown,diagnostics:unknown[]):unknown {
  if(Array.isArray(value))return value.map(v=>publicErrorProjection(v,diagnostics));
  if(value&&typeof value==='object'&&Object.getPrototypeOf(value)===Object.prototype) {
    const object=value as Record<string,unknown>,code=object.code;
    if((code===ErrorCode.INVALID_GAME_STATE||code===ErrorCode.ENGINE_ERROR)&&typeof object.message==='string') {
      diagnostics.push(object);return publicOrchestrationError({code,message:object.message});
    }
    return Object.fromEntries(Object.entries(object).map(([k,v])=>[k,publicErrorProjection(v,diagnostics)]));
  }
  return value;
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(payload);
}

function pathname(req: IncomingMessage): string {
  const raw = req.url ?? '/';
  try {
    return new URL(raw, 'http://127.0.0.1').pathname;
  } catch {
    return raw;
  }
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const declared = req.headers['content-length'];
    if (declared !== undefined && Number(declared) > MAX_BODY_BYTES) {
      reject(new BadRequestError('Request body exceeds 1 MiB'));
      req.resume();
      return;
    }
    const chunks: Buffer[] = [];
    let size = 0;
    let settled = false;
    const fail = (err: Error): void => {
      if (settled) return;
      settled = true;
      reject(err);
    };
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        fail(new BadRequestError('Request body exceeds 1 MiB'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (settled) return;
      settled = true;
      resolve(Buffer.concat(chunks).toString('utf8'));
    });
    req.on('error', (err) => fail(err));
  });
}

function isJsonContentType(req: IncomingMessage): boolean {
  const header = req.headers['content-type'];
  if (typeof header !== 'string') return false;
  return header.split(';', 1)[0].trim().toLowerCase() === 'application/json';
}

function optionalObject(value: unknown, field: string): Record<string, unknown> | undefined {
  if (value === undefined) return undefined;
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new BadRequestError(`${field} must be an object`);
  }
  return value as Record<string, unknown>;
}

function commandFromBody(req: IncomingMessage, parsed: unknown): CommandRequest {
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new BadRequestError('Request body must be a JSON object');
  }
  const body = parsed as Record<string, unknown>;
  if (typeof body.commandId !== 'string' || body.commandId.trim() === '') {
    throw new BadRequestError('commandId must be a non-empty string');
  }
  if (body.timestamp !== undefined && typeof body.timestamp !== 'number') {
    throw new BadRequestError('timestamp must be a number');
  }
  if (body.requestId !== undefined && typeof body.requestId !== 'string') {
    throw new BadRequestError('requestId must be a string');
  }
  if (body.gameplaySessionId !== undefined && typeof body.gameplaySessionId !== 'string') {
    throw new BadRequestError('gameplaySessionId must be a string');
  }
  if (body.renewalSequence !== undefined && typeof body.renewalSequence !== 'number') {
    throw new BadRequestError('renewalSequence must be a positive safe integer');
  }
  if (body.commandSequence !== undefined && typeof body.commandSequence !== 'number') {
    throw new BadRequestError('commandSequence must be a positive safe integer');
  }
  const playerId = resolvePlayerId(req, body);
  return {
    commandId: body.commandId,
    playerId,
    timestamp: body.timestamp as number | undefined,
    parameters: optionalObject(body.parameters, 'parameters'),
    clientContext: optionalObject(body.clientContext, 'clientContext'),
    requestId: body.requestId as string | undefined,
    gameplaySessionId: body.gameplaySessionId as string | undefined,
    renewalSequence: body.renewalSequence as number | undefined,
    commandSequence: body.commandSequence as number | undefined,
  };
}

async function readJsonObject(req: IncomingMessage): Promise<Record<string, unknown>> {
  if (!isJsonContentType(req)) {
    throw new BadRequestError('Content-Type must be application/json');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readBody(req));
  } catch (err) {
    if (err instanceof BadRequestError) throw err;
    throw new BadRequestError('Malformed JSON');
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new BadRequestError('Request body must be a JSON object');
  }
  return parsed as Record<string, unknown>;
}

function requireRequestId(body: Record<string, unknown>): string {
  if (typeof body.requestId !== 'string') throw new BadRequestError('requestId must be a non-empty string');
  return body.requestId;
}

function requireRenewalSequence(body: Record<string, unknown>): number {
  if (typeof body.renewalSequence !== 'number' || !Number.isSafeInteger(body.renewalSequence) || body.renewalSequence < 1) {
    throw new BadRequestError('renewalSequence must be a positive safe integer');
  }
  return body.renewalSequence;
}

function requireGameplaySessionId(body: Record<string, unknown>): string {
  if (typeof body.gameplaySessionId !== 'string') {
    throw new BadRequestError('gameplaySessionId must be a non-empty string');
  }
  return body.gameplaySessionId;
}

async function handleSession(
  req: IncomingMessage,
  res: ServerResponse,
  host: CommandSessionHost,
  kind: 'open' | 'heartbeat' | 'end',
  report:InternalErrorReporter,
): Promise<void> {
  let body: Record<string, unknown>;
  try {
    body = await readJsonObject(req);
  } catch (err) {
    const message = err instanceof BadRequestError ? err.message : 'Malformed request';
    sendJson(res, 400, { error: 'BAD_REQUEST', message });
    return;
  }
  try {
    const playerId = resolvePlayerId(req, body);
    const requestId = requireRequestId(body);
    const view = kind === 'open'
      ? await host.openGameplaySession(playerId, requestId)
      : kind === 'heartbeat'
        ? await host.heartbeatGameplaySession(
          playerId,
          requestId,
          requireGameplaySessionId(body),
          requireRenewalSequence(body),
        )
        : await host.endGameplaySession(playerId, requestId, requireGameplaySessionId(body));
    sendJson(res, 200, view);
  } catch (err) {
    if (err instanceof BadRequestError) {
      sendJson(res, 400, { error: 'BAD_REQUEST', message: err.message });
      return;
    }
    if (err instanceof GameplaySessionReceiptError) {
      sendJson(res, 409, { error: 'STALE_RECEIPT', message: err.message });
      return;
    }
    if (err instanceof PersistenceFailedError) {
      sendPersistenceError(res,report,err);
      return;
    }
    sendInternalError(res,report,err);
  }
}

async function handleCommand(req: IncomingMessage, res: ServerResponse, host: CommandSessionHost,report:InternalErrorReporter): Promise<void> {
  let parsed: Record<string, unknown>;
  try {
    parsed = await readJsonObject(req);
  } catch (err) {
    const message = err instanceof BadRequestError ? err.message : 'Malformed JSON';
    sendJson(res, 400, { error: 'BAD_REQUEST', message });
    return;
  }
  let request: CommandRequest;
  try {
    request = commandFromBody(req, parsed);
  } catch (err) {
    const message = err instanceof BadRequestError ? err.message : 'Malformed request';
    sendJson(res, 400, { error: 'BAD_REQUEST', message });
    return;
  }
  try {
    const response = await host.execute(request);
    const diagnostics:unknown[]=[],publicResponse=publicErrorProjection(response,diagnostics);
    if(diagnostics.length)reportInternalError(report,{commandId:response.commandId,requestId:response.requestId,errors:diagnostics});
    sendJson(res, 200, publicResponse);
  } catch (err) {
    if (err instanceof CommandNotExposedError) {
      sendJson(res, 403, { error: 'COMMAND_NOT_EXPOSED', message: err.message });
      return;
    }
    if (err instanceof PersistenceFailedError) {
      sendPersistenceError(res,report,err);
      return;
    }
    sendInternalError(res,report,err);
  }
}

export function createCommandHttpServer(host: CommandSessionHost,options:{onInternalError?:InternalErrorReporter}={}): Server {
  const report=options.onInternalError??((diagnostic:unknown)=>console.error('Internal game request failure',diagnostic));
  return createServer((req, res) => {
    const path = pathname(req);
    if (req.method === 'GET' && path === '/health') {
      sendJson(res, 200, { ok: true, service: 'rep-wars', persistence: host.persistenceName });
      return;
    }
    if (req.method === 'POST' && (path === '/session/open' || path === '/session/heartbeat' || path === '/session/end')) {
      const kind = path === '/session/open' ? 'open' : path === '/session/heartbeat' ? 'heartbeat' : 'end';
      void handleSession(req, res, host, kind,report).catch((err: unknown) => {
        if (res.headersSent) return;
        sendInternalError(res,report,err);
      });
      return;
    }
    if (req.method === 'POST' && path === '/commands') {
      void handleCommand(req, res, host,report).catch((err: unknown) => {
        if (res.headersSent) return;
        sendInternalError(res,report,err);
      });
      return;
    }
    sendJson(res, 404, { error: 'NOT_FOUND', message: 'Not found' });
  });
}
