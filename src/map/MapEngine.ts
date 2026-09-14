import { BALANCE, TERRAIN_NAMES } from '../constants/balance';
import { SeededRNG } from '../utils/SeededRNG';
import { DEFAULT_THEME_LIBRARY } from './Themes';
import { NamingSystem } from './NamingSystem';
import {
  MapWorldState,
  InitialWorldParams,
  ExpansionRequest,
  ExpansionResult,
  PlayerVisibilityMap,
  ScoutResult,
  ThemeDefinition,
  ThemeId,
  Territory,
  TerritoryId,
  Region,
  RegionId,
  MapGenerationReport,
  FactionId,
  TerrainType,
  ResourceType,
  VisibilityState,
  MapTerritorySpec,
} from '../types';

interface HexPos {
  q: number;
  r: number;
}

const key = (q: number, r: number): string => `${q},${r}`;
const HEX_DIRS: HexPos[] = [
  { q: +1, r: 0 }, { q: +1, r: -1 }, { q: 0, r: -1 },
  { q: -1, r: 0 }, { q: -1, r: +1 }, { q: 0, r: +1 },
];
const HEX_DIAG: HexPos[] = [
  { q: +2, r: -1 }, { q: +1, r: +1 }, { q: -1, r: +2 },
  { q: -2, r: +1 }, { q: -1, r: -1 }, { q: +1, r: -2 },
];

function hexDist(a: HexPos, b: HexPos): number {
  return (Math.abs(a.q - b.q) + Math.abs(a.q + a.r - b.q - b.r) + Math.abs(a.r - b.r)) / 2;
}

export class MapEngine {
  private naming: NamingSystem;
  private C = BALANCE.mapGen;

  constructor(namingSeed?: number) {
    this.naming = new NamingSystem(namingSeed ?? 0x5EED1E);
  }

  resetNameTracker(): void {
    this.naming.reset();
  }

  /* ─── Theme selection helpers ─────────────────────────────────────── */
  private pickTheme(
    rng: SeededRNG,
    themes: ThemeDefinition[],
    adjacentThemes: ThemeId[],
    preferUnused?: ThemeId[] | null,
    hint?: ThemeId | null,
  ): ThemeDefinition {
    const pool = themes.length ? themes : DEFAULT_THEME_LIBRARY;
    const scores = new Map<ThemeId, number>();
    for (const t of pool) {
      let s = 1 / Math.pow(t.rarity || 1, this.C.themes.rarityWeightingExponent);
      if (hint && t.id === hint)
        s *= 3;
      for (const adjId of adjacentThemes) {
        if (adjId === t.id)
          s *= this.C.themes.sameThemeBiasWhenAdjacent;
        if (t.allowedAdjacentThemes.includes(adjId))
          s *= 1.4;
      }
      if (preferUnused && preferUnused.includes(t.id))
        s *= 2;
      scores.set(t.id, s);
    }
    const total = Array.from(scores.values()).reduce((a, b) => a + b, 0);
    let roll = rng.next() * total;
    for (const t of pool) {
      roll -= scores.get(t.id) ?? 0;
      if (roll <= 0)
        return t;
    }
    return pool[0]!;
  }

  private weightedTerrain(rng: SeededRNG, theme: ThemeDefinition, fallback: TerrainType = 'plains'): TerrainType {
    const map = theme.terrainDistributionWeights;
    const entries = Object.entries(map) as [TerrainType, number][];
    const total = entries.reduce((a, [, w]) => a + w, 0);
    let roll = rng.next() * total;
    for (const [k, w] of entries) {
      roll -= w;
      if (roll <= 0)
        return k;
    }
    return fallback;
  }

  /* ─── Core territory fabricator ───────────────────────────────────── */
  private fabricateTerritory(
    world: MapWorldState,
    pos: HexPos,
    theme: ThemeDefinition,
    rng: SeededRNG,
    opts: {
      isCapital?: boolean;
      owner?: FactionId | null;
      fortHint?: number;
      baseValueMult?: number;
    } = {},
  ): Territory {
    const Cg = this.C.territory;
    const idx = world.graphMeta.nextTerritoryIndex++;
    const id = `t_${idx}_${theme.id.slice(0, 3)}`;
    const isCapital = !!opts.isCapital;
    const terrain = isCapital && theme.preferredTerrain[0]
      ? theme.preferredTerrain[0].terrain
      : this.weightedTerrain(rng, theme);
    const fortRoll = rng.next();
    let fortSum = 0;
    let fortTier = 0;
    const fw = theme.fortificationWeights as Record<string, number>;
    for (const tierStr of ['0', '1', '2', '3', '4', '5']) {
      fortSum += fw[tierStr] ?? 0;
      if (fortRoll < fortSum) {
        fortTier = parseInt(tierStr);
        break;
      }
    }
    if (opts.fortHint !== undefined)
      fortTier = opts.fortHint;
    if (isCapital)
      fortTier = Math.max(fortTier, Cg.fortificationCapitalDefault);
    else if (opts.owner && !isCapital)
      fortTier = Math.max(fortTier, Cg.fortificationStartDefault);
    const garrison = isCapital
      ? Cg.garrisonCapitalBase + rng.nextInt(-80, 150)
      : opts.owner
        ? Cg.garrisonStartBase + rng.nextInt(-50, 80)
        : Cg.garrisonNeutralBase + rng.nextInt(-30, 60);
    const [bvMin, bvMax] = theme.baseValueRange;
    let baseValue = rng.nextInt(bvMin, bvMax);
    if (isCapital)
      baseValue = Math.max(baseValue, rng.nextInt(Cg.capitalBaseValueMin, Cg.capitalBaseValueMax));
    if (opts.baseValueMult)
      baseValue = Math.round(baseValue * opts.baseValueMult);
    const pop = Math.round(baseValue * Cg.populationScaleByValue * (1 + (rng.next() - 0.5) * Cg.populationJitter * 2));
    const resCount = rng.next() < Cg.resourceDensityRoll
      ? rng.nextInt(Cg.minResourcesPerTerritory, Cg.maxResourcesPerTerritory)
      : 0;
    const resourceOutput: Partial<Record<ResourceType, number>> = {};
    const baseResources: ResourceType[] = ['gold', 'food', 'iron', 'wood', 'stone'];
    for (let r = 0; r < resCount; r++) {
      const res = r === 0 && theme.resourceTendencies
        ? this.weightedResource(rng, theme)
        : baseResources[Math.floor(rng.next() * baseResources.length)]!;
      if (!resourceOutput[res])
        resourceOutput[res] = 0;
      const jitter = 1 + (rng.next() - 0.5) * this.C.resources.perResourceJitter * 2;
      const boost = (theme.resourceTendencies?.[res] ?? 1) ** 0.6;
      resourceOutput[res]! += Math.round((5 + rng.nextInt(1, 10)) * jitter * boost);
    }
    const terr: Territory = {
      id,
      owner: opts.owner ?? null,
      regionId: 'r_map_engine_legacy',
      terrain,
      neighboring: [],
      population: Math.max(300, pop),
      baseValue,
      resourceOutput,
      fortification: fortTier,
      garrison: Math.max(0, garrison),
    };
    world.graphMeta.territoryPos.set(id, pos);
    world.graphMeta.coordToTerritory.set(key(pos.q, pos.r), id);
    world.territories.set(id, terr);
    world.graphMeta.generatedTerritoriesCount++;
    return terr;
  }

