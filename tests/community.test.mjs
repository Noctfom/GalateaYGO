import assert from 'node:assert/strict';
import test from 'node:test';
import { readCommunityConfig, resolveCommunityConfig } from '../src/lib/community.ts';

test('正式部署无需环境变量即可连接社区，内嵌评论仍需完整配置', () => {
  const result = resolveCommunityConfig();
  assert.equal(result.repositoryUrl, 'https://github.com/Noctfom/GalateaYGO');
  assert.equal(result.submissionUrl, 'https://github.com/Noctfom/GalateaYGO/issues/new?template=model-submission.yml');
  assert.equal(result.discussionsUrl, 'https://github.com/Noctfom/GalateaYGO/discussions');
  assert.equal(result.discussionEnabled, false);
  assert.equal(result.giscus, null);
});

test('派生站点可覆盖仓库并明确关闭讨论', () => {
  const result = resolveCommunityConfig({
    PUBLIC_COMMUNITY_REPOSITORY: 'another-owner/community',
    PUBLIC_GITHUB_DISCUSSIONS_ENABLED: 'false',
  });
  assert.equal(result.repositoryUrl, 'https://github.com/another-owner/community');
  assert.equal(result.discussionsUrl, null);
  assert.equal(result.giscus, null);
  const disabled = resolveCommunityConfig({
    PUBLIC_COMMUNITY_REPOSITORY: '',
    PUBLIC_GITHUB_DISCUSSIONS_ENABLED: 'false',
  });
  assert.equal(disabled.submissionUrl, null);
});

const configured = {
  PUBLIC_COMMUNITY_REPOSITORY: 'sample-owner/community',
  PUBLIC_GITHUB_DISCUSSIONS_ENABLED: 'true',
  PUBLIC_GISCUS_REPO_ID: 'R_sample123',
  PUBLIC_GISCUS_CATEGORY: '模型交流 / Models',
  PUBLIC_GISCUS_CATEGORY_ID: 'DIC_sample123',
};

test('没有仓库配置时不提供投稿或评论入口', () => {
  assert.deepEqual(readCommunityConfig({}), {
    repository: null, repositoryUrl: null, submissionUrl: null,
    discussionsUrl: null, discussionEnabled: false, giscus: null,
  });
});

test('仅配置仓库即可投稿，不误报 Discussions 已开启', () => {
  const result = readCommunityConfig({ PUBLIC_COMMUNITY_REPOSITORY: '  sample-owner/community  ' });
  assert.equal(result.repository, 'sample-owner/community');
  assert.equal(result.submissionUrl, 'https://github.com/sample-owner/community/issues/new?template=model-submission.yml');
  assert.equal(result.discussionsUrl, null);
  assert.equal(result.discussionEnabled, false);
});

test('Discussions 链接与嵌入评论可分阶段启用', () => {
  const result = readCommunityConfig({ PUBLIC_COMMUNITY_REPOSITORY: 'sample-owner/community', PUBLIC_GITHUB_DISCUSSIONS_ENABLED: 'true' });
  assert.equal(result.discussionsUrl, 'https://github.com/sample-owner/community/discussions');
  assert.equal(result.discussionEnabled, false);
  assert.equal(result.giscus, null);
  const complete = readCommunityConfig(configured);
  assert.equal(complete.discussionEnabled, true);
  assert.deepEqual(complete.giscus, { repoId: 'R_sample123', category: '模型交流 / Models', categoryId: 'DIC_sample123' });
});

test('仓库配置拒绝 URL、额外路径、查询参数和路径跳转', () => {
  for (const repository of ['https://github.com/sample-owner/community', 'sample-owner/community/issues', 'sample-owner/community?x=y', 'sample-owner/..', 'sample-owner/.', '-owner/repo', 'owner-/repo', 'owner/repo#fragment', 'owner name/repo']) {
    assert.throws(() => readCommunityConfig({ PUBLIC_COMMUNITY_REPOSITORY: repository }), /PUBLIC_COMMUNITY_REPOSITORY/, repository);
  }
});

test('Discussions 开关要求明确布尔文本和有效仓库', () => {
  assert.throws(() => readCommunityConfig({ PUBLIC_GITHUB_DISCUSSIONS_ENABLED: 'true' }), /requires PUBLIC_COMMUNITY_REPOSITORY/);
  assert.throws(() => readCommunityConfig({ PUBLIC_COMMUNITY_REPOSITORY: 'a/b', PUBLIC_GITHUB_DISCUSSIONS_ENABLED: 'yes' }), /must be true or false/);
  assert.equal(readCommunityConfig({ PUBLIC_COMMUNITY_REPOSITORY: 'a/b', PUBLIC_GITHUB_DISCUSSIONS_ENABLED: 'false' }).discussionsUrl, null);
});

test('不完整或非法 giscus 配置不会产生貌似可用的评论区', () => {
  for (const field of Object.keys(configured)) {
    const partial = { ...configured };
    delete partial[field];
    assert.throws(() => readCommunityConfig(partial), /requires|giscus/, field);
  }
  for (const values of [
    { PUBLIC_GISCUS_REPO_ID: 'https://invalid.example/' },
    { PUBLIC_GISCUS_CATEGORY_ID: 'bad id' },
    { PUBLIC_GISCUS_CATEGORY: 'line\nbreak' },
    { PUBLIC_GISCUS_CATEGORY: 'x'.repeat(101) },
    { PUBLIC_GITHUB_DISCUSSIONS_ENABLED: 'false' },
  ]) assert.throws(() => readCommunityConfig({ ...configured, ...values }), /giscus/);
});
