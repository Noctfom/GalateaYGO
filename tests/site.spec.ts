import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fixture, manifest } from './support/gkg-fixture.mjs';

test('发布表单本地读取真实包结构、拒绝非 HTTPS 地址并导出完整资料', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/zh/publish/');
  const value = manifest(5);
  const buffer = Buffer.from(await (await fixture(value, { zip64: true })).arrayBuffer());
  await page.locator('#gkg-file').setInputFiles({ name: '模型部署包.gkg', mimeType: 'application/octet-stream', buffer });
  await expect(page.locator('#package-status')).toContainText('完成');
  await expect(page.locator('#artifact-select')).toHaveValue(value.model_artifacts[0].primary);
  await page.locator('[name=name]').fill('我的测试模型');
  await page.locator('[name=slug]').fill('my-test-model');
  await page.locator('[name=summary]').fill('用于测试发布资料导出');
  await page.locator('[name=author]').fill('ExampleAuthor');
  await page.locator('[name=license]').fill('MIT');
  await page.locator('[name=downloadUrl]').fill('https://example.com/model.gkg');
  await page.locator('[name=sourceUrl]').fill('http://example.com/release');
  await page.getByRole('button', { name:'生成并保存投稿资料' }).click();
  await expect(page.locator('#form-feedback')).toContainText('HTTPS');
  await page.locator('[name=sourceUrl]').fill('https://example.com/release');
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name:'生成并保存投稿资料' }).click();
  const download = await downloadPromise;
  const draft = JSON.parse(await readFile((await download.path())!, 'utf8'));
  expect(draft.status).toBe('draft');
  expect(draft.model.author.github).toBe('https://github.com/ExampleAuthor');
  expect(draft.model.releases[0].technical.modelId).toBe(value.model_artifacts[0].model_id);
  expect(draft.model.releases[0].sha256).toBe(createHash('sha256').update(buffer).digest('hex'));
  expect(draft.model.releases[0].bcIteration).toBe(5);
  expect(draft.model.releases[0].attachments).toEqual(['decks']);
  await expect(page.locator('#form-feedback')).toContainText('尚未提交');
  await expect(page.locator('#submission-result')).toBeVisible();
  await page.locator('[name=name]').fill('修改名称');
  await expect(page.locator('#submission-result')).toBeHidden();
  await page.locator('#gkg-file').setInputFiles({ name: 'broken.gkg', mimeType: 'application/octet-stream', buffer: Buffer.from('not-a-valid-package'.repeat(4)) });
  await expect(page.locator('#package-status')).not.toContainText('读取完成');
  await expect(page.locator('#package-summary')).toBeHidden();
  await page.getByRole('button', { name:'生成并保存投稿资料' }).click();
  await expect(page.locator('#submission-result')).toBeHidden();
  expect(errors).toEqual([]);
});

test('英文发布页可读取 GKG，页面不自动连接第三方服务', async ({ page }) => {
  const external: string[] = [];
  page.on('request', request => { if (/^https?:/.test(request.url()) && !request.url().includes('127.0.0.1')) external.push(request.url()); });
  await page.goto('/en/publish/');
  const buffer = Buffer.from(await (await fixture()).arrayBuffer());
  await page.locator('#gkg-file').setInputFiles({ name: 'model.gkg', mimeType: 'application/octet-stream', buffer });
  await expect(page.locator('#package-status')).toContainText(/complete/i);
  await page.goto('/zh/models/example-general/');
  await expect(page.locator('[data-load-discussion]')).toHaveCount(0);
  expect(external).toEqual([]);
});