  private weightedResource(rng: SeededRNG, theme: ThemeDefinition): ResourceType {
    const tend = theme.resourceTendencies ?? {};
    const base: ResourceType[] = ['gold', 'food', 'iron', 'wood', 'stone'];
    const baseW = [this.C.resources.goldBaseWeight, this.C.resources.foodBaseWeight, this.C.resources.ironBaseWeight, this.C.resources.woodBaseWeight, this.C.resources.stoneBaseWeight];
    const scores = base.map((r, i) => baseW[i]! * (1 + Math.log1p((tend[r] ?? 1) * this.C.resources.terrainResourceBoostFactor)));
    const total = scores.reduce((a, b) => a + b, 0);
    let roll = rng.next() * total;
    for (let i = 0; i < base.length; i++) {
      roll -= scores[i]!;
      if (roll <= 0)
        return base[i]!;
    }
    return base[0]!;
  }

  /* ─── Graph / connection logic ───────────────────────────────────── */
  /**
   * Single authoritative mechanism for creating a neighbor edge. This is
   * the ONLY place that is allowed to push into `Territory.neighboring`,
   * which guarantees every edge that is ever created is reciprocal from
   * the moment it exists, and that neither side ever exceeds
   * `maxNeighbors`. Idempotent — safe to call repeatedly for the same
   * pair, and safe to call to "repair" a pre-existing one-directional
   * edge (it will only add the missing side, respecting the cap).
   *
   * Returns true if a and b end up connected (already were, or just got
   * connected), false if the connection was refused because one side has
   * no spare capacity.
   */
  private bidirConnect(a: Territory, b: Territory): boolean {
    if (a.id === b.id)
      return false;
    const cap = this.C.territory.maxNeighbors;
    const aHas = a.neighboring.includes(b.id);
    const bHas = b.neighboring.includes(a.id);
    if (aHas && bHas)
      return true;
    if (!aHas && a.neighboring.length >= cap)
      return false;
    if (!bHas && b.neighboring.length >= cap)
      return false;
    if (!aHas)
      a.neighboring.push(b.id);
    if (!bHas)
      b.neighboring.push(a.id);
    return true;
  }

  /**
   * Single authoritative mechanism for removing a neighbor edge. Removes
   * the id from both sides so an edge can never be torn down
   * asymmetrically (which is what previously caused non-reciprocal
   * edges when a neighbor list was truncated).
   */
  private bidirDisconnect(a: Territory, b: Territory): void {
    const ia = a.neighboring.indexOf(b.id);
    if (ia >= 0)
      a.neighboring.splice(ia, 1);
    const ib = b.neighboring.indexOf(a.id);
    if (ib >= 0)
      b.neighboring.splice(ib, 1);
  }

  private computeNeighborsFor(world: MapWorldState, id: TerritoryId, rng: SeededRNG): void {
    const Cg = this.C.graph;
    const pos = world.graphMeta.territoryPos.get(id);
    if (!pos)
      return;
    const t = world.territories.get(id);
    if (!t)
      return;
    // NOTE: this function is intentionally additive, never destructive.
    // It must NOT reset `t.neighboring = []` here: this function can be
    // called more than once for the same territory (e.g. re-scanning an
    // existing frontier territory after `expandFromFrontier` creates new
    // neighbors around it). Wiping the list would silently drop edges
    // that another territory still points back at, producing a
    // non-reciprocal edge. All additions below go through `bidirConnect`,
    // which is idempotent and cap-aware, so re-running this is always
    // safe.
    const direct = HEX_DIRS.map(d => world.graphMeta.coordToTerritory.get(key(pos.q + d.q, pos.r + d.r))).filter((x): x is TerritoryId => !!x);
    direct.forEach(nid => {
      if (nid !== id)
        this.bidirConnect(t, world.territories.get(nid)!);
    });
    for (const d of HEX_DIAG) {
      const nid = world.graphMeta.coordToTerritory.get(key(pos.q + d.q, pos.r + d.r));
      if (!nid)
        continue;
      const tpos = world.graphMeta.territoryPos.get(nid)!;
      const sharedAdj = HEX_DIRS.filter(dd => {
        const midA = world.graphMeta.coordToTerritory.get(key(pos.q + dd.q, pos.r + dd.r));
        if (!midA)
          return false;
        return hexDist(tpos, { q: pos.q + dd.q, r: pos.r + dd.r }) < 1.5;
      });
      if (sharedAdj.length === 0)
        continue;
      if ((t.neighboring.length + 1) <= this.C.territory.maxNeighbors && rng.next() < this.C.growth.crossNeighborChance) {
        this.bidirConnect(t, world.territories.get(nid)!);
      }
    }
    if (t.neighboring.length < this.C.territory.minNeighbors) {
      let best: { id: TerritoryId; dist: number } | null = null;
      for (const [otherId, otherPos] of world.graphMeta.territoryPos.entries()) {
        if (otherId === id || t.neighboring.includes(otherId))
          continue;
        // Skip candidates with no spare capacity: connecting to them
        // would either be refused by bidirConnect or (previously) force
        // an over-cap truncation that broke reciprocity elsewhere.
        const other = world.territories.get(otherId);
        if (!other || other.neighboring.length >= this.C.territory.maxNeighbors)
          continue;
        const d = hexDist(pos, otherPos);
        if (d <= Cg.neighborDistanceThreshold + Cg.diagonalNeighborThreshold && (!best || d < best.dist)) {
          best = { id: otherId, dist: d };
        }
      }
      if (best)
        this.bidirConnect(t, world.territories.get(best.id)!);
    }
  }

