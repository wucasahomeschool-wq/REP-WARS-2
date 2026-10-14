import { WorldDefinition, WorldFactionDefinition, WORLD_FORMAT_VERSION } from '../../worldDefinition/types';
import { assertValidWorld } from '../../worldDefinition/validate';
import { createGameStateFromWorld } from '../../worldDefinition/instantiate';
import { getDefaultWorldCatalog } from '../../worldDefinition/catalog';
import { PersonalitySystem } from '../../personality/PersonalitySystem';
import { PersonalityType, Resources, TerrainType } from '../../types';
import { assignGoal } from '../../cognition/goals';
import { ensureCity, syncCityFortification } from '../../gameplay/cities/city';
import { setPlayerEmpirePause } from '../../gameplay/invasion/pause';
import { checkGameStateInvariants } from '../../state/gameStateInvariants';

export const SIZES = { small: { width: 5, height: 2, factions: 3 }, medium: { width: 6, height: 5, factions: 5 }, large: { width: 10, height: 5, factions: 8 } } as const;
export interface ScenarioConfig { size: keyof typeof SIZES; seed: number; ticks: number; presence: 'online' | 'offline'; stepTicks?: number; reloadEvery?: number; reverseInsertion?: boolean; }
export const RESOURCES: (keyof Resources)[] = ['gold', 'food', 'wood', 'iron', 'stone'];
export const zeros = (): Resources => ({ gold: 0, food: 0, wood: 0, iron: 0, stone: 0 });
export function createScenario(config: ScenarioConfig) {
  if (!(config.size in SIZES) || !['online','offline'].includes(config.presence) || !Number.isSafeInteger(config.seed) || !Number.isSafeInteger(config.ticks) || config.ticks < 0) throw new Error('Invalid scenario');
  const { width, height, factions } = SIZES[config.size];
  const count = width * height, observer = 'f_observer';
  const id = (n: number) => `t_${String(n).padStart(3, '0')}`;
  const snake: number[] = [];
  for (let y = 0; y < height; y++) for (let j = 0; j < width; j++) snake.push(y * width + (y % 2 ? width - 1 - j : j));
  const observerIndex = snake.pop()!;
  const owner = new Map<number, string>([[observerIndex, observer]]);
  snake.forEach((n, i) => owner.set(n, `f_ai_${Math.floor(i * factions / snake.length)}`));
  const personalities: PersonalityType[] = ['aggressive', 'economic', 'diplomatic', 'expansionist', 'defensive', 'opportunistic'];
  const terrains: TerrainType[] = ['plains', 'hills', 'forest', 'river', 'mountain', 'coastal'];
  const rectangle = (x: number, y: number, w = 1, h = 1) => ({ rings: [[{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }, { x, y }]] });
  const bank = (i: number): Resources => ({ gold: i % 3 === 2 ? 240 : 1400, food: 900, iron: 220, wood: i % 3 === 0 ? 60 : 650, stone: i % 3 === 1 ? 10 : 600 });
  const definition: WorldDefinition = {
    formatVersion: WORLD_FORMAT_VERSION, worldId: `ai-sim:${config.size}:${config.seed}`, level: 2,
    name: `AI simulation ${config.size} seed ${config.seed}`, playerFactionId: observer,
    island: rectangle(0, 0, width, height), completion: { type: 'manual' }, containedWorlds: [],
    regions: [{ id: 'r_world', name: 'Simulation region', worldId: `ai-sim:${config.size}:${config.seed}`, territoryIds: Array.from({ length: count }, (_, n) => id(n)) }],
    factions: Array.from({ length: factions }, (_, i): WorldFactionDefinition => {
      const type = personalities[i % personalities.length], { type: presetType, ...traits } = PersonalitySystem.createPreset(type);
      const home = id(snake.find(n => owner.get(n) === `f_ai_${i}`)!);
      return { id: `f_ai_${i}`, role: 'ai' as const, name: `${type} ${i}`, homeTerritoryId: home,
        startingResources: bank(i), startingArmy: { soldiers: 1600 + (Math.abs(config.seed + i * 13) % 5) * 40, knights: 60, siegeEngines: 2, locationTerritoryId: home },
        personality: { id: i < 6 ? type : `${type}-${i}`, label: type, ambition: 0.6, traits } };
    }).concat([{ id: observer, role: 'player', name: 'Passive observer', homeTerritoryId: id(observerIndex), startingResources: zeros(),
      startingArmy: { soldiers: 0, knights: 0, siegeEngines: 0, locationTerritoryId: id(observerIndex) }, personality: null }]),
    startingDiplomacy: Array.from({ length: factions }, (_, i) => Array.from({ length: factions - i - 1 }, (_, j) => ({ a: `f_ai_${i}`, b: `f_ai_${i + j + 1}`, state: 'at_war' as const, opinion: 0 }))).flat(),
    territories: Array.from({ length: count }, (_, n) => {
      const x = n % width, y = Math.floor(n / width);
      const neighbors = [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]].filter(([a, b]) => a >= 0 && a < width && b >= 0 && b < height).map(([a, b]) => id(b * width + a)).sort();
      return { id: id(n), regionId: 'r_world', startingOwnerFactionId: owner.get(n)!, neighborIds: neighbors,
        terrain: terrains[(n + Math.abs(config.seed)) % terrains.length], resourceOutput: n === observerIndex ? zeros() : { gold: 25, food: 100, wood: 20 + n % 3 * 10, iron: 10, stone: 20 }, polygon: rectangle(x, y) };
    }),
  };
  assertValidWorld(definition);
  getDefaultWorldCatalog().register(definition);
  const state = createGameStateFromWorld(definition, { seed: config.seed });
  setPlayerEmpirePause(state, true);
  for (const f of definition.factions.filter(f => f.role === 'ai')) {
    const army = [...state.armies.values()].find(a => a.owner === f.id)!;
    const owned = [...state.territories.values()].filter(t => t.owner === f.id).sort((a, b) => a.id.localeCompare(b.id));
    // Authored starting troops are split, never added. Native local pools start empty.
    for (const t of owned) { const garrison = t.id === f.homeTerritoryId ? 100 : 50; army.soldiers -= garrison; t.garrison = garrison; t.population = 500; t.baseValue = 25; }
    ensureCity(state, f.homeTerritoryId, f.id);
    state.territories.get(f.homeTerritoryId)!.fortification = 1;
    syncCityFortification(state, f.homeTerritoryId, 1, 0);
    assignGoal(state, f.id, `sim-development:${f.id}`, { kind: 'DEVELOPMENT', territoryId: f.homeTerritoryId, projectType: 'FARM' }, 50);
    const enemy = owned.flatMap(t => t.neighboring).sort().find(t => state.territories.get(t)!.owner !== f.id && state.territories.get(t)!.owner !== observer);
    if (enemy) assignGoal(state, f.id, `sim-border:${f.id}`, f.personality!.label === 'diplomatic' ? { kind: 'PEACE', factionId: state.territories.get(enemy)!.owner! } : { kind: 'CONTROL_TERRITORY', territoryId: enemy }, 50);
  }
  const violations = checkGameStateInvariants(state);
  if (violations.length) throw new Error(JSON.stringify(violations));
  if (config.reverseInsertion) {
    // Equivalent initial values in different Map insertion order, for diagnostics.
    // Do not change ID-bearing arrays, sampled timers, or runtime RNG state.
    for (const key of Object.keys(state) as (keyof typeof state)[]) {
      const value: unknown = state[key];
      if (value instanceof Map) (state as unknown as Record<string, unknown>)[key] = new Map([...value.entries()].reverse());
    }
  }
  return { definition, state };
}
