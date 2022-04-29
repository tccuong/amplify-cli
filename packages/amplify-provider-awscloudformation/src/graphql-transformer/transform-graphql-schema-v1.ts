import fs from 'fs-extra';
import path from 'path';
import chalk from 'chalk';
import inquirer from 'inquirer';
import { destructiveUpdatesFlag, ProviderName } from '../constants';
import { AmplifyCLIFeatureFlagAdapter } from '../utils/amplify-cli-feature-flag-adapter';
import {
  getGraphQLTransformerAuthSubscriptionsDocLink,
  getGraphQLTransformerOpenSearchProductionDocLink,
  JSONUtilities,
} from 'amplify-cli-core';
import { ResourceConstants } from 'graphql-transformer-common';
import { isAuthModeUpdated } from '../utils/auth-mode-compare';
import {
  collectDirectivesByTypeNames,
  readTransformerConfiguration,
  writeTransformerConfiguration,
  TRANSFORM_CONFIG_FILE_NAME,
  TRANSFORM_BASE_VERSION,
  CLOUDFORMATION_FILE_NAME,
  readProjectConfiguration,
  buildAPIProject,
  getSanityCheckRules,
} from 'graphql-transformer-core';
import { hashDirectory } from '../upload-appsync-files';
import { exitOnNextTick } from 'amplify-cli-core';
import { getTransformerVersion } from '../graphql-transformer-factory/transformer-version';
import { getTransformerFactory } from '../graphql-transformer-factory/transformer-factory';
import { searchablePushChecks, warnOnAuth } from './api-utils';
import {
  getBucketName,
  getPreviousDeploymentRootKey,
  getProjectBucket,
  PARAMETERS_FILENAME,
  ROOT_APPSYNC_S3_KEY,
  SCHEMA_DIR_NAME,
  SCHEMA_FILENAME
} from './provider-utils';
import { migrateProject } from './migrate-project';

const apiCategory = 'api';

/**
 * @TODO Include a map of versions to keep track
 */
async function transformerVersionCheck(context, resourceDir, cloudBackendDirectory, updatedResources, usedDirectives) {
  const transformerVersion = await getTransformerVersion(context);
  const authDocLink = getGraphQLTransformerAuthSubscriptionsDocLink(transformerVersion);
  const searchable = getGraphQLTransformerOpenSearchProductionDocLink(transformerVersion);
  const versionChangeMessage = `The default behavior for @auth has changed in the latest version of Amplify\nRead here for details: ${authDocLink}`;
  const warningESMessage = `The behavior for @searchable has changed after version 4.14.1.\nRead here for details: ${searchable}`;
  const checkVersionExist = config => config && config.Version;
  const checkESWarningExists = config => config && config.ElasticsearchWarning;
  let writeToConfig = false;

  // this is where we check if there is a prev version of the transformer being used
  // by using the transformer.conf.json file
  const cloudTransformerConfig = await readTransformerConfiguration(cloudBackendDirectory);
  const cloudVersionExist = checkVersionExist(cloudTransformerConfig);
  const cloudWarningExist = checkESWarningExists(cloudTransformerConfig);

  // check local resource if the question has been answered before
  const localTransformerConfig = await readTransformerConfiguration(resourceDir);
  const localVersionExist = checkVersionExist(localTransformerConfig);
  const localWarningExist = checkESWarningExists(localTransformerConfig);

  // if we already asked the confirmation question before at a previous push
  // or during current operations we should not ask again.
  const showPrompt = !(cloudVersionExist || localVersionExist);
  const showWarning = !(cloudWarningExist || localWarningExist);

  const resources = updatedResources.filter(resource => resource.service === 'AppSync');
  if (resources.length > 0) {
    if (showPrompt && usedDirectives.includes('auth')) {
      await warningMessage(context, versionChangeMessage);
    }
    if (showWarning && usedDirectives.includes('searchable')) {
      await warningMessage(context, warningESMessage);
    }
  }

  // searchable warning flag

  // Only touch the file if it misses the Version property
  // Always set to the base version, to not to break existing projects when coming
  // from an older version of the CLI.
  if (!localTransformerConfig.Version) {
    localTransformerConfig.Version = TRANSFORM_BASE_VERSION;
    writeToConfig = true;
  }
  // Add the warning as noted in the elasticsearch
  if (!localTransformerConfig.warningESMessage) {
    localTransformerConfig.ElasticsearchWarning = true;
    writeToConfig = true;
  }
  if (writeToConfig) {
    await writeTransformerConfiguration(resourceDir, localTransformerConfig);
  }
}

async function warningMessage(context, warningMessage) {
  if (context.exeInfo && context.exeInfo.inputParams && context.exeInfo.inputParams.yes) {
    context.print.warning(`\n${warningMessage}\n`);
  } else {
    context.print.warning(`\n${warningMessage}\n`);
    const response = await inquirer.prompt({
      name: 'transformerConfig',
      type: 'confirm',
      message: `Do you wish to continue?`,
      default: false,
    });
    if (!response.transformerConfig) {
      await context.usageData.emitSuccess();
      exitOnNextTick(0);
    }
  }
}

