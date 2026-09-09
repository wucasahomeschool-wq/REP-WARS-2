import { Territory, TerritoryId } from '../types';

export type NeighborGraphIssueKind =
  | 'missing_neighbor'
  | 'self_neighbor'
  | 'non_reciprocal'
  | 'duplicate_neighbor';

export interface NeighborGraphIssue {
  kind: NeighborGraphIssueKind;
  territoryId: TerritoryId;
  neighborId: TerritoryId;
}

/** Pure graph checks. Does not change map generation. */
export function collectNeighborGraphIssues(
  territories: Iterable<Pick<Territory, 'id' | 'neighboring'>> | Map<TerritoryId, Pick<Territory, 'id' | 'neighboring'>>,
): NeighborGraphIssue[] {
  const byId = new Map<string, Pick<Territory, 'id' | 'neighboring'>>();
  const iterable = territories instanceof Map ? territories.values() : territories;
  for (const t of iterable) byId.set(t.id, t);

  const issues: NeighborGraphIssue[] = [];
  for (const t of byId.values()) {
    const seen = new Set<TerritoryId>();
    for (const nid of t.neighboring) {
      if (seen.has(nid)) {
        issues.push({ kind: 'duplicate_neighbor', territoryId: t.id, neighborId: nid });
        continue;
      }
      seen.add(nid);
      if (nid === t.id) {
        issues.push({ kind: 'self_neighbor', territoryId: t.id, neighborId: nid });
        continue;
      }
      const n = byId.get(nid);
      if (!n) {
        issues.push({ kind: 'missing_neighbor', territoryId: t.id, neighborId: nid });
        continue;
      }
      if (!n.neighboring.includes(t.id)) {
        issues.push({ kind: 'non_reciprocal', territoryId: t.id, neighborId: nid });
      }
    }
  }
  return issues;
}
