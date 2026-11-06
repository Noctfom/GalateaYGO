import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateRegistry } from './validate-registry.mjs';

const githubIdentity = value => {
  const profile = new URL(value);
  return `${profile.origin}${profile.pathname.replace(/\/+$/, '')}`.toLowerCase();
};

function currentPackageTags(tags, format) {
  let replaced = false;
  const result = [];
  for (const tag of tags) {
    if (/^GKG\d+$/i.test(tag.trim())) {
      if (!replaced) result.push(`GKG${format}`);
      replaced = true;
    } else result.push(tag);
  }
  if (!replaced) result.push(`GKG${format}`);
  return result;
}

/** 新发布追加到既有项目，旧发布及维护者精选状态保持不变 */
export function mergeSubmission(registry, draft) {
  if (draft?.draftVersion !== 2 || draft?.status !== 'draft' || !draft.model) throw new Error('只接受发布页生成的第 2 版投稿草稿');
  const errors = validateRegistry({ schemaVersion: 1, models: [draft.model] });
  if (errors.length) throw new Error(errors.join('\n'));
  if (draft.model.releases.length !== 1 || !draft.model.releases[0].technical) throw new Error('投稿应包含一个带 GKG 技术信息的发布版本');
  const existingErrors = validateRegistry(registry);
  if (existingErrors.length) throw new Error(existingErrors.join('\n'));
  const result = structuredClone(registry);
  const incoming = structuredClone(draft.model);
  const existing = result.models.find(model => model.id === incoming.id);
  if (!existing) {
    incoming.featured = false;
    result.models.push(incoming);
  } else {
    if (existing.slug !== incoming.slug || githubIdentity(existing.author.github) !== githubIdentity(incoming.author.github)) throw new Error('同一项目的路由或作者不同，需要维护者手动核对');
    const release = incoming.releases[0];
    if (existing.releases.some(item => item.id === release.id || item.sha256 === release.sha256)) throw new Error('该文件或版本已经收录，不能覆盖旧发布');
    existing.releases.unshift(release);
    existing.releases.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    existing.updatedAt = [existing.updatedAt, incoming.updatedAt].sort().at(-1);
  }
  // 容器版本标签跟随最新发布，作者的其他标签与已审核文案保持原样
  const updated = existing || incoming;
  updated.tags = currentPackageTags(updated.tags, updated.releases[0].packageFormat);
  const finalErrors = validateRegistry(result);
  if (finalErrors.length) throw new Error(finalErrors.join('\n'));
  return result;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const [input, output] = process.argv.slice(2);
    if (!input || !output) throw new Error('用法：npm run submission -- 投稿.json 待审查目录.json');
    const registryPath = fileURLToPath(new URL('../registry/models.json', import.meta.url));
    if ([registryPath, resolve(input)].includes(resolve(output))) throw new Error('输出必须是新的候选文件，审查后再更新正式目录');
    const registry = JSON.parse(readFileSync(registryPath, 'utf8'));
    const draft = JSON.parse(readFileSync(input, 'utf8'));
    const next = mergeSubmission(registry, draft);
    writeFileSync(output, `${JSON.stringify(next, null, 2)}\n`, { flag: 'wx' });
    console.log(`已生成待审查目录：${output}，共 ${next.models.length} 个项目`);
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
