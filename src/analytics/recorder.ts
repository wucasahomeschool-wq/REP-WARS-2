import { collectCommandTelemetry, collectPersistenceTelemetry } from './observer';
import { InMemoryTelemetryStore } from './inMemoryStore';
import {
  CommandObservation,
  PersistenceObservation,
  TelemetryEvent,
  TelemetryQuery,
  TelemetryRecorder,
  TelemetryStore,
} from './types';

/**
 * Isolates analytics from gameplay. observe* never throws into the
 * Orchestrator or persistence path.
 */
export class IsolatedTelemetryRecorder implements TelemetryRecorder {
  private lastByCorrelation = new Map<string, string>();

  constructor(readonly store: TelemetryStore = new InMemoryTelemetryStore()) {}

  observeCommand(input: CommandObservation): void {
    try {
      const collected = collectCommandTelemetry(input, this.lastByCorrelation);
      this.lastByCorrelation = collected.lastByCorrelation;
      if (collected.events.length === 0) return;
      this.store.append(collected.events);
    } catch {
      // Gameplay continues. Telemetry is best-effort.
    }
  }

  observePersistence(input: PersistenceObservation): void {
    try {
      const events = collectPersistenceTelemetry(input);
      if (events.length === 0) return;
      this.store.append(events);
    } catch {
      // Gameplay continues.
    }
  }

  getEvents(query?: TelemetryQuery): TelemetryEvent[] {
    try {
      return this.store.query(query);
    } catch {
      return [];
    }
  }
}

export function createTelemetryRecorder(store?: TelemetryStore): IsolatedTelemetryRecorder {
  return new IsolatedTelemetryRecorder(store ?? new InMemoryTelemetryStore());
}

export function safeObserveCommand(
  recorder: TelemetryRecorder | null | undefined,
  input: CommandObservation,
): void {
  if (!recorder) return;
  try {
    recorder.observeCommand(input);
  } catch {
    // never rethrow
  }
}

export function safeObservePersistence(
  recorder: TelemetryRecorder | null | undefined,
  input: PersistenceObservation,
): void {
  if (!recorder) return;
  try {
    recorder.observePersistence(input);
  } catch {
    // never rethrow
  }
}
