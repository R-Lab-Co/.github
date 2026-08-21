#!/usr/bin/env node
// PR → Slack notification. Zero-dependency (Node 22 global fetch).
//
// Called by .github/workflows/pr-slack.yml for three events:
//   opened    a PR was opened / reopened / marked ready for review against main
//   ci        that PR's CI run just went green for the first time
//   rereview  a green landed while the PR still reads CHANGES_REQUESTED — the
//             author has answered a review and it is back in the queue
//
// Env:
//   SLACK_WEBHOOK   Slack incoming webhook URL                  (required)
//   EVENT           opened | ci | rereview                      (required)
//   REPO            owner/name                                  (required)
//   PR_NUMBER       231                                         (required)
//   PR_TITLE        PR title                                    (required)
//   PR_URL          html_url of the PR                          (required)
//   PR_AUTHOR       GitHub login                                (required)
//   HEAD_REF        feat/vior-231-…                             (optional)
//   BASE_REF        main                                        (optional)
//   RUN_URL         link to the CI run                 (ci / rereview only)
//   JIRA_BASE_URL   https://viorant.atlassian.net               (optional)
//
// Exit 0 unless --strict is passed. A Slack hiccup must never read as a broken
// build: this workflow is decoupled from ci.yml and gates nothing.

import { pathToFileURL } from 'node:url';

const JIRA_DEFAULT_BASE = 'https://viorant.atlassian.net';
const TITLE_MAX = 240;

// The announced moments. `opened` is the fallback for an unrecognised event, so
// a future gate change degrades to an extra post rather than to silence.
const LEAD = {
  opened: '🔵 *New PR*',
  ci: '👀 *CI green — ready for review*',
  rereview: '🔄 *Changes addressed — ready for re-review*',
};

// Fallback text drives Slack's notifications and must stay plain — no mrkdwn
// links, or the notification renders the raw `<url|label>` syntax.
const FALLBACK = {
  opened: (repo, n, title) => `New PR — ${repo} #${n}: ${title}`,
  ci: (repo, n, title) => `CI green — ${repo} #${n} ready for review: ${title}`,
  rereview: (repo, n, title) => `Changes addressed — ${repo} #${n} ready for re-review: ${title}`,
};

// Both green events were triggered by a CI run, so both have one to link.
const CARRIES_RUN = new Set(['ci', 'rereview']);

// Slack parses `<url|label>` as a link and bare `&` as an entity start, so a PR
// title carrying either would break or forge the links around it.
export function escapeMrkdwn(text) {
  return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Branches are `<type>/vior-<n>-<slug>` by convention, so the key is recoverable
// even when the PR title omits it.
export function extractJiraKey(title, headRef) {
  const match = (s) => String(s || '').match(/\bVIOR-(\d+)\b/i);
  const hit = match(title) || match(headRef);
  return hit ? `VIOR-${hit[1]}` : null;
}

function truncate(text) {
  const s = String(text);
  return s.length > TITLE_MAX ? `${s.slice(0, TITLE_MAX - 1)}…` : s;
}

export function buildMessage(ctx) {
  const { event, repo, prNumber, prTitle, prUrl, author, headRef, baseRef, runUrl } = ctx;
  const shortRepo = String(repo).split('/').pop();
  const jiraBase = (ctx.jiraBaseUrl || JIRA_DEFAULT_BASE).replace(/\/$/, '');
  const jiraKey = extractJiraKey(prTitle, headRef);
  const title = escapeMrkdwn(truncate(prTitle));

  const lead = LEAD[event] ?? LEAD.opened;

  const contextParts = [`\`${escapeMrkdwn(author)}\` → \`${escapeMrkdwn(baseRef || 'main')}\``];
  if (jiraKey) contextParts.push(`<${jiraBase}/browse/${jiraKey}|${jiraKey}>`);
  if (CARRIES_RUN.has(event) && runUrl) contextParts.push(`<${runUrl}|⚙️ CI run>`);

  return {
    text: (FALLBACK[event] ?? FALLBACK.opened)(shortRepo, prNumber, truncate(prTitle)),
    blocks: [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `${lead} · \`${escapeMrkdwn(shortRepo)}\` <${prUrl}|#${prNumber}>\n${title}`,
        },
      },
      { type: 'context', elements: [{ type: 'mrkdwn', text: contextParts.join('   ·   ') }] },
    ],
  };
}

async function main() {
  const strict = process.argv.includes('--strict');
  const env = process.env;
  const warn = (msg) => {
    console.error(`::${strict ? 'error' : 'warning'}::${msg}`);
    process.exit(strict ? 1 : 0);
  };

  const required = ['SLACK_WEBHOOK', 'EVENT', 'REPO', 'PR_NUMBER', 'PR_TITLE', 'PR_URL', 'PR_AUTHOR'];
  const missing = required.filter((k) => !env[k]);
  if (missing.length) warn(`pr-slack: missing env ${missing.join(', ')} — nothing posted.`);

  const payload = buildMessage({
    event: env.EVENT,
    repo: env.REPO,
    prNumber: env.PR_NUMBER,
    prTitle: env.PR_TITLE,
    prUrl: env.PR_URL,
    author: env.PR_AUTHOR,
    headRef: env.HEAD_REF,
    baseRef: env.BASE_REF,
    runUrl: env.RUN_URL,
    jiraBaseUrl: env.JIRA_BASE_URL,
  });

  const res = await fetch(env.SLACK_WEBHOOK, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) warn(`pr-slack: Slack POST failed ${res.status} ${await res.text().catch(() => '')}`);
  console.log(`pr-slack: posted ${env.EVENT} for ${env.REPO}#${env.PR_NUMBER}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(`::warning::pr-slack: ${err.message}`);
    process.exit(process.argv.includes('--strict') ? 1 : 0);
  });
}
