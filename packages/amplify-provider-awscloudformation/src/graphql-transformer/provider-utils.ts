import { $TSContext, AmplifyCategories, JSONUtilities, pathManager, stateManager } from "amplify-cli-core";
import { ProviderName } from "../constants";
import fs from 'fs-extra';
import path from 'path';

export const PARAMETERS_FILENAME = 'parameters.json';
export const SCHEMA_FILENAME = 'schema.graphql';
export const SCHEMA_DIR_NAME = 'schema';
export const ROOT_APPSYNC_S3_KEY = 'amplify-appsync-files';

export function getProjectBucket(context: $TSContext): string {
  const projectDetails = context.amplify.getProjectDetails();
  return projectDetails.amplifyMeta.providers ? projectDetails.amplifyMeta.providers[ProviderName].DeploymentBucketName : '';
}

export async function getBucketName(context: $TSContext, s3ResourceName: string) {
  const { amplify } = context;
  const { amplifyMeta } = amplify.getProjectDetails();
  const stackName = amplifyMeta.providers.awscloudformation.StackName;
  const s3ResourcePath = pathManager.getResourceDirectoryPath(undefined, AmplifyCategories.STORAGE, s3ResourceName);
  const cliInputsPath = path.join(s3ResourcePath, 'cli-inputs.json');
  let bucketParameters;
  // get bucketParameters 1st from cli-inputs , if not present, then parameters.json
  if (fs.existsSync(cliInputsPath)) {
    bucketParameters = JSONUtilities.readJson(cliInputsPath);
  } else {
    bucketParameters = stateManager.getResourceParametersJson(undefined, AmplifyCategories.STORAGE, s3ResourceName);
  }

  const bucketName = stackName.startsWith('amplify-')
    ? `${bucketParameters.bucketName}\${hash}-\${env}`
    : `${bucketParameters.bucketName}${s3ResourceName}-\${env}`;
  return bucketName;
}

export async function getPreviousDeploymentRootKey(previouslyDeployedBackendDir: string): Promise<string | undefined> {
  try {
    const parametersPath = path.join(previouslyDeployedBackendDir, 'build', PARAMETERS_FILENAME);
    const parametersExists = fs.existsSync(parametersPath);
    if (parametersExists) {
      const parametersString = await fs.readFile(parametersPath);
      const parameters = JSON.parse(parametersString.toString());
      return parameters.S3DeploymentRootKey;
    }
    return undefined;
  } catch (err) {
    return undefined;
  }
}