  private refreshFrontier(world: MapWorldState): void {
    const frontier = new Set<TerritoryId>();
    for (const [id] of world.territories.entries()) {
      const pos = world.graphMeta.territoryPos.get(id);
      if (!pos)
        continue;
      for (const d of HEX_DIRS) {
        const neighborId = world.graphMeta.coordToTerritory.get(key(pos.q + d.q, pos.r + d.r));
        if (!neighborId) {
          frontier.add(id);
          break;
        }
      }
    }
    world.graphMeta.frontierTerritories = frontier;
  }

  /**
   * Authoritative post-pass that guarantees the neighbor graph invariants
   * hold: every neighbor id exists, no self-neighbors, no duplicates,
   * every edge is reciprocal, and no territory exceeds `maxNeighbors`.
   *
   * All edge creation elsewhere already goes through `bidirConnect`
   * (cap-aware and inherently reciprocal), so in the normal case this
   * function has nothing to repair. It remains as a defensive,
   * deterministic guarantee of the invariants rather than the primary
   * mechanism, and it never re-introduces the bug it guards against: it
   * only ever ADDS a reverse edge when there is spare capacity, and
   * otherwise DROPS the unmatched reference — it never keeps a
   * one-directional edge, and never truncates one side of an edge
   * without also removing the other side.
   */
  private ensureNeighborsSane(world: MapWorldState): void {
    const cap = this.C.territory.maxNeighbors;

    // Pass 1: normalize each list — drop self-references, drop
    // references to territories that don't exist, and remove duplicate
    // ids. This is a defensive guarantee; `bidirConnect` never produces
    // any of these on its own.
    for (const [id, terr] of world.territories.entries()) {
      const seen = new Set<TerritoryId>();
      const cleaned: TerritoryId[] = [];
      for (const nid of terr.neighboring) {
        if (nid === id || seen.has(nid) || !world.territories.has(nid))
          continue;
        seen.add(nid);
        cleaned.push(nid);
      }
      if (cleaned.length !== terr.neighboring.length)
        terr.neighboring = cleaned;
    }

    // Pass 2: restore reciprocity. If `terr` lists `nid` but `nid` does
    // not list `terr` back, try to add the reverse edge; if `nid` has no
    // spare capacity, drop the one-directional reference from `terr`
    // instead. Reciprocity is never sacrificed just to keep an edge.
    for (const [id, terr] of world.territories.entries()) {
      for (const nid of [...terr.neighboring]) {
        const n = world.territories.get(nid)!;
        if (n.neighboring.includes(id))
          continue;
        if (n.neighboring.length < cap)
          n.neighboring.push(id);
        else
          terr.neighboring = terr.neighboring.filter(x => x !== nid);
      }
    }

    // Pass 3: hard-enforce maxNeighbors on both sides of every edge.
    // Should rarely trigger given passes above and cap-aware
    // `bidirConnect`, but keeps the invariant airtight regardless. Uses
    // `bidirDisconnect` so removing the excess also removes the mirror
    // reference on the other side (the original bug was truncating only
    // one side).
    for (const [, terr] of world.territories.entries()) {
      while (terr.neighboring.length > cap) {
        const excessId = terr.neighboring[terr.neighboring.length - 1]!;
        const excess = world.territories.get(excessId);
        if (excess)
          this.bidirDisconnect(terr, excess);
        else
          terr.neighboring.pop();
      }
    }

    // Pass 4: top up territories below minNeighbors where capacity
    // allows, skipping candidates that have no spare room — we never
    // exceed maxNeighbors on someone else just to satisfy minNeighbors
    // here.
    for (const [id, terr] of world.territories.entries()) {
      if (terr.neighboring.length >= this.C.territory.minNeighbors || world.territories.size <= 2)
        continue;
      const pos = world.graphMeta.territoryPos.get(id);
      if (!pos)
        continue;
      let best: { id: TerritoryId; dist: number } | null = null;
      for (const [otherId, otherPos] of world.graphMeta.territoryPos.entries()) {
        if (otherId === id || terr.neighboring.includes(otherId))
          continue;
        const other = world.territories.get(otherId);
        if (!other || other.neighboring.length >= cap)
          continue;
        const d = hexDist(pos, otherPos);
        if (!best || d < best.dist)
          best = { id: otherId, dist: d };
      }
      if (best)
        this.bidirConnect(terr, world.territories.get(best.id)!);
    }
  }

  /* ─── World state initializers ───────────────────────────────────── */
  createEmptyWorld(worldSeed: number, themes?: ThemeDefinition[]): MapWorldState {
    const themeList = themes ?? DEFAULT_THEME_LIBRARY;
    const themeMap = new Map<ThemeId, ThemeDefinition>();
    for (const t of themeList)
      themeMap.set(t.id, t);
    return {
      worldSeed,
      turn: 1,
      territories: new Map(),
      regions: new Map(),
      themes: themeMap,
      graphMeta: {
        nextTerritoryIndex: 1,
        nextRegionIndex: 1,
        generatedTerritoriesCount: 0,
        generatedRegionsCount: 0,
        frontierTerritories: new Set(),
        coordToTerritory: new Map(),
        territoryPos: new Map(),
      },
      generationSalt: 0,
    };
  }

