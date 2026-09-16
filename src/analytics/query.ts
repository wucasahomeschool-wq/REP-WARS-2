import { TelemetryEvent, TelemetryQuery } from './types';

function asList<T>(value: T | T[] | undefined): T[] | undefined {
  if (value === undefined) return undefined;
  return Array.isArray(value) ? value : [value];
}

export function sortTelemetryEvents(events: TelemetryEvent[]): TelemetryEvent[] {
  return events.slice().sort((a, b) => {
    if (a.occurredAtWorldTick !== b.occurredAtWorldTick) {
      return a.occurredAtWorldTick - b.occurredAtWorldTick;
    }
    const aMs = a.occurredAtMs ?? 0;
    const bMs = b.occurredAtMs ?? 0;
    if (aMs !== bMs) return aMs - bMs;
    return a.eventId < b.eventId ? -1 : a.eventId > b.eventId ? 1 : 0;
  });
}

export function descendantIds(rootEventId: string, events: readonly TelemetryEvent[]): Set<string> {
  const byCause = new Map<string, string[]>();
  for (const event of events) {
    if (!event.causationId) continue;
    const list = byCause.get(event.causationId) ?? [];
    list.push(event.eventId);
    byCause.set(event.causationId, list);
  }
  const found = new Set<string>();
  const stack = [rootEventId];
  while (stack.length > 0) {
    const id = stack.pop()!;
    for (const child of byCause.get(id) ?? []) {
      if (found.has(child)) continue;
      found.add(child);
      stack.push(child);
    }
  }
  return found;
}

export function matchesTelemetryQuery(
  event: TelemetryEvent,
  query: TelemetryQuery,
  all: readonly TelemetryEvent[] = [],
): boolean {
  const importance = asList(query.importance);
  if (importance && !importance.includes(event.importance)) return false;
  const types = asList(query.eventType);
  if (types && !types.includes(event.eventType)) return false;
  if (query.playerId !== undefined && event.playerId !== query.playerId) return false;
  if (query.worldId !== undefined && event.worldId !== query.worldId) return false;
  if (query.definitionWorldId !== undefined && event.definitionWorldId !== query.definitionWorldId) return false;
  if (query.sessionId !== undefined && event.sessionId !== query.sessionId) return false;
  if (query.factionId !== undefined && event.factionId !== query.factionId) return false;
  if (query.correlationId !== undefined && event.correlationId !== query.correlationId) return false;
  if (query.commandId !== undefined && event.commandId !== query.commandId) return false;
  if (query.requestId !== undefined && event.requestId !== query.requestId) return false;
  if (query.sinceWorldTick !== undefined && event.occurredAtWorldTick < query.sinceWorldTick) return false;
  if (query.untilWorldTick !== undefined && event.occurredAtWorldTick > query.untilWorldTick) return false;

  const cause = query.causedByEventId ?? query.causationId;
  if (cause !== undefined) {
    if (query.includeDescendants) {
      const tree = descendantIds(cause, all.length > 0 ? all : [event]);
      if (event.eventId !== cause && !tree.has(event.eventId)) return false;
    } else if (event.causationId !== cause) {
      return false;
    }
  }
  return true;
}

export function getEvents(events: readonly TelemetryEvent[], query: TelemetryQuery = {}): TelemetryEvent[] {
  return sortTelemetryEvents(events.filter((event) => matchesTelemetryQuery(event, query, events)));
}

export function eventsCausedBy(events: readonly TelemetryEvent[], eventId: string, descendants = true): TelemetryEvent[] {
  return getEvents(events, { causedByEventId: eventId, includeDescendants: descendants });
}

export function reconstructChain(events: readonly TelemetryEvent[], correlationId: string): TelemetryEvent[] {
  return getEvents(events, { correlationId });
}
