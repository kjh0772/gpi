// 단일 파일 OTA 모듈 (OTA-GUIDE 기반)
// GitHub 특정 파일 폴링 → 앱 내 상태 갱신, (선택) HTTP 서버/상태 API

const http = require('http');

const OWNER = process.env.OTA_GH_OWNER || '';
const REPO = process.env.OTA_GH_REPO || '';
const BRANCH = process.env.OTA_GH_BRANCH || 'main';
const TOKEN = process.env.OTA_GH_TOKEN || '';
const FILE_PATH = process.env.OTA_GH_PATH || '';
const PORT = parseInt(process.env.OTA_PORT || '3000', 10);
const POLL_MS = parseInt(process.env.OTA_POLL_MS || '5000', 10);

// 변경: 단일 파일 내용 캐시
let cachedContent = null;
let cachedAt = 0;

/**
 * GitHub RAW 파일 내용 가져오기
 * @returns {Promise<string|null>}
 */
async function fetchFileContent() {
  if (!OWNER || !REPO || !FILE_PATH) {
    return null;
  }
  const pathEnc = encodeURIComponent(FILE_PATH.replace(/^\//, ''));
  const url = `https://raw.githubusercontent.com/${OWNER}/${REPO}/${BRANCH}/${pathEnc}`;
  const opts = {
    headers: { 'User-Agent': 'gpi-ota/1.0' }
  };
  if (TOKEN) {
    opts.headers.Authorization = `token ${TOKEN}`;
  }
  try {
    const res = await fetch(url, opts);
    if (!res.ok) {
      return null;
    }
    return await res.text();
  } catch (e) {
    return null;
  }
}

/**
 * 폴링 루프: 주기적으로 파일 내용 갱신
 */
async function pollLoop() {
  if (!FILE_PATH) {
    return;
  }
  const content = await fetchFileContent();
  if (content !== null) {
    cachedContent = content;
    cachedAt = Date.now();
  }
  setTimeout(pollLoop, POLL_MS);
}

/**
 * 캐시된 단일 파일 내용 반환 (앱에서 사용)
 * @returns {{ content: string|null, updatedAt: number }}
 */
function getCachedFile() {
  return { content: cachedContent, updatedAt: cachedAt };
}

/**
 * 간이 HTTP 서버 (선택): /health, /version(또는 /ota/file) 제공
 * @param {number} [port]
 * @returns {http.Server|null}
 */
function createServer(port) {
  const p = port != null ? port : PORT;
  const server = http.createServer((req, res) => {
    const u = req.url || '/';
    if (u === '/health' || u === '/health/') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, service: 'ota' }));
      return;
    }
    if (u === '/ota/file' || u === '/version') {
      const { content, updatedAt } = getCachedFile();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ content, updatedAt }));
      return;
    }
    res.writeHead(404);
    res.end('Not Found');
  });
  server.listen(p);
  return server;
}

// CLI 단독 실행 시: 폴링 시작 + HTTP 서버 기동
function main() {
  if (!OWNER || !REPO) {
    console.error('OTA: OTA_GH_OWNER, OTA_GH_REPO 필수');
    process.exit(1);
  }
  if (FILE_PATH) {
    pollLoop();
    console.log(`OTA: 단일 파일 폴링 시작 path=${FILE_PATH} pollMs=${POLL_MS}`);
  }
  const server = createServer(PORT);
  console.log(`OTA: HTTP 서버 포트 ${PORT} (예: /health, /ota/file)`);
}

if (require.main === module) {
  main();
}

module.exports = {
  fetchFileContent,
  getCachedFile,
  pollLoop,
  createServer,
  OWNER,
  REPO,
  BRANCH,
  FILE_PATH,
  PORT,
  POLL_MS
};
