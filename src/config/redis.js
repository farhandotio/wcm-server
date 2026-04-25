import { createClient } from 'redis';

const redisUrl = process.env.REDIS_URL;
export const redisClient = redisUrl
  ? createClient({
      url: redisUrl,
    })
  : null;

export const connectRedis = async () => {
  if (!redisClient) {
    console.warn('Redis disabled: missing REDIS_URL.');
    return;
  }

  try {
    redisClient.on('error', (error) => {
      console.error('Redis error:', error.message);
    });

    if (redisClient.isOpen || redisClient.isReady) {
      return;
    }

    await redisClient.connect();
    console.log('Redis connected successfully.');
  } catch (error) {
    console.error('Redis connection failed. Continuing without cache:', error.message);
  }
};

export const isRedisReady = () => Boolean(redisClient?.isReady);
