import path from 'path';
import fs from 'fs-extra';
import { ExecOptions } from 'child_process';
import execa from 'execa';
import * as which from 'which';
import { parse } from 'ini';

// Gets the pipenv dir where this function's dependencies are located
export async function getPipenvDir(srcRoot: string): Promise<string> {
  const pipEnvDir = await execAsStringPromise('pipenv --venv', { cwd: srcRoot });
  const pyBinary = getPythonBinaryName();

  if (!pyBinary) {
    throw new Error(`Could not find 'python3' or 'python' executable in the PATH.`);
  }

  let pipEnvPath = path.join(pipEnvDir, 'lib', `python${getPipfilePyVersion(path.join(srcRoot, 'Pipfile'))}`, 'site-packages');
  if (process.platform.startsWith('win')) {
    pipEnvPath = path.join(pipEnvDir, 'Lib', 'site-packages');
  }
  if (fs.existsSync(pipEnvPath)) {
    return pipEnvPath;
  }
  throw new Error(`Could not find a pipenv site-packages directory at ${pipEnvPath}`);
}

export function majMinPyVersion(pyVersion: string): string {
  if (!/^Python \d+\.\d+\.\d+$/.test(pyVersion)) {
    throw new Error(`Cannot interpret Python version "${pyVersion}"`);
  }
  const versionNum = pyVersion.split(' ')[1];
  return versionNum.split('.').slice(0, 2).join('.');
}

// wrapper for executing a shell command and returning the result as a string promise
// opts are passed directly to the exec command
export async function execAsStringPromise(command: string, opts?: ExecOptions): Promise<string> {
  try {
    let stdout = (await execa.command(command, opts)).stdout;

    if (stdout) {
      stdout = stdout.trim();
    }

    return stdout;
  } catch (err) {
    throw new Error(`Received error [${err}] running command [${command}]`);
  }
}

export const getPythonBinaryName = (): string | undefined => {
  const executables = ['python3', 'python'];
  let executablePath: string | null;

  for (const executable of executables) {
    executablePath = which.sync(executable, {
      nothrow: true,
    });

    if (executablePath !== null) {
      return executable;
    }
  }
  return undefined;
};

const getPipfilePyVersion = (pipfilePath: string) => {
  const pipfile = parse(fs.readFileSync(pipfilePath, 'utf-8'));
  const version = pipfile?.requires?.python_version;
  if (!version) {
    throw new Error(`Did not find Python version specified in ${pipfilePath}`);
  }
  return version as string;
};
