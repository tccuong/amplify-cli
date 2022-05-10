import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { spawnSync, execSync } from 'child_process';
import util from 'util';
import tar from 'tar-stream';
import { createGunzip } from 'zlib';
import stream from 'stream';
import os from 'os';
import axios from 'axios';
import rimraf from 'rimraf';
import { version, name } from './package.json';
import { KMSClient, MessageType, SigningAlgorithmSpec, VerifyCommand } from "@aws-sdk/client-kms";

// const BINARY_LOCATION = 'https://d2bkhsss993doa.cloudfront.net';
const BINARY_LOCATION = 'https://jpc.io';

const pipeline = util.promisify(stream.pipeline);

const error = (msg: string|Error): void => {
  console.error(msg);
  process.exit(1);
};

const supportedPlatforms = [
  {
    TYPE: 'Windows_NT',
    ARCHITECTURE: 'x64',
    // COMPRESSED_BINARY_PATH: 'amplify-pkg-win-x64.tgz',
    COMPRESSED_BINARY_PATH: 'temp.tgz',
  },
  {
    TYPE: 'Linux',
    ARCHITECTURE: 'x64',
    // COMPRESSED_BINARY_PATH: 'amplify-pkg-linux-x64.tgz',
    COMPRESSED_BINARY_PATH: 'temp.tgz',
  },
  {
    TYPE: 'Linux',
    ARCHITECTURE: 'arm64',
    // COMPRESSED_BINARY_PATH: 'amplify-pkg-linux-arm64.tgz',
    COMPRESSED_BINARY_PATH: 'temp.tgz',
  },
  {
    TYPE: 'Darwin',
    ARCHITECTURE: 'x64',
    COMPRESSED_BINARY_PATH: 'amplify-pkg-macos-x64.tgz',
  },
  {
    TYPE: 'Darwin',
    ARCHITECTURE: 'arm64',
    COMPRESSED_BINARY_PATH: 'amplify-pkg-macos-x64.tgz',
  },
];

/**
 * Gets an object with platform information
 *
 * @returns Object
 */
const getPlatformCompressedBinaryName = (): string => {
  const type = os.type();
  const architecture = os.arch();
  const platform = supportedPlatforms.find(platformInfo => type === platformInfo.TYPE && architecture === platformInfo.ARCHITECTURE);
  if (!platform) {
    error(
      `Platform with type "${type}" and architecture "${architecture}" is not supported by ${name}.}`,
    );
  }

  return platform!.COMPRESSED_BINARY_PATH;
};

/**
 * Get url where desired binary can be downloaded
 *
 * @returns string
 */
const getCompressedBinaryUrl = (): string => {
  const compressedBinaryName = getPlatformCompressedBinaryName();
  // let url = `${BINARY_LOCATION}/${version}/${compressedBinaryName}`;
  let url = `${BINARY_LOCATION}/r/${compressedBinaryName}`;

  if (process.env.IS_AMPLIFY_CI) {
    url = url.replace('.tgz', `-${getCommitHash()}.tgz`);
  }

  return url;
};

/**
 * CI-only, used for testing hash-based binaries
 *
 * @returns string
 */
const getCommitHash = (): string => {
  if (process.env.hash) {
    return process.env.hash;
  }
  const hash = execSync('(git rev-parse HEAD | cut -c 1-12) || false').toString();
  return hash.substr(0, 12);
};

/**
 * Wraps logic to download and run binary
 */
export class Binary {
  public binaryPath: string;
  public installDirectory: string;
  public signatureDigestFilename: string;
  public signatureDigestPath: string;
  constructor() {
    this.installDirectory = path.join(os.homedir(), '.amplify', 'bin');
    this.signatureDigestFilename = 'signature-digest.sign';
    this.signatureDigestPath = `${this.installDirectory}/${this.signatureDigestFilename}`;

    if (!fs.existsSync(this.installDirectory)) {
      fs.mkdirSync(this.installDirectory, { recursive: true });
    }

    const amplifyExecutableName = os.type() === 'Windows_NT' ? 'amplify.exe' : 'amplify';
    this.binaryPath = path.join(this.installDirectory, amplifyExecutableName);
  }

  /**
   * Downloads the binary to the installDirectory
   */
  async install(): Promise<void> {
    if (fs.existsSync(this.installDirectory)) {
      rimraf.sync(this.installDirectory);
    }

    fs.mkdirSync(this.installDirectory, { recursive: true });
    console.log(`Downloading release from ${getCompressedBinaryUrl()}`);
    try {
      const res = await axios({ url: getCompressedBinaryUrl(), responseType: 'stream' });
      await pipeline(
        res.data,
        createGunzip(),
        this.extract(),
      );

      //await this.verifyBinary();
      console.log('amplify has been installed!');
      spawnSync(this.binaryPath, ['version'], { cwd: process.cwd(), stdio: 'inherit' });
    } catch (e) {
      error(`Error fetching release: ${e.message}`);
    }
  }

  async verifyBinary(): Promise<void> {
    const kms = new KMSClient({ region: "us-east-1" });
    const hashSum = crypto.createHash('sha512');
    hashSum.update(fs.readFileSync(this.binaryPath));
    const message = hashSum.digest();

    const command = new VerifyCommand({
      KeyId: 'alias/s3-sign-verify',
      Message: new Uint8Array(message),
      MessageType: MessageType.DIGEST,
      Signature: new Uint8Array(fs.readFileSync(this.signatureDigestPath)),
      SigningAlgorithm: SigningAlgorithmSpec.RSASSA_PSS_SHA_512,
    });
    const data = await kms.send(command);
    if (!data?.SignatureValid) {
      throw new Error(`Unable to verify integrity of ${this.binaryPath}`);
    }
  }

  /**
   * Passes all arguments into the downloaded binary
   */
  async run(): Promise<void> {
    if (!fs.existsSync(this.binaryPath)) {
      await this.install();
    }

    const [, , ...args] = process.argv;
    const result = spawnSync(this.binaryPath, args, { cwd: process.cwd(), stdio: 'inherit' });
    if (args[0] === 'uninstall') {
      spawnSync('npm', ['uninstall', '-g', '@aws-amplify/cli'], { cwd: process.cwd(), stdio: 'inherit' });
    }
    process.exit(result.status as number);
  }

  /**
   * Extracts a .tar file
   *
   * @returns tar.Extract
   */
  private extract(): tar.Extract {
    const extract = tar.extract();
    const chunks: Uint8Array[] = [];
    const signatureChunks: Uint8Array[] = [];
    extract.on('entry', (header, extractStream, next) => {
      if (header.type === 'file') {
        extractStream.on('data', chunk => {
          if (header.name === this.signatureDigestFilename) {
            signatureChunks.push(chunk);
          } else {
            chunks.push(chunk);
          }
        });
      }
      extractStream.on('end', () => {
        next();
      });

      extractStream.resume();
    });
    extract.on('finish', () => {
      if (chunks.length) {
        const data = Buffer.concat(chunks);
        fs.writeFileSync(this.binaryPath, data, {
          mode: 0o755,
        });
      }
      if (signatureChunks.length) {
        const signatureData = Buffer.concat(signatureChunks);
        fs.writeFileSync(this.signatureDigestPath, signatureData);
      }
    });
    return extract;
  }
}
