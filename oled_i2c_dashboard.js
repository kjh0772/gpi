// 변경: oled-i2c-bus 기반 OLED 대시보드 (SSD1306 I2C)
// 참고: 기존 oled.js는 유지, 이 파일을 신규로 추가하여 리스크 최소화
const i2c = require('i2c-bus');
const OLED = require('oled-i2c-bus');
const font = require('oled-font-5x7');

class OledDashboard {
  constructor({ address = 0x3C, bus = 1, width = 128, height = 32 } = {}) {
    // 변경: 기본값을 0.91인치 128x32로 설정
    this.width = width;
    this.height = height;
    this.address = address;
    this.bus = bus;

    this.i2cBus = null;
    this.oled = null;
  }

  // 변경: 예시 코드 스타일 지원용 (show() 호출 시 자동 초기화)
  ensureInitialized() {
    if (this.oled && this.i2cBus) return;

    // oled-i2c-bus는 sync 패턴이 기본이라 여기서 sync로 오픈 // 변경: 예시 스타일
    this.i2cBus = i2c.openSync(this.bus);
    this.oled = new OLED(this.i2cBus, {
      width: this.width,
      height: this.height,
      address: this.address
    });

    this.oled.clearDisplay();
  }

  // 변경: 기존 코드(`gpi.js`)와 인터페이스 맞춤
  async initialize() {
    // 변경: ensureInitialized로 통합 (예시 코드 스타일/기존 방식 둘 다 지원)
    this.ensureInitialized();
    return true;
  }

  /** ======================
   *  공통 UI 요소
   *  ====================== */
  // 변경: 128x32에 맞춰 텍스트 한 줄 출력 헬퍼 (폰트 1배 고정)
  writeLine(lineIndex, text) {
    const y = lineIndex * 8; // 5x7 폰트는 8px 라인으로 취급
    if (y > this.height - 8) return;

    const maxChars = Math.floor(this.width / 6); // 대략 6px/문자
    const str = String(text ?? '').slice(0, maxChars);

    this.oled.setCursor(0, y);
    this.oled.writeString(font, 1, str, 1); // 변경: 폰트 크기 통일(1배)
  }

  /** ======================
   *  표시 영역 (요청: 온도,습도,CO2,IP,Serial)
   *  ====================== */
  formatTempHumLine(temperature, humidity) {
    const t = (temperature != null && Number.isFinite(temperature)) ? `${temperature.toFixed(1)}C` : 'N/A';
    const h = (humidity != null && Number.isFinite(humidity)) ? `${humidity.toFixed(0)}%` : 'N/A';
    return `T:${t} H:${h}`;
  }

  formatCo2CpuLine(co2, cpuTemp) {
    const co2Part = (() => {
      if (co2 == null) return 'CO2:N/A';
      const v = Number(co2);
      return Number.isFinite(v) ? `CO2:${v}ppm` : 'CO2:N/A';
    })();

    const cpuPart = (() => {
      if (cpuTemp == null) return 'CPU:N/A';
      const v = Number(cpuTemp);
      return Number.isFinite(v) ? `CPU:${v.toFixed(1)}C` : 'CPU:N/A';
    })();

    return `${co2Part} ${cpuPart}`;
  }

  /** ======================
   *  메인 대시보드
   *  ====================== */
  // 변경: 예시 코드 스타일의 show() 메서드 추가
  show({ temperature, humidity, co2, ipAddress, serialNumber, cpuTemp }) {
    this.ensureInitialized(); // 변경: 예시 스타일 지원

    // 변경: 잔상/쓰레기 픽셀 방지 위해 완전 클리어 후 갱신
    this.oled.clearDisplay();

    // 변경: 폰트 크기 통일(1배) + 4라인 구성
    // L0: Serial
    this.writeLine(0, `SN:${serialNumber ?? 'N/A'}`);
    // L1: IP
    this.writeLine(1, `IP:${ipAddress ?? 'N/A'}`);
    // L2: T/H
    this.writeLine(2, this.formatTempHumLine(temperature, humidity));
    // L3: CO2 + CPU
    this.writeLine(3, this.formatCo2CpuLine(co2, cpuTemp));

    this.oled.update();
  }

  // 변경: 기존 gpi.js 호출부 호환을 위한 메서드
  async displayMessage(message) {
    this.ensureInitialized(); // 변경: 예시 스타일 지원
    this.oled.clearDisplay();
    this.oled.setCursor(2, 12);
    this.oled.writeString(font, 1, String(message).slice(0, 20), 1);
    this.oled.update();
  }

  // 변경: displaySensorData는 show()를 호출하도록 통합
  async displaySensorData(data) {
    this.show({
      temperature: data?.temperature,
      humidity: data?.humidity,
      co2: data?.co2,
      ipAddress: data?.ipAddress,
      serialNumber: data?.serialNumber,
      cpuTemp: data?.cpuTemp
    });
  }

  async close() {
    try {
      if (this.oled) {
        this.oled.clearDisplay();
        this.oled.turnOffDisplay();
      }
    } catch (e) {}

    try {
      if (this.i2cBus) this.i2cBus.closeSync();
    } catch (e) {}
  }
}

module.exports = OledDashboard;

