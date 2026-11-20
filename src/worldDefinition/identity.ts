import { GameState } from '../types/GameState';
import { WorldDefinition } from './types';
import { worldContentFingerprint } from './contentIdentity';

/** Shared authored-world identity. Same values on definition, GameState, and persistence. */
export interface AuthoredWorldIdentity {
  worldId: string;
  formatVersion: string;
  level: number;
}

export function identityFromDefinition(definition: WorldDefinition): AuthoredWorldIdentity {
  return {
    worldId: definition.worldId,
    formatVersion: definition.formatVersion,
    level: definition.level,
  };
}

export function identityFromGameState(state: GameState): AuthoredWorldIdentity | null {
  if (!state.definitionWorldId || !state.definitionFormatVersion || state.worldLevel == null) {
    return null;
  }
  return {
    worldId: state.definitionWorldId,
    formatVersion: state.definitionFormatVersion,
    level: state.worldLevel,
  };
}

export function worldIdentitiesEqual(a: AuthoredWorldIdentity, b: AuthoredWorldIdentity): boolean {
  return a.worldId === b.worldId && a.formatVersion === b.formatVersion && a.level === b.level;
}

export function assertWorldIdentity(state: GameState, definition: WorldDefinition): void {
  if (state.definitionContentFingerprint != null && state.definitionContentFingerprint !== worldContentFingerprint(definition)) {
    throw new Error('Authored world content differs from the persisted world; explicit content migration required');
  }
  const fromState = identityFromGameState(state);
  const fromDef = identityFromDefinition(definition);
  if (!fromState || !worldIdentitiesEqual(fromState, fromDef)) {
    throw new Error(
      `world identity mismatch: GameState ${state.definitionWorldId}/${state.definitionFormatVersion}/${state.worldLevel}`
      + ` vs definition ${definition.worldId}/${definition.formatVersion}/${definition.level}`,
    );
  }
}
