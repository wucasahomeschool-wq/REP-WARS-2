/** Persisted operation ID continuity, including legacy commitment references during migration. */
function nextSequenceForId(id: unknown): number {
  const match = typeof id === 'string'
    ? /^cmt_[0-9a-z]+_[0-9a-z]+_-?\d+_([0-9a-z]+)_/.exec(id) : null;
  if (!match) return 0; // Custom historical IDs have no recoverable sequence.
  const sequence = parseInt(match[1]!, 36);
  // An unrepresentable sequence must fail validation rather than wrap/reset.
  return Number.isSafeInteger(sequence) && sequence < Number.MAX_SAFE_INTEGER
    ? sequence + 1 : Infinity;
}

interface RecordedCommitmentReferences {
  operations?: ReadonlyMap<unknown, unknown>;
  commitments?: ReadonlyMap<unknown, unknown>;
  armies: ReadonlyMap<unknown, unknown>;
  activeInvasions: ReadonlyMap<unknown, unknown>;
}
function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' ? value as Record<string, unknown> : {};
}

/** One pass over persisted identities, independent of faction/map ordering. */
export function recordedAiCommitmentSequenceFloors(state: RecordedCommitmentReferences): Map<unknown, number> {
  const floors = new Map<unknown, number>();
  const observe = (factionId: unknown, ...ids: unknown[]) => {
    for (const id of ids) floors.set(factionId, Math.max(floors.get(factionId) ?? 0, nextSequenceForId(id)));
  };
  for (const [factionId, value] of state.commitments ?? []) observe(factionId, record(value).id);
  for (const value of state.operations?.values() ?? []) {
    const op = record(value); observe(op.warlordId, op.id);
  }
  for (const value of state.armies.values()) {
    const army = record(value);
    observe(army.owner, record(army.movement).commitmentId, record(army.attackIntent).commitmentId);
  }
  for (const value of state.activeInvasions.values()) {
    const invasion = record(value); observe(invasion.attackerFactionId, invasion.commitmentId);
  }
  return floors;
}
/** Minimum next sequence implied by persisted IDs, including physical references. */
export function recordedAiCommitmentSequenceFloor(state: RecordedCommitmentReferences, factionId: unknown): number {
  return recordedAiCommitmentSequenceFloors(state).get(factionId) ?? 0;
}
