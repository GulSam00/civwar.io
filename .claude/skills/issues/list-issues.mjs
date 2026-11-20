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

/** 원격 기본 브랜치 이름 (예: origin/main). origin/HEAD 가 없으면 origin/main 으로 본다 */
function defaultRemoteBranch() {
  return git(['symbolic-ref', '--quiet', '--short', 'refs/remotes/origin/HEAD']) ?? 'origin/main';
}

/** ref 에 있는데 HEAD 에 없는 커밋 수. ref 가 없거나 git 이 실패하면 0 */
function behindCount(/** @type {string} */ ref) {
  if (git(['rev-parse', '--verify', '--quiet', ref]) === null) return 0;
  return Number(git(['rev-list', '--count', `HEAD..${ref}`]) ?? '0');
}

/**
 * 뒤처짐 경고 문구들. 오프라인·git 아님이면 빈 배열 (경고 없음).
 * upstream 만 보면 작업 브랜치(upstream = 자기 자신)가 main 보다 뒤처진 것을 놓친다 —
 * 2026-11-19 다른 세션이 main 에 먼저 끝낸 이슈를 같은 이슈로 중복 작업했다. 그래서 원격 기본 브랜치와도 비교한다.
 * @returns {string[]}
 */
function behindWarnings() {
  if (git(['fetch', '--quiet', 'origin'], 4000) === null) return [];
  /** @type {string[]} */
  const warns = [];
  const upstream = git(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}']);
  if (upstream !== null) {
    const n = behindCount(upstream);
    if (n > 0) warns.push(`⚠ upstream(${upstream})보다 ${n}커밋 뒤처져 있음 — 필요하면 git pull`);
  }
  const base = defaultRemoteBranch();
  if (base !== upstream) {
    const n = behindCount(base);
    if (n > 0) warns.push(`⚠ ${base} 보다 ${n}커밋 뒤처져 있음 — 아래 목록은 이 브랜치 기준이라 낡았을 수 있음. 이슈를 맡기 전에 ${base} 의 이슈 상태를 확인하고 merge 할 것 (자동 merge 안 함)`);
  }
  return warns;
}

function main() {
  /** @type {string[]} */
  const out = [];
  out.push(...behindWarnings());

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
