import assert from 'node:assert/strict';
import test from 'node:test';
import { inspectGkg } from '../src/lib/gkg.mjs';
import { buildSubmission, publicHttps } from '../src/lib/submission.mjs';
import { mergeSubmission } from '../scripts/prepare-submission.mjs';
import { validateRegistry } from '../scripts/validate-registry.mjs';
import { fixture, manifest } from './support/gkg-fixture.mjs';

const fields = {
  slug: 'galatea-study', name: '策略研究', summary: '用于模型发布流程的测试条目',
  summaryOther: 'A model used to test publication workflows', author: 'sample-author',
  category: 'general', sourceUrl: 'https://github.com/sample-author/models/releases/tag/v1',
  downloadUrl: 'https://github.com/sample-author/models/releases/download/v1/model.gkg',
  license: 'MIT', releaseLabel: 'PPO 200 / BC 5', releaseDate: '2026-11-06',
};

async function draft(source = manifest(), overrides = {}) {
  const report = await inspectGkg(await fixture(source));
  return buildSubmission({ ...fields, ...overrides }, report, report.artifacts[0].primary);
}

const emptyRegistry = () => ({ schemaVersion: 1, models: [] });
const registryOf = (value) => ({ schemaVersion: 1, models: [value.model] });

test('GKG 检查结果转为投稿草稿，技术字段与注册表相符', async () => {
  const submitted = await draft(manifest(5));
  assert.equal(submitted.draftVersion, 2);
  assert.equal(submitted.status, 'draft');
  assert.deepEqual(validateRegistry(registryOf(submitted)), []);
  const release = submitted.model.releases[0];
  assert.equal(release.ppoIteration, 200);
  assert.equal(release.bcIteration, 5);
  assert.equal(release.sha256, release.technical.sha256);
  assert.equal(release.sizeBytes, release.technical.sizeBytes);
  assert.deepEqual(release.attachments, ['decks']);
  assert.equal(submitted.model.author.github, 'https://github.com/sample-author');
  assert.equal(submitted.model.featured, false);
  assert.equal(submitted.model.example, false);
});

test('注册表拒绝草稿与 GKG 报告之间的摘要、PPO 轮次或展示模型错配', async () => {
  const original = await draft();
  for (const [key, value, expected] of [
    ['sha256', 'ab'.repeat(32), 'sha256'],
    ['ppoIteration', 900, '训练轮次'],
    ['primaryArtifact', 'absent.onnx', '展示模型'],
  ]) {
    const changed = structuredClone(original);
    changed.model.releases[0][key] = value;
    const errors = validateRegistry(registryOf(changed));
    assert.ok(errors.some((error) => error.includes(expected)), errors.join('\n'));
    assert.throws(() => mergeSubmission(emptyRegistry(), changed));
  }
});

test('首次发布生成独立候选目录，投稿不能自行获取精选身份', async () => {
  const original = emptyRegistry();
  const submitted = await draft();
  submitted.model.featured = true;
  const merged = mergeSubmission(original, submitted);
  assert.equal(merged.models.length, 1);
  assert.equal(merged.models[0].featured, false);
  assert.deepEqual(original, emptyRegistry());
  assert.equal(submitted.model.featured, true);
  assert.deepEqual(validateRegistry(merged), []);
});

test('新发布追加历史并保留维护者的项目资料与精选状态，不修改输入对象', async () => {
  const source = manifest();
  const first = await draft(source);
  const registry = registryOf(first);
  registry.models[0].featured = true;
  registry.models[0].description = { zh: '维护者审核后的说明', en: 'Reviewed description' };
  const before = structuredClone(registry);
  const nextSource = structuredClone(source);
  nextSource.model_artifacts[0].iteration = 210;
  nextSource.model_artifacts[0].training_lineage.ppo_iteration = 210;
  const next = await draft(nextSource, { releaseDate: '2026-11-07', releaseLabel: 'PPO 210 / BC 5', name: '不同投稿名称' });
  const merged = mergeSubmission(registry, next);
  assert.deepEqual(registry, before);
  assert.equal(merged.models[0].name, before.models[0].name);
  assert.equal(merged.models[0].featured, true);
  assert.deepEqual(merged.models[0].description, before.models[0].description);
  assert.equal(merged.models[0].releases.length, 2);
  assert.deepEqual(merged.models[0].releases[1], first.model.releases[0]);
  assert.equal(merged.models[0].releases[0].ppoIteration, 210);
  assert.equal(merged.models[0].updatedAt, '2026-11-07');
});

test('不能重复发布相同文件，改版本名或 ID 也不能覆盖旧发布', async () => {
  const first = await draft();
  const registry = registryOf(first);
  assert.throws(() => mergeSubmission(registry, first), /已经收录/);
  const renamed = structuredClone(first);
  renamed.model.releases[0].id = 'same-file-new-id';
  renamed.model.releases[0].label = '更名版本';
  assert.throws(() => mergeSubmission(registry, renamed), /不能覆盖旧发布/);
  assert.equal(registry.models[0].releases.length, 1);
});

