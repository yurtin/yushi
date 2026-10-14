// _ref/_push-via-api.mjs
// 用 GitHub Git Data API 重放本地提交 —— 绕开「github.com 连不上、api.github.com 能连」。
//
// 为什么不是简单的"传一个提交"：那样远程会与本地分叉。
// 这里逐个重放，且**逐字节复刻 tree / parent / author / committer / message**，
// 所以算出来的 sha 应当与本地的完全相同 —— 两边历史严格一致，没有分叉。
//
// 用法：
//   node _ref/_push-via-api.mjs --dry      # 只推演，不写远程（会校验 sha 是否算得出来）
//   node _ref/_push-via-api.mjs            # 真推

import { execSync } from 'node:child_process';

const REPO  = 'yurtin/yushi';
const API   = 'https://api.github.com';
const FROM  = process.env.PUSH_FROM || '';          // 留空 = 自动取远程 main 当前所在
const TO    = process.env.PUSH_TO   || 'HEAD';      // 本地要推到哪
const BRANCH = process.env.PUSH_BRANCH || 'main';
const TAG   = process.env.PUSH_TAG  || '';          // 留空 = 不建 tag
const DRY   = process.argv.includes('--dry');

const sh = (cmd, opts = {}) => execSync(cmd, { encoding: 'utf8', maxBuffer: 1 << 28, ...opts });
const shBuf = (cmd) => execSync(cmd, { encoding: 'buffer', maxBuffer: 1 << 28 });

// ---------- token（从 Windows 凭据管理器取，不落盘）----------
const cred = sh('git credential fill', { input: 'protocol=https\nhost=github.com\n\n' });
const TOKEN = (/^password=(.+)$/m.exec(cred) || [])[1]?.trim();
if (!TOKEN) { console.error('✗ 取不到 GitHub 凭据（git credential fill 没返回 password）'); process.exit(1); }
console.log(`✓ 凭据已取到（${TOKEN.slice(0, 4)}…，长度 ${TOKEN.length}）  ${DRY ? '【推演模式】' : '【真推】'}`);

const H = {
  Authorization: `Bearer ${TOKEN}`,
  Accept: 'application/vnd.github+json',
  'User-Agent': 'dsh',
  'X-GitHub-Api-Version': '2022-11-28',
};

