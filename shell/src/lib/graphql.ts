// ──────────────────────────────────────────────────────────────
// sentinel-os/shell/src/lib/graphql.ts
// Apollo Client connected to Sentinel OS API Gateway
// ──────────────────────────────────────────────────────────────

import { ApolloClient, InMemoryCache, createHttpLink, split } from '@apollo/client';
import { GraphQLWsLink } from '@apollo/client/link/subscriptions';
import { getMainDefinition } from '@apollo/client/utilities';
import { createClient } from 'graphql-ws';

const GQL_URL = import.meta.env.VITE_GQL_URL || 'http://localhost:4000/graphql';
const WS_URL = import.meta.env.VITE_GQL_WS_URL || 'ws://localhost:4000/graphql';

const httpLink = createHttpLink({ uri: GQL_URL });

const wsLink = typeof window !== 'undefined'
  ? new GraphQLWsLink(createClient({ url: WS_URL }))
  : httpLink;

const splitLink = split(
  ({ query }) => {
    const def = getMainDefinition(query);
    return def.kind === 'OperationDefinition' && def.operation === 'subscription';
  },
  wsLink,
  httpLink,
);

export const apolloClient = new ApolloClient({
  link: splitLink,
  cache: new InMemoryCache({
    typePolicies: {
      Alert: { keyFields: ['id'] },
      IntelligenceItem: { keyFields: ['id'] },
      CyberEvent: { keyFields: ['id'] },
      Sensor: { keyFields: ['id'] },
      Correlation: { keyFields: ['id'] },
      ResponseRule: { keyFields: ['id'] },
      PendingApproval: { keyFields: ['id'] },
    },
  }),
  defaultOptions: {
    watchQuery: { fetchPolicy: 'cache-and-network' },
    query: { fetchPolicy: 'network-only' },
  },
});
