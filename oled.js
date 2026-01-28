const i2c = require('i2c-bus');

// 5x7 기본 폰트
const FONT = {
  '0': [0x3E, 0x51, 0x49, 0x45, 0x3E], '1': [0x00, 0x42, 0x7F, 0x40, 0x00],
  '2': [0x42, 0x61, 0x51, 0x49, 0x46], '3': [0x21, 0x41, 0x45, 0x4B, 0x31],
  '4': [0x18, 0x14, 0x12, 0x7F, 0x10], '5': [0x27, 0x45, 0x45, 0x45, 0x39],
  '6': [0x3C, 0x4A, 0x49, 0x49, 0x30], '7': [0x01, 0x71, 0x09, 0x05, 0x03],
  '8': [0x36, 0x49, 0x49, 0x49, 0x36], '9': [0x06, 0x49, 0x49, 0x29, 0x1E],
  '.': [0x00, 0x60, 0x60, 0x00, 0x00], ':': [0x00, 0x36, 0x36, 0x00, 0x00],
  ' ': [0x00, 0x00, 0x00, 0x00, 0x00], '-': [0x08, 0x08, 0x08, 0x08, 0x08],
  '%': [0x22, 0x14, 0x08, 0x28, 0x44], 'C': [0x3E, 0x41, 0x41, 0x41, 0x22],
  'P': [0x7F, 0x09, 0x09, 0x09, 0x06], 'M': [0x7F, 0x02, 0x0C, 0x02, 0x7F],
  'O': [0x3E, 0x41, 0x41, 0x41, 0x3E], '2': [0x42, 0x61, 0x51, 0x49, 0x46],
  '°': [0x00, 0x06, 0x09, 0x09, 0x06]
};

// 아이콘 비트맵 (8x8)
const ICONS = {
    temp: [0x04, 0x0A, 0x0A, 0x0E, 0x0E, 0x1F, 0x1F, 0x0E], // 온도계
    drop: [0x08, 0x14, 0x22, 0x41, 0x41, 0x22, 0x14, 0x08]  // 물방울
};

class OLEDDisplay {
  constructor(address = 0x3C, busNumber = 1) {
    this.address = address;
    this.busNumber = busNumber;
    // SSD1306 표준 해상도 (128x64)
    this.width = 128;
    this.height = 64;
    this.i2cBus = null;
    this.initialized = false;
    // 버퍼: 128 * 64비트 = 1024바이트
    this.buffer = Buffer.alloc(1024);
  }

  async sendCommand(cmd) {
    if (!this.i2cBus) return;
    try { await this.i2cBus.writeByte(this.address, 0x00, cmd); } catch (e) {}
  }

  async initialize() {
    try {
      this.i2cBus = await i2c.openPromisified(this.busNumber);
      
      // SSD1306 128x64 표준 초기화 시퀀스 (가장 안정적)
      const cmds = [
        0xAE, // Display OFF
        0xD5, 0x80, // Clock Divide Ratio
        0xA8, 0x3F, // Multiplex Ratio (64 lines)
        0xD3, 0x00, // Display Offset
        0x40, // Start Line
        0x8D, 0x14, // Charge Pump Enable
        0x20, 0x00, // [중요] Horizontal Addressing Mode (화면 꼬임 방지)
        0xA1, // Segment Remap
        0xC8, // COM Scan Direction
        0xDA, 0x12, // COM Pins Config
        0x81, 0xCF, // Contrast (밝기 적당히)
        0xD9, 0xF1, // Pre-charge
        0xDB, 0x40, // VCOMH Deselect
        0xA4, // Display All On Resume
        0xA6, // Normal Display
        0xAF  // Display ON
      ];

      for (const cmd of cmds) await this.sendCommand(cmd);
      
      // 초기화 시 화면 완전 소거 (노이즈 제거)
      this.buffer.fill(0);
      await this.updateDisplay();
      
      this.initialized = true;
      console.log('[OLED] 초기화 완료 (Dashboard Style)');
      return true;
    } catch (e) {
      console.error('[OLED] Init Error:', e.message);
      return false;
    }
  }

  // 그래픽: 점 찍기
  drawPixel(x, y, color = 1) {
    if (x < 0 || x >= this.width || y < 0 || y >= this.height) return;
    const index = Math.floor(x + Math.floor(y / 8) * this.width);
    const bit = y % 8;
    if (color) this.buffer[index] |= (1 << bit);
    else this.buffer[index] &= ~(1 << bit);
  }

  // 그래픽: 선 그리기 (가로/세로)
  drawLine(x0, y0, x1, y1, color = 1) {
      if(x0 === x1) { // 수직선
          for(let y = Math.min(y0, y1); y <= Math.max(y0, y1); y++) this.drawPixel(x0, y, color);
      } else if(y0 === y1) { // 수평선
          for(let x = Math.min(x0, x1); x <= Math.max(x0, x1); x++) this.drawPixel(x, y0, color);
      }
  }

