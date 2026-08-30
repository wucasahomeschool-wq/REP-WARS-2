export class SeededRNG {
  private state: number;
  private originalSeed: number;

  constructor(seed: number) {
    this.originalSeed = seed;
    this.state = this.mixSeed(seed >>> 0);
    if (this.state === 0) this.state = 0xdeadbeef;
  }

  private mixSeed(s: number): number {
    let h = s >>> 0;
    h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
    h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
    h = (h ^ (h >>> 16)) >>> 0;
    return h;
  }

  next(): number {
    let s = this.state;
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    this.state = s >>> 0;
    return this.state / 0xffffffff;
  }

  nextInt(min: number, max: number): number {
    if (max <= min) return min;
    const range = max - min + 1;
    return Math.floor(this.next() * range) + min;
  }

  nextFloat(min: number, max: number): number {
    return this.next() * (max - min) + min;
  }

  pick<T>(arr: T[]): T {
    if (arr.length === 0) throw new Error('Cannot pick from empty array');
    return arr[Math.floor(this.next() * arr.length)];
  }

  weightedPick<T>(items: { value: T; weight: number }[]): T {
    const total = items.reduce((s, i) => s + Math.max(0, i.weight), 0);
    if (total <= 0) return items[0].value;
    let r = this.next() * total;
    for (const item of items) {
      r -= Math.max(0, item.weight);
      if (r <= 0) return item.value;
    }
    return items[items.length - 1].value;
  }

  chance(probability: number): boolean {
    return this.next() < probability;
  }

  shuffle<T>(arr: T[]): T[] {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  reset(): SeededRNG {
    return new SeededRNG(this.originalSeed);
  }

  getSeed(): number {
    return this.originalSeed;
  }

  fork(extraSalt: number): SeededRNG {
    return new SeededRNG(this.originalSeed * 31 + extraSalt);
  }
}
