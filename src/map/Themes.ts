import { ThemeDefinition } from '../types';

const FORT_WEIGHTS_FLAT: Record<number, number> = { 0: 0.5, 1: 0.35, 2: 0.12, 3: 0.03, 4: 0.0, 5: 0.0 };
const FORT_WEIGHTS_FORTIFIED: Record<number, number> = { 0: 0.25, 1: 0.3, 2: 0.25, 3: 0.15, 4: 0.04, 5: 0.01 };
const FORT_WEIGHTS_MILITANT: Record<number, number> = { 0: 0.12, 1: 0.23, 2: 0.3, 3: 0.22, 4: 0.1, 5: 0.03 };

function weights(arr: [string, number][]): Record<string, number> {
  return arr.reduce((acc, [k, v]) => { acc[k] = v; return acc; }, {} as Record<string, number>);
}

export const IRON_HILLS: ThemeDefinition = {
  id: 'iron_hills',
  name: 'Iron Hills',
  description: 'Rolling grey ridges rich in iron and mining lore.',
  environmentalTag: 'mountain',
  preferredTerrain: [
    { terrain: 'mountain', weight: 5 },
    { terrain: 'hills', weight: 3 },
    { terrain: 'forest', weight: 1 },
  ],
  terrainDistributionWeights: weights([
    ['plains', 2], ['forest', 4], ['hills', 7], ['mountain', 10],
    ['desert', 0.2], ['river', 1.2], ['fortress', 0.8], ['coastal', 0.5],
  ]) as any,
  naming: {
    prefixes: ['Iron', 'Black', 'Cold', 'Grey', 'Stone', 'Smoldering', 'Rust', 'Dwarf-', 'Hollow', 'Forge'],
    roots: ['Ridge', 'Mine', 'Crag', 'Hollow', 'Peak', 'Spur', 'Hold', 'Anvil', 'Forge', 'Foothills', 'Cleft', 'Quarry'],
    suffixes: ['Hill', 'Mount', 'Valley', 'Spire', 'Gate', 'Deep', 'Heights', 'Pass', 'Halls', 'Wastes'],
    formatWeights: { prefixRoot: 0.42, rootSuffix: 0.2, prefixRootSuffix: 0.18, standaloneRoot: 0.1, compound: 0.1 },
    capitalNameChance: 0.35,
  },
  resourceTendencies: { iron: 5, stone: 3, gold: 1, food: 0.6, wood: 0.8 },
  strategicTendency: 0.75,
  baseValueRange: [22, 44],
  populationRange: [6000, 18000],
  garrisonRange: [90, 240],
  fortificationWeights: FORT_WEIGHTS_FORTIFIED,
  capitalBonus: true,
  isCoastalBias: false,
  borderSizePreference: { min: 3, max: 7, avg: 5 },
  rarity: 1,
  allowedAdjacentThemes: ['ember_plains', 'mistwood', 'crystal_coast', 'golden_desert', 'tuna_isles', 'christmas_tree_mountains'],
};