  generateInitialWorld(params: InitialWorldParams): {
    world: MapWorldState;
    playerCapitals: Map<FactionId, TerritoryId>;
    visibility: Map<FactionId, PlayerVisibilityMap>;
  } {
    const C = this.C.initial;
    const seed = params.worldSeed;
    this.resetNameTracker();
    const rng = new SeededRNG(seed);
    const world = this.createEmptyWorld(seed, params.themes);
    const themeArr = Array.from(world.themes.values());
    const targetTerritories = params.initialTerritoryCount ?? C.defaultInitialTerritories;
    const targetRegions = params.initialRegionCount ?? C.defaultInitialRegions;
    const perFactionStart = params.startingTerritoriesPerFaction ?? C.defaultStartingTerritoriesPerFaction;
    const playerCapitals = new Map<FactionId, TerritoryId>();
    const visibilityMap = new Map<FactionId, PlayerVisibilityMap>();
    for (const f of params.playerFactionIds) {
      visibilityMap.set(f, { owner: f, visibility: new Map(), knownThemes: new Set(), knownRegions: new Set() });
    }
    const centerThemes: ThemeDefinition[] = [];
    for (let i = 0; i < targetRegions; i++)
      centerThemes.push(this.pickTheme(rng, themeArr, []));
    const regionRadii = [1, 2, 1, 2, 1, 1].slice(0, Math.max(1, targetRegions));
    let regionCenters: { pos: HexPos; theme: ThemeDefinition; radius: number }[] = [];
    let placed = 0, attempts = 0;
    while (placed < targetRegions && attempts < C.maxStartSearchAttempts * 10) {
      attempts++;
      const ring = Math.floor(placed / 6);
      const idx = placed % 6;
      const d = HEX_DIRS[idx]!;
      const pos = { q: d.q * 3 * (ring + 1), r: d.r * 3 * (ring + 1) };
      if (regionCenters.some(c => hexDist(c.pos, pos) < 3))
        continue;
      regionCenters.push({ pos, theme: centerThemes[placed % centerThemes.length]!, radius: regionRadii[placed % regionRadii.length]! + Math.floor(rng.next() * 2) });
      placed++;
    }
    if (regionCenters.length === 0)
      regionCenters.push({ pos: { q: 0, r: 0 }, theme: centerThemes[0]!, radius: 2 });
    const usedSpots = new Set<string>();
    for (const rc of regionCenters) {
      const rid = `region_${world.graphMeta.nextRegionIndex++}`;
      const regionSeed = seed ^ (world.graphMeta.nextRegionIndex * 2654435761) >>> 0;
      const region: Region = {
        id: rid,
        name: this.naming.generateRegionName(rc.theme, undefined, regionSeed),
        themeId: rc.theme.id,
        territories: [],
        centerTerritoryId: null,
        seed: regionSeed,
        createdAt: world.turn,
      };
      const rrng = new SeededRNG(regionSeed);
      const ringCount = rc.radius + 1;
      const fillPositions: HexPos[] = [{ q: rc.pos.q, r: rc.pos.r }];
      for (let ring = 1; ring < ringCount; ring++) {
        let pos = { q: rc.pos.q + HEX_DIRS[4]!.q * ring, r: rc.pos.r + HEX_DIRS[4]!.r * ring };
        for (let side = 0; side < 6; side++) {
          for (let step = 0; step < ring; step++) {
            fillPositions.push({ q: pos.q, r: pos.r });
            pos = { q: pos.q + HEX_DIRS[side]!.q, r: pos.r + HEX_DIRS[side]!.r };
          }
        }
      }
      const pert = this.C.graph.hexGridPerturbation;
      const filtered: HexPos[] = [];
      for (const fp of fillPositions) {
        const nkey = key(fp.q, fp.r);
        if (usedSpots.has(nkey))
          continue;
        if (rrng.next() < pert && ringCount > 1)
          continue;
        usedSpots.add(nkey);
        filtered.push(fp);
      }
      let centerId: TerritoryId | null = null;
      for (let i = 0; i < filtered.length; i++) {
        const pos = filtered[i]!;
        const ttheme = (i === 0 || rrng.next() < this.C.themes.regionThemePersistence)
          ? rc.theme
          : this.pickTheme(rrng, themeArr, [rc.theme.id]);
        const terr = this.fabricateTerritory(world, pos, ttheme, rrng, { owner: null, isCapital: false });
        terr.regionId = rid;
        region.territories.push(terr.id);
        if (i === 0)
          centerId = terr.id;
      }
      region.centerTerritoryId = centerId;
      world.regions.set(rid, region);
    }
    for (const id of Array.from(world.territories.keys()))
      this.computeNeighborsFor(world, id, rng);
    this.ensureNeighborsSane(world);
    const playerCount = params.playerFactionIds.length;
    if (playerCount > 0) {
      const candidates = Array.from(world.regions.values()).filter(r => r.centerTerritoryId).map(r => r.centerTerritoryId!);
      const shuffled = candidates.slice().sort(() => rng.next() - 0.5);
      const capitals: TerritoryId[] = [];
      for (const cand of shuffled) {
        if (capitals.length >= playerCount)
          break;
        const cpos = world.graphMeta.territoryPos.get(cand);
        if (!cpos)
          continue;
        const minDist = params.minCapitalsDistance ?? C.defaultMinCapitalsDistance;
        if (capitals.every(cid => hexDist(cpos, world.graphMeta.territoryPos.get(cid)!) >= minDist)) {
          capitals.push(cand);
        }
      }
      for (let i = 0; i < playerCount; i++) {
        const fid = params.playerFactionIds[i]!;
        let capId = capitals[i];
        if (!capId) {
          const fallback = Array.from(world.territories.keys())[i % world.territories.size];
          capId = fallback!;
        }
        const capT = world.territories.get(capId)!;
        const region = this.regionForObj(world, capId);
        if (region && !region.isCapitalRegion) {
          region.isCapitalRegion = true;
        }
        capT.owner = fid;
        capT.fortification = Math.max(capT.fortification, this.C.territory.fortificationCapitalDefault);
        capT.garrison = Math.max(capT.garrison, this.C.territory.garrisonCapitalBase);
        playerCapitals.set(fid, capId);
        const radius = perFactionStart;
        const withinRadius = Array.from(world.territories.entries()).filter(([, t]) => {
          const tp = world.graphMeta.territoryPos.get(t.id);
          if (!tp)
            return false;
          return hexDist(tp, world.graphMeta.territoryPos.get(capId)!) <= radius;
        }).sort((a, b) => {
          const da = hexDist(world.graphMeta.territoryPos.get(a[0])!, world.graphMeta.territoryPos.get(capId)!);
          const db = hexDist(world.graphMeta.territoryPos.get(b[0])!, world.graphMeta.territoryPos.get(capId)!);
          return da - db;
        }).slice(0, perFactionStart * 3 + 1);
        let granted = 0;
        for (const [, t] of withinRadius) {
          if (granted >= perFactionStart * 2 + 1)
            break;
          if (!t.owner || t.owner === fid) {
            t.owner = fid;
            if (t.id !== capId) {
              t.fortification = Math.max(t.fortification, 1);
              t.garrison = Math.max(t.garrison, this.C.territory.garrisonStartBase);
            }
            granted++;
          }
        }
        this.recomputeVisibilityFor(world, fid, visibilityMap.get(fid)!);
      }
    }
    else {
      // Legacy generator only: no fog. Production worlds do not use this path.
    }
    while (world.territories.size < targetTerritories) {
      const frontiers = Array.from(world.graphMeta.frontierTerritories);
      if (frontiers.length === 0)
        break;
      const pick = frontiers[Math.floor(rng.next() * frontiers.length)]!;
      const req: ExpansionRequest = {
        worldState: world,
        fromFrontierTerritoryId: pick,
        newTerritoryCount: Math.min(3, targetTerritories - world.territories.size),
        salt: world.generationSalt++,
      };
      this.expandFromFrontier(req);
    }
    this.ensureNeighborsSane(world);
    this.refreshFrontier(world);
    for (const [fid, vismap] of visibilityMap.entries()) {
      this.recomputeVisibilityFor(world, fid, vismap);
    }
    return { world, playerCapitals, visibility: visibilityMap };
  }

