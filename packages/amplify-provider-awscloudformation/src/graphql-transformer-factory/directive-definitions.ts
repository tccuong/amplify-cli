import {
  getAppSyncServiceExtraDirectives,
} from '@aws-amplify/graphql-transformer-core';
import {
  $TSContext,
} from 'amplify-cli-core';
import { print } from 'graphql';
import { getTransformerFactory } from './transformer-factory';

/**
 * Return the set of directive definitions for the project, includes both appsync and amplify supported directives.
 * This will return the relevant set determined by whether or not the customer is using GQL transformer v1 or 2 in their project.
 */
export async function getDirectiveDefinitions(context: $TSContext, resourceDir: string): Promise<string> {
  const transformerFactory = await getTransformerFactory(context, resourceDir);
  const transformList = await transformerFactory({ addSearchableTransformer: true, authConfig: {} })

  const transformDirectives = transformList
    .map(transformPluginInst => [transformPluginInst.directive, ...transformPluginInst.typeDefinitions].map(node => print(node)).join('\n'))
    .join('\n');

  return [getAppSyncServiceExtraDirectives(), transformDirectives].join('\n');
}
