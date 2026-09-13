const MAP_TAG = '$map';
const SET_TAG = '$set';

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

export function encodePersistable(value: unknown): unknown {
  if (value instanceof Map) {
    const entries: unknown[] = [];
    for (const [key, item] of value.entries()) {
      entries.push([encodePersistable(key), encodePersistable(item)]);
    }
    return { [MAP_TAG]: entries };
  }
  if (value instanceof Set) {
    return { [SET_TAG]: [...value].map(encodePersistable) };
  }
  if (Array.isArray(value)) {
    return value.map(encodePersistable);
  }
  if (value instanceof Date) {
    return { $date: value.toISOString() };
  }
  if (typeof value === 'function' || typeof value === 'undefined' || typeof value === 'bigint') {
    return undefined;
  }
  if (isPlainObject(value)) {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      if (typeof item === 'function' || typeof item === 'undefined') continue;
      out[key] = encodePersistable(item);
    }
    return out;
  }
  if (typeof value === 'number' && !Number.isFinite(value)) {
    throw new Error('Cannot persist non-finite numbers');
  }
  return value;
}

export function decodePersistable(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(decodePersistable);
  }
  if (!isPlainObject(value)) {
    return value;
  }
  if (MAP_TAG in value && Array.isArray(value[MAP_TAG])) {
    const map = new Map<unknown, unknown>();
    for (const entry of value[MAP_TAG] as unknown[]) {
      if (!Array.isArray(entry) || entry.length < 2) continue;
      map.set(decodePersistable(entry[0]), decodePersistable(entry[1]));
    }
    return map;
  }
  if (SET_TAG in value && Array.isArray(value[SET_TAG])) {
    return new Set((value[SET_TAG] as unknown[]).map(decodePersistable));
  }
  if (typeof value.$date === 'string') {
    return value.$date;
  }
  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    out[key] = decodePersistable(item);
  }
  return out;
}

export function serializeToJson(value: unknown): string {
  return JSON.stringify(encodePersistable(value));
}

export function deserializeFromJson(raw: string): unknown {
  return decodePersistable(JSON.parse(raw));
}

export function jsonRoundTrip<T>(value: T): T {
  return deserializeFromJson(serializeToJson(value)) as T;
}
