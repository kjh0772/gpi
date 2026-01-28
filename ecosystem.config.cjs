// PM2 프로세스 관리 (OTA-GUIDE 연동)
// 사용: pm2 start ecosystem.config.cjs
//      pm2 save && pm2 startup  # 부팅 시 자동 시작(선택)

const path = require('path');

module.exports = {
  apps: [
    {
      name: 'gpi',
      script: 'gpi.js',
      cwd: path.join(__dirname),
      env: {
        OTA_GH_OWNER: 'kjh0772',
        OTA_GH_REPO: 'gpi',
        OTA_GH_BRANCH: 'main',
      },
      restart_delay: 3000,
      max_restarts: 10,
    },
    {
      name: 'ota-updater',
      script: 'repo-updater.js',
      cwd: path.join(__dirname),
      env: {
        OTA_GH_OWNER: 'kjh0772',
        OTA_GH_REPO: 'gpi',
        OTA_GH_BRANCH: 'main',
        OTA_REPO_POLL_MS: 5000,
        OTA_REPO_POST_UPDATE_CMD: 'pm2 restart gpi',
      },
      restart_delay: 10000,
      max_restarts: 10,
    },
  ],
};
