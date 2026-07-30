import { test } from 'node:test';
import assert from 'node:assert/strict';

import { buildMessage, extractJiraKey, escapeMrkdwn } from './notify.mjs';

const base = {
  repo: 'viorant/viorant-hub',
  prNumber: '231',
  prTitle: 'Add space connector pool',
  prUrl: 'https://github.com/viorant/viorant-hub/pull/231',
  author: 'rajpal-viorant',
  headRef: 'feat/vior-231-space-connector-pool',
  baseRef: 'main',
  runUrl: 'https://github.com/viorant/viorant-hub/actions/runs/999',
};

const flat = (msg) =>
  msg.blocks
    .map((b) => (b.type === 'context' ? b.elements.map((e) => e.text).join(' ') : b.text.text))
    .join('\n');

test('extractJiraKey prefers the PR title', () => {
  assert.equal(extractJiraKey('VIOR-999: do the thing', 'feat/vior-231-x'), 'VIOR-999');
});

test('extractJiraKey falls back to the branch and upper-cases it', () => {
  assert.equal(extractJiraKey('Add space connector pool', 'feat/vior-231-space-pool'), 'VIOR-231');
});

test('extractJiraKey returns null when neither carries a key', () => {
  assert.equal(extractJiraKey('chore: bump deps', 'chore/bump-deps'), null);
});

test('extractJiraKey ignores a longer word that merely contains the pattern', () => {
  assert.equal(extractJiraKey('REVIOR-12 nope', 'chore/none'), null);
});

test('opened message names the repo, PR, author and Jira key', () => {
  const text = flat(buildMessage({ ...base, event: 'opened' }));
  assert.match(text, /New PR/);
  assert.match(text, /viorant-hub/);
  assert.match(text, /<https:\/\/github\.com\/viorant\/viorant-hub\/pull\/231\|#231>/);
  assert.match(text, /Add space connector pool/);
  assert.match(text, /rajpal-viorant/);
  assert.match(text, /<https:\/\/viorant\.atlassian\.net\/browse\/VIOR-231\|VIOR-231>/);
});

test('opened message omits the CI run link', () => {
  assert.doesNotMatch(flat(buildMessage({ ...base, event: 'opened' })), /CI run/);
});

test('ci message says ready for review and links the run', () => {
  const text = flat(buildMessage({ ...base, event: 'ci' }));
  assert.match(text, /ready for review/);
  assert.match(text, /<https:\/\/github\.com\/viorant\/viorant-hub\/actions\/runs\/999\|.*CI run>/);
});

test('a missing Jira key drops the link rather than emitting a broken one', () => {
  const text = flat(buildMessage({ ...base, event: 'ci', prTitle: 'bump deps', headRef: 'chore/bump' }));
  assert.doesNotMatch(text, /atlassian/);
  assert.doesNotMatch(text, /VIOR-/);
});

test('a missing run URL drops the run link rather than emitting a broken one', () => {
  const text = flat(buildMessage({ ...base, event: 'ci', runUrl: '' }));
  assert.doesNotMatch(text, /CI run/);
  assert.match(text, /ready for review/);
});

// A PR title is attacker-adjacent input: Slack parses <...|...> as a link and
// bare & as an entity, so an unescaped title can break or forge the links
// around it.
test('escapeMrkdwn neutralises Slack link syntax in titles', () => {
  assert.equal(escapeMrkdwn('A & B <https://evil|click>'), 'A &amp; B &lt;https://evil|click&gt;');
});

test('buildMessage escapes the PR title', () => {
  const text = flat(buildMessage({ ...base, event: 'opened', prTitle: 'fix <a|b> & c' }));
  assert.match(text, /fix &lt;a\|b&gt; &amp; c/);
});

test('buildMessage truncates an absurdly long title', () => {
  const msg = buildMessage({ ...base, event: 'opened', prTitle: 'x'.repeat(500) });
  assert.ok(msg.blocks[0].text.text.length < 400);
  assert.match(msg.blocks[0].text.text, /…/);
});

test('the fallback text is plain and non-empty for both events', () => {
  for (const event of ['opened', 'ci']) {
    const { text } = buildMessage({ ...base, event });
    assert.ok(text.length > 0);
    assert.doesNotMatch(text, /[<>]/);
  }
});
