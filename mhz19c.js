// MH-Z19C CO2 센서 모듈
// UART 통신 (TX: 핀 10번, RX: 핀 8번)
// 변경: 아두이노 코드 참조하여 9바이트 응답을 버퍼에 모아 읽도록 수정
const { SerialPort } = require('serialport');

class MHZ19CSensor {
  constructor(port = '/dev/ttyAMA0', baudRate = 9600) {
    // 변경: 여러 포트 경로 시도 가능하도록
    // 라즈베리 파이에서 /dev/serial0은 /dev/ttyAMA0 또는 /dev/ttyS0으로 심볼릭 링크됨
    this.port = port;
    this.baudRate = baudRate;
    this.serialPort = null;
    this.lastValue = null;
    this.responseBuffer = Buffer.alloc(0);
    this.readResolve = null;
    this.readTimeout = null;
    this.isReading = false; // 읽기 중 플래그
    this.lastReadTime = 0; // 마지막 읽기 시도 시간
    this.minReadInterval = 3000; // 최소 읽기 간격 (3초) - CO2 센서는 응답 시간이 필요함
  }

  // 시리얼 포트 초기화
  async initialize() {
    return new Promise((resolve, reject) => {
      try {
        // 변경: MH-Z19C 사양에 맞는 시리얼 포트 설정 명시
        this.serialPort = new SerialPort({
          path: this.port,
          baudRate: this.baudRate,
          dataBits: 8,
          parity: 'none',
          stopBits: 1,
          autoOpen: false
        });

        // 바이너리 데이터를 버퍼에 모아서 처리
        this.serialPort.on('data', (data) => {
          this.handleData(data);
        });

        this.serialPort.on('error', (error) => {
          console.error('[MH-Z19C] 시리얼 포트 오류:', error.message);
        });

        this.serialPort.open((error) => {
          if (error) {
            console.error('[MH-Z19C] 시리얼 포트 열기 실패:', error.message);
            console.error('[MH-Z19C] 참고: /boot/config.txt에 다음 설정이 필요할 수 있습니다:');
            console.error('[MH-Z19C]   enable_uart=1');
            console.error('[MH-Z19C]   dtoverlay=disable-bt');
            console.error('[MH-Z19C] 설정 후 재부팅이 필요합니다.');
            reject(error);
          } else {
            console.log('[MH-Z19C] 시리얼 포트 열기 성공:', this.port);
            
            // 변경: 센서 초기화 - 센서가 준비될 때까지 대기
            setTimeout(() => {
              console.log('[MH-Z19C] 센서 초기화 완료 (준비 대기: 2초)');
              resolve(true);
            }, 2000); // 2초 대기
          }
        });
      } catch (error) {
        console.error('[MH-Z19C] 초기화 오류:', error.message);
        reject(error);
      }
    });
  }

  // 수신 데이터 처리 (버퍼에 모아서 9바이트가 되면 파싱)
  handleData(data) {
    // 변경: 디버그 로그는 패킷 발견 시에만 출력
    // if (data.length > 0) {
    //   const hexString = Array.from(data)
    //     .map(b => '0x' + b.toString(16).padStart(2, '0').toUpperCase())
    //     .join(' ');
    //   console.log(`[MH-Z19C] 수신 데이터 (${data.length}바이트): ${hexString}`);
    // }

    // 버퍼에 데이터 추가
    this.responseBuffer = Buffer.concat([this.responseBuffer, data]);

    // 9바이트 이상 모였는지 확인
    if (this.responseBuffer.length >= 9) {
      // 0xFF로 시작하는 패킷 찾기
      let startIndex = -1;
      for (let i = 0; i <= this.responseBuffer.length - 9; i++) {
        if (this.responseBuffer[i] === 0xFF && this.responseBuffer[i + 1] === 0x86) {
          startIndex = i;
          break;
        }
      }

      if (startIndex >= 0) {
        // 9바이트 패킷 추출
        const packet = this.responseBuffer.slice(startIndex, startIndex + 9);
        // 변경: 패킷 발견 시에만 로그 출력
        // console.log(`[MH-Z19C] 패킷 발견: ${Array.from(packet).map(b => '0x' + b.toString(16).padStart(2, '0').toUpperCase()).join(' ')}`);
        this.processResponse(packet);
        
        // 처리한 데이터 제거
        this.responseBuffer = this.responseBuffer.slice(startIndex + 9);
      } else {
        // 0xFF를 찾지 못했으면 버퍼 초기화 (잘못된 데이터)
        if (this.responseBuffer.length > 20) {
          console.warn(`[MH-Z19C] 잘못된 데이터, 버퍼 초기화 (${this.responseBuffer.length}바이트)`);
          console.warn(`[MH-Z19C] 버퍼 내용: ${Array.from(this.responseBuffer).map(b => '0x' + b.toString(16).padStart(2, '0').toUpperCase()).join(' ')}`);
          this.responseBuffer = Buffer.alloc(0);
        }
      }
    }
  }

