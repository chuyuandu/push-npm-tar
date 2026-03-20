#!/usr/bin/env node

import arg from 'arg';
import { handleArgs } from '@/index';
import { arg_declare } from '@/util';

const args = arg(arg_declare);
const cwd = process.cwd();

handleArgs({ ...args, cwd });
