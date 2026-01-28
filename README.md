# GPI 모니터링 시스템

라즈베리 파이를 이용한 센서 모니터링 및 MQTT 통신 시스템입니다.

## 하드웨어 구성

- **ADS1115 & OLED (SSD1306 I2C 72x40)**: I2C 통신 (3.3V, GND, SDA, SCL)
- **MH-Z19C (CO2)**: UART 통신 (5V, GND, TX, RX)
- **DHT22 (온습도)**: Digital GPIO (3.3V, GND, Data/GPIO4)

## 설치 방법

```bash
npm install
```

## 라즈베리 파이 UART 설정 (MH-Z19C 센서용)

MH-Z19C CO2 센서를 사용하려면 `/boot/config.txt` 파일에 다음 설정을 추가해야 합니다:

```bash
sudo nano /boot/config.txt
```

다음 라인을 추가하거나 확인:

```
enable_uart=1
dtoverlay=disable-bt
```

설정 후 재부팅:
```bash
sudo reboot
```

**설명:**
- `enable_uart=1`: UART 사용을 활성화
- `dtoverlay=disable-bt`: RPi4 내장 Bluetooth 모듈을 비활성화하여 메인 UART(ttyAMA0)를 사용자 UART로 매핑

**참고:** 라즈베리 파이 4에서는 기본적으로 UART가 Bluetooth에 할당되어 있으므로, UART를 사용하려면 Bluetooth를 비활성화해야 합니다.

## 실행 방법

```bash
npm start
# 또는
node gpi.js
```

## 주요 기능

- DHT22 온습도 센서 데이터 수집
- MH-Z19C CO2 센서 데이터 수집
- ADS1115 아날로그 센서 데이터 수집
- OLED 디스플레이에 센서값 표시
- MQTT를 통한 데이터 전송 (2개 서버 지원)
- SQLite를 이용한 설정 정보 저장
- 콘솔에 깔끔한 형식으로 데이터 출력

## 설정

설정 정보는 SQLite 데이터베이스(`config.db`)에 저장됩니다:
- 시리얼번호
- MQTT 서버1 주소
- MQTT 서버2 주소

기본값:
- 시리얼번호: `gpi26000`
- MQTT 서버1: `mqtt.hdeng.net:1883`
- MQTT 서버2: `192.168.0.100:1883`
- MQTT Topic: `gw/{시리얼번호}`

## OTA (Over-The-Air) 업데이트 (PM2)

`OTA-GUIDE.md` 및 다음 파일로 push 시 Pi에서 자동 pull·재시작이 가능합니다.

- **ota.js**: 단일 파일 OTA + (선택) HTTP 서버 (`/health`, `/ota/file`)
- **repo-updater.js**: 브랜치 HEAD 폴링 → 변경 시 `git pull` → 앱 재시작 유도
- **ecosystem.config.cjs**: PM2로 메인 앱(gpi) + ota-updater 관리

### PM2로 실행 (권장)

```bash
npm install
npm run pm2:start
# 부팅 시 자동 시작(선택):
pm2 save && pm2 startup
```

- `npm run pm2:stop`: gpi, ota-updater 정지
- `npm run pm2:restart`: 전체 재시작
- `npm run pm2:logs`: 로그 보기

`ecosystem.config.cjs`에서 `OTA_GH_OWNER`, `OTA_GH_REPO`, `OTA_GH_BRANCH`를 실제 리포에 맞게 수정하세요. 업데이트 후 재시작은 `OTA_REPO_POST_UPDATE_CMD=pm2 restart gpi`로 동작합니다.

### systemd 사용 시

`systemd/ota.service`, `systemd/ota-updater.service`를 `/etc/systemd/system/`에 복사 후 사용. 자세한 환경 변수·트러블슈팅은 `OTA-GUIDE.md` 참고.

## 파일 구조

- `gpi.js`: 메인 실행 파일
- `db.js`: SQLite 데이터베이스 관리
- `mqtt.js`: MQTT 통신 모듈
- `dht22.js`: DHT22 센서 모듈
- `mhz19c.js`: MH-Z19C 센서 모듈
- `ads1115.js`: ADS1115 센서 모듈
- `oled.js`: OLED 디스플레이 모듈
- `ota.js`: 단일 파일 OTA 모듈
- `repo-updater.js`: 전체 리포 OTA (HEAD 폴링 → pull → 재시작)
- `ecosystem.config.cjs`: PM2 앱 설정 (gpi + ota-updater)

## 주의사항

- 라즈베리 파이에서 실행해야 합니다
- I2C, UART, GPIO 권한이 필요합니다
- 일부 패키지는 네이티브 모듈이므로 라즈베리 파이에서 컴파일이 필요할 수 있습니다
- **MH-Z19C 센서 사용 시 `/boot/config.txt`에 UART 설정이 필요합니다** (위 참조)
- UART 설정 후 재부팅이 필요합니다
