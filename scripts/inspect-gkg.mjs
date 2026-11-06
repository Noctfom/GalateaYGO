import { openAsBlob } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import { inspectGkg } from '../src/lib/gkg.mjs';

const args = process.argv.slice(2);
const usage = '用法 / Usage: npm run inspect:gkg -- <package.gkg> [--output <metadata.json>]';
if (args.length === 1 && ['--help', '-h'].includes(args[0])) {
  console.log(usage);
} else if (![1, 3].includes(args.length) || (args.length === 3 && args[1] !== '--output')) {
  console.error(usage);
  process.exitCode = 1;
} else {
  try {
    const input = resolve(args[0]);
    const blob = await openAsBlob(input);
    const metadata = await inspectGkg(blob, { filename: basename(input) });
    const output = `${JSON.stringify(metadata, null, 2)}\n`;
    if (args.length === 3) {
      // 已有文件保留，避免把模型包或人工维护的清单当作输出覆盖
      await writeFile(resolve(args[2]), output, { encoding: 'utf8', flag: 'wx' });
      console.error(`已写入 / Saved: ${resolve(args[2])}`);
    } else console.log(output.trimEnd());
  } catch (error) {
    console.error(error.messages ? `${error.messages.zh}\n${error.messages.en}` : error.message);
    process.exitCode = 1;
  }
}
