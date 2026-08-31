"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MapEngine = void 0;
const SeededRNG_1 = require("../utils/SeededRNG");
const balance_1 = require("../constants/balance");
const Themes_1 = require("./Themes");
const NamingSystem_1 = require("./NamingSystem");
const balance_2 = require("../constants/balance");
const key = (q, r) => `${q},${r}`;
const HEX_DIRS = [
    { q: +1, r: 0 }, { q: +1, r: -1 }, { q: 0, r: -1 },
    { q: -1, r: 0 }, { q: -1, r: +1 }, { q: 0, r: +1 },
];
const HEX_DIAG = [
    { q: +2, r: -1 }, { q: +1, r: +1 }, { q: -1, r: +2 },
    { q: -2, r: +1 }, { q: -1, r: -1 }, { q: +1, r: -2 },
];
function hexDist(a, b) {
    return (Math.abs(a.q - b.q) + Math.abs(a.q + a.r - b.q - b.r) + Math.abs(a.r - b.r)) / 2;
}
class MapEngine {
    constructor(namingSeed) {
        this.C = balance_1.BALANCE.mapGen;
        this.naming = new NamingSystem_1.NamingSystem(namingSeed ?? 0x5EED1E);
    }
    resetNameTracker() {
        this.naming.reset();
    }
    /* ─── Theme selection helpers ─────────────────────────────────────── */
    pickTheme(rng, themes, adjacentThemes, preferUnused, hint) {
        const pool = themes.length ? themes : Themes_1.DEFAULT_THEME_LIBRARY;
        const scores = new Map();
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
        return pool[0];
    }
    weightedTerrain(rng, theme, fallback = 'plains') {
        const map = theme.terrainDistributionWeights;
        const entries = Object.entries(map);
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
    fabricateTerritory(world, pos, theme, rng, opts = {}) {
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
        const fw = theme.fortificationWeights;
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
        const resourceOutput = {};
        const baseResources = ['gold', 'food', 'iron', 'wood', 'stone'];
        for (let r = 0; r < resCount; r++) {
            const res = r === 0 && theme.resourceTendencies
                ? this.weightedResource(rng, theme)
                : baseResources[Math.floor(rng.next() * baseResources.length)];
            if (!resourceOutput[res])
                resourceOutput[res] = 0;
            const jitter = 1 + (rng.next() - 0.5) * this.C.resources.perResourceJitter * 2;
            const boost = (theme.resourceTendencies?.[res] ?? 1) ** 0.6;
            resourceOutput[res] += Math.round((5 + rng.nextInt(1, 10)) * jitter * boost);
        }
        let name;
        if (isCapital) {
            name = this.naming.generateCapitalName(theme);
        }
        else {
            name = this.naming.generateTerritoryName(theme);
        }
        const terr = {
            id,
            name,
            owner: opts.owner ?? null,
            terrain,
            neighboring: [],
            population: Math.max(300, pop),
            baseValue,
            resourceOutput,
            fortification: fortTier,
            garrison: Math.max(0, garrison),
            isCapital,
            isKnown: false,
            scoutedTurnsAgo: null,
        };
        world.graphMeta.territoryPos.set(id, pos);
        world.graphMeta.coordToTerritory.set(key(pos.q, pos.r), id);
        world.territories.set(id, terr);
        world.graphMeta.generatedTerritoriesCount++;
        return terr;
    }
    weightedResource(rng, theme) {
        const tend = theme.resourceTendencies ?? {};
        const base = ['gold', 'food', 'iron', 'wood', 'stone'];
        const baseW = [this.C.resources.goldBaseWeight, this.C.resources.foodBaseWeight, this.C.resources.ironBaseWeight, this.C.resources.woodBaseWeight, this.C.resources.stoneBaseWeight];
        const scores = base.map((r, i) => baseW[i] * (1 + Math.log1p((tend[r] ?? 1) * this.C.resources.terrainResourceBoostFactor)));
        const total = scores.reduce((a, b) => a + b, 0);
        let roll = rng.next() * total;
        for (let i = 0; i < base.length; i++) {
            roll -= scores[i];
            if (roll <= 0)
                return base[i];
        }
        return base[0];
    }
    /* ─── Graph / connection logic ───────────────────────────────────── */
    bidirConnect(a, b) {
        if (a.id === b.id)
            return;
        if (!a.neighboring.includes(b.id))
            a.neighboring.push(b.id);
        if (!b.neighboring.includes(a.id))
            b.neighboring.push(a.id);
    }
    computeNeighborsFor(world, id, rng) {
        const Cg = this.C.graph;
        const pos = world.graphMeta.territoryPos.get(id);
        if (!pos)
            return;
        const t = world.territories.get(id);
        if (!t)
            return;
        t.neighboring = [];
        const direct = HEX_DIRS.map(d => world.graphMeta.coordToTerritory.get(key(pos.q + d.q, pos.r + d.r))).filter((x) => !!x);
        direct.forEach(nid => {
            if (nid !== id)
                this.bidirConnect(t, world.territories.get(nid));
        });
        for (const d of HEX_DIAG) {
            const nid = world.graphMeta.coordToTerritory.get(key(pos.q + d.q, pos.r + d.r));
            if (!nid)
                continue;
            const tpos = world.graphMeta.territoryPos.get(nid);
            const sharedAdj = HEX_DIRS.filter(dd => {
                const midA = world.graphMeta.coordToTerritory.get(key(pos.q + dd.q, pos.r + dd.r));
                if (!midA)
                    return false;
                return hexDist(tpos, { q: pos.q + dd.q, r: pos.r + dd.r }) < 1.5;
            });
            if (sharedAdj.length === 0)
                continue;
            if ((t.neighboring.length + 1) <= this.C.territory.maxNeighbors && rng.next() < this.C.growth.crossNeighborChance) {
                this.bidirConnect(t, world.territories.get(nid));
            }
        }
        if (t.neighboring.length < this.C.territory.minNeighbors) {
            let best = null;
            for (const [otherId, otherPos] of world.graphMeta.territoryPos.entries()) {
                if (otherId === id || t.neighboring.includes(otherId))
                    continue;
                const d = hexDist(pos, otherPos);
                if (d <= Cg.neighborDistanceThreshold + Cg.diagonalNeighborThreshold && (!best || d < best.dist)) {
                    best = { id: otherId, dist: d };
                }
            }
            if (best)
                this.bidirConnect(t, world.territories.get(best.id));
        }
    }
    refreshFrontier(world) {
        const frontier = new Set();
        for (const [id, terr] of world.territories.entries()) {
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
    ensureNeighborsSane(world) {
        for (const [id, terr] of world.territories.entries()) {
            const neigh = terr.neighboring;
            for (const nid of neigh) {
                const n = world.territories.get(nid);
                if (n && !n.neighboring.includes(id))
                    n.neighboring.push(id);
            }
            if (neigh.length > this.C.territory.maxNeighbors) {
                terr.neighboring = neigh.slice(0, this.C.territory.maxNeighbors);
            }
            if (neigh.length < this.C.territory.minNeighbors && world.territories.size > 2) {
                const pos = world.graphMeta.territoryPos.get(id);
                if (pos) {
                    let best = null;
                    for (const [otherId, otherPos] of world.graphMeta.territoryPos.entries()) {
                        if (otherId === id || neigh.includes(otherId))
                            continue;
                        const d = hexDist(pos, otherPos);
                        if (!best || d < best.dist)
                            best = { id: otherId, dist: d };
                    }
                    if (best)
                        this.bidirConnect(terr, world.territories.get(best.id));
                }
            }
        }
    }
    /* ─── World state initializers ───────────────────────────────────── */
    createEmptyWorld(worldSeed, themes) {
        const themeList = themes ?? Themes_1.DEFAULT_THEME_LIBRARY;
        const themeMap = new Map();
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
    generateInitialWorld(params) {
        const C = this.C.initial;
        const seed = params.worldSeed;
        this.resetNameTracker();
        const rng = new SeededRNG_1.SeededRNG(seed);
        const world = this.createEmptyWorld(seed, params.themes);
        const themeArr = Array.from(world.themes.values());
        const targetTerritories = params.initialTerritoryCount ?? C.defaultInitialTerritories;
        const targetRegions = params.initialRegionCount ?? C.defaultInitialRegions;
        const perFactionStart = params.startingTerritoriesPerFaction ?? C.defaultStartingTerritoriesPerFaction;
        const playerCapitals = new Map();
        const visibilityMap = new Map();
        for (const f of params.playerFactionIds) {
            visibilityMap.set(f, { owner: f, visibility: new Map(), knownThemes: new Set(), knownRegions: new Set() });
        }
        const centerThemes = [];
        for (let i = 0; i < targetRegions; i++)
            centerThemes.push(this.pickTheme(rng, themeArr, []));
        const regionRadii = [1, 2, 1, 2, 1, 1].slice(0, Math.max(1, targetRegions));
        let regionCenters = [];
        let placed = 0, attempts = 0;
        while (placed < targetRegions && attempts < C.maxStartSearchAttempts * 10) {
            attempts++;
            const ring = Math.floor(placed / 6);
            const idx = placed % 6;
            const d = HEX_DIRS[idx];
            const pos = { q: d.q * 3 * (ring + 1), r: d.r * 3 * (ring + 1) };
            if (regionCenters.some(c => hexDist(c.pos, pos) < 3))
                continue;
            regionCenters.push({ pos, theme: centerThemes[placed % centerThemes.length], radius: regionRadii[placed % regionRadii.length] + Math.floor(rng.next() * 2) });
            placed++;
        }
        if (regionCenters.length === 0)
            regionCenters.push({ pos: { q: 0, r: 0 }, theme: centerThemes[0], radius: 2 });
        const usedSpots = new Set();
        for (const rc of regionCenters) {
            const rid = `region_${world.graphMeta.nextRegionIndex++}`;
            const regionSeed = seed ^ (world.graphMeta.nextRegionIndex * 2654435761) >>> 0;
            const region = {
                id: rid,
                name: this.naming.generateRegionName(rc.theme, undefined, regionSeed),
                themeId: rc.theme.id,
                territories: [],
                centerTerritoryId: null,
                seed: regionSeed,
                createdAt: world.turn,
            };
            const rrng = new SeededRNG_1.SeededRNG(regionSeed);
            const ringCount = rc.radius + 1;
            const fillPositions = [{ q: rc.pos.q, r: rc.pos.r }];
            for (let ring = 1; ring < ringCount; ring++) {
                let pos = { q: rc.pos.q + HEX_DIRS[4].q * ring, r: rc.pos.r + HEX_DIRS[4].r * ring };
                for (let side = 0; side < 6; side++) {
                    for (let step = 0; step < ring; step++) {
                        fillPositions.push({ q: pos.q, r: pos.r });
                        pos = { q: pos.q + HEX_DIRS[side].q, r: pos.r + HEX_DIRS[side].r };
                    }
                }
            }
            const pert = this.C.graph.hexGridPerturbation;
            const filtered = [];
            for (const fp of fillPositions) {
                const nkey = key(fp.q, fp.r);
                if (usedSpots.has(nkey))
                    continue;
                if (rrng.next() < pert && ringCount > 1)
                    continue;
                usedSpots.add(nkey);
                filtered.push(fp);
            }
            let centerId = null;
            for (let i = 0; i < filtered.length; i++) {
                const pos = filtered[i];
                const ttheme = (i === 0 || rrng.next() < this.C.themes.regionThemePersistence)
                    ? rc.theme
                    : this.pickTheme(rrng, themeArr, [rc.theme.id]);
                const terr = this.fabricateTerritory(world, pos, ttheme, rrng, { owner: null, isCapital: false });
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
            const candidates = Array.from(world.regions.values()).filter(r => r.centerTerritoryId).map(r => r.centerTerritoryId);
            const shuffled = candidates.slice().sort(() => rng.next() - 0.5);
            const capitals = [];
            for (const cand of shuffled) {
                if (capitals.length >= playerCount)
                    break;
                const cpos = world.graphMeta.territoryPos.get(cand);
                if (!cpos)
                    continue;
                const minDist = params.minCapitalsDistance ?? C.defaultMinCapitalsDistance;
                if (capitals.every(cid => hexDist(cpos, world.graphMeta.territoryPos.get(cid)) >= minDist)) {
                    capitals.push(cand);
                }
            }
            for (let i = 0; i < playerCount; i++) {
                const fid = params.playerFactionIds[i];
                let capId = capitals[i];
                if (!capId) {
                    const fallback = Array.from(world.territories.keys())[i % world.territories.size];
                    capId = fallback;
                }
                const capT = world.territories.get(capId);
                const region = this.regionForObj(world, capId);
                if (region && !region.isCapitalRegion) {
                    region.isCapitalRegion = true;
                }
                capT.owner = fid;
                capT.isCapital = true;
                capT.fortification = Math.max(capT.fortification, this.C.territory.fortificationCapitalDefault);
                capT.garrison = Math.max(capT.garrison, this.C.territory.garrisonCapitalBase);
                capT.isKnown = true;
                playerCapitals.set(fid, capId);
                const radius = perFactionStart;
                const withinRadius = Array.from(world.territories.entries()).filter(([, t]) => {
                    const tp = world.graphMeta.territoryPos.get(t.id);
                    if (!tp)
                        return false;
                    return hexDist(tp, world.graphMeta.territoryPos.get(capId)) <= radius;
                }).sort((a, b) => {
                    const da = hexDist(world.graphMeta.territoryPos.get(a[0]), world.graphMeta.territoryPos.get(capId));
                    const db = hexDist(world.graphMeta.territoryPos.get(b[0]), world.graphMeta.territoryPos.get(capId));
                    return da - db;
                }).slice(0, perFactionStart * 3 + 1);
                let granted = 0;
                for (const [tid, t] of withinRadius) {
                    if (granted >= perFactionStart * 2 + 1)
                        break;
                    if (!t.owner || t.owner === fid) {
                        t.owner = fid;
                        t.isKnown = true;
                        if (!t.isCapital) {
                            t.fortification = Math.max(t.fortification, 1);
                            t.garrison = Math.max(t.garrison, this.C.territory.garrisonStartBase);
                        }
                        granted++;
                    }
                }
                this.recomputeVisibilityFor(world, fid, visibilityMap.get(fid));
            }
        }
        else {
            for (const t of world.territories.values())
                t.isKnown = true;
        }
        while (world.territories.size < targetTerritories) {
            const frontiers = Array.from(world.graphMeta.frontierTerritories);
            if (frontiers.length === 0)
                break;
            const pick = frontiers[Math.floor(rng.next() * frontiers.length)];
            const req = {
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
    expandFromFrontier(req) {
        const world = req.worldState;
        const Cg = this.C.growth;
        const fromT = world.territories.get(req.fromFrontierTerritoryId);
        const result = {
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
        const fromPos = world.graphMeta.territoryPos.get(fromT.id);
        const frontierSlots = HEX_DIRS
            .map(d => ({ q: fromPos.q + d.q, r: fromPos.r + d.r, d }))
            .filter(s => !world.graphMeta.coordToTerritory.has(key(s.q, s.r)));
        if (frontierSlots.length === 0) {
            this.refreshFrontier(world);
            return result;
        }
        const seed = world.worldSeed ^ (fromT.id.length * 1315423911) ^ ((req.salt ?? 0) * 2654435761) ^ req.newTerritoryCount;
        const rng = new SeededRNG_1.SeededRNG((seed >>> 0) || 1);
        const existingAdjacentThemes = fromT.neighboring
            .map(nid => this.themeFor(world, nid))
            .filter((x) => !!x);
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
            const rrng = new SeededRNG_1.SeededRNG(regionSeed);
            const regionTheme = this.pickTheme(rrng, themesArr, existingAdjacentThemes, req.preferUnusedThemes ?? null, req.themeHint ?? null);
            theme = regionTheme;
            const newRegion = {
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
                const nr = {
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
    regionFor(world, tid) {
        for (const r of world.regions.values())
            if (r.territories.includes(tid))
                return r.id;
        return null;
    }
    regionForObj(world, tid) {
        for (const r of world.regions.values())
            if (r.territories.includes(tid))
                return r;
        return null;
    }
    themeFor(world, tid) {
        const r = this.regionForObj(world, tid);
        return r ? r.themeId : null;
    }
    revealNeighbors(world, tid, visibility, range = this.C.fogOfWar.defaultRevealRangeFromControl, revealedBy = 'control') {
        const startPos = world.graphMeta.territoryPos.get(tid);
        const newly = [];
        const advanced = [];
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
            const desired = terr.owner === visibility.owner ? 'controlled' : d === 0 ? 'controlled' : (range >= 2 ? 'scouted' : 'discovered');
            const rank = (s) => s === 'unknown' ? 0 : s === 'discovered' ? 1 : s === 'scouted' ? 2 : 3;
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
    recomputeVisibilityFor(world, faction, visibility) {
        visibility.visibility.clear();
        visibility.knownThemes.clear();
        visibility.knownRegions.clear();
        for (const [id, terr] of world.territories.entries()) {
            if (terr.owner === faction) {
                this.revealNeighbors(world, id, visibility, this.C.fogOfWar.defaultRevealRangeFromControl, 'control');
            }
        }
    }
    createVisibilityMapFor(world, faction) {
        const v = { owner: faction, visibility: new Map(), knownThemes: new Set(), knownRegions: new Set() };
        this.recomputeVisibilityFor(world, faction, v);
        return v;
    }
    revealTerritories(world, origin, range, visibility, revealedBy = 'scout') {
        const res = {
            fromTerritoryId: origin,
            range,
            revealedTerritories: [],
            newlyDiscovered: [],
            newlyScouted: [],
        };
        const op = world.graphMeta.territoryPos.get(origin);
        if (!op)
            return res;
        const beforeByT = new Map();
        for (const [tid, v] of visibility.visibility.entries())
            beforeByT.set(tid, v.state);
        const startT = world.territories.get(origin);
        if (startT)
            this.revealNeighbors(world, origin, visibility, range, revealedBy);
        const queue = [{ id: origin, dist: 0 }];
        const seen = new Set([origin]);
        while (queue.length) {
            const cur = queue.shift();
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
    generateReport(world, capitals) {
        const terrainDist = {};
        const themeDist = {};
        for (const t of world.territories.values()) {
            terrainDist[t.terrain] = (terrainDist[t.terrain] ?? 0) + 1;
            const rid = this.regionFor(world, t.id);
            const r = rid ? world.regions.get(rid) : null;
            if (r)
                themeDist[r.themeId] = (themeDist[r.themeId] ?? 0) + 1;
        }
        const report = {
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
    renderWorldText(world, visibility, faction) {
        const lines = [];
        const minQ = Math.min(...Array.from(world.graphMeta.territoryPos.values()).map(p => p.q));
        const maxQ = Math.max(...Array.from(world.graphMeta.territoryPos.values()).map(p => p.q));
        const minR = Math.min(...Array.from(world.graphMeta.territoryPos.values()).map(p => p.r));
        const maxR = Math.max(...Array.from(world.graphMeta.territoryPos.values()).map(p => p.r));
        const width = maxQ - minQ + 1;
        const height = maxR - minR + 1;
        const grid = [];
        for (let r = 0; r < height * 2 + 1; r++)
            grid.push(new Array(width * 4 + 2).fill(' '));
        for (const [id, t] of world.territories.entries()) {
            const pos = world.graphMeta.territoryPos.get(id);
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
            const ownerChar = t.owner ? (t.owner[0] ?? '?').toUpperCase() : (t.isCapital ? '★' : '·');
            const display = visibility && (visibility.visibility.get(id)?.state ?? 'unknown') === 'unknown' ? '????' : `${stateLabel}${ownerChar}${(t.isCapital ? '★' : '.')}${balance_2.TERRAIN_NAMES[t.terrain]?.[0] ?? '.'}`;
            const col = (pos.q - minQ) * 4 + (pos.r - minR) % 2 * 2;
            const row = (pos.r - minR) * 2 + 1;
            for (let i = 0; i < display.length; i++)
                grid[row][col + i] = display[i];
            const tlabel = visibility && !visibility.visibility.has(id) ? '      ' : `${id.split('_')[1].padStart(3, '0')}${t.isCapital ? 'K' : '.'}${stateLabel}`;
            if (row + 1 < grid.length)
                for (let i = 0; i < tlabel.length; i++)
                    grid[row + 1][col + i] = tlabel[i];
        }
        for (let r = 0; r < grid.length; r++) {
            const buf = [];
            let hasChar = false;
            for (let c = 0; c < grid[r].length; c++) {
                if (grid[r][c] !== ' ')
                    hasChar = true;
                buf.push(grid[r][c]);
            }
            if (hasChar)
                lines.push(buf.join(''));
        }
        return lines.join('\n');
    }
    renderTerritoryTable(world, visibility) {
        const lines = [];
        lines.push('┌─────┬──────────────────────────┬────────────┬──────┬──────────┬─────┬──────┬────────┬────────┐');
        lines.push('│ ID  │ Name                     │ Terrain    │ Owner│ Fort     │ Gar │ Pop  │ Value    │ Region │');
        lines.push('├─────┼──────────────────────────┼────────────┼──────┼──────────┼─────┼──────┼────────┼────────┤');
        const arr = Array.from(world.territories.values()).sort((a, b) => a.id.localeCompare(b.id));
        for (const t of arr) {
            const v = visibility?.visibility.get(t.id)?.state ?? 'controlled';
            const shown = !visibility || v !== 'unknown';
            const short = t.id.slice(2, 8).padEnd(4, ' ');
            const name = shown ? t.name.padEnd(24, ' ').slice(0, 24) : '??? unknown ???'.padEnd(24, ' ');
            const terr = shown ? (balance_2.TERRAIN_NAMES[t.terrain] ?? t.terrain).padEnd(10, ' ').slice(0, 10) : '?'.padEnd(10, ' ');
            const owner = t.owner ? t.owner.split('_')[0].padEnd(4, ' ').slice(0, 4).toUpperCase() : 'NEUT';
            const fort = t.isCapital ? `★L${t.fortification}` : ` L${t.fortification}`;
            const gar = shown ? `${t.garrison}`.padStart(3, ' ') : '???';
            const pop = shown ? `${Math.round(t.population / 1000)}k`.padStart(4, ' ') : '????';
            const val = shown ? `${t.baseValue}`.padStart(5, ' ') : '?????';
            const rid = this.regionFor(world, t.id);
            const rshort = rid ? rid.replace('region_', 'R') : '?';
            const mark = v === 'unknown' ? 'U' : v === 'discovered' ? 'D' : v === 'scouted' ? 'S' : 'C';
            lines.push(`│${short}${t.isCapital ? '★' : ' '}│${name}│${terr}│ ${owner} │${fort}    │ ${gar} │ ${pop} │ ${val}${mark} │ ${rshort.padEnd(6)} │`);
        }
        lines.push('└─────┴──────────────────────────┴────────────┴──────┴──────────┴─────┴──────┴────────┴────────┘');
        lines.push('Legend: U=unknown  D=discovered  S=scouted  C=controlled  ★=capital');
        return lines.join('\n');
    }
    validateWorld(world) {
        const isolated = [];
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
        const names = new Set();
        let dup = false;
        for (const t of world.territories.values()) {
            if (names.has(t.name))
                dup = true;
            names.add(t.name);
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
                dup ? 'DUPLICATE territory names detected' : 'All territory names are unique ✓',
            ].join('\n'),
        };
    }
    /* ─── GameStateSnapshot compatibility bridge ───────────────────── */
    toTerritorySpecs(world) {
        const specs = [];
        for (const t of world.territories.values()) {
            specs.push({
                id: t.id,
                name: t.name,
                terrain: t.terrain,
                neighbors: [...t.neighboring],
                population: t.population,
                baseValue: t.baseValue,
                resourceOutput: { ...t.resourceOutput },
                fortification: t.fortification,
                garrison: t.garrison,
                isCapital: t.isCapital,
                owner: t.owner,
            });
        }
        return specs;
    }
    collectFactionTerritoryIds(world, factionId) {
        const ids = [];
        for (const [id, t] of world.territories) {
            if (t.owner === factionId)
                ids.push(id);
        }
        return ids;
    }
    collectAdjacentFrontiers(world, factionId) {
        const owned = new Set(this.collectFactionTerritoryIds(world, factionId));
        const frontiers = new Set();
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
exports.MapEngine = MapEngine;
//# sourceMappingURL=MapEngine.js.map