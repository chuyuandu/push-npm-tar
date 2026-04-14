import { execSync } from 'node:child_process';
import pkg from '../package.json';
import { Result } from 'arg';
import chalk from 'chalk';

/** 参数声明 */
export const arg_declare = {
  '--help': Boolean,
  '--version': Boolean,
  // 最大并发上传数, 最小为 1， 默认为 cpu 核心数的 2 倍
  '--limit': Number,
  // tgz文件存放路径，默认为当前工作目录下的 storage 文件夹
  '--dir': String,
  // 目标仓库地址
  '--registry': String,
  // 是否跳过工具版本检测，默认为 false
  '--skipVersionCheck': Boolean,
  // alias
  '-h': '--help',
  '-v': '--version',
  '-l': '--limit',
  '-r': '--registry',
  '-d': '--dir',
  '-s': '--skipVersionCheck',
};
/** args 参数解析结果类型 */
// export type IArgType = Result<typeof arg_declare>;
export type IArgType = Result<typeof arg_declare> & {
  /** 当前工作目录 */
  cwd: string;
  // /** 下载文件的保存目录 */
  // tgzFolder: string;
};

/** 下载文件的保存目录名 */
export const tgzFolderName = 'storage';

const params = [
  {
    name: '--version',
    alias: '-v',
    des: '查看当前版本号',
  },
  {
    name: '--help',
    alias: '-h',
    des: '查看帮助信息',
  },
  {
    name: '--limit',
    alias: '-l',
    des: '最大并发上传数, 最小为 1， 默认为 cpu 核心数的 2 倍',
  },
  {
    name: '--registry',
    alias: '-r',
    des: '目标仓库地址',
  },
  {
    name: '--dir',
    alias: '-d',
    des: 'tgz 文件存放路径',
  },
  {
    name: '--skipVersionCheck',
    alias: '-s',
    des: '是否跳过版本检查，默认会自动检查 `push-npm-tar`包的版本更新\n并要求最新版才可以推送',
  },
];

/** 帮助文档 */
export const helpContent = `
${chalk.greenBright(`通过命令行将通过${chalk.blueBright('fetch-npm-tar')}下载的tgz文件上传到私有npm仓库中`)}

${params
  .map(item => {
    return `  ${chalk.blueBright(item.name)}: ${item.alias ? ` ${chalk.blue(item.alias)}` : ''}

    ${item.des}`;
  })
  .join(`\n\n`)}
`;

/** 获取当前运行的版本号 */
export function getCurrentVersion(): string {
  return pkg.version;
}

/** 获取当前包的最新版本号 */
export function getLatestVersion(): string {
  let version = '';
  try {
    version = execSync(`npm view ${pkg.name} version`).toString().trim();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) {
    console.error('获取 npm 最新版本失败:', err.message || '');
  }
  return version;
}
/** 版本更新检测 */
export function checkVersion(currentVersion: string, args: IArgType) {
  return new Promise<void>(function (resolve) {
    if (args['--skipVersionCheck']) {
      resolve();
      return;
    }
    const latestVersion = getLatestVersion();
    if (latestVersion !== currentVersion) {
      if (latestVersion) {
        console.warn(`当前版本已更新到 ${latestVersion}，请先更新版本！`);
      }
      // setTimeout(() => resolve(), 500);
      process.exit(0);
    } else {
      resolve();
    }
  });
}

/** 从指定目录获取 npm config 设置的 registry */
export function getRegistry(dir: string) {
  const stdout = execSync('npm config get registry', {
    cwd: dir,
    encoding: 'utf-8',
  });
  return stdout.trim();
}
