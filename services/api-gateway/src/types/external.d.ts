declare module 'graphql-depth-limit' {
  import { GraphQLSchema } from 'graphql';
  const depthLimit: (maxDepth: number, options?: { onDepth?: (depth: number) => void }) => ((schema: GraphQLSchema) => GraphQLSchema);
  export default depthLimit;
}

declare module 'graphql-redis-subscriptions' {
  import { PubSubEngine } from 'graphql-subscriptions';
  export class RedisPubSub extends PubSubEngine {
    constructor(options: { publisher?: any; subscriber?: any; reviver?: any });
  }
}
