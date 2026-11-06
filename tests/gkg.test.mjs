import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { hashBlob, inspectGkg, validateInspection } from '../src/lib/gkg.mjs';
import { fixture, hash, manifest, protocol } from './support/gkg-fixture.mjs';

test('GKG4 提取实际合同字段并为整个包计算 SHA256', async () => {
  const source = manifest();
  const blob = await fixture(source);
  const progress = [];
  const result = await inspectGkg(blob, { filename: '发布包.gkg', onProgress: (entry) => progress.push(entry) });
  assert.equal(result.packageFormat, 4);
  assert.equal(result.modelId, source.model_artifacts[0].model_id);
  assert.equal(result.filename, '发布包.gkg');
  assert.equal(result.sha256, hash(new Uint8Array(await blob.arrayBuffer())));
  assert.equal(result.artifacts[0].ppoIteration, 200);
  assert.equal(result.artifacts[0].bcIteration, 5);
  assert.equal(result.protocol.semanticLookupHash, protocol.semantic_lookup_hash);
  assert.deepEqual(result.attachments, []);
  assert.equal(progress.at(-1).loaded, blob.size);
});

test('GKG5 保留中文路径分类和 ZIP64，读取过程不展开模型文件', async () => {
  const result = await inspectGkg(await fixture(manifest(5), { zip64: true }));
  assert.equal(result.packageFormat, 5);
  assert.deepEqual(result.attachments, ['decks']);
  assert.deepEqual(result.attachmentCounts, { decks: 1, replays: 0, documents: 0, presets: 0 });
});

test('支持无接续字段的 PPO，旧 BC 未声明来源时不猜测 PPO 计数', async () => {
  const ppo = manifest();
  delete ppo.model_artifacts[0].training_lineage;
  assert.equal((await inspectGkg(await fixture(ppo))).artifacts[0].ppoIteration, 200);
  ppo.model_artifacts[0].format = 'pytorch_checkpoint';
  ppo.model_artifacts[0].training_stage = 'imitation';
  const bc = (await inspectGkg(await fixture(ppo))).artifacts[0];
  assert.equal(bc.ppoIteration, null);
  assert.equal(bc.bcIteration, null);
});

test('无清单、损坏 ZIP 和未知容器版本会拒绝，而不是产生默认模型信息', async () => {
  await assert.rejects(inspectGkg(await fixture(manifest(), { missing: ['manifest.json'] })), { code: 'manifest' });
  await assert.rejects(inspectGkg(new Blob(['not a zip archive'.repeat(5)])), { code: 'archive' });
  await assert.rejects(inspectGkg(await fixture(manifest(9))), { code: 'version' });
  const broken = await fixture();
  await assert.rejects(inspectGkg(broken.slice(0, broken.size - 3)), { code: 'archive' });
});

test('清单字段、模型协议和跨模型身份不一致会拒绝', async () => {
  const value = manifest();
  value.model_protocol_version = 3;
  await assert.rejects(inspectGkg(await fixture(value)), { code: 'protocol' });
  value.model_protocol_version = 4;
  delete value.semantic_lookup_hash;
  await assert.rejects(inspectGkg(await fixture(value)), { code: 'protocol' });
  const mixed = manifest();
  mixed.model_artifacts.push({ ...mixed.model_artifacts[0], model_id: randomUUID(), primary: 'other.onnx', files: ['other.onnx'] });
  await assert.rejects(inspectGkg(await fixture(mixed)), { code: 'models' });
});

test('拒绝缺失模型、重复大小写路径和路径穿越', async () => {
  const value = manifest();
  await assert.rejects(inspectGkg(await fixture(value, { missing: [value.model_artifacts[0].primary] })), { code: 'models' });
  await assert.rejects(inspectGkg(await fixture(value, { extra: [['MANIFEST.JSON', '{}']] })), { code: 'archive' });
  await assert.rejects(inspectGkg(await fixture(value, { extra: [['../outside.txt', 'outside']] })), { code: 'archive' });
});

test('GKG4 不接收 GKG5 附件，GKG5 附件大小和目录应一致', async () => {
  const version4 = manifest(5);
  version4.package_format_version = 4;
  await assert.rejects(inspectGkg(await fixture(version4)), { code: 'content' });
  const mismatch = manifest(5);
  mismatch.optional_content.files[0].size = 99;
  await assert.rejects(inspectGkg(await fixture(mismatch)), { code: 'content' });
  await assert.rejects(inspectGkg(await fixture(manifest(), { extra: [['content/documents/undeclared.md', '# text']] })), { code: 'content' });
});

test('清单 CRC 损坏会拒绝', async () => {
  const value = manifest();
  const blob = await fixture(value, { level: 0 });
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const header = new DataView(bytes.buffer);
  const contentOffset = 30 + header.getUint16(26, true) + header.getUint16(28, true);
  bytes[contentOffset + 2] ^= 1;
  await assert.rejects(inspectGkg(new Blob([bytes])), { code: 'archive' });
});

test('限制清单展开大小与伪造超大目录，不整包读入内存', async () => {
  const blob = await fixture();
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const view = new DataView(bytes.buffer);
  let eocd = bytes.length - 22;
  while (view.getUint32(eocd, true) !== 0x06054b50) eocd--;
  view.setUint32(eocd + 12, 33 * 1024 * 1024, true);
  await assert.rejects(inspectGkg(new Blob([bytes])), { code: 'limits' });
  const oversized = manifest();
  oversized.padding = 'x'.repeat(2 * 1024 * 1024);
  await assert.rejects(inspectGkg(await fixture(oversized)), { code: 'limits' });
});

test('SHA256 分块结果与 Node 原生一致，取消后不会返回报告', async () => {
  const bytes = new Uint8Array(9 * 1024 * 1024 + 17).fill(37);
  const blob = new Blob([bytes]);
  assert.equal(await hashBlob(blob), hash(bytes));
  const controller = new AbortController();
  await assert.rejects(hashBlob(blob, {
    signal: controller.signal,
    onProgress(progress) { if (progress.loaded > 0) controller.abort(); },
  }), { name: 'AbortError' });
  await assert.rejects(inspectGkg(await fixture(), { signal: controller.signal }), { name: 'AbortError' });
});

test('导入的检查报告仍需完整技术字段和附件计数', async () => {
  const report = await inspectGkg(await fixture());
  assert.equal(validateInspection(report), report);
  assert.throws(() => validateInspection({ ...report, sha256: 'fake' }), { code: 'report' });
  assert.throws(() => validateInspection({ ...report, artifacts: [] }), { code: 'report' });
  assert.throws(() => validateInspection({ ...report, attachments: ['decks'] }), { code: 'report' });
  assert.throws(() => validateInspection({ ...report, protocol: {} }), { code: 'report' });
});
