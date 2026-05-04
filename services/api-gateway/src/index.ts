import { initTelemetry } from './middleware/telemetry.js';
initTelemetry('api-gateway');

import express from 'express';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import rateLimit from 'express-rate-limit';
import { ApolloServer } from '@apollo/server';
import { expressMiddleware } from '@apollo/server/express4';
import { ApolloServerPluginDrainHttpServer } from '@apollo/server/plugin/drainHttpServer';
import { makeExecutableSchema } from '@graphql-tools/schema';
import { useServer } from 'graphql-ws/lib/use/ws';
import depthLimit from 'graphql-depth-limit';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createLogger } from './middleware/logger.js';
import { authMiddleware, wsAuthMiddleware } from './middleware/auth.js';
import { classificationDirective } from './directives/classification.js';
import { rateLimitDirective } from './directives/rateLimit.js';
import { resolvers } from './resolvers/index.js';
import { createDataLoaders } from './middleware/dataloaders.js';
import { KafkaEventBus } from './subscriptions/kafkaEventBus.js';
import { createPubSub } from './subscriptions/pubsub.js';
import { healthRouter } from './middleware/health.js';
import type { SentinelContext } from './middleware/context.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const logger = createLogger('api-gateway');

const PORT = parseInt(process.env.PORT || '4000', 10);
const CORS_ORIGINS = (process.env.CORS_ORIGINS || 'https://sentinel.internal').split(',');
const DEPTH_LIMIT = parseInt(process.env.GRAPHQL_DEPTH_LIMIT || '10', 10);
const RATE_LIMIT_WINDOW = parseInt(process.env.RATE_LIMIT_WINDOW_MS || '60000', 10);
const RATE_LIMIT_MAX = parseInt(process.env.RATE_LIMIT_MAX || '1000', 10);

async function bootstrap(): Promise<void> {
  const app = express();
  const httpServer = createServer(app);

  const typeDefs = readFileSync(join(__dirname, 'schema', 'typeDefs.graphql'), 'utf-8');

  let schema = makeExecutableSchema({ typeDefs, resolvers });
  schema = depthLimit(DEPTH_LIMIT)(schema);
  schema = classificationDirective(schema);
  schema = rateLimitDirective(schema);

  const pubsub = createPubSub();
  const kafkaEventBus = new KafkaEventBus(pubsub);
  await kafkaEventBus.connect();

  const wsServer = new WebSocketServer({
    server: httpServer,
    path: '/ws',
  });

  const serverCleanup = useServer(
    {
      schema,
      context: async (ctx) => {
        const user = await wsAuthMiddleware(ctx.connectionParams);
        return {
          user,
          pubsub,
          dataloaders: createDataLoaders(user),
          requestId: crypto.randomUUID(),
        };
      },
      onConnect: async (ctx) => {
        const user = await wsAuthMiddleware(ctx.connectionParams);
        if (!user) {
          return false;
        }
        logger.info({ userId: user.id }, 'WebSocket client connected');
        return true;
      },
      onDisconnect: (ctx) => {
        logger.info('WebSocket client disconnected');
      },
    },
    wsServer,
  );

  const server = new ApolloServer<SentinelContext>({
    schema,
    plugins: [
      ApolloServerPluginDrainHttpServer({ httpServer }),
      {
        async serverWillStart() {
          return {
            async drainServer() {
              await serverCleanup.dispose();
              await kafkaEventBus.disconnect();
            },
          };
        },
      },
      {
        async requestDidStart() {
          return {
            async didEncounterErrors(requestContext) {
              for (const error of requestContext.errors) {
                logger.error(
                  {
                    message: error.message,
                    path: error.path,
                    extensions: error.extensions,
                  },
                  'GraphQL error',
                );
              }
            },
          };
        },
      },
    ],
    formatError: (formattedError, error) => {
      if (process.env.NODE_ENV === 'production') {
        delete formattedError.extensions?.stacktrace;
      }
      return formattedError;
    },
    introspection: process.env.NODE_ENV !== 'production',
  });

  await server.start();

  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", 'data:', 'https:'],
          connectSrc: ["'self'", ...CORS_ORIGINS],
        },
      },
      hsts: {
        maxAge: 31536000,
        includeSubDomains: true,
        preload: true,
      },
    }),
  );

  app.use(compression());
  app.use(express.json({ limit: '10mb' }));

  app.use('/health', healthRouter);

  const limiter = rateLimit({
    windowMs: RATE_LIMIT_WINDOW,
    max: RATE_LIMIT_MAX,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => {
      return req.headers['x-forwarded-for']?.toString() || req.ip || 'unknown';
    },
    handler: (req, res) => {
      logger.warn({ ip: req.ip }, 'Rate limit exceeded');
      res.status(429).json({
        errors: [{ message: 'Rate limit exceeded. Please retry later.' }],
      });
    },
  });

  app.use(
    '/graphql',
    cors<cors.CorsRequest>({
      origin: CORS_ORIGINS,
      credentials: true,
      methods: ['POST', 'GET', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-ID', 'X-Organization-ID'],
      maxAge: 86400,
    }),
    limiter,
    expressMiddleware(server, {
      context: async ({ req }): Promise<SentinelContext> => {
        const user = await authMiddleware(req);
        const requestId = (req.headers['x-request-id'] as string) || crypto.randomUUID();
        return {
          user,
          pubsub,
          dataloaders: createDataLoaders(user),
          requestId,
          ip: req.ip || 'unknown',
          userAgent: req.headers['user-agent'] || 'unknown',
        };
      },
    }),
  );

  httpServer.listen(PORT, '0.0.0.0', () => {
    logger.info(`API Gateway ready at http://0.0.0.0:${PORT}/graphql`);
    logger.info(`WebSocket subscriptions at ws://0.0.0.0:${PORT}/ws`);
  });

  const shutdown = async (signal: string) => {
    logger.info(`${signal} received, starting graceful shutdown`);
    await server.stop();
    await kafkaEventBus.disconnect();
    httpServer.close(() => {
      logger.info('HTTP server closed');
      process.exit(0);
    });
    setTimeout(() => {
      logger.error('Forceful shutdown after timeout');
      process.exit(1);
    }, 30000);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('unhandledRejection', (reason) => {
    logger.error({ reason }, 'Unhandled promise rejection');
  });
  process.on('uncaughtException', (error) => {
    logger.fatal({ error }, 'Uncaught exception');
    process.exit(1);
  });
}

bootstrap().catch((error) => {
  console.error('Failed to start API Gateway:', error);
  process.exit(1);
});
