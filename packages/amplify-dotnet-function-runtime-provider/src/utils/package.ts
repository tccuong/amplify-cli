import fs from 'fs-extra';
import path from 'path';
import * as execa from 'execa';
import { PackageRequest, PackageResult } from '@aws-amplify/amplify-function-plugin-interface';
import { dotnetcore31, executableName } from '../constants';

export const packageAssemblies = async (request: PackageRequest, context: any): Promise<PackageResult> => {
  const distPath = path.join(request.srcRoot, 'dist');
  const sourcePath = path.join(request.srcRoot, 'src');

  if (fs.existsSync(request.dstFilename)) {
    fs.removeSync(request.dstFilename);
  }

  const packageHash = (await context.amplify.hashDir(distPath, [])) as string;
  const framework = request.runtime === dotnetcore31 ? 'netcoreapp3.1' : 'net6.0';
  const result = execa.sync(
    executableName,
    ['lambda', 'package', '--framework', framework, '--configuration', 'Release', '--output-package', request.dstFilename],
    {
      cwd: sourcePath,
    },
  );

  if (result.exitCode !== 0) {
    throw new Error(`Packaging failed. Exit code was ${result.exitCode}`);
  }

  return {
    packageHash: packageHash,
  };
};
