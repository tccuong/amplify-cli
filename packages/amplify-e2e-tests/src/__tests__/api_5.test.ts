import {
  amplifyPush,
  amplifyPushGraphQlWithCognitoPrompt,
  deleteProject,
  initJSProjectWithProfile,
  addApiWithoutSchema,
  addApiWithAllAuthModesV2,
  createNewProjectDir,
  deleteProjectDir,
  getAppSyncApi,
  getProjectMeta,
  addFeatureFlag,
  updateApiSchema,
} from 'amplify-e2e-core';
import path from 'path';
import { existsSync } from 'fs';
import _ from 'lodash';

describe('test graphql lambda authorizer and auto apply auth mode', () => {
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

  // it('amplify add graphql api with lambda auth mode', async () => {
  //   const envName = 'devtest';
  //   const projName = 'lambdaauthmode';
  //   await initJSProjectWithProfile(projRoot, { name: projName, envName });
  //   await addFeatureFlag(projRoot, 'graphqltransformer', 'useexperimentalpipelinedtransformer', true);
  //   await addApiWithAllAuthModesV2(projRoot);
  //   await amplifyPush(projRoot);

  //   const meta = getProjectMeta(projRoot);
  //   const region = meta.providers.awscloudformation.Region;
  //   const { output } = meta.api.lambdaauthmode;
  //   const { GraphQLAPIIdOutput, GraphQLAPIEndpointOutput, GraphQLAPIKeyOutput } = output;
  //   const { graphqlApi } = await getAppSyncApi(GraphQLAPIIdOutput, region);

  //   expect(GraphQLAPIIdOutput).toBeDefined();
  //   expect(GraphQLAPIEndpointOutput).toBeDefined();
  //   expect(GraphQLAPIKeyOutput).toBeDefined();

  //   expect(graphqlApi).toBeDefined();
  //   expect(graphqlApi.apiId).toEqual(GraphQLAPIIdOutput);
  // });

  it('amplify push prompt for cognito configuration if auth mode is missing', async () => {
    const envName = 'devtest';
    const projName = 'lambdaauthmode';
    await initJSProjectWithProfile(projRoot, { name: projName, envName });
    await addFeatureFlag(projRoot, 'graphqltransformer', 'useexperimentalpipelinedtransformer', true);
    await addApiWithoutSchema(projRoot);
    await updateApiSchema(projRoot, projName, 'cognito_simple_model.graphql');
    await amplifyPushGraphQlWithCognitoPrompt(projRoot);

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