export const CHRISTMAS_TREE_MOUNTAINS: ThemeDefinition = {
  id: 'christmas_tree_mountains',
  name: 'Christmas Tree Mountains',
  description: 'Evergreen-capped peaks and snowy passes of the northern ranges.',
  environmentalTag: 'winter-mountain',
  preferredTerrain: [
    { terrain: 'mountain', weight: 6 },
    { terrain: 'forest', weight: 3 },
    { terrain: 'hills', weight: 2 },
  ],
  terrainDistributionWeights: weights([
    ['plains', 1.2], ['forest', 8], ['hills', 5], ['mountain', 11],
    ['desert', 0.1], ['river', 2], ['fortress', 1.2], ['coastal', 0.8],
  ]) as any,
  naming: {
    prefixes: ['Frost', 'Snow', 'Pine', 'Aurora', 'Cedar', 'Wyrm', 'Tannen', 'Glitter', 'Cold', 'Crystal'],
    roots: ['Spire', 'Crown', 'Bough', 'Needle', 'Ridge', 'Peak', 'Grove', 'Pass', 'Slope', 'Hollow', 'Woods', 'Tree'],
    suffixes: ['Mount', 'Crag', 'Mountain', 'Reach', 'Wilds', 'Forest', 'Spine', 'Wall', 'Watch', 'Sierra'],
    formatWeights: { prefixRoot: 0.3, rootSuffix: 0.3, prefixRootSuffix: 0.18, standaloneRoot: 0.08, compound: 0.14 },
    capitalNameChance: 0.3,
  },
  resourceTendencies: { wood: 3.5, stone: 2, iron: 1.2, food: 0.5, gold: 0.8 },
  strategicTendency: 0.65,
  baseValueRange: [18, 38],
  populationRange: [4000, 16000],
  garrisonRange: [80, 220],
  fortificationWeights: FORT_WEIGHTS_FLAT,
  capitalBonus: true,
  isCoastalBias: false,
  borderSizePreference: { min: 3, max: 7, avg: 5 },
  rarity: 1,
  allowedAdjacentThemes: ['iron_hills', 'mistwood', 'ember_plains', 'crystal_coast'],
};

export const TUNA_ISLES: ThemeDefinition = {
  id: 'tuna_isles',
  name: 'Tuna Isles',
  description: 'Fishing archipelago, windy coasts, salt-crusted coves.',
  environmentalTag: 'coastal',
  preferredTerrain: [
    { terrain: 'coastal', weight: 7 },
    { terrain: 'plains', weight: 2 },
    { terrain: 'river', weight: 2 },
  ],
  terrainDistributionWeights: weights([
    ['plains', 4], ['forest', 1.5], ['hills', 1.2], ['mountain', 0.4],
    ['desert', 0.2], ['river', 3.5], ['fortress', 0.6], ['coastal', 10],
  ]) as any,
  naming: {
    prefixes: ['Blue', 'Tuna', 'Salt', 'Wave', 'Coral', 'Fisher', 'Sailor', 'Deep', 'Pier', 'Misty'],
    roots: ['Water', 'Bay', 'Harbor', 'Isle', 'Cove', 'Reef', 'Beach', 'Spit', 'Anchor', 'Dune', 'Marina', 'Haven'],
    suffixes: ['Isles', 'Reach', 'Coast', 'Sound', 'Sea', 'Bay', 'Port', 'Cay', 'Shores', 'Keys'],
    formatWeights: { prefixRoot: 0.3, rootSuffix: 0.3, prefixRootSuffix: 0.15, standaloneRoot: 0.15, compound: 0.1 },
    capitalNameChance: 0.28,
  },
  resourceTendencies: { food: 4.5, gold: 2.2, wood: 1.1, iron: 0.5, stone: 0.6 },
  strategicTendency: 0.5,
  baseValueRange: [20, 42],
  populationRange: [8000, 22000],
  garrisonRange: [70, 200],
  fortificationWeights: FORT_WEIGHTS_FLAT,
  capitalBonus: true,
  isCoastalBias: true,
  borderSizePreference: { min: 2, max: 5, avg: 3.5 },
  rarity: 1.1,
  allowedAdjacentThemes: ['crystal_coast', 'mistwood', 'ember_plains', 'golden_desert', 'iron_hills'],
};

