import { ApolloClient, InMemoryCache, HttpLink, split, from } from '@apollo/client';
import { onError } from '@apollo/client/link/error';
import { GraphQLWsLink } from '@apollo/client/link/subscriptions';
import { getMainDefinition } from '@apollo/client/utilities';
import { createClient } from 'graphql-ws';

const API_URL = import.meta.env.VITE_API_URL || '/graphql';
const WS_URL = import.meta.env.VITE_WS_URL ||
  `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}/ws`;

const errorLink = onError(({ graphQLErrors, networkError }) => {
  if (graphQLErrors) {
    graphQLErrors.forEach(({ message, locations, path }) =>
      console.warn(`[GraphQL error]: Message: ${message}, Path: ${path}`),
    );
  }
  if (networkError) {
    console.warn(`[Network error]: ${networkError.message} — falling back to seed data`);
  }
});

const httpLink = new HttpLink({
  uri: API_URL,
  headers: {
    'Content-Type': 'application/json',
  },
});

let link = from([errorLink, httpLink]);

try {
  const wsLink = new GraphQLWsLink(
    createClient({
      url: WS_URL,
      connectionParams: () => {
        const token = localStorage.getItem('sentinel_token');
        return token ? { authorization: `Bearer ${token}` } : {};
      },
      retryAttempts: 3,
      shouldRetry: () => true,
      lazy: true,
    }),
  );

  link = from([
    errorLink,
    split(
      ({ query }) => {
        const definition = getMainDefinition(query);
        return definition.kind === 'OperationDefinition' && definition.operation === 'subscription';
      },
      wsLink,
      httpLink,
    ),
  ]);
} catch {
  console.warn('WebSocket link unavailable — subscriptions disabled');
}

export const apolloClient = new ApolloClient({
  link,
  cache: new InMemoryCache({
    typePolicies: {
      Query: {
        fields: {
          alerts: { merge: false },
          detections: { merge: false },
          sensors: { merge: false },
        },
      },
    },
  }),
  defaultOptions: {
    watchQuery: { fetchPolicy: 'cache-and-network', errorPolicy: 'all' },
    query: { fetchPolicy: 'network-only', errorPolicy: 'all' },
    mutate: { errorPolicy: 'all' },
  },
});
