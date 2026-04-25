import { isRedisReady, redisClient } from '../config/redis.js';

const VERSION_PREFIX = 'cache:version:';

const sanitizeSegment = (value) => String(value ?? '').trim().toLowerCase();

export const getCache = async (key) => {
  if (!isRedisReady()) return null;

  try {
    return await redisClient.get(key);
  } catch (error) {
    console.error(`Cache GET failed for ${key}:`, error.message);
    return null;
  }
};

export const setCache = async (key, value, ttlSeconds) => {
  if (!isRedisReady()) return false;

  try {
    await redisClient.set(key, JSON.stringify(value), { EX: ttlSeconds });
    return true;
  } catch (error) {
    console.error(`Cache SET failed for ${key}:`, error.message);
    return false;
  }
};

export const deleteCacheKeys = async (keys = []) => {
  if (!isRedisReady()) return 0;

  const uniqueKeys = [...new Set(keys.filter(Boolean))];
  if (!uniqueKeys.length) return 0;

  try {
    return await redisClient.del(uniqueKeys);
  } catch (error) {
    console.error('Cache DEL failed:', error.message);
    return 0;
  }
};

export const getCacheVersion = async (namespace) => {
  if (!isRedisReady()) return '0';

  try {
    const version = await redisClient.get(`${VERSION_PREFIX}${namespace}`);
    return version || '0';
  } catch (error) {
    console.error(`Cache version read failed for ${namespace}:`, error.message);
    return '0';
  }
};

export const bumpCacheVersion = async (namespace) => {
  if (!isRedisReady()) return '0';

  try {
    return String(await redisClient.incr(`${VERSION_PREFIX}${namespace}`));
  } catch (error) {
    console.error(`Cache version bump failed for ${namespace}:`, error.message);
    return '0';
  }
};

export const buildVersionedCacheKey = async (namespace, suffix) => {
  const version = await getCacheVersion(namespace);
  return `${namespace}:v${version}:${suffix}`;
};

export const invalidateUserProfileCaches = async ({ id, username, slug } = {}) => {
  await Promise.all([
    deleteCacheKeys([
      id ? `user:profile:${sanitizeSegment(id)}` : null,
      username ? `user:profile:${sanitizeSegment(username)}` : null,
      slug ? `user:profile:${sanitizeSegment(slug)}` : null,
    ]),
    bumpCacheVersion('creators:famous'),
    bumpCacheVersion('creators:top30'),
  ]);
};

export const invalidateListingCaches = async ({ id, slug, creatorId } = {}) => {
  await Promise.all([
    deleteCacheKeys([
      id ? `listing:detail:${sanitizeSegment(id)}` : null,
      slug ? `listing:detail:${sanitizeSegment(slug)}` : null,
    ]),
    bumpCacheVersion('listings:public'),
    bumpCacheVersion('meta:categories_tags'),
    bumpCacheVersion('creators:famous'),
    bumpCacheVersion('creators:top30'),
    creatorId ? invalidateUserProfileCaches({ id: creatorId }) : Promise.resolve(),
  ]);
};

export const invalidateMetaCaches = async () => {
  await Promise.all([
    bumpCacheVersion('meta:categories_tags'),
    bumpCacheVersion('listings:public'),
  ]);
};

export const parseCachedJson = (value) => {
  try {
    return value ? JSON.parse(value) : null;
  } catch {
    return null;
  }
};
