import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (file) => readFileSync(path.join(root, file), 'utf8');
const html = read('public/index.html');
const app = read('public/app.js');
const css = read('public/styles.css');

test('V4 workbench overview exposes summary, queue, timeline and desktop filters', () => {
  for (const id of [
    'v3WorkbenchDigest',
    'v3WorkbenchSummaryGrid',
    'v3WorkbenchQueueList',
    'v3WorkbenchEventList',
    'v3TopicCryostatFilter',
    'v3OnlyPending',
  ]) assert.match(html, new RegExp(`id="${id}"`));
  for (const key of ['pending_eta', 'recent_arrival', 'delayed', 'testing', 'unassigned', 'submitted']) {
    assert.match(html, new RegExp(`data-v3-workbench-stat="${key}"`));
    assert.match(app, new RegExp(`(?:item\.kind === v3State\.workbenchFocus|counts\[key\]).*${key}|${key}:`));
  }
});

test('workbench reuses V3 topic resources and renders safe, actionable projections', () => {
  for (const endpoint of ['/samples', '/tasks', '/submissions', '/events']) assert.match(app, new RegExp(`topics/\\$\\{topic\.id\\}${endpoint}`));
  for (const helper of ['v3TopicHasPending', 'v3TopicHasFocus', 'v3RenderWorkbenchOverview', 'v3EventLabel']) assert.match(app, new RegExp(`function ${helper}`));
  assert.match(app, /v3Esc\(item\.topic/);
  assert.match(app, /data-v3-workbench-action/);
  assert.match(app, /function v3OpenWorkbenchAction/);
  assert.match(app, /action === "execution"/);
  assert.match(app, /action === "assignment"/);
  assert.match(app, /action === "acceptance"/);
  assert.match(app, /data-v3-open-topic/);
  assert.match(app, /v3State\.onlyPending/);
  assert.match(app, /v3State\.cryostat/);
  assert.match(app, /v3StatusMarkup\(task\.display_status\)/);
  assert.match(app, /\["pending_eta", "recent_arrival", "delayed", "testing", "unassigned", "submitted"\]/);
  assert.match(app, /event\.taskId \|\| event\.topic_task_id/);
  assert.match(app, /v3State\.activeTaskId = taskId/);
  assert.match(app, /recentCutoff = v3DaysAgoIso\(14\)/);
  assert.match(app, /futureLimit = addDays\(today, v3State\.windowDays\)/);
});

test('workbench layout constrains dense desktop content', () => {
  assert.match(css, /\.v3-workbench-summary-grid\s*\{[\s\S]*grid-template-columns:\s*repeat\(6,\s*minmax\(0,\s*1fr\)/);
  assert.match(css, /\.v3-workbench-columns\s*\{[\s\S]*minmax\(0,\s*1\.35fr\)/);
  assert.match(css, /\.v3-workbench-queue-item\s*\{[\s\S]*min-width:\s*0/);
  assert.match(css, /\.v3-workbench-table\s*\{[\s\S]*table-layout:\s*fixed/);
  assert.match(css, /\.v3-queue-kind\.is-testing\s*\{[\s\S]*background:\s*var\(--v2-testing\)/);
  assert.match(css, /@media\s*\(max-width:\s*1280px\)/);
});

test('topic planning renders a navigable topic list before a topic is selected', () => {
  assert.match(html, /id="v3TopicView"[^>]*data-v3-panel="plans"/);
  assert.match(html, /id="v3TopicList"/);
  assert.match(app, /function v3RenderTopicList/);
  assert.match(app, /v3RenderTopicList\(\);/);
  assert.match(app, /data-v3-open-topic=\"\$\{topic\.id\}\"/);
  assert.match(css, /button\.v3-topic-row\.is-active/);
});
