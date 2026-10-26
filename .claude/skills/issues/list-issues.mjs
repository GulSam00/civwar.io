// SessionStart 훅: docs/issues 의 열린 이슈(done 제외)를 한 줄씩 출력한다.
// - 어떤 에러가 나도 메시지를 출력하고 exit 0 으로 끝난다 (훅 실패가 세션 시작을 막으면 안 된다)
// - 외부 의존성 없이 node 내장 모듈만 쓴다. 타입은 JSDoc 이고 `tsc -p .claude/skills/issues/tsconfig.json` 으로 검사한다.
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/** @typedef {'doing' | 'todo' | 'later' | 'done'} Status */
/** @typedef {'high' | 'medium' | 'low'} Priority */
/** @typedef {{ id: string, title: string, status: Status, priority: Priority, created: string }} Issue */

/** @type {readonly Status[]} */
const STATUSES = ['doing', 'todo', 'later', 'done'];
/** @type {readonly Priority[]} */
const PRIORITIES = ['high', 'medium', 'low'];
const ID_PATTERN = /^\d{8}-\d{4}-[a-z0-9]+(?:-[a-z0-9]+)*$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const MAX_LINES = 30;

const projectDir = process.env.CLAUDE_PROJECT_DIR || process.cwd();
const issuesDir = join(projectDir, 'docs', 'issues');

/** @param {unknown} e */
function message(e) {
  return e instanceof Error ? e.message : String(e);
}

/**
 * frontmatter 의 `key: value` 줄만 읽는다 (중첩·배열 없음). 값은 주변 따옴표를 벗긴다.
 * @param {string} text
 * @returns {Record<string, string>}
 */
function parseFrontmatter(text) {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/);
  if (lines[0]?.trim() !== '---') throw new Error('frontmatter 시작(---)이 없음');
  const end = lines.indexOf('---', 1);
  if (end === -1) throw new Error('frontmatter 끝(---)이 없음');
  /** @type {Record<string, string>} */
  const fields = {};
  for (const line of lines.slice(1, end)) {
    if (line.trim() === '' || line.trimStart().startsWith('#')) continue;
    const m = /^([A-Za-z_][\w-]*):\s*(.*)$/.exec(line);
    if (!m) throw new Error(`해석할 수 없는 줄: ${line.trim()}`);
    fields[m[1]] = m[2].trim().replace(/^(['"])(.*)\1$/, '$2');
  }
  return fields;
}

/**
 * @param {string} file 파일명 (확장자 포함)
 * @param {string} text
 * @returns {Issue}
 */
function parseIssue(file, text) {
  const f = parseFrontmatter(text);
  const id = f.id ?? '';
  if (!ID_PATTERN.test(id)) throw new Error(`id 형식 오류 (YYYYMMDD-HHmm-kebab-slug): "${id}"`);
  if (id !== file.replace(/\.md$/, '')) throw new Error(`id 가 파일명과 다름: ${id}`);
  const title = f.title ?? '';
  if (title === '') throw new Error('title 이 비어 있음');
  const status = STATUSES.find((s) => s === f.status);
  if (!status) throw new Error(`status 는 ${STATUSES.join('|')} 중 하나여야 함: "${f.status ?? ''}"`);
  const priority = PRIORITIES.find((p) => p === f.priority);
  if (!priority) throw new Error(`priority 는 ${PRIORITIES.join('|')} 중 하나여야 함: "${f.priority ?? ''}"`);
  const created = f.created ?? '';
  if (!DATE_PATTERN.test(created)) throw new Error(`created 형식 오류 (YYYY-MM-DD): "${created}"`);
  return { id, title, status, priority, created };
}

/** @param {readonly string[]} args @returns {string | null} 실패하면 null */
function git(args, timeout = 5000) {
  try {
    return execFileSync('git', args, { cwd: projectDir, timeout, stdio: ['ignore', 'pipe', 'ignore'], encoding: 'utf8' }).trim();
  } catch {
    return null;
  }
}

/** upstream 보다 뒤처졌으면 경고 문구. 오프라인·upstream 없음·git 아님이면 null (경고 없음) */
function behindWarning() {
  if (git(['rev-parse', '--abbrev-ref', '@{u}']) === null) return null;
  if (git(['fetch', '--quiet'], 3000) === null) return null;
  const behind = Number(git(['rev-list', '--count', 'HEAD..@{u}']) ?? '0');
  return behind > 0 ? `⚠ upstream 보다 ${behind}커밋 뒤처져 있음 — 이슈 목록이 낡았을 수 있음 (자동 pull 안 함, 필요하면 git pull)` : null;
}

function main() {
  /** @type {string[]} */
  const out = [];
  const warn = behindWarning();
  if (warn) out.push(warn);

  /** @type {Issue[]} */
  const issues = [];
  /** @type {string[]} */
  const broken = [];
  if (existsSync(issuesDir)) {
    for (const file of readdirSync(issuesDir).filter((f) => f.endsWith('.md') && f !== 'README.md').sort()) {
      try {
        issues.push(parseIssue(file, readFileSync(join(issuesDir, file), 'utf8')));
      } catch (e) {
        broken.push(`${file}: ${message(e)}`);
      }
    }
  }

  const open = issues.filter((i) => i.status !== 'done');
  open.sort((a, b) => STATUSES.indexOf(a.status) - STATUSES.indexOf(b.status) || PRIORITIES.indexOf(a.priority) - PRIORITIES.indexOf(b.priority) || a.id.localeCompare(b.id));
  out.push(`열린 이슈 ${open.length}건 (done ${issues.length - open.length}건 제외)`);
  for (const i of open.slice(0, MAX_LINES)) out.push(`[${i.status}][${i.priority}] ${i.id} — ${i.title}`);
  if (open.length > MAX_LINES) out.push(`…외 ${open.length - MAX_LINES}건`);
  if (broken.length > 0) {
    out.push(`형식 오류 ${broken.length}건 (목록에서 제외됨):`);
    for (const b of broken) out.push(`  - ${b}`);
  }
  console.log(out.join('\n'));
}

try {
  main();
} catch (e) {
  console.log(`이슈 목록을 읽지 못했습니다: ${message(e)}`);
}
process.exit(0);
