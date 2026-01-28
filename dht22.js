// DHT22 온습도 센서 모듈
// GPIO4 (핀 7번) 사용
const sensor = require('node-dht-sensor');

class DHT22Sensor {
  constructor(pin = 4) {
    this.pin = pin;
    this.sensorType = 22; // DHT22
  }

  // 이슬점 계산 (Magnus 공식)
  calculateDewPoint(temperature, humidity) {
    if (temperature === null || humidity === null) {
      return null;
    }

    const a = 17.27;
    const b = 237.7;
    const alpha = ((a * temperature) / (b + temperature)) + Math.log(humidity / 100.0);
    const dewpoint = (b * alpha) / (a - alpha);
    
    return parseFloat(dewpoint.toFixed(1));
  }

  // 수분 부족분(HD) 계산
  calculateHD(temperature, humidity, dewpoint) {
    if (temperature === null || humidity === null || dewpoint === null) {
      return null;
    }

    // 포화 수증기압 (hPa)
    const satVP = 6.112 * Math.exp((17.67 * temperature) / (temperature + 243.5));

    // 실제 수증기압 (hPa) - 이슬점에서의 수증기압
    const actVP = 6.112 * Math.exp((17.67 * dewpoint) / (dewpoint + 243.5));

    // 절대 습도 (g/m³) 변환
    // AH = e(Pa) * 2.1674 / (절대온도)  →  e(hPa) * 100 = e(Pa)
    const satAH = satVP * 2.1674 * 100.0 / (273.15 + temperature);
    const actAH = actVP * 2.1674 * 100.0 / (273.15 + temperature);

    // 수분 부족분(HD) = (포화 AH) - (실제 AH)
    const hd = satAH - actAH;
    
    return parseFloat(hd.toFixed(1));
  }

  // 온도와 이슬점 차이(gap) 계산
  calculateGap(temperature, dewpoint) {
    if (temperature === null || dewpoint === null) {
      return null;
    }

    const gap = Math.abs(temperature - dewpoint);
    return parseFloat(gap.toFixed(1));
  }

  // 센서 데이터 읽기
  read() {
    try {
      const result = sensor.read(this.sensorType, this.pin);
      const temperature = parseFloat(result.temperature.toFixed(1));
      const humidity = parseFloat(result.humidity.toFixed(1));
      
      // 이슬점 계산
      const dewpoint = this.calculateDewPoint(temperature, humidity);
      
      // 수분 부족분(HD) 계산
      const hd = this.calculateHD(temperature, humidity, dewpoint);
      
      // 온도와 이슬점 차이(gap) 계산
      const gap = this.calculateGap(temperature, dewpoint);

      return {
        temperature: temperature,
        humidity: humidity,
        dewpoint: dewpoint,
        hd: hd,
        gap: gap,
        success: true
      };
    } catch (error) {
      console.error('[DHT22] 센서 읽기 오류:', error.message);
      return {
        temperature: null,
        humidity: null,
        dewpoint: null,
        hd: null,
        gap: null,
        success: false,
        error: error.message
      };
    }
  }

  // 센서 초기화 확인
  async initialize() {
    try {
      const test = this.read();
      if (test.success) {
        console.log('[DHT22] 센서 초기화 성공');
        return true;
      }
      return false;
    } catch (error) {
      console.error('[DHT22] 센서 초기화 실패:', error.message);
      return false;
    }
  }
}

module.exports = DHT22Sensor;