  /* ─── Expansion ──────────────────────────────────────────────────── */
  expandFromFrontier(req: ExpansionRequest): ExpansionResult {
    const world = req.worldState;
    const Cg = this.C.growth;
    const fromT = world.territories.get(req.fromFrontierTerritoryId);
    const result: ExpansionResult = {
      newTerritories: [],
      updatedFrontierTerritories: [],
      newRegions: [],
      newConnections: [],
      newlyAdjacentExistingTerritories: [],
      generatedFor: req.fromFrontierTerritoryId,
      validation: { allConnected: true, noIsolated: true, noOverwrites: true, frontierCount: 0 },
    };
    if (!fromT) {
      result.validation.allConnected = false;
      return result;
    }
    const fromPos = world.graphMeta.territoryPos.get(fromT.id)!;
    const frontierSlots = HEX_DIRS
      .map(d => ({ q: fromPos.q + d.q, r: fromPos.r + d.r, d }))
      .filter(s => !world.graphMeta.coordToTerritory.has(key(s.q, s.r)));
    if (frontierSlots.length === 0) {
      this.refreshFrontier(world);
      return result;
    }
    const seed = world.worldSeed ^ (fromT.id.length * 1315423911) ^ ((req.salt ?? 0) * 2654435761) ^ req.newTerritoryCount;
    const rng = new SeededRNG((seed >>> 0) || 1);
    const existingAdjacentThemes = fromT.neighboring
      .map(nid => this.themeFor(world, nid))
      .filter((x): x is ThemeId => !!x);
    const themesArr = Array.from(world.themes.values());
    let theme = this.pickTheme(rng, themesArr, existingAdjacentThemes, req.preferUnusedThemes ?? null, req.themeHint ?? null);
    const needNewRegion = this.regionFor(world, fromT.id) === null
      || rng.next() < (1 / Cg.newRegionEveryNTerritories);
    const maxPerBatch = Math.min(Cg.expansionMax, Math.max(1, req.newTerritoryCount));
    let remaining = maxPerBatch;
    let currentRegion = this.regionForObj(world, fromT.id);
    const slots = frontierSlots.slice().sort(() => rng.next() - 0.5);
    let createdThisRegion = 0;
    if (needNewRegion) {
      const rid = `region_${world.graphMeta.nextRegionIndex++}`;
      const regionSeed = (seed ^ rid.length) >>> 0;
      const rrng = new SeededRNG(regionSeed);
      const regionTheme = this.pickTheme(rrng, themesArr, existingAdjacentThemes, req.preferUnusedThemes ?? null, req.themeHint ?? null);
      theme = regionTheme;
      const newRegion: Region = {
        id: rid,
        name: this.naming.generateRegionName(regionTheme, undefined, regionSeed),
        themeId: regionTheme.id,
        territories: [],
        centerTerritoryId: null,
        seed: regionSeed,
        createdAt: world.turn,
      };
      world.regions.set(rid, newRegion);
      result.newRegions.push(newRegion);
      currentRegion = newRegion;
    }
    else if (currentRegion) {
      theme = world.themes.get(currentRegion.themeId) ?? theme;
    }
    const idealTarget = currentRegion
      ? Math.max(Cg.regionTargetSize.min, Math.min(Cg.regionTargetSize.max, Cg.regionTargetSize.ideal))
      : maxPerBatch;
    for (let attempt = 0; attempt < Cg.frontierConnectionRetries && remaining > 0; attempt++) {
      const spot = slots[attempt % slots.length];
      if (!spot)
        break;
      const k = key(spot.q, spot.r);
      if (world.graphMeta.coordToTerritory.has(k))
        continue;
      if (createdThisRegion >= idealTarget && currentRegion) {
        const newTheme = this.pickTheme(rng, themesArr, existingAdjacentThemes.concat(currentRegion.themeId));
        const rid = `region_${world.graphMeta.nextRegionIndex++}`;
        const regionSeed = ((seed + attempt) ^ rid.length) >>> 0;
        const nr: Region = {
          id: rid,
          name: this.naming.generateRegionName(newTheme, undefined, regionSeed),
          themeId: newTheme.id,
          territories: [],
          centerTerritoryId: null,
          seed: regionSeed,
          createdAt: world.turn,
        };
        world.regions.set(rid, nr);
        result.newRegions.push(nr);
        createdThisRegion = 0;
        theme = newTheme;
        currentRegion = nr;
      }
      const owner = req.ownerFaction ?? null;
      const newT = this.fabricateTerritory(world, { q: spot.q, r: spot.r }, theme, rng, { owner });
      if (currentRegion) {
        currentRegion.territories.push(newT.id);
        newT.regionId = currentRegion.id;
        if (!currentRegion.centerTerritoryId)
          currentRegion.centerTerritoryId = newT.id;
      }
      result.newTerritories.push(newT);
      remaining--;
      createdThisRegion++;
      this.computeNeighborsFor(world, newT.id, rng);
      for (const nid of newT.neighboring) {
        result.newConnections.push({ from: newT.id, to: nid });
        if (nid !== req.fromFrontierTerritoryId)
          result.newlyAdjacentExistingTerritories.push(nid);
      }
      result.newConnections.push({ from: req.fromFrontierTerritoryId, to: newT.id });
    }
    for (const t of result.newTerritories)
      this.computeNeighborsFor(world, t.id, rng);
    this.computeNeighborsFor(world, fromT.id, rng);
    this.ensureNeighborsSane(world);
    this.refreshFrontier(world);
    result.updatedFrontierTerritories = Array.from(world.graphMeta.frontierTerritories);
    result.validation.frontierCount = world.graphMeta.frontierTerritories.size;
    const anyIsolated = result.newTerritories.some(t => t.neighboring.length === 0);
    result.validation.noIsolated = !anyIsolated;
    result.validation.allConnected = !result.newTerritories.some(t => t.neighboring.length > 0 &&
      !t.neighboring.some(nid => world.territories.has(nid) && !result.newTerritories.some(nt => nt.id === nid) || nid === fromT.id));
    result.validation.noOverwrites = result.newTerritories.every(t => world.territories.get(t.id) === t);
    return result;
  }