async function api(method, path, body) {
  const r = await fetch(API + path, {
    method,
    headers: body ? { ...H, 'Content-Type': 'application/json' } : H,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  let j = null; try { j = JSON.parse(text); } catch { /* 非 JSON */ }
  if (!r.ok) throw new Error(`${method} ${path} → HTTP ${r.status}\n${text.slice(0, 800)}`);
  return j;
}

// ---------- 解析 commit 对象 ----------
function parseCommit(sha) {
  const raw = shBuf(`git cat-file commit ${sha}`).toString('utf8');
  const i = raw.indexOf('\n\n');
  const head = raw.slice(0, i);
  const message = raw.slice(i + 2);
  const lines = head.split('\n');
  let tree = null, parents = [], author = null, committer = null, extra = [];
  for (const ln of lines) {
    if (ln.startsWith('tree ')) tree = ln.slice(5);
    else if (ln.startsWith('parent ')) parents.push(ln.slice(7));
    else if (ln.startsWith('author ')) author = ln.slice(7);
    else if (ln.startsWith('committer ')) committer = ln.slice(10);
    else extra.push(ln);
  }
  return { tree, parents, author, committer, message, extra };
}

// `Name <email> 1700000000 +0800` → {name,email,date}
function parsePerson(s) {
  const m = /^(.*) <(.*)> (\d+) ([+-]\d{4})$/.exec(s);
  if (!m) throw new Error('认不出 person: ' + s);
  const [, name, email, ts, tz] = m;
  const sign = tz[0] === '-' ? -1 : 1;
  const offMin = sign * (+tz.slice(1, 3) * 60 + +tz.slice(3, 5));
  const local = new Date((+ts + offMin * 60) * 1000).toISOString().slice(0, 19);
  return { name, email, date: local + tz.slice(0, 3) + ':' + tz.slice(3) };
}

// `-z` 下 diff-tree 是 status\0path\0 交替
function changedFiles(parent, c) {
  const out = shBuf(`git diff-tree -r --no-commit-id --name-status -z ${parent} ${c}`).toString('utf8');
  const parts = out.split('\0').filter(Boolean);
  const res = [];
  for (let k = 0; k < parts.length; k += 2) {
    res.push({ status: parts[k][0], path: parts[k + 1] });
  }
  return res;
}

function modeOf(c, path) {
  const out = shBuf(`git ls-tree -z ${c} -- ${JSON.stringify(path)}`).toString('utf8');
  const m = /^(\d{6}) blob /.exec(out);
  return m ? m[1] : '100644';
}

// ---------- 主流程 ----------
// FROM 留空时自动取远程 main 的当前 sha（本地 origin/main 可能是过期的）
let fromRef = FROM;
if (!fromRef) {
  const r = await api('GET', `/repos/${REPO}/git/ref/heads/${BRANCH}`);
  fromRef = r.object.sha;
  console.log(`· 远程 ${BRANCH} 当前 = ${fromRef.slice(0, 8)}（自动取到）`);
}
const commits = sh(`git rev-list --reverse ${fromRef}..${TO}`).trim().split('\n').filter(Boolean);
if (!commits.length) { console.log('· 没有要推的提交，已是最新。'); process.exit(0); }
console.log(`\n要重放的提交 ${commits.length} 个（从旧到新）：`);
for (const c of commits) console.log(`  ${c.slice(0, 8)}  ${parseCommit(c).message.split('\n')[0]}`);

let totalBlobs = 0, totalBytes = 0;
const shaChecks = [];

for (const c of commits) {
  const info = parseCommit(c);
  if (info.extra.length) throw new Error(`${c} 有额外 header（可能是 gpgsig），无法逐字节复刻：${info.extra.join(' | ')}`);
  const parent = info.parents[0];
  if (!parent) throw new Error(`${c} 没有 parent，不在预期内`);

  const files = changedFiles(parent, c);
  const treeList = [];
  for (const f of files) {
    if (f.status === 'D') {
      treeList.push({ path: f.path, mode: '100644', type: 'blob', sha: null });
      console.log(`    D ${f.path}`);
      continue;
    }
    const blobSha = sh(`git rev-parse ${c}:${JSON.stringify(f.path)}`).trim();
    const content = shBuf(`git cat-file blob ${blobSha}`);
    totalBytes += content.length;
    if (!DRY) {
      const r = await api('POST', `/repos/${REPO}/git/blobs`, {
        content: content.toString('base64'), encoding: 'base64',
      });
      if (r.sha !== blobSha) throw new Error(`blob 回传 sha 不符：本地 ${blobSha} / 远程 ${r.sha}`);
    }
    totalBlobs++;
    treeList.push({ path: f.path, mode: modeOf(c, f.path), type: 'blob', sha: blobSha });
    console.log(`    ${f.status} ${f.path}  (${(content.length / 1024).toFixed(0)}KB)`);
  }

  // 建树（base_tree = 父提交的树）
  let treeSha = info.tree;
  if (!DRY) {
    // ⚠️ 不要写 `git rev-parse ${parent}^{tree}`：execSync 在 Windows 走 cmd.exe，
    //    `^` 是 cmd 的转义字符，会被吃掉变成 `{tree}`。这里直接从 commit 对象里取。
    const t = await api('POST', `/repos/${REPO}/git/trees`, { base_tree: parseCommit(parent).tree, tree: treeList });
    treeSha = t.sha;
  }
  shaChecks.push({ c, expectTree: info.tree, gotTree: treeSha });

  if (!DRY) {
    const cm = await api('POST', `/repos/${REPO}/git/commits`, {
      // ⚠️ message 必须**原样**发（含结尾那个 \n）：GitHub 不会替你补，
      //    剥掉就会算出一个不同的 sha（本项目实测：8931bb77… vs 应为 4359ed08…）。
      message: info.message,
      tree: treeSha,
      parents: info.parents,
      author: parsePerson(info.author),
      committer: parsePerson(info.committer),
    });
    if (cm.sha !== c) {
      console.error(`\n✗ commit sha 不一致！本地 ${c} / 远程算出 ${cm.sha}`);
      console.error(`  tree  ${info.tree} vs ${treeSha}`);
      console.error('  说明有一处没复刻到位，已停下（远程分支还没动）。');
      process.exit(2);
    }
    console.log(`  ✓ commit ${c} 一致`);
  }
}

console.log(`\n合计：${commits.length} 个提交 / ${totalBlobs} 个 blob / ${(totalBytes / 1048576).toFixed(1)} MB`);

if (DRY) {
  console.log('\n【推演结束】没有写任何远程内容。去掉 --dry 真推。');
  process.exit(0);
}

// ---------- 更新分支 + 建 tag ----------
const head = commits[commits.length - 1];
await api('PATCH', `/repos/${REPO}/git/refs/heads/${BRANCH}`, { sha: head, force: false });
console.log(`\n✓ ${BRANCH} → ${head}`);

if (TAG) {
  try {
    await api('POST', `/repos/${REPO}/git/refs`, { ref: `refs/tags/${TAG}`, sha: head });
    console.log(`✓ tag ${TAG} → ${head}`);
  } catch (e) {
    if (/already exists/i.test(String(e.message))) console.log(`· tag ${TAG} 已存在，跳过`);
    else throw e;
  }
} else {
  console.log('· 未指定 PUSH_TAG，跳过建 tag');
}
console.log('\n完成。');
