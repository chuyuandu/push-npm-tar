#!/usr/bin/env node

import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { IArgType } from './util';

export function doPush(args: IArgType) {
  getTgzFiles(args.tgzFolder);
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
