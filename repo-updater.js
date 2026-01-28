// 전체 리포 OTA (OTA-GUIDE 기반)
// 브랜치 HEAD 폴링 → 변경 시 git pull(reset) → 재시작 유도

const { execSync } = require('child_process');

const OWNER = process.env.OTA_GH_OWNER || '';
const REPO = process.env.OTA_GH_REPO || '';
const BRANCH = process.env.OTA_GH_BRANCH || 'main';
const TOKEN = process.env.OTA_GH_TOKEN || '';
const POLL_MS = parseInt(
  process.env.OTA_REPO_POLL_MS || process.env.OTA_POLL_MS || '5000',
  10
);
const STRATEGY = (process.env.OTA_REPO_UPDATE_STRATEGY || 'pull').toLowerCase();
const EXIT_ON_UPDATE = process.env.OTA_REPO_EXIT_ON_UPDATE !== '0';
const POST_UPDATE_CMD = process.env.OTA_REPO_POST_UPDATE_CMD || '';

let lastSha = null;

/**
 * GitHub API로 브랜치 HEAD 커밋 SHA 조회
 * @returns {Promise<string|null>}
 */
async function fetchHeadSha() {
  const url = `https://api.github.com/repos/${OWNER}/${REPO}/git/ref/heads/${encodeURIComponent(BRANCH)}`;
  const opts = {
    headers: { 'User-Agent': 'gpi-repo-updater/1.0' }
  };
  if (TOKEN) {
    opts.headers.Authorization = `token ${TOKEN}`;
  }
  try {
    const res = await fetch(url, opts);
    if (!res.ok) {
      return null;
    }
    const data = await res.json();
    const sha = data && data.object && data.object.sha ? data.object.sha : null;
    return sha;
  } catch (e) {
    return null;
  }
}

/**
 * git pull (ff-only) 또는 fetch + reset --hard
 */
function doUpdate() {
  if (STRATEGY === 'reset') {
    execSync('git fetch origin', { stdio: 'inherit' });
    execSync(`git reset --hard origin/${BRANCH}`, { stdio: 'inherit' });
  } else {
    execSync('git pull --ff-only origin ' + BRANCH, { stdio: 'inherit' });
  }
}

/**
 * 폴링 루프
 */
async function pollLoop() {
  const sha = await fetchHeadSha();
  if (sha === null) {
    setTimeout(pollLoop, POLL_MS);
    return;
  }
  if (lastSha !== null && lastSha !== sha) {
    console.log('[repo-updater] 새 커밋 감지: ' + sha.substring(0, 7));
    try {
      doUpdate();
      console.log('[repo-updater] 업데이트 완료');
      if (POST_UPDATE_CMD) {
        console.log('[repo-updater] 실행: ' + POST_UPDATE_CMD);
        execSync(POST_UPDATE_CMD, { stdio: 'inherit', shell: true });
      }
      if (EXIT_ON_UPDATE) {
        process.exit(42);
      }
    } catch (e) {
      console.error('[repo-updater] 업데이트 실패:', e.message);
    }
  }
  lastSha = sha;
  setTimeout(pollLoop, POLL_MS);
}

function main() {
  if (!OWNER || !REPO) {
    console.error('repo-updater: OTA_GH_OWNER, OTA_GH_REPO 필수');
    process.exit(1);
  }
  console.log('[repo-updater] 시작 owner=' + OWNER + ' repo=' + REPO + ' branch=' + BRANCH + ' pollMs=' + POLL_MS);
  pollLoop();
}

main();
