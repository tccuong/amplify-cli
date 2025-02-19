import { isWindowsPlatform, JSONUtilities } from 'amplify-cli-core';
import {
  addCDKCustomResource,
  addCFNCustomResource,
  addSimpleDDB,
  amplifyPushAuth,
  buildCustomResources,
  createNewProjectDir,
  deleteProject,
  deleteProjectDir,
  getProjectMeta,
  initJSProjectWithProfile,
  useLatestExtensibilityHelper,
} from '@aws-amplify/amplify-e2e-core';
import * as fs from 'fs-extra';
import * as path from 'path';
import { v4 as uuid } from 'uuid';

describe('adding custom resources test', () => {
  let projRoot: string;
  beforeEach(async () => {
    projRoot = await createNewProjectDir('custom-resources');
  });

  afterEach(async () => {
    await deleteProject(projRoot);
    deleteProjectDir(projRoot);
  });

  it('add/update CDK and CFN custom resources', async () => {
    const cdkResourceName = `custom${uuid().split('-')[0]}`;
    const cfnResourceName = `custom${uuid().split('-')[0]}`;

    await initJSProjectWithProfile(projRoot, {});
    await addCDKCustomResource(projRoot, { name: cdkResourceName });

    // this is where we will write our custom cdk stack logic to
    const destCustomResourceFilePath = path.join(projRoot, 'amplify', 'backend', 'custom', cdkResourceName, 'cdk-stack.ts');
    const cfnFilePath = path.join(
      projRoot,
      'amplify',
      'backend',
      'custom',
      cdkResourceName,
      'build',
      `${cdkResourceName}-cloudformation-template.json`,
    );

    // should throw error if compilation failure
    const srcCompileErrorTest = path.join(__dirname, '..', '..', 'custom-resources', 'custom-cdk-stack-compile-error.txt');
    fs.copyFileSync(srcCompileErrorTest, destCustomResourceFilePath);
    await expect(amplifyPushAuth(projRoot)).rejects.toThrowError();

    // should throw error on runtime failure
    const srcRuntimeErrorTest = path.join(__dirname, '..', '..', 'custom-resources', 'custom-cdk-stack-runtime-error.txt');
    fs.copyFileSync(srcRuntimeErrorTest, destCustomResourceFilePath);
    await expect(amplifyPushAuth(projRoot)).rejects.toThrowError();

    // add sample resource from other category that custom stack depends on
    const ddbName = 'ddb';
    await addSimpleDDB(projRoot, { name: ddbName });

    // happy path test (this custom stack compiles and runs successfully)
    const srcCustomResourceFilePath = path.join(__dirname, '..', '..', 'custom-resources', 'custom-cdk-stack.ts');
    fs.copyFileSync(srcCustomResourceFilePath, destCustomResourceFilePath);

    // TODO: this is required to jump over breaking change between 2.53 and 2.68 of CDK.
    // Remove after we ship new extensibility helper.
    useLatestExtensibilityHelper(projRoot, cdkResourceName);
    await buildCustomResources(projRoot);

    // check if latest @aws-amplify/cli-extensibility-helper works
    // skip on Windows, we don't start local registry there
    if (!isWindowsPlatform()) {
      useLatestExtensibilityHelper(projRoot, cdkResourceName);
      await buildCustomResources(projRoot);
    }

    await amplifyPushAuth(projRoot);

    // check if cfn file is generated in the build dir
    expect(fs.existsSync(cfnFilePath)).toEqual(true);

    const buildCFNFileJSON: any = JSONUtilities.readJson(cfnFilePath);

    // Basic sanity generated CFN file content check

    expect(buildCFNFileJSON?.Parameters).toMatchSnapshot();

    expect(buildCFNFileJSON?.Parameters).toMatchObject({
      env: { Type: 'String', Description: 'Current Amplify CLI env name' },
      storageddbName: { Type: 'String' },
    });

    expect(Object.keys(buildCFNFileJSON?.Outputs)).toEqual(['snsTopicArn']);

    const meta = getProjectMeta(projRoot);
    const { snsTopicArn: customResourceSNSArn } = Object.keys(meta.custom).map((key) => meta.custom[key])[0].output;

    expect(customResourceSNSArn).toBeDefined();

    // Add custom CFN and add dependency of custom CDK resource on the custom CFN
    await addCFNCustomResource(projRoot, { name: cfnResourceName, promptForCategorySelection: true });

    const customCFNFilePath = path.join(
      projRoot,
      'amplify',
      'backend',
      'custom',
      cfnResourceName,
      `${cfnResourceName}-cloudformation-template.json`,
    );

    const customCFNFileJSON: any = JSONUtilities.readJson(customCFNFilePath);

    expect(buildCFNFileJSON?.Parameters).toMatchSnapshot();

    // Make sure input params has params from the resource dependency

    expect(customCFNFileJSON?.Parameters).toMatchObject({
      env: { Type: 'String' },
      [`custom${cdkResourceName}snsTopicArn`]: {
        Type: 'String',
        Description: `Input parameter describing snsTopicArn attribute for custom/${cdkResourceName} resource`,
      },
    });
  });
});