  // 응답 패킷 처리
  processResponse(packet) {
    if (packet.length !== 9) {
      console.warn(`[MH-Z19C] 패킷 길이 오류: ${packet.length}바이트 (예상: 9바이트)`);
      return;
    }

    // 체크섬 검증
    const checksum = this.calculateChecksum(packet);
    const receivedChecksum = packet[8];
    if (checksum !== receivedChecksum) {
      console.warn(`[MH-Z19C] 체크섬 오류: 계산값=0x${checksum.toString(16).padStart(2, '0')}, 수신값=0x${receivedChecksum.toString(16).padStart(2, '0')}`);
      return;
    }

    // CO2 값 추출 (big-endian)
    const co2 = (packet[2] << 8) | packet[3];
    this.lastValue = co2;

    // 읽기 요청이 있으면 응답
    if (this.readResolve) {
      // 변경: 성공 로그는 첫 번째 성공 시에만 출력
      if (this.lastValue === null || Math.abs(this.lastValue - co2) > 100) {
        console.log(`[MH-Z19C] CO2 값 읽기 성공: ${co2} ppm`);
      }
      this.readResolve({
        co2: co2,
        success: true
      });
      this.readResolve = null;
      this.isReading = false;
      if (this.readTimeout) {
        clearTimeout(this.readTimeout);
        this.readTimeout = null;
      }
    } else {
      // 읽기 요청이 없어도 값은 저장됨 (로그 제거)
      // console.log(`[MH-Z19C] CO2 값 업데이트: ${co2} ppm (읽기 요청 없음)`);
    }
  }

  // 체크섬 계산
  calculateChecksum(buffer) {
    let sum = 0;
    for (let i = 1; i < 8; i++) {
      sum += buffer[i];
    }
    return (0xFF - sum + 1) & 0xFF;
  }

  // CO2 값 읽기 (아두이노 코드 참조)
  read() {
    return new Promise((resolve) => {
      if (!this.serialPort || !this.serialPort.isOpen) {
        resolve({
          co2: this.lastValue,
          success: this.lastValue !== null,
          error: this.lastValue === null ? '시리얼 포트가 열려있지 않습니다' : null
        });
        return;
      }

      const now = Date.now();
      
      // 변경: 이전 읽기 작업이 진행 중이면 스킵하고 마지막 값 반환
      if (this.isReading) {
        resolve({
          co2: this.lastValue,
          success: this.lastValue !== null,
          error: this.lastValue === null ? '읽기 작업 진행 중' : null
        });
        return;
      }

      // 변경: 최소 읽기 간격 확인 (너무 자주 읽기 방지)
      if (now - this.lastReadTime < this.minReadInterval) {
        const remainingTime = this.minReadInterval - (now - this.lastReadTime);
        resolve({
          co2: this.lastValue,
          success: this.lastValue !== null,
          error: this.lastValue === null ? `읽기 간격 부족 (${Math.ceil(remainingTime/1000)}초 대기 필요)` : null
        });
        return;
      }

      // 버퍼 초기화 (명령 전송 전에 초기화)
      this.responseBuffer = Buffer.alloc(0);
      this.readResolve = resolve;
      this.isReading = true;
      this.lastReadTime = now; // 읽기 시도 시간 기록

      // MH-Z19C 읽기 명령: 0xFF 0x01 0x86 0x00 0x00 0x00 0x00 0x00 0x79
      const readCommand = Buffer.from([0xFF, 0x01, 0x86, 0x00, 0x00, 0x00, 0x00, 0x00, 0x79]);
      
      // 변경: 타임아웃을 먼저 설정 (명령 전송 전)
      this.readTimeout = setTimeout(() => {
        if (this.readResolve) {
          // 변경: 타임아웃 로그는 첫 번째 실패 시에만 출력
          if (this.lastValue === null) {
            console.warn('[MH-Z19C] 센서 응답 없음. 시리얼 포트 연결 확인 필요.');
          }
          this.readResolve({
            co2: this.lastValue,
            success: this.lastValue !== null,
            error: this.lastValue === null ? '응답 타임아웃 (10초)' : null
          });
          this.readResolve = null;
          this.readTimeout = null;
          this.isReading = false;
        }
      }, 10000); // 변경: 10초로 증가 (센서 응답 시간 여유)
      
      // 명령 전송 (로그 제거 - 너무 많은 로그 방지)
      // const cmdHex = Array.from(readCommand).map(b => '0x' + b.toString(16).padStart(2, '0').toUpperCase()).join(' ');
      // console.log(`[MH-Z19C] 명령 전송: ${cmdHex}`);
      
      this.serialPort.write(readCommand, (error) => {
        if (error) {
          console.error('[MH-Z19C] 명령 전송 오류:', error.message);
          if (this.readTimeout) {
            clearTimeout(this.readTimeout);
            this.readTimeout = null;
          }
          if (this.readResolve) {
            this.readResolve({
              co2: this.lastValue,
              success: false,
              error: error.message
            });
            this.readResolve = null;
            this.isReading = false;
          }
        } else {
          // 전송 완료 확인 (로그 제거)
          this.serialPort.drain((drainError) => {
            if (drainError) {
              console.error('[MH-Z19C] drain 오류:', drainError.message);
            }
            // 변경: 성공 로그 제거 (너무 많은 로그 방지)
            // else {
            //   console.log('[MH-Z19C] 명령 전송 완료, 응답 대기 중...');
            // }
          });
        }
      });
    });
  }

  // 연결 종료
  close() {
    if (this.serialPort && this.serialPort.isOpen) {
      this.serialPort.close();
      console.log('[MH-Z19C] 시리얼 포트 종료');
    }
  }
}

module.exports = MHZ19CSensor;
