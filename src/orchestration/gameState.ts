/**
 * @deprecated Phase 9 `GameState` (`src/types/GameState.ts`) is the sole
 * authoritative runtime state. This file previously defined
 * `AuthoritativeGameState` with incompatible fields (`worldTimeMs`,
 * wall-clock AI commitments, workout sessions). It is retained only as a
 * migration marker — do not use in new code.
 */
export type { GameState as AuthoritativeGameState } from '../types/GameState';
