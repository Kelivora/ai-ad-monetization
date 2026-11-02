import { AppError } from '../lib/errors.js';
import type { PlatformId } from '../knowledge/schema.js';
import type { KnowledgeBase } from '../knowledge/loader.js';
import type { PlatformAdapter } from './types.js';
import { AdMobAdapter } from './admob/index.js';
import { AppLovinMaxAdapter } from './applovin-max/index.js';
import { UnityLevelPlayAdapter } from './unity-levelplay/index.js';

let registry: Map<PlatformId, PlatformAdapter> | undefined;

export function getAdapters(kb: KnowledgeBase): Map<PlatformId, PlatformAdapter> {
  registry ??= new Map<PlatformId, PlatformAdapter>([
    ['admob', new AdMobAdapter(kb)],
    ['applovin-max', new AppLovinMaxAdapter(kb)],
    ['unity-levelplay', new UnityLevelPlayAdapter(kb)],
  ]);
  return registry;
}

export function getAdapter(kb: KnowledgeBase, id: PlatformId): PlatformAdapter {
  const adapter = getAdapters(kb).get(id);
  if (!adapter) throw new AppError('KNOWLEDGE_MISSING', `未知平台: ${id}`);
  return adapter;
}

export function listAdapters(kb: KnowledgeBase): PlatformAdapter[] {
  return [...getAdapters(kb).values()];
}
