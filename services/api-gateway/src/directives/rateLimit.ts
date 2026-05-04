import { mapSchema, getDirective, MapperKind } from '@graphql-tools/utils';
import { defaultFieldResolver, GraphQLSchema } from 'graphql';
import { Redis } from 'ioredis';

const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379', {
  maxRetriesPerRequest: 1,
  lazyConnect: true,
});

export function rateLimitDirective(schema: GraphQLSchema): GraphQLSchema {
  return mapSchema(schema, {
    [MapperKind.OBJECT_FIELD]: (fieldConfig, fieldName) => {
      const directive = getDirective(schema, fieldConfig, 'rateLimit')?.[0];
      if (!directive) return fieldConfig;

      const maxRequests = directive['max'] as number;
      const windowSeconds = directive['window'] as number;
      const { resolve = defaultFieldResolver } = fieldConfig;

      fieldConfig.resolve = async (source, args, context, info) => {
        const { user, ip } = context;
        const identifier = user?.id || ip || 'anonymous';
        const key = `ratelimit:${fieldName}:${identifier}`;

        try {
          const current = await redis.incr(key);
          if (current === 1) {
            await redis.expire(key, windowSeconds);
          }

          if (current > maxRequests) {
            const ttl = await redis.ttl(key);
            throw new Error(
              `Rate limit exceeded for ${fieldName}. Limit: ${maxRequests}/${windowSeconds}s. Retry after ${ttl}s.`,
            );
          }
        } catch (error: any) {
          if (error.message.includes('Rate limit exceeded')) throw error;
          // If Redis is unavailable, allow the request through
        }

        return resolve(source, args, context, info);
      };

      return fieldConfig;
    },
  });
}
