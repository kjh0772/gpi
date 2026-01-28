// 콘솔 로그 출력 모듈
// 변경: 콘솔 출력 로직을 별도 파일로 분리

class ConsoleLogger {
  // 변경: 콘솔 색상(ANSI) 적용 헬퍼 (추가 라이브러리 없이)
  supportsColor() {
    // NO_COLOR 표준 지원 + CI 환경에서는 기본 비활성화
    if (process.env.NO_COLOR) return false;
    if (process.env.FORCE_COLOR) return true;
    if (process.env.CI) return false;
    return Boolean(process.stdout && process.stdout.isTTY);
  }

  color(text, code) {
    if (!this.supportsColor()) return String(text);
    return `\u001b[${code}m${text}\u001b[0m`;
  }

  bold(text) {
    return this.color(text, '1');
  }

  dim(text) {
    return this.color(text, '2');
  }

  gray(text) {
    return this.color(text, '90');
  }

  cyan(text) {
    return this.color(text, '36');
  }

  green(text) {
    return this.color(text, '32');
  }

  yellow(text) {
    return this.color(text, '33');
  }

  magenta(text) {
    return this.color(text, '35');
  }

  red(text) {
    return this.color(text, '31');
  }

  // 센서 데이터 콘솔 출력
  display(data) {
    // 변경: 서울 시간대로 출력
    const time = new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });
    console.log(this.gray('─'.repeat(60)));
    console.log(this.bold(`[${time}]`));

    // 변경: 출력 라인 간소화용 헬퍼
    const fmt = (v, suffix = '') => (v !== null && v !== undefined ? `${v}${suffix}` : 'N/A');
    const fmtFixed = (v, digits, suffix = '') =>
      v !== null && v !== undefined && Number.isFinite(v) ? `${v.toFixed(digits)}${suffix}` : 'N/A';

    const aStr = (label, t, v) => {
      const tStr = (t !== null && t !== undefined) ? `${t.toFixed(2)}°C` : 'N/A';
      const vStr = (v !== null && v !== undefined) ? `${v.toFixed(3)}V` : 'N/A';
      const labelStr = this.bold(label);
      const tOut = (t !== null && t !== undefined) ? this.green(tStr) : this.dim(tStr);
      const vOut = (v !== null && v !== undefined) ? this.cyan(vStr) : this.dim(vStr);
      return `${labelStr}:${tOut}/${vOut}`;
    };

    // 변경: 카테고리별로 콘솔 로그 분류
    console.log(this.magenta('[변동없는데이터]'));
    console.log(`- ${this.bold('IP')}:${this.cyan(fmt(data.ipAddress))} | ${this.bold('SN')}:${this.cyan(fmt(data.serialNumber))} | ${this.bold('HW')}:${this.cyan(fmt(data.gpi_hv))} | ${this.bold('SW')}:${this.cyan(fmt(data.gpi_sv))}`);

    console.log(this.magenta('[시스템정보cpu,wifi]'));
    console.log(
      `- ${this.bold('CPU')}:${data.cpuTemp !== null && data.cpuTemp !== undefined ? this.green(fmt(data.cpuTemp, '°C')) : this.dim('N/A')}` +
        ` ${this.bold('CPU%')}:${data.cpuUsage !== null && data.cpuUsage !== undefined ? this.yellow(fmt(data.cpuUsage, '%')) : this.dim('N/A')}` +
        ` ${this.bold('RAM%')}:${data.ramUsage !== null && data.ramUsage !== undefined ? this.yellow(fmt(data.ramUsage, '%')) : this.dim('N/A')}` +
        ` | ${this.bold('WiFi')}:${data.wifiRssi !== null && data.wifiRssi !== undefined ? this.yellow(fmt(data.wifiRssi, ' dBm')) : this.dim('N/A')}`
    );

    console.log(this.magenta('[센서정보]'));
    console.log(`- ${this.bold('T')}:${data.temperature !== null && data.temperature !== undefined ? this.green(fmt(data.temperature, '°C')) : this.dim('N/A')} ${this.bold('RH')}:${data.humidity !== null && data.humidity !== undefined ? this.green(fmt(data.humidity, '%')) : this.dim('N/A')} ${this.bold('CO2')}:${data.co2 !== null && data.co2 !== undefined ? this.yellow(fmt(data.co2, 'ppm')) : this.dim('N/A')}`);
    console.log(`- ${aStr('A0', data.dryBulbTemp, data.dryBulbVoltage)} | ${aStr('A1', data.wetBulbTemp, data.wetBulbVoltage)} | ${aStr('A2', data.fruitTemp, data.fruitVoltage)} | ${aStr('A3', data.soilTemp, data.soilVoltage)}`);

    console.log(this.magenta('[센서를가공한데이터]'));
    console.log(`- ${this.bold('DP')}:${data.dewpoint !== null && data.dewpoint !== undefined ? this.green(fmt(data.dewpoint, '°C')) : this.dim('N/A')} ${this.bold('HD')}:${data.hd !== null && data.hd !== undefined ? this.cyan(fmt(data.hd, ' g/m³')) : this.dim('N/A')} ${this.bold('Gap')}:${data.gap !== null && data.gap !== undefined ? this.green(fmt(data.gap, '°C')) : this.dim('N/A')} ${this.bold('CP')}:${data.condensationPoint !== null && data.condensationPoint !== undefined ? this.red(fmt(data.condensationPoint, '°C')) : this.dim('N/A')}`);
    console.log(`- ${this.bold('AirVPD')}:${data.airVpd !== null && data.airVpd !== undefined ? this.cyan(fmtFixed(data.airVpd, 3, 'kPa')) : this.dim('N/A')} ${this.bold('LeafVPD')}:${data.leafVpd !== null && data.leafVpd !== undefined ? this.cyan(fmtFixed(data.leafVpd, 3, 'kPa')) : this.dim('N/A')} ${this.bold('WB')}:${data.calcWetBulb !== null && data.calcWetBulb !== undefined ? this.green(fmt(data.calcWetBulb, '°C')) : this.dim('N/A')} ${this.bold('GDD')}:${data.dailyGdd !== null && data.dailyGdd !== undefined ? this.cyan(fmt(data.dailyGdd, '°C·day')) : this.dim('N/A')}`);

    console.log(this.gray('─'.repeat(60)));
    console.log('');
  }
}

module.exports = ConsoleLogger;