function apiProjectIsFromOldVersion(pathToProject, resourcesToBeCreated) {
  const resources = resourcesToBeCreated.filter(resource => resource.service === 'AppSync');
  if (!pathToProject || resources.length > 0) {
    return false;
  }
  return fs.existsSync(`${pathToProject}/${CLOUDFORMATION_FILE_NAME}`) && !fs.existsSync(`${pathToProject}/${TRANSFORM_CONFIG_FILE_NAME}`);
}

export async function transformGraphQLSchemaV1(context, options) {
  const backEndDir = context.amplify.pathManager.getBackendDirPath();
  const flags = context.parameters.options;
  if (flags['no-gql-override']) {
    return;
  }

  let { resourceDir, parameters } = options;
  const { forceCompile } = options;

  // Compilation during the push step
  const { resourcesToBeCreated, resourcesToBeUpdated, allResources } = await context.amplify.getResourceStatus(apiCategory);
  let resources = resourcesToBeCreated.concat(resourcesToBeUpdated);

  // When build folder is missing include the API
  // to be compiled without the backend/api/<api-name>/build
  // cloud formation push will fail even if there is no changes in the GraphQL API
  // https://github.com/aws-amplify/amplify-console/issues/10
  const resourceNeedCompile = allResources
    .filter(r => !resources.includes(r))
    .filter(r => {
      const buildDir = path.normalize(path.join(backEndDir, apiCategory, r.resourceName, 'build'));
      return !fs.existsSync(buildDir);
    });
  resources = resources.concat(resourceNeedCompile);

  if (forceCompile) {
    resources = resources.concat(allResources);
  }
  resources = resources.filter(resource => resource.service === 'AppSync');
  // check if api is in update status or create status
  const isNewAppSyncAPI: boolean = resourcesToBeCreated.filter(resource => resource.service === 'AppSync').length === 0 ? false : true;

  if (!resourceDir) {
    // There can only be one appsync resource
    if (resources.length > 0) {
      const resource = resources[0];
      if (resource.providerPlugin !== ProviderName) {
        return;
      }
      const { category, resourceName } = resource;
      resourceDir = path.normalize(path.join(backEndDir, category, resourceName));
    } else {
      // No appsync resource to update/add
      return;
    }
  }

  let previouslyDeployedBackendDir = options.cloudBackendDirectory;
  if (!previouslyDeployedBackendDir) {
    if (resources.length > 0) {
      const resource = resources[0];
      if (resource.providerPlugin !== ProviderName) {
        return;
      }
      const { category, resourceName } = resource;
      const cloudBackendRootDir = context.amplify.pathManager.getCurrentCloudBackendDirPath();
      /* eslint-disable */
      previouslyDeployedBackendDir = path.normalize(path.join(cloudBackendRootDir, category, resourceName));
      /* eslint-enable */
    }
  }

  const parametersFilePath = path.join(resourceDir, PARAMETERS_FILENAME);

  if (!parameters && fs.existsSync(parametersFilePath)) {
    try {
      parameters = JSONUtilities.readJson(parametersFilePath);
    } catch (e) {
      parameters = {};
    }
  }

  const isCLIMigration = options.migrate;
  const isOldApiVersion = apiProjectIsFromOldVersion(previouslyDeployedBackendDir, resourcesToBeCreated);
  const migrateOptions = {
    ...options,
    resourceDir,
    migrate: false,
    isCLIMigration,
    cloudBackendDirectory: previouslyDeployedBackendDir,
  };
  if (isCLIMigration && isOldApiVersion) {
    return await migrateProject(context, migrateOptions);
  } else if (isOldApiVersion) {
    let IsOldApiProject;

    if (context.exeInfo && context.exeInfo.inputParams && context.exeInfo.inputParams.yes) {
      IsOldApiProject = context.exeInfo.inputParams.yes;
    } else {
      const migrateMessage =
        `${chalk.bold('The CLI is going to take the following actions during the migration step:')}\n` +
        '\n1. If you have a GraphQL API, we will update the corresponding Cloudformation stack to support larger annotated schemas and custom resolvers.\n' +
        'In this process, we will be making Cloudformation API calls to update your GraphQL API Cloudformation stack. This operation will result in deletion of your AppSync resolvers and then the creation of new ones and for a brief while your AppSync API will be unavailable until the migration finishes\n' +
        '\n2. We will be updating your local Cloudformation files present inside the ‘amplify/‘ directory of your app project, for the GraphQL API service\n' +
        '\n3. If for any reason the migration fails, the CLI will rollback your cloud and local changes and you can take a look at https://aws-amplify.github.io/docs/cli/migrate?sdk=js for manually migrating your project so that it’s compatible with the latest version of the CLI\n' +
        '\n4. ALL THE ABOVE MENTIONED OPERATIONS WILL NOT DELETE ANY DATA FROM ANY OF YOUR DATA STORES\n' +
        `\n${chalk.bold('Before the migration, please be aware of the following things:')}\n` +
        '\n1. Make sure to have an internet connection through the migration process\n' +
        '\n2. Make sure to not exit/terminate the migration process (by interrupting it explicitly in the middle of migration), as this will lead to inconsistency within your project\n' +
        '\n3. Make sure to take a backup of your entire project (including the amplify related config files)\n' +
        '\nDo you want to continue?\n';
      ({ IsOldApiProject } = await inquirer.prompt({
        name: 'IsOldApiProject',
        type: 'confirm',
        message: migrateMessage,
        default: true,
      }));
    }
    if (!IsOldApiProject) {
      throw new Error('Migration cancelled. Please downgrade to a older version of the Amplify CLI or migrate your API project.');
    }
    return await migrateProject(context, migrateOptions);
  }

  let { authConfig } = options;

  //
  // If we don't have an authConfig from the caller, use it from the
  // already read resources[0], which is an AppSync API.
  //

  if (!authConfig) {
    if (resources[0].output.securityType) {
      // Convert to multi-auth format if needed.
      authConfig = {
        defaultAuthentication: {
          authenticationType: resources[0].output.securityType,
        },
        additionalAuthenticationProviders: [],
      };
    } else {
      ({ authConfig } = resources[0].output);
    }
  }

  // for the predictions directive get storage config
  const s3ResourceName = await invokeS3GetResourceName(context);
  const storageConfig = {
    bucketName: s3ResourceName ? await getBucketName(context, s3ResourceName) : undefined,
  };

  const buildDir = path.normalize(path.join(resourceDir, 'build'));
  const schemaFilePath = path.normalize(path.join(resourceDir, SCHEMA_FILENAME));
  const schemaDirPath = path.normalize(path.join(resourceDir, SCHEMA_DIR_NAME));
  let deploymentRootKey = await getPreviousDeploymentRootKey(previouslyDeployedBackendDir);
  if (!deploymentRootKey) {
    const deploymentSubKey = await hashDirectory(resourceDir);
    deploymentRootKey = `${ROOT_APPSYNC_S3_KEY}/${deploymentSubKey}`;
  }
  const projectBucket = options.dryRun ? 'fake-bucket' : getProjectBucket(context);
  const buildParameters = {
    ...parameters,
    S3DeploymentBucket: projectBucket,
    S3DeploymentRootKey: deploymentRootKey,
  };

  // If it is a dry run, don't create the build folder as it could make a follow-up command
  // to not to trigger a build, hence a corrupt deployment.
  if (!options.dryRun) {
    fs.ensureDirSync(buildDir);
  }

  // Transformer compiler code
  // const schemaText = await readProjectSchema(resourceDir);
  const project = await readProjectConfiguration(resourceDir);

  // Check for common errors
  const directiveMap = collectDirectivesByTypeNames(project.schema);
  await warnOnAuth(context, directiveMap.types);
  await searchablePushChecks(context, directiveMap.types, parameters[ResourceConstants.PARAMETERS.AppSyncApiName]);

  await transformerVersionCheck(context, resourceDir, previouslyDeployedBackendDir, resourcesToBeUpdated, directiveMap.directives);

  const transformerListFactory = await getTransformerFactory(context, resourceDir, authConfig);

  const searchableTransformerFlag = directiveMap.directives.includes('searchable');

  const ff = new AmplifyCLIFeatureFlagAdapter();
  const allowDestructiveUpdates = context?.input?.options?.[destructiveUpdatesFlag] || context?.input?.options?.force;
  const sanityCheckRulesList = getSanityCheckRules(isNewAppSyncAPI, ff, allowDestructiveUpdates);

  const buildConfig = {
    ...options,
    buildParameters,
    projectDirectory: resourceDir,
    transformersFactory: transformerListFactory,
    transformersFactoryArgs: [searchableTransformerFlag, storageConfig],
    rootStackFileName: 'cloudformation-template.json',
    currentCloudBackendDirectory: previouslyDeployedBackendDir,
    minify: options.minify,
    featureFlags: ff,
    sanityCheckRules: sanityCheckRulesList,
  };
  const transformerOutput = await buildAPIProject(buildConfig);

  context.print.success(`GraphQL schema compiled successfully.\n\nEdit your schema at ${schemaFilePath} or \
place .graphql files in a directory at ${schemaDirPath}`);

  if (isAuthModeUpdated(options)) {
    parameters.AuthModeLastUpdated = new Date();
  }
  if (!options.dryRun) {
    JSONUtilities.writeJson(parametersFilePath, parameters);
  }

  return transformerOutput;
}

// TODO: Remove until further discussion
// function getTransformerOptions(project, transformerName) {
//   if (
//     project &&
//     project.config &&
//     project.config.TransformerOptions &&
//     project.config.TransformerOptions[transformerName]
//   ) {
//     return project.config.TransformerOptions[transformerName];
//   }
//   return undefined;
// }

/**
 * S3API
 * TBD: Remove this once all invoke functions are moved to a library shared across amplify
 * */
async function invokeS3GetResourceName(context) {
  const s3ResourceName = await context.amplify.invokePluginMethod(context, 'storage', undefined, 's3GetResourceName', [context]);
  return s3ResourceName;
}