  /* ─── Fog of war / visibility ───────────────────────────────────── */
  regionFor(world: MapWorldState, tid: TerritoryId): RegionId | null {
    for (const r of world.regions.values())
      if (r.territories.includes(tid))
        return r.id;
    return null;
  }

  regionForObj(world: MapWorldState, tid: TerritoryId): Region | null {
    for (const r of world.regions.values())
      if (r.territories.includes(tid))
        return r;
    return null;
  }

  themeFor(world: MapWorldState, tid: TerritoryId): ThemeId | null {
    const r = this.regionForObj(world, tid);
    return r ? r.themeId : null;
  }

  revealNeighbors(
    world: MapWorldState,
    tid: TerritoryId,
    visibility: PlayerVisibilityMap,
    range = this.C.fogOfWar.defaultRevealRangeFromControl,
    revealedBy: 'control' | 'scout' | 'diplomacy' | 'event' = 'control',
  ): {
    newly: TerritoryId[];
    advanced: TerritoryId[];
  } {
    const startPos = world.graphMeta.territoryPos.get(tid);
    const newly: TerritoryId[] = [];
    const advanced: TerritoryId[] = [];
    if (!startPos)
      return { newly, advanced };
    const existing = visibility.visibility;
    for (const [id, terr] of world.territories.entries()) {
      const pos = world.graphMeta.territoryPos.get(id);
      if (!pos)
        continue;
      const d = hexDist(startPos, pos);
      if (d > range)
        continue;
      const prev = existing.get(id);
      const prevState = prev?.state ?? 'unknown';
      const desired: VisibilityState = terr.owner === visibility.owner ? 'controlled' : d === 0 ? 'controlled' : (range >= 2 ? 'scouted' : 'discovered');
      const rank = (s: VisibilityState) => s === 'unknown' ? 0 : s === 'discovered' ? 1 : s === 'scouted' ? 2 : 3;
      if (rank(desired) > rank(prevState)) {
        existing.set(id, { state: desired, lastUpdatedTurn: world.turn, turnsSinceSeen: 0, revealedBy });
        if (prevState === 'unknown')
          newly.push(id);
        else
          advanced.push(id);
      }
      else if (prev) {
        prev.turnsSinceSeen = 0;
        prev.lastUpdatedTurn = world.turn;
      }
      const region = this.regionFor(world, id);
      if (region)
        visibility.knownRegions.add(region);
      const theme = this.themeFor(world, id);
      if (theme)
        visibility.knownThemes.add(theme);
    }
    return { newly, advanced };
  }

  recomputeVisibilityFor(world: MapWorldState, faction: FactionId, visibility: PlayerVisibilityMap): void {
    visibility.visibility.clear();
    visibility.knownThemes.clear();
    visibility.knownRegions.clear();
    for (const [id, terr] of world.territories.entries()) {
      if (terr.owner === faction) {
        this.revealNeighbors(world, id, visibility, this.C.fogOfWar.defaultRevealRangeFromControl, 'control');
      }
    }
  }

  createVisibilityMapFor(world: MapWorldState, faction: FactionId): PlayerVisibilityMap {
    const v: PlayerVisibilityMap = { owner: faction, visibility: new Map(), knownThemes: new Set(), knownRegions: new Set() };
    this.recomputeVisibilityFor(world, faction, v);
    return v;
  }

