// MQTT 통신 모듈
const mqtt = require('mqtt');

class MQTTManager {
  constructor(server1, server2, topic) {
    this.server1 = server1;
    this.server2 = server2;
    this.topic = topic;
    this.clients = [];
  }

  // MQTT 클라이언트 연결
  connect() {
    const servers = [
      { url: `mqtt://${this.server1}`, name: 'Server1' },
      { url: `mqtt://${this.server2}`, name: 'Server2' }
    ];

    servers.forEach(server => {
      try {
        const client = mqtt.connect(server.url, {
          clientId: `gpi_${Date.now()}_${Math.random().toString(16).substr(2, 8)}`,
          reconnectPeriod: 5000
        });

        client.on('connect', () => {
          // 변경: MQTT 로그 주석처리
          // console.log(`[MQTT] ${server.name} 연결 성공: ${server.url}`);
        });

        client.on('error', (error) => {
          // 변경: MQTT 로그 주석처리
          // console.error(`[MQTT] ${server.name} 오류:`, error.message);
        });

        client.on('offline', () => {
          // 변경: MQTT 로그 주석처리
          // console.warn(`[MQTT] ${server.name} 오프라인`);
        });

        client.on('reconnect', () => {
          // 변경: MQTT 로그 주석처리
          // console.log(`[MQTT] ${server.name} 재연결 시도 중...`);
        });

        this.clients.push({ client, name: server.name });
      } catch (error) {
        // 변경: MQTT 로그 주석처리
        // console.error(`[MQTT] ${server.name} 연결 실패:`, error.message);
      }
    });
  }

  // 데이터 전송
  publish(data) {
    const message = JSON.stringify(data);
    
    // 변경: MQTT 로그 주석처리
    // const dataObj = typeof data === 'string' ? JSON.parse(data) : data;
    // const opTime = dataObj.opTime || 'N/A';
    // console.log(`[MQTT] 전송 시도 - Topic: ${this.topic} | opTime: ${opTime}`);
    
    this.clients.forEach(({ client, name }) => {
      if (client.connected) {
        client.publish(this.topic, message, { qos: 1 }, (error) => {
          if (error) {
            // 변경: MQTT 로그 주석처리
            // console.error(`[MQTT] ${name} 전송 실패:`, error.message);
          } else {
            // 변경: MQTT 로그 주석처리
            // console.log(`[MQTT] ${name} 전송 성공 | opTime: ${opTime}`);
          }
        });
      } else {
        // 변경: MQTT 로그 주석처리
        // console.warn(`[MQTT] ${name} 연결되지 않음 (전송 건너뜀) | opTime: ${opTime}`);
      }
    });
  }

  // 모든 연결 종료
  disconnect() {
    this.clients.forEach(({ client, name }) => {
      if (client.connected) {
        client.end();
        // 변경: MQTT 로그 주석처리
        // console.log(`[MQTT] ${name} 연결 종료`);
      }
    });
  }

  // 연결 상태 확인
  isConnected() {
    return this.clients.some(({ client }) => client.connected);
  }

  // 변경: 각 서버별 연결 상태 반환 (웹 표시용)
  getConnectionStatus() {
    const status = [];
    this.clients.forEach(({ client, name }) => {
      const serverAddr = name === 'Server1' ? this.server1 : this.server2;
      status.push({
        server: serverAddr,
        name: name,
        connected: client && client.connected === true
      });
    });
    return status;
  }
}

module.exports = MQTTManager;
