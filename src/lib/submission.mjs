import { validateInspection } from './gkg.mjs';

const identifier = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const localized = (value, alternative, lang) => lang === 'en'
  ? { en: value, zh: alternative || value } : { zh: value, en: alternative || value };

export function publicHttps(value) {
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    if (url.protocol !== 'https:' || url.username || url.password || url.hash ||
        !host.includes('.') || host.endsWith('.local') || host.endsWith('.localhost') ||
        host.startsWith('[') || /^\d+(?:\.\d+)*$/.test(host)) return null;
    return url.href;
  } catch { return null; }
}

/** 技术字段来自本地检查报告，作者文案保持独立 */
export function buildSubmission(fields, report, selectedPrimary, lang = 'zh') {
  const fail = (zh, en) => { const error = new Error(zh); error.messages = { zh, en }; throw error; };
  validateInspection(report);
  const artifact = report.artifacts.find(item => item.primary === selectedPrimary);
  if (!artifact) fail('请选择包中用于此版本介绍的模型', 'Choose the model to feature in this release.');
  if (!Number.isSafeInteger(artifact.ppoIteration) || artifact.ppoIteration < 0 || !Number.isSafeInteger(artifact.bcIteration) || artifact.bcIteration < 0) {
    fail('该制品缺少完整训练来源，请使用当前 Core 重新打包', 'This artifact has incomplete training lineage. Repackage it with the current Core.');
  }
  const value = name => String(fields[name] || '').trim();
  const id = value('slug');
  if (!identifier.test(id) || id.length > 80) fail('目录标识需使用小写字母、数字和短横线', 'Use lowercase letters, numbers and hyphens for the directory ID.');
  const sourceUrl = publicHttps(value('sourceUrl'));
  const url = publicHttps(value('downloadUrl'));
  if (!sourceUrl || !url) fail('发布页与文件地址需使用公开 HTTPS 地址，不含账号、密码或锚点', 'Use public HTTPS release and download URLs without credentials or fragments.');
  const author = value('author');
  if (!/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/.test(author)) fail('请填写有效的 GitHub 账号', 'Enter a valid GitHub handle.');
  const date = value('releaseDate');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0, 10) !== date) {
    fail('请选择有效的发布日期', 'Choose a valid release date.');
  }
  for (const key of ['name', 'summary', 'license', 'releaseLabel']) {
    if (!value(key)) fail('名称、简介、许可证和版本名称不能为空', 'Name, summary, license and release label are required.');
  }
  if (!['general', 'specialist', 'lightweight'].includes(value('category'))) fail('请选择模型分类', 'Choose a model category.');
  const description = value('notes') || value('summary');
  const descriptionOther = value('notesOther') || value('summaryOther');
  return {
    draftVersion: 2, status: 'draft', language: lang,
    model: {
      id, slug: id, name: value('name'), author: { name: author, github: `https://github.com/${author}` },
      summary: localized(value('summary'), value('summaryOther'), lang),
      description: localized(description, descriptionOther, lang),
      tags: ['V4', `GKG${report.packageFormat}`], category: value('category'), accent: 'violet',
      featured: false, updatedAt: date, license: value('license'), example: false,
      releases: [{
        id: `${id}-${report.sha256.slice(0, 12)}`, label: value('releaseLabel'), createdAt: date,
        modelProtocol: report.modelProtocol, packageFormat: report.packageFormat,
        ppoIteration: artifact.ppoIteration, bcIteration: artifact.bcIteration, format: 'GKG',
        sizeBytes: report.sizeBytes, sha256: report.sha256, url, sourceUrl,
        attachments: report.attachments,
        notes: localized(description, descriptionOther, lang), primaryArtifact: selectedPrimary,
        technical: report,
      }],
    },
  };
}