test('取消大包读取会清除旧报告，同一文件可重新选择', async ({ page }) => {
  await page.goto('/zh/publish/');
  const small = Buffer.from(await (await fixture()).arrayBuffer());
  await page.locator('#gkg-file').setInputFiles({ name:'small.gkg', mimeType:'application/octet-stream', buffer:small });
  await expect(page.locator('#package-status')).toContainText('完成');
  const large = Buffer.from(await (await fixture(manifest(), { extra:[['padding.bin', 'x'.repeat(48*1024*1024)]], level:0 })).arrayBuffer());
  await page.locator('#gkg-file').setInputFiles({ name:'large.gkg', mimeType:'application/octet-stream', buffer:large });
  await page.locator('#cancel-inspection').click();
  await expect(page.locator('#package-status')).toContainText('取消');
  await expect(page.locator('#package-summary')).toBeHidden();
  await expect(page.locator('#gkg-file')).toHaveValue('');
  await page.locator('#gkg-file').setInputFiles({ name:'small.gkg', mimeType:'application/octet-stream', buffer:small });
  await expect(page.locator('#package-status')).toContainText('完成');
});

test('中文首页可访问，并能切换到英文首页', async ({ page }) => {
  const response = await page.goto('/zh/');
  expect(response?.status()).toBe(200);
  await expect(page.locator('html')).toHaveAttribute('lang', 'zh-CN');
  await expect(page.locator('main h1')).toBeVisible();
  await page.getByRole('link', { name: '切换为英文' }).click();
  await expect(page).toHaveURL(/\/en\/$/);
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expect(page.getByRole('navigation', { name: 'Main navigation' })).toBeVisible();
});

