import { readFileSync, writeFileSync, mkdirSync, appendFileSync, openAsBlob, statSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { inspectGkg } from '../../src/lib/gkg.mjs';
import { authorize, parseSubmission, githubRelease, fingerprint, hashPattern, validateReport, reviewedRegistry } from './policy.mjs';
import { downloadPackage } from './download.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const read = path => {
  if (statSync(path).size > 64 * 1024 * 1024) throw new Error('审核 JSON 超过 64 MiB 上限');
  return JSON.parse(readFileSync(path, 'utf8'));
};
const write = (path, value) => writeFileSync(path, JSON.stringify(value, null, 2) + '\n');
const policy = read(join(root, 'registry/moderation-policy.json'));

async function api(path, method = 'GET', body) {
  const response = await fetch(`https://api.github.com${path}`, {
    method, redirect: 'error', signal: AbortSignal.timeout(30000),
    headers: { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28',
      Authorization: `Bearer ${process.env.GH_TOKEN}`, 'Content-Type': 'application/json', 'User-Agent': 'GalateaYGO-review' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`GitHub API ${method} ${path}: HTTP ${response.status}`);
  return response.status === 204 ? null : response.json();
}

async function requestFromEvent() {
  const event = read(process.env.GITHUB_EVENT_PATH);
  if (process.env.GITHUB_REF !== 'refs/heads/main' || process.env.GITHUB_REPOSITORY !== policy.repository
      || process.env.GITHUB_EVENT_NAME !== 'workflow_dispatch') throw new Error('审核工作流只能由正式仓库 main 分支手动启动');
  if (process.env.GITHUB_TRIGGERING_ACTOR && process.env.GITHUB_TRIGGERING_ACTOR !== process.env.GITHUB_ACTOR) throw new Error('不能以其他用户身份重跑审核，请自行发起新审核');
  const inputs = event.inputs;
  const actor = authorize(policy, process.env.GITHUB_ACTOR_ID, inputs.action);
  const request = {
    action: inputs.action, actor, policy, createdAt: new Date().toISOString(),
    runUrl: `https://github.com/${policy.repository}/actions/runs/${process.env.GITHUB_RUN_ID}`,
    expectedSha: inputs.package_sha256?.trim(), expectedDraft: inputs.draft_sha256?.trim(),
    reason: inputs.reason?.trim() ?? '',
  };
  if (request.action !== 'scan' && !hashPattern.test(request.expectedSha ?? '')) throw new Error('批准或撤回必须填写完整包 SHA256');
  if (request.action === 'withdraw') {
    if (!request.reason || request.reason.length > 2000) throw new Error('撤回需要填写不超过 2000 字的原因');
    return request;
  }
  if (!/^[1-9]\d{0,9}$/.test(inputs.issue ?? '')) throw new Error('请填写投稿 Issue 编号');
  const issue = await api(`/repos/${policy.repository}/issues/${inputs.issue}`);
  if (issue.pull_request || issue.state !== 'open') throw new Error('仅接受仍开放的投稿 Issue');
  const draft = parseSubmission(issue.body);
  const release = draft.model.releases[0];
  githubRelease(release.url, policy);
  request.issue = { number: issue.number, url: issue.html_url, author: { id: issue.user.id, login: issue.user.login } };
  request.draft = draft;
  if (request.action === 'publish' && (request.expectedSha !== release.sha256 || request.expectedDraft !== fingerprint(draft))) throw new Error('包或投稿在确认后发生变化，请重新检查');
  return request;
}

function summary(request, report) {
  const lines = ['## GKG 审核', '', `操作: ${request.action}`, `包 SHA256: ${request.draft?.model.releases[0].sha256 ?? request.expectedSha}`];
  if (request.draft) lines.push(`投稿 SHA256: ${fingerprint(request.draft)}`);
  lines.push(`结果: ${report?.status ?? '待检查'}`, '', '完整报告见本次运行附件，检查通过不等于自动上架，也不证明模型没有训练投毒');
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, lines.join('\n\n') + '\n');
}

async function propose(request, report, inspection) {
  const result = reviewedRegistry(read(join(root, 'registry/models.json')), read(join(root, 'registry/moderation-log.json')), request, report, inspection);
  const repo = `/repos/${policy.repository}`;
  const localHead = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  const head = await api(`${repo}/git/ref/heads/main`);
  if (head.object.sha !== localHead) throw new Error('审核期间 main 已更新，请重跑本次工作流以避免覆盖目录');
  const base = await api(`${repo}/git/commits/${localHead}`);
  const changes = [['registry/models.json', result.registry], ['registry/moderation-log.json', result.log]];
  const tree = await api(`${repo}/git/trees`, 'POST', {
    base_tree: base.tree.sha,
    tree: changes.map(([path, data]) => ({ path, mode: '100644', type: 'blob', content: JSON.stringify(data, null, 2) + '\n' })),
  });
  const branch = `review/${request.action}-${process.env.GITHUB_RUN_ID}-${process.env.GITHUB_RUN_ATTEMPT}`;
  const title = `${request.action === 'publish' ? '收录' : '撤回'} GKG ${request.expectedSha.slice(0, 12)}`;
  const commit = await api(`${repo}/git/commits`, 'POST', { message: title, tree: tree.sha, parents: [localHead] });
  await api(`${repo}/git/refs`, 'POST', { ref: `refs/heads/${branch}`, sha: commit.sha });
  const pull = await api(`${repo}/pulls`, 'POST', {
    title, head: branch, base: 'main', body: [
      `由授权管理员 @${request.actor.login} 发起，合并后才进入正式目录`,
      `包 SHA256: \`${request.expectedSha}\``,
      request.issue ? `投稿: ${request.issue.url}` : '撤回原因与原发布记录保存在 moderation-log.json',
      `审核记录: ${request.runUrl}`, '请核对作者授权、许可证、说明与附件内容；自动检查不代替这些判断',
    ].join('\n\n'),
  });
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, `\n待合并 PR: ${pull.html_url}\n`);
  // GITHUB_TOKEN 创建的 PR 不触发普通 PR 工作流，显式启动受控候选分支的构建
  await api(`${repo}/actions/workflows/check.yml/dispatches`, 'POST', { ref: branch });
}