export const EMBER_PLAINS: ThemeDefinition = {
  id: 'ember_plains',
  name: 'Ember Plains',
  description: 'Warm grasslands spotted with volcanic vents and ash-rivers.',
  environmentalTag: 'volcanic',
  preferredTerrain: [
    { terrain: 'plains', weight: 7 },
    { terrain: 'hills', weight: 2 },
    { terrain: 'desert', weight: 1.2 },
  ],
  terrainDistributionWeights: weights([
    ['plains', 10], ['forest', 1.3], ['hills', 3], ['mountain', 1.5],
    ['desert', 2.8], ['river', 1.2], ['fortress', 0.6], ['coastal', 0.9],
  ]) as any,
  naming: {
    prefixes: ['Ember', 'Ash', 'Cinder', 'Fire', 'Black', 'Blaze', 'Searing', 'Smoke', 'Pale', 'Bronze'],
    roots: ['Field', 'Plain', 'Steppe', 'Run', 'Heath', 'Burnt', 'Pasture', 'Fall', 'March', 'Stead', 'Barrens'],
    suffixes: ['Plains', 'Hold', 'Marches', 'Reach', 'Steppes', 'Fields', 'Fell', 'Expanse', 'Territory', 'Grounds'],
    formatWeights: { prefixRoot: 0.38, rootSuffix: 0.25, prefixRootSuffix: 0.16, standaloneRoot: 0.1, compound: 0.11 },
    capitalNameChance: 0.3,
  },
  resourceTendencies: { food: 3, gold: 1.4, iron: 1.6, stone: 1, wood: 0.7 },
  strategicTendency: 0.55,
  baseValueRange: [22, 44],
  populationRange: [10000, 24000],
  garrisonRange: [60, 200],
  fortificationWeights: FORT_WEIGHTS_FLAT,
  capitalBonus: true,
  isCoastalBias: false,
  borderSizePreference: { min: 3, max: 7, avg: 5 },
  rarity: 1,
  allowedAdjacentThemes: ['iron_hills', 'golden_desert', 'mistwood', 'tuna_isles', 'crystal_coast', 'christmas_tree_mountains'],
};

export const CRYSTAL_COAST: ThemeDefinition = {
  id: 'crystal_coast',
  name: 'Crystal Coast',
  description: 'Gemstone cliffs, pale beaches, and tide-carved grottoes.',
  environmentalTag: 'coastal-gem',
  preferredTerrain: [
    { terrain: 'coastal', weight: 6 },
    { terrain: 'hills', weight: 2 },
    { terrain: 'forest', weight: 1.5 },
  ],
  terrainDistributionWeights: weights([
    ['plains', 2.4], ['forest', 3], ['hills', 3.5], ['mountain', 0.9],
    ['desert', 0.6], ['river', 2], ['fortress', 0.8], ['coastal', 10],
  ]) as any,
  naming: {
    prefixes: ['Crystal', 'Prism', 'Sapphire', 'Emerald', 'Pearl', 'Glass', 'Luminous', 'Aqua', 'Moonstone', 'Jade'],
    roots: ['Shore', 'Cove', 'Spire', 'Bay', 'Grotto', 'Cliff', 'Reef', 'Crest', 'Marina', 'Beach', 'Dune'],
    suffixes: ['Coast', 'Haven', 'Spire', 'Bay', 'Waters', 'Reach', 'Cay', 'Keys', 'Shore', 'Harbor'],
    formatWeights: { prefixRoot: 0.32, rootSuffix: 0.28, prefixRootSuffix: 0.18, standaloneRoot: 0.1, compound: 0.12 },
    capitalNameChance: 0.3,
  },
  resourceTendencies: { gold: 3.5, food: 2.5, stone: 1.1, wood: 1, iron: 0.6 },
  strategicTendency: 0.6,
  baseValueRange: [24, 48],
  populationRange: [9000, 20000],
  garrisonRange: [80, 220],
  fortificationWeights: FORT_WEIGHTS_FORTIFIED,
  capitalBonus: true,
  isCoastalBias: true,
  borderSizePreference: { min: 3, max: 6, avg: 4 },
  rarity: 1.15,
  allowedAdjacentThemes: ['tuna_isles', 'mistwood', 'golden_desert', 'ember_plains', 'iron_hills'],
};

