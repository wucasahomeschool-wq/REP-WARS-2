/** Identity continuity for the existing single-commitment format, not a new operation store. */
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
  commitments: ReadonlyMap<unknown, unknown>;
  armies: ReadonlyMap<unknown, unknown>;
  activeInvasions: ReadonlyMap<unknown, unknown>;
}
function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' ? value as Record<string, unknown> : {};
}

/** Minimum next sequence implied by persisted IDs, including physical-operation references. */
export function recordedAiCommitmentSequenceFloor(state: RecordedCommitmentReferences, factionId: unknown): number {
  let floor = nextSequenceForId(record(state.commitments.get(factionId)).id);
  for (const value of state.armies.values()) {
    const army = record(value);
    if (army.owner !== factionId) continue;
    floor = Math.max(floor, nextSequenceForId(record(army.movement).commitmentId),
      nextSequenceForId(record(army.attackIntent).commitmentId));
  }
  for (const value of state.activeInvasions.values()) {
    const invasion = record(value);
    if (invasion.attackerFactionId === factionId) floor = Math.max(floor, nextSequenceForId(invasion.commitmentId));
  }
  return floor;
}
