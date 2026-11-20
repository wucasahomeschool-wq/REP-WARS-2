import { Army } from '../types';

/** Existing banked-deployment condition, shared by local formation and its
 * factual projection. Data only: callers own funding, claims and identity. */
export function soldierForce(id: string, owner: string, location: string, soldiers: number): Army {
  return { id, owner, location, soldiers, knights: 0, siegeEngines: 0,
    morale: 80, supply: 80, movement: null, attackIntent: null };
}