  revealTerritories(
    world: MapWorldState,
    origin: TerritoryId,
    range: number,
    visibility: PlayerVisibilityMap,
    revealedBy: 'scout' | 'diplomacy' | 'event' = 'scout',
  ): ScoutResult {
    const res: ScoutResult = {
      fromTerritoryId: origin,
      range,
      revealedTerritories: [],
      newlyDiscovered: [],
      newlyScouted: [],
    };
    const op = world.graphMeta.territoryPos.get(origin);
    if (!op)
      return res;
    const beforeByT = new Map<TerritoryId, VisibilityState>();
    for (const [tid, v] of visibility.visibility.entries())
      beforeByT.set(tid, v.state);
    const startT = world.territories.get(origin);
    if (startT)
      this.revealNeighbors(world, origin, visibility, range, revealedBy);
    const queue: { id: TerritoryId; dist: number }[] = [{ id: origin, dist: 0 }];
    const seen = new Set<TerritoryId>([origin]);
    while (queue.length) {
      const cur = queue.shift()!;
      if (cur.dist >= range)
        continue;
      const terr = world.territories.get(cur.id);
      if (!terr)
        continue;
      for (const nid of terr.neighboring) {
        if (seen.has(nid))
          continue;
        seen.add(nid);
        const npos = world.graphMeta.territoryPos.get(nid);
        if (!npos)
          continue;
        if (hexDist(op, npos) <= range) {
          this.revealNeighbors(world, nid, visibility, 0, revealedBy);
        }
        queue.push({ id: nid, dist: cur.dist + 1 });
      }
    }
    for (const [tid, v] of visibility.visibility.entries()) {
      const before = beforeByT.get(tid) ?? 'unknown';
      if (before === v.state)
        continue;
      res.revealedTerritories.push({ id: tid, fromState: before, toState: v.state, distance: hexDist(op, world.graphMeta.territoryPos.get(tid) ?? op) });
      if (before === 'unknown' && (v.state === 'discovered' || v.state === 'scouted' || v.state === 'controlled'))
        res.newlyDiscovered.push(tid);
      if ((before === 'unknown' || before === 'discovered') && v.state === 'scouted')
        res.newlyScouted.push(tid);
    }
    return res;
  }

  /* ─── Reports & rendering helpers ────────────────────────────────── */
  generateReport(world: MapWorldState, capitals?: Map<FactionId, TerritoryId>): MapGenerationReport {
    const terrainDist: Record<string, number> = {};
    const themeDist: Record<string, number> = {};
    for (const t of world.territories.values()) {
      terrainDist[t.terrain] = (terrainDist[t.terrain] ?? 0) + 1;
      const rid = this.regionFor(world, t.id);
      const r = rid ? world.regions.get(rid) : null;
      if (r)
        themeDist[r.themeId] = (themeDist[r.themeId] ?? 0) + 1;
    }
    const report: MapGenerationReport = {
      territoryCount: world.territories.size,
      regionCount: world.regions.size,
      frontierCount: world.graphMeta.frontierTerritories.size,
      terrainDistribution: terrainDist,
      themeDistribution: themeDist,
    };
    if (capitals) {
      report.perFactionStart = {};
      for (const [fid, cid] of capitals.entries()) {
        const terrCount = Array.from(world.territories.values()).filter(t => t.owner === fid).length;
        report.perFactionStart[fid] = { capital: cid, territoryCount: terrCount };
      }
    }
    return report;
  }

  renderWorldText(world: MapWorldState, visibility?: PlayerVisibilityMap, faction?: FactionId): string {
    void faction;
    const lines: string[] = [];
    const minQ = Math.min(...Array.from(world.graphMeta.territoryPos.values()).map(p => p.q));
    const maxQ = Math.max(...Array.from(world.graphMeta.territoryPos.values()).map(p => p.q));
    const minR = Math.min(...Array.from(world.graphMeta.territoryPos.values()).map(p => p.r));
    const maxR = Math.max(...Array.from(world.graphMeta.territoryPos.values()).map(p => p.r));
    const width = maxQ - minQ + 1;
    const height = maxR - minR + 1;
    const grid: string[][] = [];
    for (let r = 0; r < height * 2 + 1; r++)
      grid.push(new Array(width * 4 + 2).fill(' '));
    for (const [id, t] of world.territories.entries()) {
      const pos = world.graphMeta.territoryPos.get(id)!;
      let stateLabel = '?';
      if (visibility) {
        const v = visibility.visibility.get(id);
        if (!v)
          stateLabel = '·';
        else if (v.state === 'controlled')
          stateLabel = '#';
        else if (v.state === 'scouted')
          stateLabel = '!';
        else if (v.state === 'discovered')
          stateLabel = 'o';
        else
          stateLabel = '·';
      }
      else {
        stateLabel = t.owner ? '#' : 'o';
      }
      const ownerChar = t.owner ? (t.owner[0] ?? '?').toUpperCase() : '·';
      const display = visibility && (visibility.visibility.get(id)?.state ?? 'unknown') === 'unknown' ? '????' : `${stateLabel}${ownerChar}.${TERRAIN_NAMES[t.terrain]?.[0] ?? '.'}`;
      const col = (pos.q - minQ) * 4 + (pos.r - minR) % 2 * 2;
      const row = (pos.r - minR) * 2 + 1;
      for (let i = 0; i < display.length; i++)
        grid[row]![col + i] = display[i]!;
      const tlabel = visibility && !visibility.visibility.has(id) ? '      ' : `${id.split('_')[1]!.padStart(3, '0')}.${stateLabel}`;
      if (row + 1 < grid.length)
        for (let i = 0; i < tlabel.length; i++)
          grid[row + 1]![col + i] = tlabel[i]!;
    }
    for (let r = 0; r < grid.length; r++) {
      const buf: string[] = [];
      let hasChar = false;
      for (let c = 0; c < grid[r]!.length; c++) {
        if (grid[r]![c] !== ' ')
          hasChar = true;
        buf.push(grid[r]![c]!);
      }
      if (hasChar)
        lines.push(buf.join(''));
    }
    return lines.join('\n');
  }