export const MISTWOOD: ThemeDefinition = {
  id: 'mistwood',
  name: 'Mistwood',
  description: 'Endless forest draped in fog, crossed by deer paths.',
  environmentalTag: 'woodland',
  preferredTerrain: [
    { terrain: 'forest', weight: 9 },
    { terrain: 'river', weight: 2 },
    { terrain: 'hills', weight: 1.5 },
  ],
  terrainDistributionWeights: weights([
    ['plains', 2], ['forest', 12], ['hills', 2.2], ['mountain', 0.6],
    ['desert', 0.1], ['river', 3], ['fortress', 0.7], ['coastal', 1.4],
  ]) as any,
  naming: {
    prefixes: ['Mist', 'Shadow', 'Green', 'Thorn', 'Whisper', 'Silver', 'Dusk', 'Willow', 'Briar', 'Dew'],
    roots: ['Wood', 'Forest', 'Grove', 'Glen', 'Thicket', 'Hollow', 'Brae', 'Dell', 'Briar', 'Canopy', 'Mire'],
    suffixes: ['Woods', 'Hollow', 'Forest', 'Reach', 'Glade', 'Thicket', 'Marches', 'Wilds', 'Deep', 'Moor'],
    formatWeights: { prefixRoot: 0.3, rootSuffix: 0.3, prefixRootSuffix: 0.18, standaloneRoot: 0.1, compound: 0.12 },
    capitalNameChance: 0.3,
  },
  resourceTendencies: { wood: 5, food: 1.8, iron: 0.6, gold: 0.8, stone: 0.7 },
  strategicTendency: 0.62,
  baseValueRange: [18, 40],
  populationRange: [7000, 18000],
  garrisonRange: [60, 180],
  fortificationWeights: FORT_WEIGHTS_FLAT,
  capitalBonus: true,
  isCoastalBias: false,
  borderSizePreference: { min: 3, max: 6, avg: 4.5 },
  rarity: 1,
  allowedAdjacentThemes: ['iron_hills', 'christmas_tree_mountains', 'ember_plains', 'tuna_isles', 'crystal_coast', 'golden_desert'],
};

export const GOLDEN_DESERT: ThemeDefinition = {
  id: 'golden_desert',
  name: 'Golden Desert',
  description: 'Sun-baked dunes, caravan routes, and sunken oases.',
  environmentalTag: 'arid',
  preferredTerrain: [
    { terrain: 'desert', weight: 8 },
    { terrain: 'plains', weight: 1.8 },
    { terrain: 'hills', weight: 1.4 },
  ],
  terrainDistributionWeights: weights([
    ['plains', 2.8], ['forest', 0.4], ['hills', 2.2], ['mountain', 1.2],
    ['desert', 11], ['river', 1.6], ['fortress', 1.2], ['coastal', 1.6],
  ]) as any,
  naming: {
    prefixes: ['Golden', 'Sand', 'Sun', 'Sahara', 'Dune', 'Bone', 'Palm', 'Sultans', 'Silent', 'Scorching'],
    roots: ['Dune', 'Sands', 'Oasis', 'Bazaar', 'Well', 'Path', 'Sea', 'Spice', 'Wastes', 'Tomb', 'Market'],
    suffixes: ['Desert', 'Reach', 'Wastes', 'Dunes', 'Expanse', 'Emirate', 'Ways', 'Sea', 'Depths', 'Kingdom'],
    formatWeights: { prefixRoot: 0.32, rootSuffix: 0.25, prefixRootSuffix: 0.16, standaloneRoot: 0.16, compound: 0.11 },
    capitalNameChance: 0.35,
  },
  resourceTendencies: { gold: 3, food: 1, stone: 1.4, iron: 0.8, wood: 0.3 },
  strategicTendency: 0.55,
  baseValueRange: [20, 44],
  populationRange: [5000, 18000],
  garrisonRange: [80, 240],
  fortificationWeights: FORT_WEIGHTS_MILITANT,
  capitalBonus: true,
  isCoastalBias: false,
  borderSizePreference: { min: 4, max: 8, avg: 5.5 },
  rarity: 1.1,
  allowedAdjacentThemes: ['ember_plains', 'crystal_coast', 'tuna_isles', 'mistwood', 'iron_hills'],
};

export const DEFAULT_THEME_LIBRARY: ThemeDefinition[] = [
  IRON_HILLS,
  CHRISTMAS_TREE_MOUNTAINS,
  TUNA_ISLES,
  EMBER_PLAINS,
  CRYSTAL_COAST,
  MISTWOOD,
  GOLDEN_DESERT,
];
