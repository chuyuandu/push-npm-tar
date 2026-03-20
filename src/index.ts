#!/usr/bin/env node

import { readdir } from 'node:fs/promises';
import { join, basename } from 'node:path';
import https from 'node:https';
import http from 'node:http';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
const execAsync = promisify(exec);
import chalk from 'chalk';
import ora from 'ora';
import pLimit from 'p-limit';
import {
  checkVersion,
  getCurrentVersion,
  getRegistry,
  helpContent,
  type IArgType,
} from './util';
import { cpus } from 'node:os';

export function doPush(args: IArgType) {
  const tgzFolder = args['--dir']
    ? join(args.cwd, args['--dir'])
    : join(args.cwd, 'storage');
  getTgzFiles(tgzFolder)
    .then(files => {
      const pkgs = parsePkgFiles(files);
      const curRegistry = getRegistry(args.cwd);
      console.log(
        chalk.green(`找到 ${pkgs.length} 个包，准备上传到 ${curRegistry}：`),
      );
      const installing = ora().start('正在上传包依赖...\n');
      const limit = pLimit(args['--limit'] || cpus().length * 2);

      const uploadList = pkgs.map(pkg => {
        return limit(() =>
          pushFile(pkg, curRegistry, args)
            .then(() => {})
            .catch(error => {
              console.error(
                `push failed: ${chalk.bgRed(
                  `${pkg.name}@${pkg.version}`,
                )} , ${chalk.red(
                  typeof error === 'string' ? error : error.message,
                )}`,
              );
            }),
        );
      });
      return Promise.all(uploadList).finally(() => {
        installing.stop();
        // console.log(chalk.green('所有包上传完成！'));
      });
    })
    .catch(err => {
      console.error(chalk.red(`读取目录失败: ${err.message}`));
      process.exit(1);
    });
}

export function handleArgs(args: IArgType) {
  const currentVersion = getCurrentVersion();

  if (args['--version']) {
    console.log(currentVersion);
    checkVersion(currentVersion);
    return currentVersion;
  } else if (args['--help']) {
    console.log(helpContent);
    checkVersion(currentVersion);
    return helpContent;
  } else {
    return checkVersion(currentVersion, 2000).then(() => {
      return doPush(args);
    });
  }
}

async function pushFile(pkg: PkgInfo, curRegistry: string, args: IArgType) {
  const { name, version } = pkg;
  const versions = await getPackageVersions(name, curRegistry, args);
  if (versions.includes(version)) {
    console.warn(
      chalk.yellow(`警告：包 ${name}@${version} 已存在，跳过上传。`),
    );
    return;
  }
  return uploadPackage(pkg, curRegistry, args);
}

async function uploadPackage(
  pkg: PkgInfo,
  curRegistry: string,
  args: IArgType,
): Promise<void> {
  // 使用 exec（Promise）调用 npm publish，exec 使用 shell 在 PATH 中查找可执行文件
  const cmd = `npm publish ${pkg.path} --registry ${
    curRegistry
  } --provenance=false`;
  try {
    await execAsync(cmd, {
      cwd: args.cwd,
      maxBuffer: 10 * 1024 * 1024,
    });
  } catch (err: any) {
    // 如果子进程返回非 0，err.code / err.stderr 可用于排查
    throw new Error(err?.message || 'npm publish failed');
  }
}

// 获取指定目录下的 .tgz 文件列表（递归）
async function getTgzFiles(dir: string): Promise<string[]> {
  const result: string[] = [];
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isFile() && entry.name.endsWith('.tgz')) {
      result.push(fullPath);
    } else if (entry.isDirectory()) {
      const sub = await getTgzFiles(fullPath);
      result.push(...sub);
    }
  }
  return result;
}

// 从文件名数组解析出 pkg 列表
export type PkgInfo = {
  path: string; // 文件路径
  name: string;
  version: string;
};

/**
 * 解析文件名数组为 pkg 列表。
 * 每个输入项为文件路径或文件名，形式为 `<pkgName>+<version>.tgz`，
 * 其中包名中的 `~` 替换为 `/`。
 */
export function parsePkgFiles(files: string[]): PkgInfo[] {
  const invalidFiles: string[] = [];
  const result = files.map(f => {
    const base = basename(f);
    const withoutExt = base.endsWith('.tgz') ? base.slice(0, -4) : base;
    const idx = withoutExt.indexOf('+');
    if (idx === -1) {
      invalidFiles.push(f);
      // process.exit(1);
      return null;
    } else {
      const rawName = withoutExt.slice(0, idx).replace(/~/g, '/');
      const version = withoutExt.slice(idx + 1);
      return { path: f, name: rawName, version };
    }
  });
  if (invalidFiles.length > 0) {
    console.warn(chalk.yellow(`警告：以下文件名不符合格式要求，已被忽略：`));
    invalidFiles.forEach(f => console.warn(chalk.yellow(`  - ${f}`)));
  }
  return result.filter((pkg): pkg is PkgInfo => pkg !== null);
}
async function getPackageVersions(
  name: string,
  curRegistry: string,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _args: IArgType,
): Promise<string[]> {
  return new Promise((resolve, reject) => {
    const encoded = encodeURIComponent(name);
    const u = new URL(curRegistry);
    const isHttps = u.protocol === 'https:';
    const client = isHttps ? https : http;
    const options = {
      hostname: u.hostname,
      port: u.port ? Number(u.port) : isHttps ? 443 : 80,
      path: `/${encoded}`,
      method: 'GET',
      headers: {
        Accept: 'application/vnd.npm.install-v1+json, application/json',
      },
    } as const;

    const req = client.request(options, res => {
      let raw = '';
      res.setEncoding('utf8');
      res.on('data', chunk => (raw += chunk));
      res.on('end', () => {
        if (res.statusCode === 404) {
          resolve([]);
          return;
        }
        try {
          const json = JSON.parse(raw);
          if (json && json.versions && typeof json.versions === 'object') {
            resolve(Object.keys(json.versions));
          } else {
            resolve([]);
          }
        } catch (err) {
          reject(err);
        }
      });
    });
    req.on('error', reject);
    req.end();
  });
}
