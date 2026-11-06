import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { validateRegistry } from '../scripts/validate-registry.mjs';

const examples = JSON.parse(readFileSync(new URL('../registry/examples.json', import.meta.url), 'utf8'));
const published = JSON.parse(readFileSync(new URL('../registry/models.json', import.meta.url), 'utf8'));

function realModel() {
  const model = structuredClone(examples.models[0]);
  model.example = false;
  model.author.github = 'https://github.com/example';
  model.releases = [model.releases[0]];
  Object.assign(model.releases[0], {
    url: 'https://github.com/example/models/releases/download/v1/model.gkg',
    sha256: 'ab'.repeat(32),
    sizeBytes: 12582912,
  });
  return model;
}

function registry(model = realModel()) {
  return { schemaVersion: 1, models: [model] };
}

test('真实目录与示例目录分开校验，示例不能进入正式发布目录', () => {
  assert.deepEqual(validateRegistry(published), []);
  assert.deepEqual(validateRegistry(examples, { allowExamples: true }), []);
  assert.ok(validateRegistry(examples).some((error) => error.includes('正式目录不能包含示例')));
});

test('具有完整下载信息的真实发布通过', () => {
  assert.deepEqual(validateRegistry(registry()), []);
});

test('重复模型 ID、路由 slug 和发布 ID 不会被静默覆盖', () => {
  const data = registry();
  data.models.push(structuredClone(data.models[0]));
  const errors = validateRegistry(data);
  assert.ok(errors.some((error) => error.includes('models[1].id: 标识重复')));
  assert.ok(errors.some((error) => error.includes('models[1].slug: 标识重复')));
  assert.ok(errors.some((error) => error.includes('models[1].releases[0].id: 标识重复')));
});

test('拒绝脚本、文件、带凭据和本机下载地址', () => {
  const badUrls = ['javascript:alert(1)', 'data:text/plain,x', 'file:///C:/model.gkg', 'http://example.com/model.gkg', 'https://user:password@example.com/model.gkg', 'https://localhost/model.gkg', 'https://127.0.0.1/model.gkg', 'https://10.1.2.3/model.gkg', 'https://[::1]/model.gkg', 'https://example.com/model.gkg#fragment'];
  for (const url of badUrls) {
    const data = registry();
    data.models[0].releases[0].url = url;
    assert.ok(validateRegistry(data).some((error) => error.includes('.url:')), url);
  }
});

test('作者账号需要真正的 GitHub 主页结构', () => {
  const data = registry();
  data.models[0].author.github = 'https://github.com.example.org/someone';
  assert.ok(validateRegistry(data).some((error) => error.includes('.author.github:')));
});

test('正式文件不能缺失下载地址、文件大小或摘要', () => {
  for (const field of ['url', 'sizeBytes', 'sha256']) {
    const data = registry();
    data.models[0].releases[0][field] = null;
    assert.ok(validateRegistry(data).some((error) => error.includes(`.${field}:`)));
  }
});

test('无效大小和摘要无法作为可核对的发布信息', () => {
  const data = registry();
  data.models[0].releases[0].sizeBytes = Number.MAX_SAFE_INTEGER + 1;
  data.models[0].releases[0].sha256 = 'not-a-sha256';
  const errors = validateRegistry(data);
  assert.ok(errors.some((error) => error.includes('.sizeBytes:')));
  assert.ok(errors.some((error) => error.includes('.sha256:')));
});

test('示例永不带有看似真实的下载链接', () => {
  const data = structuredClone(examples);
  data.models[0].releases[0].url = 'https://example.com/fake.gkg';
  assert.ok(validateRegistry(data, { allowExamples: true }).some((error) => error.includes('示例不能带有下载地址')));
});

test('不能通过无效路由、日期或格式进入构建', () => {
  const data = registry();
  data.models[0].slug = '../invalid';
  data.models[0].updatedAt = '2026-02-31';
  data.models[0].releases[0].packageFormat = 99;
  const errors = validateRegistry(data);
  assert.ok(errors.some((error) => error.includes('.slug:')));
  assert.ok(errors.some((error) => error.includes('.updatedAt:')));
  assert.ok(errors.some((error) => error.includes('.packageFormat:')));
});

test('GKG4 与 GKG5 的附件约束保持 Core 合同', () => {
  const data = registry();
  data.models[0].releases[0].packageFormat = 4;
  assert.ok(validateRegistry(data).some((error) => error.includes('GKG4 不声明共享附件')));
  data.models[0].releases[0].packageFormat = 5;
  data.models[0].releases[0].attachments = [];
  assert.ok(validateRegistry(data).some((error) => error.includes('GKG5 至少包含一类共享附件')));
});

test('缺少翻译和空发布列表会给出可定位错误', () => {
  const data = registry();
  data.models[0].summary.en = '';
  data.models[0].releases = [];
  const errors = validateRegistry(data);
  assert.ok(errors.some((error) => error.includes('.summary.en:')));
  assert.ok(errors.some((error) => error.includes('.releases:')));
});

test('畸形顶层和条目返回错误列表，不造成未捕获异常', () => {
  for (const value of [null, [], 'registry', { schemaVersion: 1 }, { schemaVersion: 1, models: [null] }]) {
    assert.ok(validateRegistry(value).length > 0);
  }
});
