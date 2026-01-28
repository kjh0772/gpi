// 메인 실행 파일 - 라즈베리 파이 센서 모니터링 시스템
const ConfigDB = require('./db');
const MQTTManager = require('./mqtt');
const DHT22Sensor = require('./dht22');
const MHZ19CSensor = require('./mhz19c');
const ADS1115Sensor = require('./ads1115');
// 변경: oled-i2c-bus 기반 OLED 대시보드 사용
const OLEDDisplay = require('./oled_i2c_dashboard');
// 변경: 콘솔 로그 모듈 분리
const ConsoleLogger = require('./consoleLogger');
// 변경: 로컬 웹 대시보드(HTML) 제공
const WebServer = require('./webServer');
// 변경: 버전 정보 모듈 추가
const version = require('./version');
const os = require('os');
const fs = require('fs'); // 변경: CPU 온도 읽기용
const { execSync } = require('child_process'); // 변경: WiFi RSSI 읽기용

class GPIMonitor {
  constructor() {
    this.db = null;
    this.mqtt = null;
    this.dht22 = null;
    this.mhz19c = null;
    this.ads1115 = null;
    this.oled = null;
    // 변경: 콘솔 로거 인스턴스 추가
    this.consoleLogger = new ConsoleLogger();
    // 변경: 웹 서버 + 최신 센서 데이터 저장
    this.webServer = null;
    this.lastSensorData = null;
    this.config = null;
    this.serialNumber = 'gpi26000'; // 기본 시리얼 번호
    this.intervalId = null;
    this.readInterval = 1000; // 변경: 2초마다 읽기
    this.consoleInterval = 2000; // 콘솔 출력 주기 (10초)
    this.lastConsoleTime = 0; // 마지막 콘솔 출력 시간

    // 변경: OTA/버전 정보 상태 (웹 대시보드 표시용)
    this.otaInfo = null;
    this.appStartedAt = null;

    // 변경: 일 적산온도(GDD) 누적용 상태 (MQTT 포맷은 수정하지 않음)
    this.gddBaseTemp = 10.0; // 변경: 기준온도(작물별 조정 가능)
    this.gddDayKey = null; // YYYY-MM-DD
    this.gddDaily = 0; // °C·day
    this.gddLastUpdateMs = 0;

    // 변경: CPU 사용률 계산용 상태 (/proc/stat)
    this._cpuStatPrevTotal = null;
    this._cpuStatPrevIdle = null;
  }

  // 변경: 시리얼번호를 DB에 저장하고 런타임 값도 갱신 (웹에서 호출)
  setSerialNumber(serialNumber) {
    try {
      const sn = typeof serialNumber === 'string' ? serialNumber.trim() : '';
      if (!sn) return { ok: false, message: '시리얼번호가 비어있습니다.' };
      if (sn.length > 32) return { ok: false, message: '시리얼번호가 너무 깁니다(최대 32자).' };

      // 현재 설정이 없으면 기본값으로 생성 후 업데이트
      if (!this.config) this.config = this.db ? this.db.getConfig() : null;
      const mqtt1 = this.config ? this.config.mqtt_server1 : 'mqtt.hdeng.net:1883';
      const mqtt2 = this.config ? this.config.mqtt_server2 : '192.168.0.100:1883';

      // 변경: SQLite에 저장 (updated_at 갱신)
      if (this.db) this.db.saveConfig(sn, mqtt1, mqtt2);

      // 변경: 런타임 값 갱신 (웹/콘솔 표시용)
      this.serialNumber = sn;
      if (this.config) this.config.serial_number = sn;

      // 변경: MQTT 자동 재시작(토픽 반영)
      // - topic은 gw/{serialNumber} 이므로, 시리얼 변경 시 재연결 필요
      try {
        if (this.mqtt) {
          this.mqtt.disconnect();
        }
        const topic = `gw/${this.serialNumber}`;
        this.mqtt = new MQTTManager(mqtt1, mqtt2, topic);
        this.mqtt.connect();
      } catch (e) {
        return { ok: true, message: `저장됨(단, MQTT 재시작 실패: ${e.message})` };
      }

      return { ok: true, message: '저장되었습니다. MQTT도 자동으로 재시작했습니다.' };
    } catch (e) {
      return { ok: false, message: `저장 실패: ${e.message}` };
    }
  }

