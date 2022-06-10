/* eslint-disable spellcheck/spell-checker */
import {
  addApiWithoutSchema,
  createNewProjectDir,
  deleteProject,
  deleteProjectDir,
  initJSProjectWithProfile,
  getProjectMeta,
  amplifyPush,
  updateApiSchema,
} from 'amplify-e2e-core';
import * as path from 'path';
import { existsSync } from 'fs-extra';
import { addCodegen } from '../../codegen/add';

describe('amplify codegen add', () => {
  let projRoot: string;
  let projRootExternalApi: string;

  beforeEach(async () => {
    projRoot = await createNewProjectDir('add_codegen');
    projRootExternalApi = await createNewProjectDir('add_codegen_external_api');
  });

  afterEach(async () => {
    [projRoot, projRootExternalApi].forEach(async root => {
      if (existsSync(path.join(root, 'amplify', '#current-cloud-backend', 'amplify-meta.json'))) {
        await deleteProject(root);
      }
      deleteProjectDir(root);
    });
  });

  it('allows adding codegen to a project with api', async () => {
    const projName = 'simplemodel';
    await initJSProjectWithProfile(projRoot, {});
    await addApiWithoutSchema(projRoot);
    await updateApiSchema(projRoot, projName, 'simple_model.graphql');
    await addCodegen(projRoot, {});
  });

  it('allows adding codegen to a project with api', async () => {
    // Set up project 1 with API
    const projName = 'appWithAPI';
    await initJSProjectWithProfile(projRoot, {});
    await addApiWithoutSchema(projRoot);
    await updateApiSchema(projRoot, projName, 'simple_model.graphql');
    await amplifyPush(projRoot);

    // Get API Id
    const { GraphQLAPIIdOutput } = getProjectMeta(projRoot).api.simplemodel.output;
    expect(GraphQLAPIIdOutput).toBeDefined();

    // Setup Project 2
    const projName2 = 'projectWithoutAPI';
    await initJSProjectWithProfile(projName2, {});
    await addCodegen(projRootExternalApi, { apiId: GraphQLAPIIdOutput });
  });
});
