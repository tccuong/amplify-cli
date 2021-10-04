import {
  amplifyPush,
  deleteProject,
  initJSProjectWithProfile,
  addApiWithAllAuthModesV2,
  createNewProjectDir,
  deleteProjectDir,
  getAppSyncApi,
  getProjectMeta,
  addFeatureFlag,
} from 'amplify-e2e-core';
import path from 'path';
import { existsSync } from 'fs';
import _ from 'lodash';

describe('amplify add graphql api with lambda auth mode', () => {
  let projRoot: string;
  let projFolderName: string;
  beforeEach(async () => {
    projFolderName = 'graphqlapi';
    projRoot = await createNewProjectDir(projFolderName);
  });

  afterEach(async () => {
    const metaFilePath = path.join(projRoot, 'amplify', '#current-cloud-backend', 'amplify-meta.json');
    if (existsSync(metaFilePath)) {
      await deleteProject(projRoot);
    }
    deleteProjectDir(projRoot);
  });

  it('init a project and add the simple_model api', async () => {
    const envName = 'devtest';
    const projName = 'lambdaauthmode';
    await initJSProjectWithProfile(projRoot, { name: projName, envName });
    await addFeatureFlag(projRoot, 'graphqltransformer', 'useexperimentalpipelinedtransformer', true);
    await addApiWithAllAuthModesV2(projRoot);
    await amplifyPush(projRoot);

    const meta = getProjectMeta(projRoot);
    const region = meta.providers.awscloudformation.Region;
    const { output } = meta.api.lambdaauthmode;
    const { GraphQLAPIIdOutput, GraphQLAPIEndpointOutput, GraphQLAPIKeyOutput } = output;
    const { graphqlApi } = await getAppSyncApi(GraphQLAPIIdOutput, region);

    expect(GraphQLAPIIdOutput).toBeDefined();
    expect(GraphQLAPIEndpointOutput).toBeDefined();
    expect(GraphQLAPIKeyOutput).toBeDefined();

    expect(graphqlApi).toBeDefined();
    expect(graphqlApi.apiId).toEqual(GraphQLAPIIdOutput);
  });
});
