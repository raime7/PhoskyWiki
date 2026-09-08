import assert from 'node:assert/strict';
import { chromium, expect } from '@playwright/test';

const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  const origin = 'http://localhost:3219';
  await page.goto(`${origin}/term/5`);
  await expect(page.getByRole('heading', { level: 1, name: '价值', exact: true })).toBeVisible();
  await expect(page.locator('.wiki-content')).toContainText('价值（政治经济学）');
  await expect(page.locator('.wiki-content')).toContainText('价值（哲学）');
  for (const path of ['/term/6', '/disambiguation/7', '/perspective/34']) {
    assert.equal((await page.request.get(origin + path)).status(), 404);
  }
  const history = await (await page.request.get(`${origin}/api/pages/33/history`)).json();
  assert.ok(history.revisions.length >= 2);
  assert.ok(history.revisions[0].content.includes('## 价值（政治经济学）'));
  assert.ok(history.revisions[0].content.includes('## 价值（哲学）'));
  const search = await (await page.request.get(`${origin}/api/search?q=${encodeURIComponent('价值')}&type=term`)).json();
  assert.ok(search.hits.some(hit => hit.pageId === 5));
  assert.ok(!search.hits.some(hit => [6, 7, 34].includes(hit.pageId)));
  const graph = await (await page.request.get(`${origin}/api/graph/site`)).json();
  assert.equal(graph.nodes.filter(node => node.title === '价值').length, 1);
  assert.ok(!graph.nodes.some(node => [6, 7, 34].includes(node.id)));
  await page.goto(`${origin}/perspective/33`);
  await expect(page.getByRole('heading', { level: 1, name: '编委会论价值', exact: true })).toBeVisible();
  const broken = [];
  const paths = await page.locator('.wiki-content a[href^="/"]').evaluateAll(nodes => [...new Set(nodes.map(n => n.getAttribute('href')))]);
  for (const path of paths) {
    const response = await page.request.get(origin + path);
    if (!response.ok()) broken.push({ path, status: response.status() });
  }
  assert.deepEqual(broken, []);
  console.log(JSON.stringify({ target: 'localhost:5432/phoskywiki', canonicalTerm: 5, canonicalPerspective: 33, bothChaptersVisible: true, oldSources404: true, retainedPerspectiveRevisions: history.revisions.length, searchCanonical: true, graphCanonical: true, checkedInternalLinks: paths.length }));
} finally { await browser.close(); }
