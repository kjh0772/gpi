# Node.js 기반 OTA 가이드 (라즈베리파이 · gpi 이식용)

이 문서는 **기존 gpi 프로젝트**(https://github.com/kjh0772/gpi.git)에 OTA(Over-The-Air) 업데이트를 붙이기 위한 가이드입니다. 

---

## 1. 개요

### 1.1 지원하는 OTA 방식

| 방식 | 용도 | 사용 스크립트 |
|------|------|----------------|
| **단일 파일 OTA** | GitHub의 특정 파일(예: 설정/버전 문자열) 내용을 폴링해 변경 시 앱 내 상태만 갱신 | `ota.js` |
| **전체 리포 OTA** | 브랜치 HEAD 커밋 변경 감지 → `git pull` → (선택) 앱 재시작 | `repo-updater.js` |

라즈베리파이에서 **코드 전체를 자동 업데이트**하려면 **전체 리포 OTA**를 사용하고, `repo-updater.js` + systemd로 “push만 하면 Pi가 pull 후 재시작”하도록 구성하는 것을 권장합니다.

### 1.2 요구사항

- Node.js 18+ (내장 `fetch` 사용, 별도 npm 패키지 불필요)
- 라즈베리파이에서 `git` 설치 및 네트워크 연결
- 대상 리포: **https://github.com/kjh0772/gpi.git**

---

## 2. gpi 프로젝트에 넣을 파일

아래 파일만 gpi 리포로 복사해 사용하면 됩니다.

| 파일 | 설명 |
|------|------|
| `ota.js` | 단일 파일 OTA + (선택) 간이 HTTP 서버/상태 API |
| `repo-updater.js` | 리포 HEAD 폴링 → `git pull` → 재시작 유도 |
| `systemd/ota.service` | 앱(또는 ota.js 서버) 실행용 systemd 유닛 |
| `systemd/ota-updater.service` | repo-updater 실행용 systemd 유닛 |

테스트/가이드 전용 파일은 이식 대상에서 제외해도 됩니다.

- 제외 권장: `ota.test.js`, `ota.txt`, `setup-pi.txt`, `OTA-GUIDE.md`(문서만 참고용으로 보관 가능)

---

## 3. 환경 변수

### 3.1 공통 (ota.js / repo-updater.js)

| 변수 | 필수 | 기본값 | 설명 |
|------|------|--------|------|
| `OTA_GH_OWNER` | ✓ | — | GitHub owner (예: `kjh0772`) |
| `OTA_GH_REPO` | ✓ | — | 리포 이름 (예: `gpi`) |
| `OTA_GH_BRANCH` | | `main` | 추적할 브랜치 |
| `OTA_GH_TOKEN` | | (없음) | Private 리포 또는 rate limit 대비 토큰 |

### 3.2 ota.js (단일 파일 OTA / 웹서버)

| 변수 | 필수 | 기본값 | 설명 |
|------|------|--------|------|
| `OTA_GH_PATH` | 단일파일 OTA 시 ✓ | — | 리포 내 파일 경로 (예: `version.txt`) |
| `OTA_PORT` | | `3000` | HTTP 서버 포트 |
| `OTA_POLL_MS` | | `5000` | GitHub 폴링 주기(ms) |

### 3.3 repo-updater.js (전체 리포 OTA)

| 변수 | 필수 | 기본값 | 설명 |
|------|------|--------|------|
| `OTA_REPO_POLL_MS` | | `OTA_POLL_MS` 또는 `5000` | 리포 HEAD 폴링 주기(ms) |
| `OTA_REPO_UPDATE_STRATEGY` | | `pull` | `pull`(ff-only) 또는 `reset`(fetch + reset --hard) |
| `OTA_REPO_EXIT_ON_UPDATE` | | `1` | `1`이면 업데이트 후 exit 42로 종료(감시자가 재시작) |
| `OTA_REPO_POST_UPDATE_CMD` | | (없음) | 업데이트 직후 실행할 명령 (예: `sudo systemctl restart ota`) |

---

## 4. 라즈베리파이 한 번 설정 (gpi 기준)

아래는 **gpi** 리포와 경로(`/home/pi/gpi`) 기준입니다. 계정/경로가 다르면 해당 값만 바꿔서 사용하세요.

### 4.1 프로젝트 클론

```bash
cd ~
git clone https://github.com/kjh0772/gpi.git
cd gpi
```

### 4.2 systemd 유닛 복사 및 경로/유저 수정

```bash
sudo cp systemd/ota.service /etc/systemd/system/
sudo cp systemd/ota-updater.service /etc/systemd/system/
```

**gpi용으로 수정할 내용:**

- `ota.service`:  
  - `WorkingDirectory=/home/pi/gpi`  
  - `User=pi` (또는 실제 실행 유저)  
  - `Environment=OTA_GH_OWNER=kjh0772`  
  - `Environment=OTA_GH_REPO=gpi`  
  - `Environment=OTA_GH_BRANCH=main`  
  - 단일 파일 OTA를 쓸 때만 `OTA_GH_PATH`, `OTA_PORT` 등 추가

- `ota-updater.service`:  
  - `WorkingDirectory=/home/pi/gpi`  
  - `User=pi`  
  - `Environment=OTA_GH_OWNER=kjh0772`  
  - `Environment=OTA_GH_REPO=gpi`  
  - `Environment=OTA_REPO_POST_UPDATE_CMD=sudo systemctl restart ota` (실제 앱 서비스명에 맞게 변경)

편집 예:

```bash
sudo nano /etc/systemd/system/ota.service
sudo nano /etc/systemd/system/ota-updater.service
```

### 4.3 재시작 명령 비밀번호 없이 허용 (한 번만)

updater가 `sudo systemctl restart ota`를 실행하려면:

```bash
sudo visudo
```

맨 아래에 한 줄 추가 (계정명이 다르면 `pi` 부분 수정):

```
pi ALL=(ALL) NOPASSWD: /bin/systemctl restart ota
```

저장 후 종료.

### 4.4 서비스 활성화 및 시작

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now ota
sudo systemctl enable --now ota-updater
```

### 4.5 동작 확인

```bash
systemctl status ota
systemctl status ota-updater
# ota.js에서 HTTP 서버를 켜 둔 경우:
curl -s http://localhost:3000/health
```

---

## 5. 운영 흐름

1. **PC(또는 개발 환경)** 에서 gpi 리포 수정 후 `git push`  
2. **라즈베리파이**의 `ota-updater` 서비스가 주기적으로 `main`(또는 설정한 브랜치) HEAD를 확인  
3. 새 커밋 감지 → `git pull`(또는 `reset`) → `OTA_REPO_POST_UPDATE_CMD` 실행(예: `sudo systemctl restart ota`)  
4. `OTA_REPO_EXIT_ON_UPDATE=1`이면 updater가 exit 42로 종료하고, systemd가 `ota-updater`를 다시 띄움  
5. `ota` 서비스가 재시작되며 새 코드로 앱이 동작  

Pi에서 수동으로 `git pull`·재시작할 필요 없이, push만 하면 반영됩니다.

---

## 6. gpi에서의 사용 패턴

### 6.1 전체 리포만 자동 업데이트 (권장)

- **실행**: `ota.service`에는 **gpi 메인 앱**만 실행 (예: `node index.js` 또는 `node app.js`)  
- **업데이트**: `ota-updater.service`가 `repo-updater.js`만 실행  
- `ota.service`의 `ExecStart`를 gpi 앱 진입점에 맞게 설정 (예: `ExecStart=/usr/bin/node index.js`)

이 경우 **ota.js는 사용하지 않아도** 됩니다. repo-updater만 있어도 “push → pull → 재시작”이 동작합니다.

### 6.2 단일 파일 OTA도 함께 사용

- 설정/버전 등 **한 파일**만 GitHub에서 가져와 앱 내에서 쓰려면 `ota.js`를 gpi 앱에 모듈로 넣거나, 별도 프로세스로 띄운 뒤 `/version` 같은 API를 호출해 사용  
- 이때 `OTA_GH_PATH`에 해당 파일 경로(예: `version.txt`)를 지정  

---

## 7. systemd 유닛 예시 (gpi용)

**`/etc/systemd/system/ota.service`** (gpi 메인 앱 실행 예시):

```ini
[Unit]
Description=GPI application (OTA)
After=network.target

[Service]
Type=simple
User=pi
WorkingDirectory=/home/pi/gpi
Environment=OTA_GH_OWNER=kjh0772
Environment=OTA_GH_REPO=gpi
Environment=OTA_GH_BRANCH=main
ExecStart=/usr/bin/node index.js
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
```

**`/etc/systemd/system/ota-updater.service`**:

```ini
[Unit]
Description=OTA repo updater (pull + restart on change)
After=network.target ota.service

[Service]
Type=simple
User=pi
WorkingDirectory=/home/pi/gpi
Environment=OTA_GH_OWNER=kjh0772
Environment=OTA_GH_REPO=gpi
Environment=OTA_GH_BRANCH=main
Environment=OTA_REPO_POLL_MS=5000
Environment=OTA_REPO_POST_UPDATE_CMD=sudo systemctl restart ota
ExecStart=/usr/bin/node repo-updater.js
Restart=on-failure
RestartSec=10

[Install]
WantedBy=multi-user.target
```

`index.js`는 gpi의 실제 진입점 파일명으로 바꿔서 사용하세요.

---

## 8. 트러블슈팅

| 현상 | 확인/조치 |
|------|-----------|
| 업데이트 후에도 예전 코드가 동작함 | `systemctl restart ota` 후 로그 확인. `WorkingDirectory`가 gpi 클론 경로인지 확인. |
| updater가 재시작을 못 함 | `visudo`에 `NOPASSWD: /bin/systemctl restart ota` 추가 여부 확인. |
| GitHub 인증/rate limit | Private 리포 또는 제한 걸리면 `OTA_GH_TOKEN` 설정. |
| pull 시 충돌 | 로컬 수정이 없다는 전제라면 `OTA_REPO_UPDATE_STRATEGY=reset`으로 시도. |

---

## 9. 참고

- 리포: **https://github.com/kjh0772/gpi.git**
- Node.js 18+ 권장 (내장 `fetch` 사용)
- 테스트용 코드·문서는 이식 시 제외하고, 위 파일과 환경변수·systemd만 gpi에 맞게 적용하면 됩니다.
