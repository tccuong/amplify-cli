import { $TSContext } from 'amplify-cli-core';
import { syncOAuthSecretsToCloud } from '../provider-utils/awscloudformation/auth-secret-manager/sync-oauth-secrets';
import { getAuthResourceName } from '../utils/getAuthResourceName';

export const prePushHandler = async (context: $TSContext) => {
  const authResourceName = await getAuthResourceName(context);
  await syncOAuthSecretsToCloud(context, authResourceName);
};
