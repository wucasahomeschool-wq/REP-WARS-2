import { TraceStep } from './protocol';

export class CommandTrace {
  readonly started = Date.now();
  readonly steps: TraceStep[] = [];

  add(phase: TraceStep['phase'], detail: Record<string, unknown>): void {
    this.steps.push({ phase, atMs: Date.now() - this.started, detail });
  }
}