  renderTerritoryTable(world: MapWorldState, visibility?: PlayerVisibilityMap): string {
    const lines: string[] = [];
    lines.push('┌─────┬──────────────────────────┬────────────┬──────┬──────────┬─────┬──────┬────────┬────────┐');
    lines.push('│ ID  │ Name                     │ Terrain    │ Owner│ Fort     │ Gar │ Pop  │ Value    │ Region │');
    lines.push('├─────┼──────────────────────────┼────────────┼──────┼──────────┼─────┼──────┼────────┼────────┤');
    const arr = Array.from(world.territories.values()).sort((a, b) => a.id.localeCompare(b.id));
    for (const t of arr) {
      const v = visibility?.visibility.get(t.id)?.state ?? 'controlled';
      const shown = !visibility || v !== 'unknown';
      const short = t.id.slice(2, 8).padEnd(4, ' ');
      const name = shown ? t.id.padEnd(24, ' ').slice(0, 24) : '??? unknown ???'.padEnd(24, ' ');
      const terr = shown ? (TERRAIN_NAMES[t.terrain] ?? t.terrain).padEnd(10, ' ').slice(0, 10) : '?'.padEnd(10, ' ');
      const owner = t.owner ? t.owner.split('_')[0]!.padEnd(4, ' ').slice(0, 4).toUpperCase() : 'NEUT';
      const fort = ` L${t.fortification}`;
      const gar = shown ? `${t.garrison}`.padStart(3, ' ') : '???';
      const pop = shown ? `${Math.round(t.population / 1000)}k`.padStart(4, ' ') : '????';
      const val = shown ? `${t.baseValue}`.padStart(5, ' ') : '?????';
      const rid = this.regionFor(world, t.id);
      const rshort = rid ? rid.replace('region_', 'R') : '?';
      const mark = v === 'unknown' ? 'U' : v === 'discovered' ? 'D' : v === 'scouted' ? 'S' : 'C';
      lines.push(`│${short} │${name}│${terr}│ ${owner} │${fort}    │ ${gar} │ ${pop} │ ${val}${mark} │ ${rshort.padEnd(6)} │`);
    }
    lines.push('└─────┴──────────────────────────┴────────────┴──────┴──────────┴─────┴──────┴────────┴────────┘');
    lines.push('Legend: U=unknown  D=discovered  S=scouted  C=controlled (legacy MapEngine fixture)');
    return lines.join('\n');
  }

  validateWorld(world: MapWorldState): {
    noIsolated: boolean;
    allBidirectional: boolean;
    allInRegions: boolean;
    noDuplicateNames: boolean;
    summary: string;
  } {
    const isolated: TerritoryId[] = [];
    for (const [id, t] of world.territories)
      if (t.neighboring.length === 0)
        isolated.push(id);
    let allBidir = true;
    for (const [id, t] of world.territories) {
      for (const nid of t.neighboring) {
        const n = world.territories.get(nid);
        if (!n || !n.neighboring.includes(id)) {
          allBidir = false;
        }
      }
    }
    let covered = 0;
    for (const r of world.regions.values())
      covered += r.territories.length;
    const names = new Set<string>();
    let dup = false;
    for (const t of world.territories.values()) {
      if (names.has(t.id))
        dup = true;
      names.add(t.id);
    }
    return {
      noIsolated: isolated.length === 0,
      allBidirectional: allBidir,
      allInRegions: covered >= world.territories.size,
      noDuplicateNames: !dup,
      summary: [
        isolated.length ? `Isolated territories (${isolated.length}): ${isolated.join(', ')}` : 'No isolated territories ✓',
        allBidir ? 'All neighborhood edges are bidirectional ✓' : 'UNIDIRECTIONAL EDGE DETECTED',
        covered >= world.territories.size ? `All territories belong to a region (${covered}/${world.territories.size}) ✓` : `${world.territories.size - covered} territories have no region`,
        dup ? 'DUPLICATE territory ids detected' : 'All territory ids are unique ✓',
      ].join('\n'),
    };
  }

  /**
   * GameStateSnapshot compatibility bridge — returns the canonical
   * `MapTerritorySpec[]` (see `src/types/index.ts`), the same shape
   * `SampleMap.ts`'s hand-authored `SAMPLE_MAP` uses, so both paths feed
   * `SimulationBuilder.buildFromSpecs` identically.
   */
  toTerritorySpecs(world: MapWorldState): MapTerritorySpec[] {
    const specs: MapTerritorySpec[] = [];
    for (const t of world.territories.values()) {
      specs.push({
        id: t.id,
        name: t.id,
        terrain: t.terrain,
        neighbors: [...t.neighboring],
        population: t.population,
        baseValue: t.baseValue,
        resourceOutput: { ...t.resourceOutput },
        fortification: t.fortification,
        garrison: t.garrison,
        isCapital: false,
        owner: t.owner,
      });
    }
    return specs;
  }

  collectFactionTerritoryIds(world: MapWorldState, factionId: FactionId): TerritoryId[] {
    const ids: TerritoryId[] = [];
    for (const [id, t] of world.territories) {
      if (t.owner === factionId)
        ids.push(id);
    }
    return ids;
  }

  collectAdjacentFrontiers(world: MapWorldState, factionId: FactionId): TerritoryId[] {
    const owned = new Set(this.collectFactionTerritoryIds(world, factionId));
    const frontiers = new Set<TerritoryId>();
    for (const ownedId of owned) {
      const t = world.territories.get(ownedId);
      if (!t)
        continue;
      for (const nid of t.neighboring) {
        if (!owned.has(nid))
          frontiers.add(nid);
      }
      if (world.graphMeta.frontierTerritories.has(ownedId))
        frontiers.add(ownedId);
    }
    return Array.from(frontiers);
  }
}
