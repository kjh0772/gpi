// SQLite 데이터베이스 설정 관리 모듈
const Database = require('better-sqlite3');
const path = require('path');

class ConfigDB {
  constructor(dbPath = './config.db') {
    this.db = new Database(dbPath);
    this.initDatabase();
  }

  // 데이터베이스 초기화 및 테이블 생성
  initDatabase() {
    const createTable = `
      CREATE TABLE IF NOT EXISTS config (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        serial_number TEXT UNIQUE NOT NULL,
        mqtt_server1 TEXT NOT NULL,
        mqtt_server2 TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `;
    this.db.exec(createTable);
  }

  // 설정 정보 가져오기
  getConfig() {
    const stmt = this.db.prepare('SELECT * FROM config ORDER BY id DESC LIMIT 1');
    return stmt.get();
  }

  // 설정 정보 저장/업데이트
  saveConfig(serialNumber, mqttServer1, mqttServer2) {
    const existing = this.getConfig();
    
    if (existing) {
      const stmt = this.db.prepare(`
        UPDATE config 
        SET serial_number = ?, mqtt_server1 = ?, mqtt_server2 = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `);
      stmt.run(serialNumber, mqttServer1, mqttServer2, existing.id);
    } else {
      const stmt = this.db.prepare(`
        INSERT INTO config (serial_number, mqtt_server1, mqtt_server2)
        VALUES (?, ?, ?)
      `);
      stmt.run(serialNumber, mqttServer1, mqttServer2);
    }
  }

  // 데이터베이스 연결 종료
  close() {
    this.db.close();
  }
}

module.exports = ConfigDB;
