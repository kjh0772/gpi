// 전체 리포 OTA (OTA-GUIDE 기반)
// 브랜치 HEAD 폴링 → 변경 시 git pull(reset) → 재시작 유도

const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

// 변경: Pi 부팅 시 .bashrc 미적용 → 프로젝트 루트 .env.ota에서 토큰 로드 (gitignore됨)
const envOtaPath = path.join(__dirname, '.env.ota');
if (fs.existsSync(envOtaPath) && !process.env.OTA_GH_TOKEN) {
  try {
    const content = fs.readFileSync(envOtaPath, 'utf8');
    const m = content.match(/OTA_GH_TOKEN\s*=\s*(\S+)/);
    if (m && m[1]) process.env.OTA_GH_TOKEN = m[1].trim();
  } catch (e) {}
}

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

/** Pi 등에서 pm2가 PATH에 없을 수 있음 → 절대경로로 실행할 명령 반환 */
function resolvePostUpdateCmd() {
  if (!POST_UPDATE_CMD || !POST_UPDATE_CMD.trim().startsWith('pm2 ')) {
    return POST_UPDATE_CMD;
  }
  const pathEnv = process.env.PATH || '';
  const nodeDir = path.dirname(process.execPath);
  const safePath = nodeDir + ':/usr/local/bin:/usr/bin:/bin' + (pathEnv ? ':' + pathEnv : '');
  try {
    const out = execSync('which pm2', { encoding: 'utf8', env: { ...process.env, PATH: safePath } });
    const pm2Path = (out && out.trim()) || '';
    if (pm2Path) {
      return pm2Path + ' ' + POST_UPDATE_CMD.trim().slice(4);
    }
  } catch (e) {}
  // 변경: which 실패 시 Node와 같은 bin 디렉터리의 pm2 사용 (npm -g 설치 시)
  const pm2NextToNode = path.join(nodeDir, 'pm2');
  if (fs.existsSync(pm2NextToNode)) {
    return pm2NextToNode + ' ' + POST_UPDATE_CMD.trim().slice(4);
  }
  if (fs.existsSync('/usr/local/bin/pm2')) {
    return '/usr/local/bin/pm2 ' + POST_UPDATE_CMD.trim().slice(4);
  }
  return POST_UPDATE_CMD;
}

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
      console.error('[repo-updater] 원격 HEAD 조회 실패 HTTP', res.status, res.statusText);
      return null;
    }
    const data = await res.json();
    const sha = data && data.object && data.object.sha ? data.object.sha : null;
    return sha;
  } catch (e) {
    console.error('[repo-updater] 원격 HEAD 조회 실패:', e.message);
    return null;
  }
}

/**
 * 로컬 HEAD 커밋 SHA 조회 (동기)
 * @returns {string|null}
 */
function getLocalHeadSha() {
  try {
    const out = execSync('git rev-parse HEAD', { encoding: 'utf8' });
    return (out && out.trim()) || null;
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
 * 변경: 첫 기동 시에도 로컬 HEAD와 원격 비교 → 뒤처져 있으면 바로 pull
 */
async function pollLoop() {
  const sha = await fetchHeadSha();
  if (sha === null) {
    setTimeout(pollLoop, POLL_MS);
    return;
  }
  const needUpdate = lastSha !== null
    ? lastSha !== sha
    : (() => {
        const local = getLocalHeadSha();
        // 변경: 진단용 로그 (첫 폴링 시 원격/로컬 비교)
        console.log('[repo-updater] 원격 HEAD:', sha.substring(0, 7), '로컬 HEAD:', local ? local.substring(0, 7) : '?');
        return local !== null && local !== sha;
      })();
  if (needUpdate) {
    console.log('[repo-updater] 새 커밋 감지: ' + sha.substring(0, 7));
    try {
      doUpdate();
      console.log('[repo-updater] 업데이트 완료');
      if (POST_UPDATE_CMD) {
        const cmd = resolvePostUpdateCmd();
        console.log('[repo-updater] 실행: ' + cmd);
        // 변경: cwd를 프로젝트 루트로 고정, PATH 보강
        const pathEnv = process.env.PATH || '';
        const nodeDir = path.dirname(process.execPath);
        const safePath = nodeDir + ':/usr/local/bin:/usr/bin:/bin' + (pathEnv ? ':' + pathEnv : '');
        execSync(cmd, {
          stdio: 'inherit',
          shell: true,
          cwd: __dirname,
          env: { ...process.env, PATH: safePath },
        });
        console.log('[repo-updater] 재시작 명령 완료');
      }
      if (EXIT_ON_UPDATE) {
        process.exit(42);
      }
    } catch (e) {
      console.error('[repo-updater] 업데이트 실패:', e.message);
      if (e.stderr) console.error('[repo-updater] stderr:', String(e.stderr).trim());
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
