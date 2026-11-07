import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { mergeSubmission } from '../prepare-submission.mjs';

export const digest = value => createHash('sha256').update(value).digest('hex');
export const fingerprint = value => digest(JSON.stringify(value));
export const hashPattern = /^[a-f0-9]{64}$/;

export function authorize(policy, actorId, action) {
  if (policy?.schemaVersion !== 1 || policy.aiReviewEnabled !== false) throw new Error('审核策略版本无效，当前版本未启用 AI 审核');
  const role = action === 'scan' ? 'reviewers' : ['publish', 'withdraw'].includes(action) ? 'publishers' : null;
  if (!role) throw new Error('未知审核操作');
  const user = [...policy.roles.administrators, ...policy.roles[role]].find(item => String(item.id) === String(actorId));
  if (!user) throw new Error('当前 GitHub 用户 ID 没有执行此操作的权限');
  return user;
}

export function parseSubmission(body) {
  if (typeof body !== 'string' || Buffer.byteLength(body) > 256 * 1024) throw new Error('投稿内容为空或过大');
  const blocks = [...body.matchAll(/```json\s*\r?\n([\s\S]*?)\r?\n```/g)];
  if (blocks.length !== 1) throw new Error('投稿 Issue 必须包含一个完整的 JSON 代码块');
  const draft = JSON.parse(blocks[0][1]);
  mergeSubmission({ schemaVersion: 1, models: [] }, draft);
  return draft;
}

export function githubRelease(url, policy) {
  const value = new URL(url);
  if (value.protocol !== 'https:' || !policy.downloadHosts.includes(value.hostname) || value.port || value.username || value.password || value.search || value.hash) throw new Error('首版自动审核仅下载公开 GitHub Release 的固定版本 GKG');
  const match = /^\/([A-Za-z0-9-]+)\/([A-Za-z0-9_.-]+)\/releases\/download\/([^/]+)\/([^/]+\.gkg)$/i.exec(value.pathname);
  if (!match || match.slice(1).some(item => { const decoded = decodeURIComponent(item); return /[\\/\u0000-\u001f]/.test(decoded) || ['.', '..'].includes(decoded); })) throw new Error('请使用 releases/download/版本标签/文件.gkg 地址，不接受 latest 或任意网页');
  return { owner: match[1], repository: match[2], tag: decodeURIComponent(match[3]), filename: decodeURIComponent(match[4]) };
}

export function validateReport(request, report, inspection) {
  const release = request.draft.model.releases[0];
  if (report.policyHash !== fingerprint(request.policy)) throw new Error('审核策略已变化，需要按当前策略重新检查');
  if (report.status !== 'passed' || report.sha256 !== release.sha256 || report.sizeBytes !== release.sizeBytes) throw new Error('实际包体检查失败或摘要、大小发生变化');
  if (!isDeepStrictEqual(inspection, release.technical)) throw new Error('下载包的技术信息与投稿不符，请作者重新生成投稿');
  if (!Array.isArray(report.files) || !report.files.length || report.files.some(file => !hashPattern.test(file.sha256))) throw new Error('缺少完整包内检查记录');
  return true;
}

export function reviewedRegistry(registry, log, request, report, inspection) {
  if (request.action === 'scan') throw new Error('只读检查不能生成上架目录');
  const actor = authorize(request.policy, request.actor.id, request.action);
  if (!hashPattern.test(request.expectedSha ?? '')) throw new Error('批准或撤回时必须填写完整包 SHA256');
  if (request.action === 'withdraw') {
    if (!request.reason?.trim()) throw new Error('撤回需要填写原因');
    const next = structuredClone(registry);
    const removed = [];
    for (const model of next.models) {
      model.releases = model.releases.filter(release => {
        if (release.sha256 !== request.expectedSha) return true;
        removed.push({ modelId: model.id, release });
        return false;
      });
      if (model.releases.length) {
        model.updatedAt = model.releases.map(item => item.createdAt).sort().at(-1);
        model.tags = [...model.tags.filter(tag => !/^GKG\d+$/i.test(tag)), `GKG${model.releases[0].packageFormat}`];
      }
    }
    next.models = next.models.filter(model => model.releases.length);
    if (!removed.length) throw new Error('正式目录中未找到此摘要，未执行撤回');
    return { registry: next, log: { ...log, events: [...log.events, {
      action: 'withdraw', sha256: request.expectedSha, reason: request.reason.trim(), actor,
      runUrl: request.runUrl, at: request.createdAt, removed,
    }] } };
  }
  if (request.expectedSha !== request.draft.model.releases[0].sha256 || request.expectedDraft !== fingerprint(request.draft)) throw new Error('批准的包摘要或投稿摘要与当前内容不同，请重新检查');
  validateReport(request, report, inspection);
  if (log.events.some(event => event.action === 'withdraw' && event.sha256 === request.expectedSha)) throw new Error('该包曾被撤回，需要单独复审，不能重新自动上架');
  return { registry: mergeSubmission(registry, request.draft), log: { ...log, events: [...log.events, {
    action: 'publish', sha256: request.expectedSha, draftHash: request.expectedDraft,
    modelId: request.draft.model.id, releaseId: request.draft.model.releases[0].id,
    releaseHash: fingerprint(request.draft.model.releases[0]),
    policyHash: fingerprint(request.policy), actor, issue: request.issue,
    sourceUrl: request.draft.model.releases[0].sourceUrl, downloadUrl: request.draft.model.releases[0].url,
    runUrl: request.runUrl, at: request.createdAt, report,
  }] } };
}

export function validatePublishedRegistry(registry, log) {
  if (log?.schemaVersion !== 1 || !Array.isArray(log.events)) throw new Error('正式目录缺少有效审核记录');
  for (const model of registry.models) for (const release of model.releases) {
    const latest = log.events.filter(event => event.sha256 === release.sha256).at(-1);
    if (!latest || latest.action !== 'publish' || latest.modelId !== model.id || latest.releaseId !== release.id
        || latest.releaseHash !== fingerprint(release) || latest.report?.status !== 'passed'
        || latest.report.sha256 !== release.sha256 || !Number.isSafeInteger(latest.actor?.id)
        || !hashPattern.test(latest.policyHash ?? '') || !hashPattern.test(latest.draftHash ?? '')) {
      throw new Error(`发布 ${release.id} 缺少匹配的审核批准记录，或已被撤回`);
    }
  }
}