test('不同作者或路由的同名项目不会接管已有目录', async () => {
  const first = await draft();
  const next = await draft(manifest(), { author: 'another-author' });
  assert.throws(() => mergeSubmission(registryOf(first), next), /作者不同/);
  next.model.author = structuredClone(first.model.author);
  next.model.slug = 'another-route';
  assert.throws(() => mergeSubmission(registryOf(first), next), /路由或作者不同/);
});

test('同一 GitHub 作者的大小写与主页尾斜线不会阻止追加发布', async () => {
  const first = await draft(manifest(4));
  first.model.author.github = 'https://github.com/Sample-Author/';
  const next = await draft(manifest(5), { releaseDate: '2026-11-07' });
  const merged = mergeSubmission(registryOf(first), next);
  assert.equal(merged.models[0].releases.length, 2);
  assert.equal(merged.models[0].author.github, first.model.author.github);
  assert.deepEqual(validateRegistry(merged), []);
});

test('追加新容器版本时只更新保留格式标签，旧发布与作者标签保持不变', async () => {
  const first = await draft(manifest(4));
  first.model.tags = ['V4', 'GKG4', 'PPO', '烙印研究', 'GKG使用说明'];
  first.model.featured = true;
  const next = await draft(manifest(5), { releaseDate: '2026-11-07' });
  const merged = mergeSubmission(registryOf(first), next);
  assert.deepEqual(merged.models[0].tags, ['V4', 'GKG5', 'PPO', '烙印研究', 'GKG使用说明']);
  assert.deepEqual(merged.models[0].releases.map(item=>item.packageFormat), [5, 4]);
  assert.deepEqual(merged.models[0].releases[1], first.model.releases[0]);
  assert.equal(merged.models[0].featured, true);
  assert.deepEqual(first.model.tags, ['V4', 'GKG4', 'PPO', '烙印研究', 'GKG使用说明']);
});

test('补录较早发布不会把最新容器格式标签改回旧版本', async () => {
  const current = await draft(manifest(5), { releaseDate: '2026-11-07' });
  current.model.tags = ['研究用途'];
  const older = await draft(manifest(4));
  const merged = mergeSubmission(registryOf(current), older);
  assert.deepEqual(merged.models[0].tags, ['研究用途', 'GKG5']);
  assert.deepEqual(merged.models[0].releases.map(item=>item.packageFormat), [5, 4]);
  assert.equal(merged.models[0].updatedAt, '2026-11-07');
});

test('旧 BC 计数未知时拒绝准备发布，不把本地 BC 轮次当作 PPO', async () => {
  const source = manifest();
  delete source.model_artifacts[0].training_lineage;
  source.model_artifacts[0].training_stage = 'imitation';
  const report = await inspectGkg(await fixture(source));
  assert.equal(report.artifacts[0].ppoIteration, null);
  assert.throws(() => buildSubmission(fields, report, report.artifacts[0].primary), /缺少完整训练来源/);
});

test('发布地址拒绝脚本、本地文件、私有地址、凭据和片段', async () => {
  const report = await inspectGkg(await fixture());
  const invalid = [
    'javascript:alert(1)', 'file:///model.gkg', 'http://example.com/model.gkg',
    'https://localhost/model.gkg', 'https://127.0.0.1/model.gkg', 'https://[::1]/model.gkg',
    'https://test.local/model.gkg', 'https://user:secret@example.com/model.gkg', 'https://example.com/model.gkg#part',
  ];
  for (const url of invalid) {
    assert.equal(publicHttps(url), null, url);
    assert.throws(() => buildSubmission({ ...fields, downloadUrl: url }, report, report.artifacts[0].primary), /公开 HTTPS/);
    assert.throws(() => buildSubmission({ ...fields, sourceUrl: url }, report, report.artifacts[0].primary), /公开 HTTPS/);
  }
  assert.equal(publicHttps('https://example.com/releases/v1'), 'https://example.com/releases/v1');
});

test('选择不存在的制品、无效日期和不合法目录 ID 会给出可读错误', async () => {
  const report = await inspectGkg(await fixture());
  assert.throws(() => buildSubmission(fields, report, 'missing.onnx'), /请选择包中/);
  assert.throws(() => buildSubmission({ ...fields, releaseDate: '2026-02-31' }, report, report.artifacts[0].primary), /发布日期/);
  assert.throws(() => buildSubmission({ ...fields, slug: '../unsafe' }, report, report.artifacts[0].primary), /目录标识/);
});

test('投稿函数本身拒绝不完整报告，并保留中英文错误信息', async () => {
  const report = await inspectGkg(await fixture());
  delete report.modelId;
  assert.throws(() => buildSubmission(fields, report, report.artifacts[0].primary), (error) => {
    assert.equal(error.code, 'report');
    assert.ok(error.messages.zh);
    assert.ok(error.messages.en);
    return true;
  });
});

test('英文文案与选填译文按语言记录，缺少译文时保留作者原文', async () => {
  const report = await inspectGkg(await fixture());
  const english = buildSubmission({ ...fields, summary: 'English summary', summaryOther: '中文简介' }, report, report.artifacts[0].primary, 'en');
  assert.deepEqual(english.model.summary, { en: 'English summary', zh: '中文简介' });
  const untranslated = buildSubmission({ ...fields, summaryOther: '' }, report, report.artifacts[0].primary);
  assert.equal(untranslated.model.summary.en, fields.summary);
});
