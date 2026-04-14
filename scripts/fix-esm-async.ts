#!/usr/bin/env bun

import {
    readFileSync,
    writeFileSync
} from 'fs';
import { join } from 'path';

// Fix Bun bundler bug: __esm wrappers that contain `await` but are missing `async`
const bundledFilePath = join('dist', 'ccstatusline.js');
let content = readFileSync(bundledFilePath, 'utf-8');

const before = (content.match(/__esm\(\(\) => \{\n\s*await /g) ?? []).length;

content = content.replace(/__esm\(\(\) => \{\n(\s*await )/g, '__esm(async () => {\n$1');

writeFileSync(bundledFilePath, content);

if (before > 0) {
    console.log(`✓ Fixed ${before} non-async __esm wrappers containing await`);
} else {
    console.log('✓ No __esm async fixes needed');
}