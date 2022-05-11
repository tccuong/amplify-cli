import { getProjectMeta } from './get-project-meta';

/**
 *
 */
export function getAmplifyAppId() {
  const meta = getProjectMeta();

  if (meta.providers && meta.providers.awscloudformation) {
    const appId = meta.providers.awscloudformation.AmplifyAppId;
    if (appId === undefined || appId.includes('mockAmplifyId_')) {
      return undefined;
    }

    return appId;
  }
}
