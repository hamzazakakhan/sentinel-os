import { mapSchema, getDirective, MapperKind } from '@graphql-tools/utils';
import { defaultFieldResolver, GraphQLSchema } from 'graphql';
import { canAccessClassification } from '../middleware/auth.js';

const CLASSIFICATION_ORDER = ['UNCLASSIFIED', 'CONFIDENTIAL', 'SECRET', 'TOP_SECRET', 'SCI'];

export function classificationDirective(schema: GraphQLSchema): GraphQLSchema {
  return mapSchema(schema, {
    [MapperKind.OBJECT_FIELD]: (fieldConfig) => {
      const directive = getDirective(schema, fieldConfig, 'classification')?.[0];
      if (!directive) return fieldConfig;

      const requiredLevel = directive['minLevel'] as string;
      const { resolve = defaultFieldResolver } = fieldConfig;

      fieldConfig.resolve = async (source, args, context, info) => {
        const { user } = context;
        if (!user) {
          throw new Error('Authentication required for classified data');
        }

        if (!canAccessClassification(user, requiredLevel)) {
          const userIdx = CLASSIFICATION_ORDER.indexOf(user.clearanceLevel);
          const reqIdx = CLASSIFICATION_ORDER.indexOf(requiredLevel);
          if (userIdx < reqIdx) {
            throw new Error(
              `Insufficient clearance. Required: ${requiredLevel}, Current: ${user.clearanceLevel}`,
            );
          }
        }

        return resolve(source, args, context, info);
      };

      return fieldConfig;
    },
  });
}
