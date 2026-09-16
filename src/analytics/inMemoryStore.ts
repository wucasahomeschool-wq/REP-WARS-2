import { TelemetryEvent, TelemetryQuery, TelemetrySink, TelemetryStore } from './types';
import { matchesTelemetryQuery, sortTelemetryEvents } from './query';
import { assertValidTelemetryEvent } from './schema';

/**
 * Append-only in-memory telemetry store with an optional durable sink.
 * Duplicate eventIds are ignored. Sink failures move events into an outbox
 * without removing them from the queryable log.
 */
export class InMemoryTelemetryStore implements TelemetryStore {
  private readonly events: TelemetryEvent[] = [];
  private readonly byId = new Map<string, TelemetryEvent>();
  private pending: TelemetryEvent[] = [];
  private readonly seenOutbox = new Set<string>();

  constructor(private readonly sink?: TelemetrySink | null) {}

  append(events: readonly TelemetryEvent[]): void {
    const novel: TelemetryEvent[] = [];
    for (const event of events) {
      assertValidTelemetryEvent(event);
      if (this.byId.has(event.eventId)) continue;
      this.byId.set(event.eventId, event);
      this.events.push(event);
      novel.push(event);
    }
    if (novel.length === 0 || !this.sink) return;
    try {
      this.sink.persist(novel);
    } catch {
      for (const event of novel) {
        if (this.seenOutbox.has(event.eventId)) continue;
        this.seenOutbox.add(event.eventId);
        this.pending.push(event);
      }
    }
  }

  getById(eventId: string): TelemetryEvent | undefined {
    return this.byId.get(eventId);
  }

  query(query: TelemetryQuery = {}): TelemetryEvent[] {
    return sortTelemetryEvents(this.events.filter((event) => matchesTelemetryQuery(event, query, this.events)));
  }

  all(): TelemetryEvent[] {
    return this.events.slice();
  }

  outbox(): TelemetryEvent[] {
    return this.pending.slice();
  }

  flushOutbox(): { flushed: number; remaining: number } {
    if (!this.sink || this.pending.length === 0) {
      return { flushed: 0, remaining: this.pending.length };
    }
    const still: TelemetryEvent[] = [];
    let flushed = 0;
    for (const event of this.pending) {
      try {
        this.sink.persist([event]);
        this.seenOutbox.delete(event.eventId);
        flushed += 1;
      } catch {
        still.push(event);
      }
    }
    this.pending = still;
    return { flushed, remaining: still.length };
  }
}
