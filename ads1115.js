// ADS1115 아날로그-디지털 컨버터 모듈
// I2C 통신 사용
const i2c = require('i2c-bus');

class ADS1115Sensor {
  constructor(address = 0x48, busNumber = 1) {
    this.address = address;
    this.busNumber = busNumber;
    this.i2cBus = null;
    
    // [설정 복구] 하드웨어는 정상이므로 표준값(10k)으로 되돌립니다.
    this.ntcConfig = {
      supplyVoltage: 3.3,      // 테스터기로 측정한 전압
      fixedResistor: 10000,      // 테스터기로 확인한 10k 저항
      ntcNominalResistance: 10000, // 10k NTC (정상)
      nominalTemperature: 25.0,
      betaCoefficient: 3950,
    };
  }

  // I2C 버스 초기화
  async initialize() {
    try {
      this.i2cBus = await i2c.openPromisified(this.busNumber);
      console.log('[ADS1115] I2C 버스 초기화 성공');
      return true;
    } catch (error) {
      console.error('[ADS1115] I2C 버스 초기화 실패:', error.message);
      return false;
    }
  }

  // NTC 센서 설정 변경
  setNTCConfig(config) {
    this.ntcConfig = { ...this.ntcConfig, ...config };
    console.log('[ADS1115] NTC 설정 업데이트:', this.ntcConfig);
  }

  // 전압 분배 계산식 (1.79V 측정됨 -> Pull-down 방식이 확실함)
  // 회로: 3.3V -> 10k 고정저항 -> (A0 측정) -> NTC -> GND
  calculateNTCResistance(voltage) {
    const { supplyVoltage, fixedResistor } = this.ntcConfig;
    if (voltage <= 0 || voltage >= supplyVoltage) return null;
    
    // 10k 고정저항이 상단(3.3V쪽)에 있을 때의 공식
    const rNTC = fixedResistor * (voltage / (supplyVoltage - voltage));
    return rNTC;
  }

  // NTC 저항값으로부터 온도 계산 (베타 파라미터 방정식 사용)
  // 변경: 제공된 코드의 계산식 적용
  // Steinhart-Hart Beta 식 단순화 버전: 1/T = 1/T0 + 1/B * ln(R/R0)
  calculateTemperature(ntcResistance) {
    if (!ntcResistance || ntcResistance <= 0) {
      return null;
    }

    const { ntcNominalResistance, nominalTemperature, betaCoefficient } = this.ntcConfig;
    
    // 25도를 켈빈 온도로 변환
    const t25 = nominalTemperature + 273.15;
    
    // 온도 계산 (켈빈)
    const kelvin = 1 / ((1 / t25) + (1 / betaCoefficient) * Math.log(ntcResistance / ntcNominalResistance));
    
    // 섭씨 온도로 변환
    const celsius = kelvin - 273.15;
    
    return parseFloat(celsius.toFixed(2));
  }

  // 채널 읽기 (0-3)
  async readChannel(channel = 0) {
    if (!this.i2cBus) {
      return {
        value: null,
        voltage: null,
        success: false,
        error: 'I2C 버스가 초기화되지 않았습니다'
      };
    }

    try {
      // [핵심 수정 1] Gain 설정을 ±6.144V (Gain 0)로 변경하여 매칭시킴
      // Config Register:
      // OS=1
      // MUX=channel (0x4~0x7)
      // PGA=000 (±6.144V) -> 비트 11-9를 000으로 설정
      // MODE=1 (Single)
      
      // 기존 0x84는 PGA=010(±4.096V) 였습니다.
      // PGA=000으로 만들기 위해 0xC0 또는 0xC1 계열 사용
      // bit 15(OS)=1, bit 14-12(MUX)=channel, bit 11-9(PGA)=000, bit 8(MODE)=1
      // 1xxx 0001 -> 0xC1 (채널0 기준)
      
      let configMSB = 0xC1; 
      if (channel === 1) configMSB = 0xD1;
      if (channel === 2) configMSB = 0xE1;
      if (channel === 3) configMSB = 0xF1;

      const configLSB = 0x83; // 128SPS

      const configBuffer = Buffer.from([0x01, configMSB, configLSB]);
      await this.i2cBus.writeI2cBlock(this.address, 0x01, 2, configBuffer.slice(1));

      await new Promise(resolve => setTimeout(resolve, 20)); // 여유있게 대기

      // 변환 결과 읽기 (0x00) - Conversion Register 읽기
      // 변경: readI2cBlock을 사용하여 2바이트 읽기 (바이트 순서 보장)
      const readBuffer = Buffer.alloc(2);
      await this.i2cBus.readI2cBlock(this.address, 0x00, 2, readBuffer);
      // ADS1115는 big-endian (MSB first)
      const rawValue = (readBuffer[0] << 8) | readBuffer[1];
      
      // 16비트 부호 있는 정수로 변환
      let value = rawValue;
      if (value > 32767) {
        value = value - 65536;
      }

      // [핵심 수정 2] 전압 변환 계수 수정 (±6.144V 기준)
      // Gain 0 (6.144V) => 6.144 / 32767 * rawValue
      const absValue = Math.abs(value);
      const voltage = (6.144 / 32767) * absValue;
      
      // NTC 온도 변환 (유효한 전압 범위에서만 처리)
      // 변경: 제공된 코드의 로직 적용
      // 예외 처리: 전압이 0이거나 입력 전압과 같으면 계산 불가
      let ntcResistance = null;
      let temperature = null;
      
      if (voltage > 0 && voltage < this.ntcConfig.supplyVoltage) {
        ntcResistance = this.calculateNTCResistance(voltage);
        if (ntcResistance && ntcResistance > 0) {
          temperature = this.calculateTemperature(ntcResistance);
        }
      }

      return {
        value: value,
        voltage: parseFloat(voltage.toFixed(4)),
        ntcResistance: ntcResistance ? parseFloat(ntcResistance.toFixed(2)) : null,
        temperature: temperature,
        success: true
      };
    } catch (error) {
      console.error(`[ADS1115] 채널 ${channel} 읽기 오류:`, error.message);
      return {
        value: null,
        voltage: null,
        success: false,
        error: error.message
      };
    }
  }

  // 온도만 읽기 (NTC 센서용)
  async readTemperature(channel = 0) {
    const result = await this.readChannel(channel);
    
    if (!result.success) {
      return {
        temperature: null,
        success: false,
        error: result.error || '온도 읽기 실패'
      };
    }

    return {
      temperature: result.temperature,
      voltage: result.voltage,
      ntcResistance: result.ntcResistance,
      success: true
    };
  }

  // 모든 채널 읽기
  async readAllChannels() {
    const channels = [0, 1, 2, 3];
    const results = {};

    for (const channel of channels) {
      results[`channel${channel}`] = await this.readChannel(channel);
    }

    return results;
  }

  // 연결 종료
  close() {
    if (this.i2cBus) {
      this.i2cBus.close();
      console.log('[ADS1115] I2C 버스 종료');
    }
  }
}

module.exports = ADS1115Sensor;