  // 변경: 서울 시간대(Asia/Seoul)로 변환하는 헬퍼 함수
  getSeoulTimeISOString() {
    const now = new Date();
    // 서울 시간대의 각 부분을 추출
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: 'Asia/Seoul',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false
    });
    
    const parts = formatter.formatToParts(now);
    const year = parts.find(p => p.type === 'year').value;
    const month = parts.find(p => p.type === 'month').value;
    const day = parts.find(p => p.type === 'day').value;
    let hour = parseInt(parts.find(p => p.type === 'hour').value, 10);
    const minute = parts.find(p => p.type === 'minute').value;
    const second = parts.find(p => p.type === 'second').value;
    // 변경: hour가 24 이상이면 0으로 변환
    if (hour >= 24) {
      hour = 0;
    }
    const hourStr = String(hour).padStart(2, '0');
    // 밀리초는 UTC 기준으로 계산 (서울 시간대와 밀리초는 동일)
    const milliseconds = String(now.getMilliseconds()).padStart(3, '0');
    
    return `${year}-${month}-${day}T${hourStr}:${minute}:${second}.${milliseconds}+09:00`;
  }

  // 변경: 서울 시간대로 YYYY-MM-DD HH:mm:ss 형식 변환
  getSeoulTimeString() {
    const now = new Date();
    // 변경: toLocaleString을 사용하여 서울 시간대 문자열 생성 후 파싱
    const seoulTimeStr = now.toLocaleString('en-US', {
      timeZone: 'Asia/Seoul',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false
    });
    
    // 변경: "MM/DD/YYYY, HH:mm:ss" 형식을 "YYYY-MM-DD HH:mm:ss"로 변환
    // 예: "01/21/2026, 00:22:32" -> "2026-01-21 00:22:32"
    const match = seoulTimeStr.match(/(\d+)\/(\d+)\/(\d+),\s+(\d+):(\d+):(\d+)/);
    if (match) {
      const [, month, day, year, hour, minute, second] = match;
      // 변경: hour가 24 이상이면 0으로 변환 (안전장치)
      let hourNum = parseInt(hour, 10);
      if (hourNum >= 24) {
        hourNum = 0;
      }
      const hourStr = String(hourNum).padStart(2, '0');
      return `${year}-${month}-${day} ${hourStr}:${minute}:${second}`;
    }
    
    // 변경: 파싱 실패 시 대체 방법 (직접 계산)
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: 'Asia/Seoul',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false
    });
    
    const parts = formatter.formatToParts(now);
    const year = parts.find(p => p.type === 'year').value;
    const month = parts.find(p => p.type === 'month').value;
    const day = parts.find(p => p.type === 'day').value;
    let hour = parseInt(parts.find(p => p.type === 'hour').value, 10);
    // 변경: hour가 24 이상이면 0으로 변환
    if (hour >= 24) {
      hour = 0;
    }
    const hourStr = String(hour).padStart(2, '0');
    const minute = parts.find(p => p.type === 'minute').value;
    const second = parts.find(p => p.type === 'second').value;
    
    return `${year}-${month}-${day} ${hourStr}:${minute}:${second}`;
  }

  // IP 주소 가져오기
  getLocalIP() {
    const interfaces = os.networkInterfaces();
    for (const name of Object.keys(interfaces)) {
      for (const iface of interfaces[name]) {
        if (iface.family === 'IPv4' && !iface.internal) {
          return iface.address;
        }
      }
    }
    return '127.0.0.1';
  }

  // 변경: CPU 온도(섭씨) 읽기 (/sys/class/thermal/thermal_zone0/temp)
  getCpuTemp() {
    try {
      const raw = fs.readFileSync('/sys/class/thermal/thermal_zone0/temp', 'utf8').trim();
      const milli = parseInt(raw, 10);
      if (Number.isFinite(milli)) return parseFloat((milli / 1000).toFixed(1));
      return null;
    } catch (e) {
      return null;
    }
  }

  // 변경: CPU 사용률(%) 읽기 (Linux: /proc/stat 기반, 0~100)
  getCpuUsagePercent() {
    try {
      const raw = fs.readFileSync('/proc/stat', 'utf8');
      const firstLine = raw.split('\n')[0]; // cpu  user nice system idle iowait irq softirq steal guest guest_nice
      if (!firstLine || !firstLine.startsWith('cpu ')) return null;

      const parts = firstLine.trim().split(/\s+/).slice(1).map((v) => parseInt(v, 10));
      if (parts.length < 4) return null;

      const idle = (parts[3] || 0) + (parts[4] || 0); // idle + iowait
      const total = parts.reduce((a, b) => a + (Number.isFinite(b) ? b : 0), 0);

      if (this._cpuStatPrevTotal === null || this._cpuStatPrevIdle === null) {
        // 첫 호출은 기준값만 저장 (다음 루프부터 계산)
        this._cpuStatPrevTotal = total;
        this._cpuStatPrevIdle = idle;
        return null;
      }

      const deltaTotal = total - this._cpuStatPrevTotal;
      const deltaIdle = idle - this._cpuStatPrevIdle;

      this._cpuStatPrevTotal = total;
      this._cpuStatPrevIdle = idle;

      if (deltaTotal <= 0) return null;
      const usage = (1 - deltaIdle / deltaTotal) * 100;
      const clamped = Math.max(0, Math.min(100, usage));
      return parseFloat(clamped.toFixed(1));
    } catch (e) {
      return null;
    }
  }

  // 변경: RAM 사용률(%) 읽기 (0~100)
  getRamUsagePercent() {
    try {
      const total = os.totalmem();
      const free = os.freemem();
      if (!Number.isFinite(total) || total <= 0) return null;
      const used = total - free;
      const pct = (used / total) * 100;
      const clamped = Math.max(0, Math.min(100, pct));
      return parseFloat(clamped.toFixed(1));
    } catch (e) {
      return null;
    }
  }

  // 변경: 포화수증기압(SVP, kPa) 계산
  calcSVP_kPa(tempC) {
    if (tempC == null || !Number.isFinite(tempC)) return null;
    // SVP (kPa) = 0.611 * exp((17.27*T)/(T+237.3))
    return 0.611 * Math.exp((17.27 * tempC) / (tempC + 237.3));
  }

  // 변경: VPD(kPa) 계산 (T: °C, RH: %)
  calcVPD_kPa(tempC, rhPercent) {
    if (tempC == null || rhPercent == null) return null;
    if (!Number.isFinite(tempC) || !Number.isFinite(rhPercent)) return null;
    const rh = Math.min(100, Math.max(0, rhPercent));
    const svp = this.calcSVP_kPa(tempC);
    if (svp == null) return null;
    return svp * (1 - rh / 100);
  }

  // 변경: 이론 습구온도(Stull 근사식, °C)
  // 참고: T(°C), RH(%) 입력
  calcWetBulb_Stull(tempC, rhPercent) {
    if (tempC == null || rhPercent == null) return null;
    if (!Number.isFinite(tempC) || !Number.isFinite(rhPercent)) return null;
    const RH = Math.min(100, Math.max(0, rhPercent));
    const T = tempC;

    // Stull (2011) approximation
    const Tw =
      T * Math.atan(0.151977 * Math.pow(RH + 8.313659, 0.5)) +
      Math.atan(T + RH) -
      Math.atan(RH - 1.676331) +
      0.00391838 * Math.pow(RH, 1.5) * Math.atan(0.023101 * RH) -
      4.686035;

    return Number.isFinite(Tw) ? parseFloat(Tw.toFixed(1)) : null;
  }

  // 변경: WiFi RSSI(dBm) 읽기 (iwconfig wlan0 기반)
  getWifiRssi() {
    try {
      const out = execSync('iwconfig wlan0 2>/dev/null', { timeout: 800 }).toString();
      // 예: "Signal level=-57 dBm" 또는 "Signal level=-57/70"
      const m = out.match(/Signal level[=|:]\s*(-?\d+)\s*dBm/i);
      if (m && m[1]) return parseInt(m[1], 10);

      // fallback: -57/70 형태 처리
      const m2 = out.match(/Signal level[=|:]\s*(-?\d+)\s*\/\s*\d+/i);
      if (m2 && m2[1]) return parseInt(m2[1], 10);

      return null;
    } catch (e) {
      return null;
    }
  }

  // 변경: Daily GDD(일 적산온도) 업데이트 (°C·day)
  updateDailyGdd(tempC) {
    const now = Date.now();
    const dayKey = new Date().toISOString().split('T')[0]; // UTC 기준이지만 운영상 간단 적용

    // 날짜가 바뀌면 리셋
    if (this.gddDayKey !== dayKey) {
      this.gddDayKey = dayKey;
      this.gddDaily = 0;
      this.gddLastUpdateMs = now;
      return this.gddDaily;
    }

    if (!Number.isFinite(tempC)) {
      this.gddLastUpdateMs = now;
      return this.gddDaily;
    }

    // 누적 간격(시간) 계산
    const last = this.gddLastUpdateMs || now;
    const deltaHours = Math.max(0, (now - last) / (1000 * 60 * 60));
    this.gddLastUpdateMs = now;

    // (T - base) 가 양수인 부분만 누적 (°C·hour) -> /24 => °C·day
    const inc = Math.max(0, tempC - this.gddBaseTemp) * (deltaHours / 24);
    this.gddDaily = parseFloat((this.gddDaily + inc).toFixed(3));
    return this.gddDaily;
  }

  // 초기화
  async initialize() {
    console.log('=== GPI 모니터링 시스템 초기화 ===\n');

    // 변경: OTA/버전 정보(마지막 커밋 정보) 캐시
    try {
      const out = execSync('git log -1 --pretty=format:"%h%n%s%n%ci"', {
        encoding: 'utf8',
      }).split('\n');
      const [sha, subject, date] = out;
      this.appStartedAt = this.getSeoulTimeISOString();
      this.otaInfo = {
        version: version.gpi_sv,
        commit: sha || null,
        message: subject || null,
        committedAt: date || null,
        appStartedAt: this.appStartedAt,
      };
    } catch (e) {
      this.appStartedAt = this.getSeoulTimeISOString();
      this.otaInfo = {
        version: version.gpi_sv,
        commit: null,
        message: null,
        committedAt: null,
        appStartedAt: this.appStartedAt,
      };
    }

    // 데이터베이스 초기화
    this.db = new ConfigDB();
    
    // 설정 정보 로드 또는 기본값 설정
    this.config = this.db.getConfig();
    if (!this.config) {
      // 기본 설정 저장
      this.db.saveConfig(
        this.serialNumber,
        'mqtt.hdeng.net:1883',
        '192.168.0.100:1883'
      );
      this.config = this.db.getConfig();
    } else {
      this.serialNumber = this.config.serial_number;
    }

    // MQTT 초기화
    const topic = `gw/${this.serialNumber}`;
    this.mqtt = new MQTTManager(
      this.config.mqtt_server1,
      this.config.mqtt_server2,
      topic
    );
    this.mqtt.connect();

    // 센서 초기화
    this.dht22 = new DHT22Sensor(4); // GPIO4
    await this.dht22.initialize();

    // 변경: 여러 시리얼 포트 경로 시도
    const possiblePorts = ['/dev/ttyAMA0', '/dev/serial0', '/dev/ttyS0'];
    this.mhz19c = null;
    
    for (const port of possiblePorts) {
      try {
        console.log(`[MH-Z19C] 시리얼 포트 시도: ${port}`);
        this.mhz19c = new MHZ19CSensor(port, 9600);
        await this.mhz19c.initialize();
        console.log(`[MH-Z19C] 초기화 성공: ${port}`);
        break; // 성공하면 루프 종료
      } catch (error) {
        console.warn(`[MH-Z19C] ${port} 초기화 실패:`, error.message);
        if (this.mhz19c) {
          try {
            this.mhz19c.close();
          } catch (e) {}
          this.mhz19c = null;
        }
      }
    }
    
    if (!this.mhz19c) {
      console.warn('[MH-Z19C] 모든 시리얼 포트 초기화 실패 (계속 진행)');
    }

    this.ads1115 = new ADS1115Sensor(0x48, 1);
    await this.ads1115.initialize();

    // OLED 초기화 (0.91인치 SSD1306 I2C 128x32) // 변경: oled-i2c-bus 방식 적용
    this.oled = new OLEDDisplay({ address: 0x3C, bus: 1, width: 128, height: 32 });
    await this.oled.initialize();
    await this.oled.displayMessage('Initializing...');

    // 변경: 웹 서버 시작 (http://로컬IP:3000)
    this.webServer = new WebServer({
      port: 3000,
      host: '0.0.0.0',
      getData: () => this.lastSensorData,
      // 변경: 설정/시리얼번호 API 제공
      getConfig: () => (this.db ? this.db.getConfig() : null),
      setSerialNumber: (sn) => this.setSerialNumber(sn),
      // 변경: MQTT 연결 상태 제공
      getMqttStatus: () => (this.mqtt ? this.mqtt.getConnectionStatus() : []),
    });
    this.webServer.start();
    console.log(`[WEB] 대시보드: http://${this.getLocalIP()}:3000`);

    console.log('\n=== 초기화 완료 ===\n');
  }

  // 센서 데이터 읽기
  async readSensors() {
    const sensorData = {
      // 변경: 서울 시간대로 타임스탬프 생성
      timestamp: this.getSeoulTimeISOString(),
      serialNumber: this.serialNumber,
      ipAddress: this.getLocalIP(),
      // 변경: 버전 정보 추가
      gpi_hv: version.gpi_hv,
      gpi_sv: version.gpi_sv,
      // 변경: OTA/업데이트 정보 추가
      ota: this.otaInfo,
    };

    // 변경: CPU 온도 추가
    sensorData.cpuTemp = this.getCpuTemp();
    // 변경: CPU/RAM 사용률 추가
    sensorData.cpuUsage = this.getCpuUsagePercent();
    sensorData.ramUsage = this.getRamUsagePercent();

    // 변경: WiFi RSSI 추가 (dBm)
    sensorData.wifiRssi = this.getWifiRssi();

    // DHT22 읽기
    const dhtData = this.dht22.read();
    sensorData.temperature = dhtData.temperature;
    sensorData.humidity = dhtData.humidity;
    sensorData.dewpoint = dhtData.dewpoint;
    sensorData.hd = dhtData.hd;
    sensorData.gap = dhtData.gap;

    // 변경: VPD 계산 (Air/Leaf) + 이론 습구 + Daily GDD
    sensorData.airVpd = this.calcVPD_kPa(sensorData.temperature, sensorData.humidity);
    // Leaf_VPD: 과일(A2)을 엽온 대용으로 (온도 없으면 null)
    // fruitTemp는 ADS1115 읽기 이후에 채워지므로, 아래 ADS1115 처리 뒤에 다시 한 번 계산합니다.
    sensorData.leafVpd = null;
    sensorData.calcWetBulb = this.calcWetBulb_Stull(sensorData.temperature, sensorData.humidity);
    sensorData.dailyGdd = this.updateDailyGdd(sensorData.temperature);

    // MH-Z19C 읽기
    try {
      if (this.mhz19c && this.mhz19c.serialPort && this.mhz19c.serialPort.isOpen) {
        const co2Data = await this.mhz19c.read();
        sensorData.co2 = co2Data.success ? co2Data.co2 : null;
        // 변경: 읽기 실패 로그 제거 (너무 많은 로그 방지, 첫 번째 실패만 출력)
        // if (!co2Data.success && co2Data.error && sensorData.co2 === null) {
        //   console.warn(`[MH-Z19C] 읽기 실패: ${co2Data.error}`);
        // }
      } else {
        sensorData.co2 = null;
        // 변경: 시리얼 포트 미열림 로그 제거
        // console.warn('[MH-Z19C] 시리얼 포트가 열려있지 않습니다');
      }
    } catch (error) {
      sensorData.co2 = null;
      // 변경: 읽기 오류 로그 제거
      // console.error('[MH-Z19C] 읽기 오류:', error.message);
    }

    // ADS1115 읽기 (모든 채널 A0~A3)
    // 변경: A0=건구, A1=습구, A2=과일, A3=토양
    // 변경: 온도값 사용 (NTC 센서 변환값)
    try {
      const adsData = await this.ads1115.readAllChannels();
      
      // 온도값 우선 사용, 없으면 전압값 사용
      // 온도값이 있으면 온도로, 없으면 전압값으로 저장
      sensorData.dryBulb = adsData.channel0.temperature !== null 
        ? adsData.channel0.temperature 
        : adsData.channel0.voltage;      // A0: 건구
      sensorData.wetBulb = adsData.channel1.temperature !== null 
        ? adsData.channel1.temperature 
        : adsData.channel1.voltage;      // A1: 습구
      sensorData.fruit = adsData.channel2.temperature !== null 
        ? adsData.channel2.temperature 
        : adsData.channel2.voltage;       // A2: 과일
      sensorData.soil = adsData.channel3.temperature !== null 
        ? adsData.channel3.temperature 
        : adsData.channel3.voltage;        // A3: 토양
      
      // 전압값 저장 (로그 출력용)
      sensorData.dryBulbVoltage = adsData.channel0.voltage;
      sensorData.wetBulbVoltage = adsData.channel1.voltage;
      sensorData.fruitVoltage = adsData.channel2.voltage;
      sensorData.soilVoltage = adsData.channel3.voltage;
      
      // 온도값 저장 (로그 출력용)
      sensorData.dryBulbTemp = adsData.channel0.temperature;
      sensorData.wetBulbTemp = adsData.channel1.temperature;
      sensorData.fruitTemp = adsData.channel2.temperature;
      sensorData.soilTemp = adsData.channel3.temperature;

      // 변경: 기준전압(3.3V)에 근접하면 0값으로 대체 (오픈/단선 등 비정상 구간 보호)
      // - 전압이 높게 붙으면 NTC 계산이 음수로 튀는 현상 방지
      const OPEN_CIRCUIT_VOLTAGE_THRESHOLD = 3.25; // 변경: 3.30V 근접 구간 (필요시 3.28 등으로 조정)
      const normalizeNearVcc = (voltage) =>
        voltage !== null && voltage !== undefined && voltage >= OPEN_CIRCUIT_VOLTAGE_THRESHOLD;

      if (normalizeNearVcc(sensorData.dryBulbVoltage)) {
        sensorData.dryBulbVoltage = 0;
        sensorData.dryBulbTemp = null;
      }
      if (normalizeNearVcc(sensorData.wetBulbVoltage)) {
        sensorData.wetBulbVoltage = 0;
        sensorData.wetBulbTemp = null;
      }
      if (normalizeNearVcc(sensorData.fruitVoltage)) {
        sensorData.fruitVoltage = 0;
        sensorData.fruitTemp = null;
      }
      if (normalizeNearVcc(sensorData.soilVoltage)) {
        sensorData.soilVoltage = 0;
        sensorData.soilTemp = null;
      }

      // 변경: 위 정규화 결과를 반영해 대표값도 재계산 (MQTT/결로점 등 영향)
      sensorData.dryBulb = sensorData.dryBulbTemp !== null ? sensorData.dryBulbTemp : sensorData.dryBulbVoltage;
      sensorData.wetBulb = sensorData.wetBulbTemp !== null ? sensorData.wetBulbTemp : sensorData.wetBulbVoltage;
      sensorData.fruit = sensorData.fruitTemp !== null ? sensorData.fruitTemp : sensorData.fruitVoltage;
      sensorData.soil = sensorData.soilTemp !== null ? sensorData.soilTemp : sensorData.soilVoltage;
      
      // 온도값 여부 저장 (콘솔 출력 시 구분용)
      sensorData.dryBulbIsTemp = sensorData.dryBulbTemp !== null;
      sensorData.wetBulbIsTemp = sensorData.wetBulbTemp !== null;
      sensorData.fruitIsTemp = sensorData.fruitTemp !== null;
      sensorData.soilIsTemp = sensorData.soilTemp !== null;

      // 변경: Leaf_VPD 계산 (엽온=과일온도 가정)
      sensorData.leafVpd = this.calcVPD_kPa(sensorData.fruitTemp, sensorData.humidity);
    } catch (error) {
      sensorData.dryBulb = null;
      sensorData.wetBulb = null;
      sensorData.fruit = null;
      sensorData.soil = null;
    }

    // 결로점 계산: 결로점 = 과일 - 이슬점
    if (sensorData.fruit !== null && sensorData.dewpoint !== null) {
      sensorData.condensationPoint = parseFloat((sensorData.fruit - sensorData.dewpoint).toFixed(1));
    } else {
      sensorData.condensationPoint = null;
    }

    return sensorData;
  }

  // 콘솔 출력
  // 변경: 콘솔 로거 모듈로 위임
  displayConsole(data) {
    this.consoleLogger.display(data);
  }

  // 숫자 변환 헬퍼 함수 (null이면 0)
  toNumber(value) {
    if (value === null || value === undefined) {
      return 0;
    }
    const num = parseFloat(value);
    return isNaN(num) ? 0 : num;
  }

  // MQTT 메시지 포맷 변환 (C# 코드 포맷에 맞춤)
  formatMQTTMessage(data) {
    // 변경: 서울 시간대로 측정일시 포맷팅 (YYYY-MM-DD HH:mm:ss)
    const opTime = this.getSeoulTimeString();

    // MQTT 메시지 포맷 (C# 코드와 동일)
    // 변경: null 값을 0으로 변환하여 서버 파싱 오류 방지
    const mqttMessage = {
      facilityid: this.serialNumber,        // 시설 아이디 (시리얼번호 사용)
      opCode: this.serialNumber,            // 센서 아이디 (시리얼번호)
      opTime: opTime,                       // 측정일시
      EI_FG_TI: this.toNumber(data.temperature),          // 건구온도 (DHT22 온도값으로 대체)
      EI_FG_TW: this.toNumber(data.wetBulb),               // 습구온도 (A1)
      EI_FG_TF: this.toNumber(data.fruit),                 // 과실온도 (A2)
      EI_FG_TS: this.toNumber(data.soil),                  // 배지온도 (A3)
      EI_FG_TL: 0,                          // 습구 물통 수위 (현재 미지원, 0으로 설정)
      EI_FG_HD: this.toNumber(data.hd),                    // HD값
      EI_FG_DP: this.toNumber(data.dewpoint),              // 이슬점
      EI_FG_CI: this.toNumber(data.co2),                   // CO2
      EI_FG_HI: this.toNumber(data.humidity),              // 습도
      EI_FG_GP: this.toNumber(data.condensationPoint)      // 결로점
    };

    // 변경: MQTT 전송 디버깅용 로그 (opTime 확인)
    // console.log(`[MQTT] opTime: ${opTime} | 메시지: ${JSON.stringify(mqttMessage).substring(0, 150)}...`);

    return mqttMessage;
  }

  // 메인 루프
  async mainLoop() {
    try {
      const data = await this.readSensors();

      // 변경: 웹 대시보드용 최신 데이터 저장
      this.lastSensorData = data;
      
      const currentTime = Date.now();
      // 콘솔 출력은 10초마다만
      if (currentTime - this.lastConsoleTime >= this.consoleInterval) {
        this.displayConsole(data);
        this.lastConsoleTime = currentTime;
      }

      // OLED 출력 (항상 업데이트)
      await this.oled.displaySensorData(data);

      // MQTT 전송 (포맷 변환 후 전송, 항상 전송)
      const mqttMessage = this.formatMQTTMessage(data);
      this.mqtt.publish(mqttMessage);

    } catch (error) {
      console.error('[메인 루프] 오류:', error.message);
    }
  }

  // 시작
  async start() {
    try {
      await this.initialize();
      
      // 초기 데이터 읽기
      await this.mainLoop();

      // 주기적으로 데이터 읽기
      this.intervalId = setInterval(() => {
        this.mainLoop();
      }, this.readInterval);

      console.log(`데이터 읽기 시작 (${this.readInterval / 1000}초 간격)\n`);

    } catch (error) {
      console.error('[시작] 오류:', error);
      this.cleanup();
      process.exit(1);
    }
  }

  // 정리 작업
  cleanup() {
    console.log('\n=== 시스템 종료 중 ===');
    
    if (this.intervalId) {
      clearInterval(this.intervalId);
    }

    if (this.mqtt) {
      this.mqtt.disconnect();
    }

    if (this.mhz19c) {
      this.mhz19c.close();
    }

    if (this.ads1115) {
      this.ads1115.close();
    }

    if (this.oled) {
      this.oled.close();
    }

    // 변경: 웹 서버 종료
    if (this.webServer) {
      this.webServer.close();
      this.webServer = null;
    }

    if (this.db) {
      this.db.close();
    }

    console.log('시스템 종료 완료');
  }
}

// 메인 실행
const monitor = new GPIMonitor();

// 종료 시그널 처리
process.on('SIGINT', () => {
  monitor.cleanup();
  process.exit(0);
});

process.on('SIGTERM', () => {
  monitor.cleanup();
  process.exit(0);
});

// 시작
monitor.start().catch(error => {
  console.error('시작 실패:', error);
  process.exit(1);
});
