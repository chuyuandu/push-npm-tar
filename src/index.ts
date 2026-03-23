#!/usr/bin/env node

import { readdir, mkdir, appendFile, writeFile } from 'node:fs/promises';
import { join, basename, isAbsolute, resolve } from 'node:path';
import https from 'node:https';
import http from 'node:http';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
const execAsync = promisify(exec);
import * as semver from 'semver';
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
    ? isAbsolute(args['--dir'])
      ? args['--dir']
      : resolve(args.cwd, args['--dir'])
    : join(args.cwd, 'storage');
  getTgzFiles(tgzFolder)
    .then(async files => {
      const pkgs = parsePkgFiles(files);
      const curRegistry = getRegistry(args.cwd);
      console.log(
        chalk.green(`找到 ${pkgs.length} 个包，准备上传到 ${curRegistry}：`),
      );

      // prepare logs directory
      const logsDir = join(args.cwd, 'logs');
      try {
        await mkdir(logsDir, { recursive: true });
      } catch (e) {
        console.error(e);
        process.exit(1);
      }
      const errorLog = join(logsDir, 'errors.log');
      // clear previous log
      try {
        await writeFile(errorLog, '', { encoding: 'utf8' });
      } catch (e) {
        console.error(e);
        process.exit(1);
      }

      // counters
      const total = pkgs.length;
      let success = 0;
      let skipped = 0;
      let failed = 0;

      const spinner = ora().start(
        renderSpinnerText(total, success, skipped, failed),
      );
      const limit = pLimit(args['--limit'] || cpus().length * 2);

      const uploadList = pkgs.map(pkg => {
        return limit(async () => {
          try {
            const status = await pushFile(pkg, curRegistry, args);
            if (status === 'skipped') {
              skipped++;
              await appendLog(errorLog, {
                type: 'skipped',
                pkg,
                time: new Date().toISOString(),
              });
            } else {
              success++;
              await appendLog(errorLog, {
                type: 'success',
                pkg,
                time: new Date().toISOString(),
              });
            }
          } catch (err: any) {
            failed++;
            await appendLog(errorLog, {
              type: 'failed',
              pkg,
              time: new Date().toISOString(),
              error: String(err?.message || err),
            });
          } finally {
            spinner.text = renderSpinnerText(total, success, skipped, failed);
          }
        });
      });

      return Promise.all(uploadList)
        .finally(() => {
          // 保留 spinner 最终文本，不额外输出新行
          const finalText = `${renderSpinnerText(total, success, skipped, failed)}  ${chalk.gray(
            `\n详细记录见 ${join('logs', 'errors.log')}`,
          )}`;
          try {
            // stopAndPersist 会保留一行最终文本显示
            spinner.stopAndPersist({ text: finalText });
            // eslint-disable-next-line @typescript-eslint/no-unused-vars
          } catch (e) {
            // 兼容旧版 ora，回退到 succeed
            spinner.succeed(finalText);
          }
        })
        .catch(() => {
          try {
            spinner.stopAndPersist({
              text: renderSpinnerText(total, success, skipped, failed),
            });
            // eslint-disable-next-line @typescript-eslint/no-unused-vars
          } catch (e) {
            spinner.stop();
          }
        });
    })
    .catch(err => {
      console.error(chalk.red(`读取目录失败: ${err.message}`));
      process.exit(1);
    });
}

function renderSpinnerText(
  total: number,
  success: number,
  skipped: number,
  failed: number,
) {
  return `总: ${total}  成功: ${chalk.green(String(success))}  跳过: ${chalk.yellow(
    String(skipped),
  )}  失败: ${chalk.red(String(failed))}`;
}

async function appendLog(logPath: string, obj: unknown) {
  const line = JSON.stringify(obj) + '\n';
  try {
    await appendFile(logPath, line, { encoding: 'utf8' });
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
  } catch (e) {
    // ignore logging errors
  }
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
    // 包已存在，跳过上传（由调用方统计和记录日志）
    return 'skipped';
  }
  await uploadPackage(pkg, curRegistry, args);
  // 上传成功后调整 latest 标签，只指向最大的正式版本（非 prerelease）
  try {
    const updated = await getPackageVersions(name, curRegistry, args);
    const stableVersions = updated.filter(v => isStableVersion(v));
    if (stableVersions.length === 0) {
      // 没有正式版本，移除 latest（串行执行以避免并发冲突）
      await enqueueSetLatest(name, null, curRegistry, args.cwd);
      return;
    }
    const maxStable = stableVersions.reduce((a, b) =>
      semver.compare(a, b) >= 0 ? a : b,
    );
    // 串行执行 dist-tag 更新，避免多个并发 upload 相互覆盖
    await enqueueSetLatest(name, maxStable, curRegistry, args.cwd);
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
  } catch (err) {
    // 调整标签失败不影响整体上传流程，记录为成功（但不抛出）
  }
  return 'success';
}

// 判断是否为正式版本（不包含 pre-release 部分）
function isStableVersion(v: string): boolean {
  return !!semver.valid(v) && semver.prerelease(v) == null;
}

// per-package serial queue to avoid concurrent dist-tag operations
const tagQueue = new Map<string, Promise<void>>();

async function setLatestTag(
  name: string,
  version: string | null,
  registry: string,
  cwd: string,
) {
  const cleanRegistry = String(registry || '')
    .replace(/^"|"$/g, '')
    .replace(/\/+$/g, '');
  const reg = /^https?:\/\//i.test(cleanRegistry)
    ? cleanRegistry
    : `http://${cleanRegistry}`;
  if (version === null) {
    const cmd = `npm dist-tag rm ${JSON.stringify(name)} latest --registry ${JSON.stringify(reg)}`;
    await execAsync(cmd, {
      cwd,
      maxBuffer: 10 * 1024 * 1024,
      env: { ...process.env, npm_config_registry: reg },
    });
    return;
  }
  const cmd = `npm dist-tag add ${JSON.stringify(name + '@' + version)} latest --registry ${JSON.stringify(reg)}`;
  await execAsync(cmd, {
    cwd,
    maxBuffer: 10 * 1024 * 1024,
    env: { ...process.env, npm_config_registry: reg },
  });
}

function enqueueSetLatest(
  name: string,
  version: string | null,
  registry: string,
  cwd: string,
) {
  const prev = tagQueue.get(name) || Promise.resolve();
  const next = prev
    .catch(() => {
      // ignore previous errors
    })
    .then(() => setLatestTag(name, version, registry, cwd))
    .finally(() => {
      if (tagQueue.get(name) === next) tagQueue.delete(name);
    });
  tagQueue.set(name, next);
  return next;
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
