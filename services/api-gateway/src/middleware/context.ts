import type { PubSub } from 'graphql-subscriptions';
import type DataLoader from 'dataloader';

export interface AuthenticatedUser {
  id: string;
  organizationId: string;
  username: string;
  role: string;
  clearanceLevel: string;
  permissions: string[];
}

export interface SentinelContext {
  user: AuthenticatedUser | null;
  pubsub: PubSub;
  dataloaders: DataLoaderMap;
  requestId: string;
  ip?: string;
  userAgent?: string;
}

export interface DataLoaderMap {
  userLoader: DataLoader<string, any>;
  organizationLoader: DataLoader<string, any>;
  sensorLoader: DataLoader<string, any>;
  alertLoader: DataLoader<string, any>;
  missionLoader: DataLoader<string, any>;
  trackLoader: DataLoader<string, any>;
  modelLoader: DataLoader<string, any>;
}
