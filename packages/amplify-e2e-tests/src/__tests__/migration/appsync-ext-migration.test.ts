import {
  addApiWithBlankSchemaAndConflictDetection,
  addHeadlessApi,
  amplifyPush,
  amplifyPushUpdate,
  cliVersionController,
  createNewProjectDir,
  deleteProject,
  deleteProjectDir,
  getAppSyncApi,
  getCLIInputs,
  getProjectMeta,
  getProjectSchema,
  getSchemaPath,
  getTransformConfig,
  initJSProjectWithProfile,
  updateApiSchema,
  updateAPIWithResolutionStrategyWithModels,
  updateHeadlessApi,
} from 'amplify-e2e-core';
import { AddApiRequest, UpdateApiRequest } from 'amplify-headless-interface';
import { readFileSync } from 'fs-extra';
import { v4 as uuid } from 'uuid';

const addApiRequest: AddApiRequest = {
  version: 1,
  serviceConfiguration: {
    serviceName: 'AppSync',
    apiName: 'myApiName',
    transformSchema: readFileSync(getSchemaPath('simple_model.graphql'), 'utf8'),
    defaultAuthType: {
      mode: 'API_KEY',
    },
  },
};

const updateApiRequest: UpdateApiRequest = {
  version: 1,
  serviceModification: {
    serviceName: 'AppSync',
    transformSchema: readFileSync(getSchemaPath('two-model-schema.graphql'), 'utf8'),
    defaultAuthType: {
      mode: 'AWS_IAM',
    },
    additionalAuthTypes: [
      {
        mode: 'API_KEY',
      },
    ],
    conflictResolution: {
      defaultResolutionStrategy: {
        type: 'OPTIMISTIC_CONCURRENCY',
      },
    },
  },
};
describe('AppSync ext migration', () => {
  let projRoot: string;

  beforeEach(async () => {
    const [shortId] = uuid().split('-');
    const projName = `appsyncmig${shortId}`;
    projRoot = await createNewProjectDir(projName);
    await cliVersionController.useCliVersion('6.4.0');
    await initJSProjectWithProfile(projRoot, { name: projName });
  });

  afterEach(async () => {
    await deleteProject(projRoot);
    deleteProjectDir(projRoot);
  });

  it.skip('migrates appsync when update conflict resolution strategy', async () => {
    const name = `syncenabled`;
    await initJSProjectWithProfile(projRoot, { name });
    await addApiWithBlankSchemaAndConflictDetection(projRoot);
    await updateApiSchema(projRoot, name, 'simple_model.graphql');

    let transformConfig = getTransformConfig(projRoot, name);
    expect(transformConfig).toBeDefined();
    expect(transformConfig.ResolverConfig).toBeDefined();
    expect(transformConfig.ResolverConfig.project).toBeDefined();
    expect(transformConfig.ResolverConfig.project.ConflictDetection).toEqual('VERSION');
    expect(transformConfig.ResolverConfig.project.ConflictHandler).toEqual('AUTOMERGE');
    await amplifyPush(projRoot);

    // upgrade amplify version
    await cliVersionController.resetCliVersion();
    await updateAPIWithResolutionStrategyWithModels(projRoot, { isMigrated: true });

    transformConfig = getTransformConfig(projRoot, name);
    const cliInputs = getCLIInputs(projRoot, 'api', name);
    expect(cliInputs).toBeDefined();
    expect(transformConfig).toBeDefined();
    expect(transformConfig.Version).toBeDefined();
    expect(transformConfig.ResolverConfig).toBeDefined();
    expect(cliInputs).toMatchSnapshot();
    await amplifyPush(projRoot);
    const meta = getProjectMeta(projRoot);
    const { output } = meta.api[name];
    const { GraphQLAPIIdOutput, GraphQLAPIEndpointOutput, GraphQLAPIKeyOutput } = output;
    const { graphqlApi } = await getAppSyncApi(GraphQLAPIIdOutput, meta.providers.awscloudformation.Region);
    expect(GraphQLAPIIdOutput).toBeDefined();
    expect(GraphQLAPIEndpointOutput).toBeDefined();
    expect(GraphQLAPIKeyOutput).toBeDefined();
    expect(graphqlApi).toBeDefined();
    expect(graphqlApi.apiId).toEqual(GraphQLAPIIdOutput);
  });

  it.skip('migrates AppSync API updates in headless mode', async () => {
    await initJSProjectWithProfile(projRoot, {});
    await addHeadlessApi(projRoot, addApiRequest);
    await amplifyPush(projRoot);
    await cliVersionController.resetCliVersion();
    await updateHeadlessApi(projRoot, updateApiRequest, true);
    await amplifyPushUpdate(projRoot, undefined, undefined, true);

    // verify
    const meta = getProjectMeta(projRoot);
    const { output } = meta.api.myApiName;
    const { GraphQLAPIIdOutput, GraphQLAPIEndpointOutput, GraphQLAPIKeyOutput } = output;
    const { graphqlApi } = await getAppSyncApi(GraphQLAPIIdOutput, meta.providers.awscloudformation.Region);

    expect(GraphQLAPIIdOutput).toBeDefined();
    expect(GraphQLAPIEndpointOutput).toBeDefined();
    expect(GraphQLAPIKeyOutput).toBeDefined();

    expect(graphqlApi).toBeDefined();
    expect(graphqlApi.apiId).toEqual(GraphQLAPIIdOutput);

    expect(getCLIInputs(projRoot, 'api', 'myApiName')).toMatchSnapshot();
    expect(output.authConfig).toMatchSnapshot();
    expect(getProjectSchema(projRoot, 'myApiName')).toMatchSnapshot();
  });
});
