import { SeededRNG } from '../utils/SeededRNG';
import { BALANCE } from '../constants/balance';
import { ThemeDefinition } from '../types';

type NameFormat = 'prefixRoot' | 'rootSuffix' | 'prefixRootSuffix' | 'standaloneRoot' | 'compound';

export class NamingSystem {
  private usedNames = new Set<string>();
  private rng: SeededRNG;

  constructor(seed: number) {
    this.rng = new SeededRNG(seed);
  }

  reset(): void {
    this.usedNames.clear();
  }

  private pick(arr: string[]): string {
    return arr[Math.floor(this.rng.next() * arr.length)]!;
  }

  private weightedFormat(theme: ThemeDefinition): NameFormat {
    const w = theme.naming.formatWeights;
    const total = w.prefixRoot + w.rootSuffix + w.prefixRootSuffix + w.standaloneRoot + w.compound;
    const roll = this.rng.next() * total;
    if (roll < w.prefixRoot)
      return 'prefixRoot';
    if (roll < w.prefixRoot + w.rootSuffix)
      return 'rootSuffix';
    if (roll < w.prefixRoot + w.rootSuffix + w.prefixRootSuffix)
      return 'prefixRootSuffix';
    if (roll < total - w.compound)
      return 'standaloneRoot';
    return 'compound';
  }

  generateTerritoryName(theme: ThemeDefinition, opts: {
    isCapital?: boolean;
    disambiguationAttempt?: number;
  } = {}): string {
    const { isCapital = false, disambiguationAttempt = 0 } = opts;
    const cfg = theme.naming;
    const maxTries = BALANCE.mapGen.naming.nameRetriesUntilUnique;
    for (let i = 0; i < maxTries; i++) {
      let name = '';
      const fmt = this.weightedFormat(theme);
      switch (fmt) {
        case 'prefixRoot':
          name = `${this.pick(cfg.prefixes)} ${this.pick(cfg.roots)}`;
          break;
        case 'rootSuffix':
          name = `${this.pick(cfg.roots)} ${this.pick(cfg.suffixes)}`;
          break;
        case 'prefixRootSuffix':
          name = `${this.pick(cfg.prefixes)} ${this.pick(cfg.roots)} ${this.pick(cfg.suffixes)}`;
          break;
        case 'standaloneRoot':
          name = `${this.pick(cfg.roots)}`;
          break;
        case 'compound':
          name = `${this.pick(cfg.roots)} of ${this.pick(cfg.prefixes)} ${this.pick(cfg.suffixes)}`;
          break;
      }
      if (name.endsWith('-'))
        name = name.slice(0, -1);
      if (isCapital && this.rng.next() < cfg.capitalNameChance * BALANCE.mapGen.naming.capitalSuffixBias) {
        const capCandidates = [' Citadel', ' Capital', ' Prime', ' Hold', ' Crown', ' Bastion', ''];
        name = `${name}${this.pick(capCandidates)}`;
      }
      if (!this.usedNames.has(name)) {
        this.usedNames.add(name);
        return name.trim();
      }
    }
    const salted = `${this.pick(cfg.prefixes)} ${this.pick(cfg.roots)} ${BALANCE.mapGen.naming.disambiguationSalt + disambiguationAttempt + this.rng.nextInt(0, 9999)}`;
    this.usedNames.add(salted);
    return salted;
  }

  generateRegionName(theme: ThemeDefinition, additionalRoots?: string[], seedSalt?: number): string {
    if (seedSalt !== undefined) {
      this.rng.reseed(seedSalt);
    }
    const cfg = theme.naming;
    const roots = additionalRoots && additionalRoots.length ? additionalRoots : cfg.roots;
    const sfx = cfg.suffixes.slice().concat(['Region', 'Lands', 'March', 'Province', 'Reach', 'Dominion', 'Territory']);
    const roll = this.rng.next();
    let name: string;
    if (roll < 0.5)
      name = `${this.pick(cfg.prefixes)} ${this.pick(roots)}`;
    else if (roll < 0.85)
      name = `${this.pick(cfg.prefixes)} ${this.pick(sfx)}`;
    else
      name = `${this.pick(cfg.roots)} ${this.pick(sfx)}`;
    return name.trim();
  }

  generateCapitalName(theme: ThemeDefinition): string {
    for (let i = 0; i < 5; i++) {
      const n = this.generateTerritoryName(theme, { isCapital: true, disambiguationAttempt: i });
      return n;
    }
    return this.generateTerritoryName(theme, { disambiguationAttempt: 42 });
  }
}