test('首页展示真实卡图，社区提供项目与公开联系方式', async ({ page }) => {
  const requests: string[] = [];
  page.on('request', request => { if (request.url().includes('/cards/')) requests.push(request.url()); });
  await page.goto('/zh/');
  await expect(page.locator('.hero-card-photo img[src]')).toHaveCount(3);
  await expect(page.locator('.card-front img[src]')).toHaveAttribute('src', /\/cards\/dm\//);
  await expect(page.locator('.card-middle img[src]')).toHaveAttribute('src', /\/cards\/orcust\//);
  await page.waitForFunction(() => Array.from(document.querySelectorAll<HTMLImageElement>('.hero-card-photo img[src]')).every(image => image.complete && image.naturalWidth > 0));
  expect(requests).toHaveLength(3);
  await expect(page.locator('.ecosystem-bar a[href="https://github.com/Noctfom/Galatea-Link"]')).toBeVisible();
  await page.goto('/zh/community/');
  await expect(page.getByText('492420925', { exact: true })).toBeVisible();
  await expect(page.locator('a[href="mailto:noctfom114514@outlook.com"]')).toBeVisible();
  await expect(page.locator('.star-link')).toHaveCount(2);
});

test('模型搜索可按名称和标签过滤，并能清除无结果状态', async ({ page }) => {
  await page.goto('/zh/models/');
  const visibleCards = page.locator('[data-model-card]:visible');
  const search = page.locator('#model-search');
  await expect(visibleCards).toHaveCount(3);
  await search.fill('Galatea');
  await expect(visibleCards).toHaveCount(3);
  await search.fill('PPO');
  await expect(visibleCards).toHaveCount(2);
  await search.fill('GKG4');
  await expect(page.locator('[data-id="preview-general"]')).toBeVisible();
  await search.fill('GKG5');
  await expect(page.locator('[data-id="preview-general"]')).toBeVisible();
  await search.fill('no-match-galateaygo-12345');
  await expect(visibleCards).toHaveCount(0);
  await expect(page.locator('#no-results')).toBeVisible();
  await expect(page.locator('#model-count')).toHaveText('0');
  await page.locator('#reset-filters').click();
  await expect(visibleCards).toHaveCount(3);
  await expect(search).toHaveValue('');
  await expect(page.locator('#no-results')).toBeHidden();
});

test('分类筛选与地址栏同步，重新访问可恢复分类', async ({ page }) => {
  await page.goto('/zh/models/');
  await page.locator('[data-filter="specialist"]').click();
  await expect(page.locator('[data-model-card]:visible')).toHaveCount(1);
  await expect(page.locator('[data-model-card]:visible')).toHaveAttribute('data-category', 'specialist');
  await expect(page.locator('[data-filter="specialist"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page).toHaveURL(/category=specialist/);
  await page.reload();
  await expect(page.locator('[data-model-card]:visible')).toHaveCount(1);
  await expect(page.locator('[data-filter="specialist"]')).toHaveAttribute('aria-pressed', 'true');
});

test('收藏可筛选，刷新后仍保留模型收藏', async ({ page }) => {
  await page.goto('/zh/models/');
  const favorite = page.locator('[data-favorite="preview-general"]');
  await favorite.click();
  await expect(favorite).toHaveAttribute('aria-pressed', 'true');
  await page.locator('#saved-only').check();
  await expect(page.locator('[data-model-card]:visible')).toHaveCount(1);
  await expect(page.locator('[data-model-card]:visible')).toHaveAttribute('data-id', 'preview-general');
  await page.reload();
  await expect(favorite).toHaveAttribute('aria-pressed', 'true');
  await page.locator('#saved-only').check();
  await expect(page.locator('[data-model-card]:visible')).toHaveCount(1);
  await favorite.click();
  await expect(page.locator('[data-model-card]:visible')).toHaveCount(0);
  await expect(page.locator('#no-results')).toBeVisible();
});

test('详情页切换版本时协议、附件和下载状态随版本更新', async ({ page }) => {
  await page.goto('/zh/models/example-general/');
  const first = page.locator('[data-release-panel="0"]');
  const second = page.locator('[data-release-panel="1"]');
  await expect(first).toBeVisible();
  await expect(second).toBeHidden();
  await expect(first).toContainText('GKG 5');
  await page.locator('#release-select').selectOption('1');
  await expect(first).toBeHidden();
  await expect(second).toBeVisible();
  await expect(second).toContainText('GKG 4');
  await expect(second).toContainText('无可选附件');
  await expect(second.locator('.download-button')).toBeDisabled();
  await expect(page.locator('a.download-button')).toHaveCount(0);
});

test('详情页标签支持点击和方向键导航，版本历史可定位发布信息', async ({ page }) => {
  await page.goto('/zh/models/example-general/');
  const about = page.locator('[data-tab="about"]');
  const releases = page.locator('[data-tab="releases"]');
  await releases.click();
  await expect(releases).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('#panel-releases')).toBeVisible();
  await expect(page.locator('#panel-about')).toBeHidden();
  await releases.press('ArrowLeft');
  await expect(about).toBeFocused();
  await expect(about).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('#panel-about')).toBeVisible();
  await about.press('End');
  await expect(releases).toBeFocused();
  await expect(page.locator('#panel-releases')).toBeVisible();
  await page.locator('[data-select-release="1"]').click();
  await expect(page.locator('#release-select')).toHaveValue('1');
  await expect(page.locator('[data-release-panel="1"]')).toBeVisible();
});

test('文档中心的四篇入门文档均有可阅读的页面', async ({ page }) => {
  await page.goto('/zh/docs/');
  const links = page.locator('a.guide-card');
  await expect(links).toHaveCount(4);
  const urls = await links.evaluateAll((elements) => elements.map((element) => element.getAttribute('href')));
  for (const url of urls) {
    expect(url).toMatch(/^\/zh\/docs\//);
    const response = await page.goto(url!);
    expect(response?.status()).toBe(200);
    await expect(page.locator('main h1')).toBeVisible();
    await expect(page.locator('main')).not.toHaveText('');
  }
});

test('375 像素手机视口保留导航且主要页面没有横向溢出', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  for (const path of ['/zh/', '/zh/models/', '/zh/models/example-general/', '/zh/docs/', '/zh/publish/', '/zh/community/']) {
    await page.goto(path);
    await expect(page.getByRole('navigation', { name: '主导航' })).toBeVisible();
    await expect(page.getByRole('navigation', { name: '主导航' }).getByRole('link', { name: '模型广场' })).toBeVisible();
    const width = await page.evaluate(() => ({ content: document.documentElement.scrollWidth, viewport: window.innerWidth }));
    expect(width.content, path).toBeLessThanOrEqual(width.viewport + 1);
  }
});