  // 그래픽: 사각형 채우기
  fillRect(x, y, w, h, color = 1) {
    for (let i = 0; i < w; i++) {
      for (let j = 0; j < h; j++) {
        this.drawPixel(x + i, y + j, color);
      }
    }
  }

  // 텍스트 출력
  drawChar(char, x, y, scale = 1) {
    const font = FONT[char] || FONT[' '];
    for (let i = 0; i < 5; i++) {
      for (let j = 0; j < 7; j++) {
        if ((font[i] >> j) & 0x01) {
          this.fillRect(x + (i * scale), y + (j * scale), scale, scale, 1);
        }
      }
    }
    return (5 * scale) + scale; // 문자 너비 반환
  }

  drawString(text, x, y, scale = 1) {
    let cx = x;
    for (let char of text) {
      cx += this.drawChar(char, cx, y, scale);
    }
  }

  // 아이콘 출력
  drawIcon(type, x, y) {
      const icon = ICONS[type];
      if(!icon) return;
      for(let i=0; i<8; i++) {
          for(let j=0; j<8; j++) {
              if((icon[i] >> j) & 0x01) this.drawPixel(x+i, y+j, 1);
          }
      }
  }

  // 화면 업데이트 (Horizontal Mode 최적화)
  async updateDisplay() {
    if (!this.initialized) return;
    try {
      // 주소 포인터를 처음으로 리셋
      await this.sendCommand(0x21); // Column Address
      await this.sendCommand(0);
      await this.sendCommand(127);
      await this.sendCommand(0x22); // Page Address
      await this.sendCommand(0);
      await this.sendCommand(7);

      // 데이터 전송 (16바이트 청크)
      const length = this.buffer.length;
      for (let i = 0; i < length; i += 16) {
        const chunk = this.buffer.subarray(i, i + 16);
        await this.i2cBus.writeI2cBlock(this.address, 0x40, chunk.length, chunk);
      }
    } catch (e) {}
  }

  // [핵심] 센서 데이터 대시보드 출력
  async displaySensorData(data) {
    if (!this.initialized) return;
    this.buffer.fill(0); // 화면 지우기

    // 1. 레이아웃 구분선 (중앙 수직선)
    this.drawLine(64, 0, 64, 40, 1);
    // 하단 구분선
    this.drawLine(0, 42, 128, 42, 1);

    // 2. 왼쪽: 온도 (Temperature)
    this.drawIcon('temp', 4, 4); // 아이콘
    if (data.temperature !== null) {
        const temp = data.temperature.toFixed(1);
        // 숫자 크게 (Scale 2)
        this.drawString(temp, 16, 4, 2);
        // 단위 작게 (Scale 1) - 위치 자동 조정
        this.drawString("C", 16 + (temp.length * 12), 4, 1);
        this.fillRect(16 + (temp.length * 12) - 3, 4, 2, 2, 1); // 도(°) 기호
        
        // 라벨
        this.drawString("TEMP", 18, 24, 1);
    }

    // 3. 오른쪽: 습도 (Humidity)
    this.drawIcon('drop', 70, 4); // 아이콘
    if (data.humidity !== null) {
        const hum = data.humidity.toFixed(0);
        this.drawString(hum, 82, 4, 2);
        this.drawString("%", 82 + (hum.length * 12), 11, 1); // %는 약간 아래로
        
        // 라벨
        this.drawString("HUMID", 82, 24, 1);
    }

    // 4. 하단: CO2 Progress Bar (게이지)
    const co2 = data.co2 || 0;
    this.drawString("CO2", 2, 48, 1);
    this.drawString(`${co2}ppm`, 80, 48, 1); // 값 우측 정렬 느낌

    // 게이지 바 그리기 (배경 박스)
    this.drawLine(0, 58, 128, 58, 1); // 상단 선
    this.drawLine(0, 63, 128, 63, 1); // 하단 선
    this.drawLine(0, 58, 0, 63, 1);   // 좌측 선
    this.drawLine(127, 58, 127, 63, 1); // 우측 선

    // 게이지 채우기 (최대 2000ppm 기준)
    const maxPPM = 2000;
    const barWidth = Math.min(126, Math.floor((co2 / maxPPM) * 126));
    if (barWidth > 0) {
        this.fillRect(1, 59, barWidth, 4, 1);
    }

    await this.updateDisplay();
  }

  async displayMessage(msg) {
      if(!this.initialized) return;
      this.buffer.fill(0);
      this.fillRect(0, 0, 128, 14, 1); // 상단 반전 바
      // 반전된 텍스트 효과는 복잡하니 간단히 처리
      this.drawString("SYSTEM", 40, 4, 1); 
      this.drawPixel(40,4,0); // 글자 부분만 끄기(Invert 효과 흉내) - 생략하고 그냥 그림

      this.drawString(msg.substring(0,10), 10, 25, 2);
      await this.updateDisplay();
  }

  async close() {
    if (this.initialized) {
        this.buffer.fill(0);
        await this.updateDisplay();
        await this.sendCommand(0xAE);
    }
    if (this.i2cBus) this.i2cBus.close();
  }
}

module.exports = OLEDDisplay;