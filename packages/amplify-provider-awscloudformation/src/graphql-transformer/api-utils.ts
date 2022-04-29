import {
  stateManager,
  getTransformerVersion,
  getGraphQLTransformerOpenSearchProductionDocLink,
  getGraphQLTransformerAuthDocLink,
  $TSContext,
  $TSObject,
} from "amplify-cli-core";
import { printer } from "amplify-prompts";
import { ResourceConstants } from "graphql-transformer-common";
import _ from "lodash";

export async function searchablePushChecks(context, map, apiName): Promise<void> {
  const searchableModelTypes = Object.keys(map).filter(type => map[type].includes('searchable') && map[type].includes('model'));
  if (searchableModelTypes.length) {
    const currEnv = context.amplify.getEnvInfo().envName;
    const teamProviderInfo = stateManager.getTeamProviderInfo();
    const instanceType = _.get(
      teamProviderInfo,
      [currEnv, 'categories', 'api', apiName, ResourceConstants.PARAMETERS.ElasticsearchInstanceType],
      't2.small.elasticsearch',
    );
    if (instanceType === 't2.small.elasticsearch' || instanceType === 't3.small.elasticsearch') {
      const version = await getTransformerVersion(context);
      const docLink = getGraphQLTransformerOpenSearchProductionDocLink(version);
      printer.warn(
        `Your instance type for OpenSearch is ${instanceType}, you may experience performance issues or data loss. Consider reconfiguring with the instructions here ${docLink}`,
      );
    }
  }
}

export const warnOnAuth = async (context: $TSContext, map: $TSObject): Promise<void> => {
  const unAuthModelTypes = Object.keys(map).filter(type => !map[type].includes('auth') && map[type].includes('model'));
  if (unAuthModelTypes.length) {
    const transformerVersion = await getTransformerVersion(context);
    const docLink = getGraphQLTransformerAuthDocLink(transformerVersion);
    if (transformerVersion === 2) {
      printer.info(
        `
  ⚠️  WARNING: Some types do not have authorization rules configured. That means all create, read, update, and delete operations are denied on these types:`,
        'yellow',
      );
      printer.info(unAuthModelTypes.map(type => `\t - ${type}`).join('\n'), 'yellow');
      printer.info(`Learn more about "@auth" authorization rules here: ${docLink}`, 'yellow');
    } else {
      context.print.warning("\nThe following types do not have '@auth' enabled. Consider using @auth with @model");
      context.print.warning(unAuthModelTypes.map(type => `\t - ${type}`).join('\n'));
      context.print.info(`Learn more about @auth here: ${docLink}\n`);
    }
  }
};