try {
  const [command, directory = '.review'] = process.argv.slice(2);
  mkdirSync(directory, { recursive: true });
  if (command === 'prepare') {
    const request = await requestFromEvent();
    write(join(directory, 'request.json'), request);
    write(join(directory, 'policy.json'), policy);
    appendFileSync(process.env.GITHUB_OUTPUT, `action=${request.action}\n`);
    summary(request);
  } else if (command === 'download') {
    const request = read(join(directory, 'request.json'));
    await downloadPackage(request.draft.model.releases[0], policy, join(directory, 'package.gkg'));
  } else if (command === 'inspect') {
    const request = read(join(directory, 'request.json'));
    const inspection = await inspectGkg(await openAsBlob(join(directory, 'package.gkg')), { filename: request.draft.model.releases[0].technical.filename });
    write('/output/inspection.json', inspection);
  } else if (command === 'report') {
    const request = read(join(directory, 'request.json'));
    const report = read(join(directory, 'results/report.json'));
    report.policyHash = fingerprint(request.policy);
    validateReport(request, report, read(join(directory, 'results/inspection.json')));
    write(join(directory, 'results/report.json'), report);
    summary(request, report);
  } else if (command === 'propose') {
    const request = await requestFromEvent();
    const report = request.action === 'publish' ? read(join(directory, 'results/report.json')) : null;
    const inspection = request.action === 'publish' ? read(join(directory, 'results/inspection.json')) : null;
    await propose(request, report, inspection);
  } else throw new Error('未知审核子命令');
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
