import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateInspection } from '../src/lib/gkg.mjs';
import { validatePublishedRegistry } from './moderation/policy.mjs';

const categories = new Set(['general', 'specialist', 'lightweight']);
const accents = new Set(['violet', 'amber', 'teal']);
const attachmentTypes = new Set(['decks', 'replays', 'documents', 'presets']);
const identifier = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const isText = (value) => typeof value === 'string' && value.trim().length > 0;

function validDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}

function isPublicHttps(value) {
  if (typeof value !== 'string' || value !== value.trim()) return false;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.hash) return false;
    const host = url.hostname.toLowerCase();
    if (!host.includes('.') || host.endsWith('.localhost') || host.endsWith('.local')) return false;
    // 下载目标使用公开域名，拒绝本地地址和所有数字 IP 形式
    if (/^\d+(?:\.\d+)*$/.test(host) || host.startsWith('[')) return false;
    return true;
  } catch {
    return false;
  }
}

function isGithubProfile(value) {
  if (!isPublicHttps(value)) return false;
  const url = new URL(value);
  return url.hostname === 'github.com' && !url.search && /^\/[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,38})\/?$/.test(url.pathname);
}

/** 检查公开目录的字段合同，返回可直接展示的问题列表 */
export function validateRegistry(data, { allowExamples = false } = {}) {
  const errors = [];
  const check = (condition, path, message) => {
    if (!condition) errors.push(`${path}: ${message}`);
  };
  if (!isRecord(data)) return ['registry: 必须是 JSON 对象'];
  check(data.schemaVersion === 1, 'schemaVersion', '只支持目录格式 1');
  if (!Array.isArray(data.models)) return [...errors, 'models: 必须是数组'];
  const modelIds = new Set();
  const slugs = new Set();
  const releaseIds = new Set();
  const checkUnique = (value, values, path) => {
    check(typeof value === 'string' && identifier.test(value), path, '必须是小写字母、数字和短横线组成的标识');
    check(!values.has(value), path, '标识重复');
    values.add(value);
  };
  const checkLocalized = (value, path) => {
    if (!isRecord(value)) return check(false, path, '必须包含中文和英文文本');
    check(isText(value.zh), `${path}.zh`, '缺少中文文本');
    check(isText(value.en), `${path}.en`, '缺少英文文本');
  };
  data.models.forEach((model, index) => {
    const path = `models[${index}]`;
    if (!isRecord(model)) return check(false, path, '必须是模型对象');
    checkUnique(model.id, modelIds, `${path}.id`);
    checkUnique(model.slug, slugs, `${path}.slug`);
    check(isText(model.name), `${path}.name`, '名称不能为空');
    check(typeof model.example === 'boolean', `${path}.example`, '必须明确是否为示例');
    check(allowExamples || model.example === false, `${path}.example`, '正式目录不能包含示例');
    if (!isRecord(model.author)) {
      check(false, `${path}.author`, '缺少作者资料');
    } else {
      check(isText(model.author.name), `${path}.author.name`, '作者名称不能为空');
      check(model.example && model.author.github === null || isGithubProfile(model.author.github), `${path}.author.github`, '需要公开 GitHub 作者主页');
    }
    checkLocalized(model.summary, `${path}.summary`);
    checkLocalized(model.description, `${path}.description`);
    check(Array.isArray(model.tags) && model.tags.every(isText) && new Set(model.tags).size === model.tags.length, `${path}.tags`, '标签必须是无重复的非空字符串数组');
    check(categories.has(model.category), `${path}.category`, '未知模型分类');
    check(accents.has(model.accent), `${path}.accent`, '未知主题色');
    check(typeof model.featured === 'boolean', `${path}.featured`, '必须为布尔值');
    check(validDate(model.updatedAt), `${path}.updatedAt`, '需要有效的 YYYY-MM-DD 日期');
    check(isText(model.license), `${path}.license`, '缺少许可证说明');
    if (!Array.isArray(model.releases) || model.releases.length === 0) {
      check(false, `${path}.releases`, '至少需要一个发布版本');
      return;
    }
    model.releases.forEach((release, releaseIndex) => {
      const rp = `${path}.releases[${releaseIndex}]`;
      if (!isRecord(release)) return check(false, rp, '必须是发布版本对象');
      checkUnique(release.id, releaseIds, `${rp}.id`);
      check(isText(release.label), `${rp}.label`, '版本名称不能为空');
      check(validDate(release.createdAt), `${rp}.createdAt`, '需要有效的 YYYY-MM-DD 日期');
      check(!validDate(model.updatedAt) || !validDate(release.createdAt) || release.createdAt <= model.updatedAt, `${rp}.createdAt`, '发布日期不能晚于条目更新时间');
      check(release.modelProtocol === 4, `${rp}.modelProtocol`, '当前目录支持 V4');
      check([4, 5].includes(release.packageFormat), `${rp}.packageFormat`, '当前支持 GKG4 和 GKG5');
      check(release.format === 'GKG', `${rp}.format`, '当前发布入口使用 GKG 部署包');
      for (const key of ['ppoIteration', 'bcIteration']) {
        check(Number.isSafeInteger(release[key]) && release[key] >= 0, `${rp}.${key}`, '轮次必须是非负安全整数');
      }
      check(Array.isArray(release.attachments) && release.attachments.every((type) => attachmentTypes.has(type)) && new Set(release.attachments).size === release.attachments.length, `${rp}.attachments`, '附件分类未知或重复');
      check(release.packageFormat !== 4 || Array.isArray(release.attachments) && release.attachments.length === 0, `${rp}.attachments`, 'GKG4 不声明共享附件');
      check(release.packageFormat !== 5 || Array.isArray(release.attachments) && release.attachments.length > 0, `${rp}.attachments`, 'GKG5 至少包含一类共享附件');
      checkLocalized(release.notes, `${rp}.notes`);
      if (release.sourceUrl !== undefined) check(isPublicHttps(release.sourceUrl), `${rp}.sourceUrl`, '发布页需要公开 HTTPS 地址');
      if (release.technical !== undefined) {
        try {
          const report = validateInspection(release.technical);
          for (const key of ['modelProtocol', 'packageFormat', 'sizeBytes', 'sha256']) {
            check(release[key] === report[key], `${rp}.${key}`, '与 GKG 检查报告不一致');
          }
          check(JSON.stringify(release.attachments) === JSON.stringify(report.attachments), `${rp}.attachments`, '与 GKG 附件分类不一致');
          const artifact = report.artifacts.find(item => item.primary === release.primaryArtifact);
          check(Boolean(artifact), `${rp}.primaryArtifact`, '展示模型不在 GKG 制品列表中');
          if (artifact) {
            check(release.ppoIteration === artifact.ppoIteration && release.bcIteration === artifact.bcIteration, `${rp}.primaryArtifact`, '训练轮次与展示制品不一致');
          }
        } catch { check(false, `${rp}.technical`, 'GKG 检查报告结构无效'); }
      } else if (release.primaryArtifact !== undefined) check(false, `${rp}.technical`, '展示制品需要完整 GKG 信息');
      if (model.example) {
        check(release.url === null && release.sha256 === null && release.sizeBytes === null, rp, '示例不能带有下载地址、文件摘要或文件大小');
      } else {
        check(isPublicHttps(release.url), `${rp}.url`, '下载地址必须是无凭据的公开 HTTPS 域名地址');
        check(typeof release.sha256 === 'string' && /^[a-f0-9]{64}$/.test(release.sha256), `${rp}.sha256`, '需要 64 位小写 SHA256');
        check(Number.isSafeInteger(release.sizeBytes) && release.sizeBytes > 0, `${rp}.sizeBytes`, '文件大小必须是正安全整数');
      }
    });
  });
  return errors;
}

const invokedPath = process.argv[1] && resolve(process.argv[1]);
if (invokedPath === fileURLToPath(import.meta.url)) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const files = [
    ['registry/models.json', false],
    ['registry/examples.json', true],
  ];
  let invalid = false;
  for (const [file, allowExamples] of files) {
    try {
      const data = JSON.parse(readFileSync(resolve(root, file), 'utf8'));
      if (!allowExamples) validatePublishedRegistry(data, JSON.parse(readFileSync(resolve(root, 'registry/moderation-log.json'), 'utf8')));
      const errors = validateRegistry(data, { allowExamples });
      if (errors.length) {
        invalid = true;
        console.error(`${file}\n${errors.join('\n')}`);
      } else {
        console.log(`${file}: 通过，${data.models.length} 个条目`);
      }
    } catch (error) {
      invalid = true;
      console.error(`${file}: ${error.message}`);
    }
  }
  if (invalid) process.exitCode = 1;
}
