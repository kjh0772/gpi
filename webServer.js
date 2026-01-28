// 웹 서버 모듈 (로컬 IP로 접속해 센서 데이터 확인)
// 변경: 콘솔 로그 데이터를 웹으로 볼 수 있게 추가

const http = require('http');
const url = require('url');

class WebServer {
  /**
   * @param {object} options
   * @param {number} [options.port]
   * @param {string} [options.host]
   * @param {() => any} options.getData - 최신 센서 데이터 반환 콜백
   * @param {() => any} [options.getConfig] - 설정 조회 콜백
   * @param {(serialNumber: string) => { ok: boolean, message?: string }} [options.setSerialNumber] - 시리얼번호 저장 콜백
   * @param {() => Array} [options.getMqttStatus] - MQTT 연결 상태 반환 콜백
   */
  constructor(options = {}) {
    this.port = options.port || 3000;
    this.host = options.host || '0.0.0.0';
    this.getData = typeof options.getData === 'function' ? options.getData : () => null;
    this.getConfig = typeof options.getConfig === 'function' ? options.getConfig : () => null;
    this.setSerialNumber =
      typeof options.setSerialNumber === 'function'
        ? options.setSerialNumber
        : () => ({ ok: false, message: '시리얼번호 변경 기능이 비활성화되어 있습니다.' });
    this.getMqttStatus = typeof options.getMqttStatus === 'function' ? options.getMqttStatus : () => [];

    this.server = null;
  }

  start() {
    if (this.server) return;

    this.server = http.createServer((req, res) => {
      const parsed = url.parse(req.url, true);
      const pathname = parsed.pathname || '/';

      if (pathname === '/' || pathname === '/index.html') {
        const html = this.getHtml();
        res.writeHead(200, {
          'Content-Type': 'text/html; charset=utf-8',
          'Cache-Control': 'no-store',
        });
        res.end(html);
        return;
      }

      if (pathname === '/api/data') {
        const data = this.getData();
        res.writeHead(200, {
          'Content-Type': 'application/json; charset=utf-8',
          'Cache-Control': 'no-store',
        });
        res.end(JSON.stringify({ ok: true, data }, null, 2));
        return;
      }

      // 변경: 설정 조회 (현재 시리얼번호 포함)
      if (pathname === '/api/config') {
        const config = this.getConfig();
        res.writeHead(200, {
          'Content-Type': 'application/json; charset=utf-8',
          'Cache-Control': 'no-store',
        });
        res.end(JSON.stringify({ ok: true, config }, null, 2));
        return;
      }

      // 변경: MQTT 연결 상태 조회
      if (pathname === '/api/mqtt-status') {
        const status = this.getMqttStatus();
        res.writeHead(200, {
          'Content-Type': 'application/json; charset=utf-8',
          'Cache-Control': 'no-store',
        });
        res.end(JSON.stringify({ ok: true, status }, null, 2));
        return;
      }

      // 변경: 시리얼번호 저장
      if (pathname === '/api/serial' && req.method === 'POST') {
        this.readJsonBody(req, 8 * 1024)
          .then((body) => {
            const sn = body && typeof body.serialNumber === 'string' ? body.serialNumber.trim() : '';
            const result = this.setSerialNumber(sn);
            res.writeHead(200, {
              'Content-Type': 'application/json; charset=utf-8',
              'Cache-Control': 'no-store',
            });
            res.end(JSON.stringify(result, null, 2));
          })
          .catch((err) => {
            res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify({ ok: false, message: err.message || '요청 처리 실패' }));
          });
        return;
      }

      // 간단 404
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('404 Not Found');
    });

    this.server.listen(this.port, this.host);
  }

  close() {
    if (!this.server) return;
    try {
      this.server.close();
    } catch (e) {
      // ignore
    } finally {
      this.server = null;
    }
  }

  // 변경: JSON Body 파서(간단 구현, 용량 제한)
  readJsonBody(req, maxBytes) {
    return new Promise((resolve, reject) => {
      let size = 0;
      let raw = '';

      req.on('data', (chunk) => {
        size += chunk.length;
        if (size > maxBytes) {
          reject(new Error('요청 본문이 너무 큽니다.'));
          try {
            req.destroy();
          } catch (e) {}
          return;
        }
        raw += chunk.toString('utf8');
      });

      req.on('end', () => {
        try {
          if (!raw) return resolve({});
          resolve(JSON.parse(raw));
        } catch (e) {
          reject(new Error('JSON 파싱 실패'));
        }
      });

      req.on('error', (e) => reject(e));
    });
  }

  // 변경: 초간단 HTML 대시보드 (polling)
  getHtml() {
    return `<!doctype html>
<html lang="ko">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>결로 모니터링 시스템(센서노드)</title>
    <style>
      /* 변경: 모바일 최적화(1열, 터치 타겟 확대, 줄바꿈) */
      body { font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif; margin: 12px; background: #0b0f14; color: #e6edf3; }
      .container { max-width: 980px; margin: 0 auto; }
      .card { border: 1px solid #30363d; border-radius: 12px; padding: 12px; background: #0d1117; }
      .row { display: grid; grid-template-columns: 1fr; gap: 12px; }
      .kv { display: grid; grid-template-columns: 110px 1fr; gap: 8px 10px; align-items: start; }
      .k { color: #8b949e; font-weight: 500; }
      .v { color: #e6edf3; font-weight: 600; overflow-wrap: anywhere; word-break: break-word; line-height: 1.5; }
      /* 변경: 데이터값 가독성용 색상 클래스 */
      .vl { color: #8b949e; font-weight: 500; }
      .vn { color: #79c0ff; }
      .vt { color: #7ee787; }
      .vy { color: #d29922; }
      .vp { color: #a371f7; }
      .vu { color: #9da7b3; font-weight: 400; }
      .muted { color: #9da7b3; }
      pre { white-space: pre-wrap; word-break: break-word; margin: 0; font-size: 12px; color: #9da7b3; line-height: 1.4; }
      pre .json-key { color: #7ee787; }
      pre .json-str { color: #79c0ff; }
      pre .json-num { color: #d29922; }
      h1 { font-size: 16px; margin: 0 0 10px; display:flex; align-items:center; gap:8px; flex-wrap:wrap; }
      h2 { font-size: 13px; margin: 0 0 8px; color: #c9d1d9; }
      a { color: #58a6ff; }
      .badge { display: inline-block; font-size: 12px; padding: 2px 8px; border-radius: 999px; border: 1px solid #30363d; color: #9da7b3; }
      .mqtt-status { display: flex; gap: 12px; flex-wrap: wrap; align-items: center; }
      .mqtt-item { display: flex; align-items: center; gap: 6px; }
      .mqtt-dot { width: 10px; height: 10px; border-radius: 50%; display: inline-block; }
      .mqtt-dot.ok { background-color: #3fb950; }
      .mqtt-dot.fail { background-color: #f85149; }
      .mqtt-srv { color: #79c0ff; }
      .mqtt-ok { color: #7ee787; }
      .mqtt-fail { color: #f85149; }

      .controls { display:flex; gap:8px; flex-wrap:wrap; align-items:center; }
      input[type="text"], input[type="search"], input { font-size: 16px; } /* iOS 줌 방지 */
      .input { width: 100%; max-width: 260px; padding: 10px 12px; border-radius: 10px; border: 1px solid #30363d; background:#0b0f14; color:#e6edf3; }
      .btn { padding: 10px 12px; border-radius: 10px; border: 1px solid #30363d; background:#161b22; color:#e6edf3; cursor:pointer; min-height: 40px; }
      .btn:active { transform: translateY(1px); }

      /* 모바일에서 키/값 컬럼을 더 촘촘하게 */
      @media (max-width: 420px) {
        body { margin: 10px; }
        .kv { grid-template-columns: 92px 1fr; }
        pre { font-size: 11px; }
      }
    </style>
  </head>
  <body>
    <div class="container">
      <h1>결로 모니터링 시스템(센서노드) <span class="badge" id="status">연결 중...</span></h1>
      <p class="muted">자동 갱신(1초) · API: <a href="/api/data" target="_blank" rel="noreferrer">/api/data</a></p>

      <div class="row">
        <div class="card">
          <h2>요약(한글)</h2>
          <div class="kv" id="summary"></div>
        </div>

        <div class="card">
          <h2>설정(시리얼번호)</h2>
          <div class="kv">
            <div class="k">현재 시리얼번호</div><div class="v" id="currentSn">-</div>
            <div class="k">새 시리얼번호</div>
            <div class="v">
              <div class="controls">
                <input id="newSn" class="input" placeholder="예: gpi26000" />
                 <button id="saveSn" class="btn">저장</button>
              </div>
              <!-- 변경: '안내' 항목(라벨) 제거, 메시지는 아래로 이동 -->
            </div>
          </div>
        </div>

        <div class="card">
          <h2>MQTT 통신 상태</h2>
          <div class="mqtt-status" id="mqttStatus">-</div>
        </div>

        <div class="card">
          <h2>원본 JSON</h2>
          <pre id="raw">{}</pre>
        </div>
      </div>

    <script>
      const $ = (id) => document.getElementById(id);
      const fmt = (v, suffix = '') => (v === null || v === undefined ? 'N/A' : String(v) + suffix);
      // 변경: 숫자 소수점 고정 표시용
      const fmtFixed = (v, digits, suffix = '') => {
        if (v === null || v === undefined) return 'N/A';
        const n = Number(v);
        if (!Number.isFinite(n)) return 'N/A';
        return n.toFixed(digits) + suffix;
      };
      // 변경: 가독성용 색상 span 헬퍼 (vl=라벨, vn=숫자/값, vt=온도/녹색, vy=강조, vp=보조, vu=단위)
      const w = (cls, text) => '<span class="' + cls + '">' + (text === null || text === undefined ? 'N/A' : String(text)) + '</span>';
      // 변경: 서울 시간대로 타임스탬프 포맷팅
      const fmtSeoulTime = (timestamp) => {
        if (!timestamp) return 'N/A';
        try {
          // 변경: ISO 형식 문자열에서 직접 파싱 (예: 2026-01-21T00:22:32.468+09:00 또는 2026-01-21T24:29:36.865+09:00)
          if (typeof timestamp === 'string' && timestamp.includes('T')) {
            // ISO 형식인 경우 직접 파싱 (24시 포함 처리)
            const match = timestamp.match(/(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})/);
            if (match) {
              const [, year, month, day, hour, minute, second] = match;
              // 변경: hour가 24 이상이면 0으로 변환
              let hourNum = parseInt(hour, 10);
              if (hourNum >= 24) {
                hourNum = 0;
              }
              const hourStr = String(hourNum).padStart(2, '0');
              // 변경: 템플릿 리터럴 대신 문자열 연결 사용 (백틱 이스케이프 문제 해결)
              return year + '-' + month + '-' + day + ' ' + hourStr + ':' + minute + ':' + second;
            }
            // 변경: 정규식 매칭 실패 시에도 원본 문자열에서 직접 추출 시도
            const parts = timestamp.split('T');
            if (parts.length === 2) {
              const datePart = parts[0];
              const timePart = parts[1];
              const timeMatch = timePart.match(/(\d{2}):(\d{2}):(\d{2})/);
              if (timeMatch) {
                const [, h, m, s] = timeMatch;
                let hourNum = parseInt(h, 10);
                if (hourNum >= 24) {
                  hourNum = 0;
                }
                const hourStr = String(hourNum).padStart(2, '0');
                return datePart + ' ' + hourStr + ':' + m + ':' + s;
              }
            }
          }
          // 변경: Date 객체로 파싱 시도
          const date = new Date(timestamp);
          if (isNaN(date.getTime())) {
            return String(timestamp);
          }
          // 변경: 서울 시간대로 변환하여 표시
          const formatted = date.toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
          // 변경: 24시가 포함된 경우 처리
          if (formatted.includes('24:')) {
            return formatted.replace(/24:/g, '00:');
          }
          return formatted;
        } catch (e) {
          // 변경: 에러 발생 시에도 24시 처리 시도
          if (typeof timestamp === 'string' && timestamp.includes('T24:')) {
            // 변경: 정규식 대신 문자열 메서드 사용 (이스케이프 문제 해결)
            let result = timestamp.replace(/T24:/g, 'T00:');
            if (result.endsWith('+09:00')) {
              result = result.substring(0, result.length - 6);
            }
            return result.replace('T', ' ');
          }
          return String(timestamp);
        }
      };
      const kv = (k, v) => \`<div class="k">\${k}</div><div class="v">\${v}</div>\`;

      async function loadConfig() {
        try {
          const r = await fetch('/api/config', { cache: 'no-store' });
          const j = await r.json();
          const c = (j && j.config) ? j.config : null;
          const sn = c && c.serial_number ? c.serial_number : null;
          $('currentSn').textContent = sn || 'N/A';
          if (sn && !$('newSn').value) $('newSn').value = sn;
        } catch (e) {
          $('currentSn').textContent = 'N/A';
        }
      }

      async function saveSerial() {
        const sn = ($('newSn').value || '').trim();
        if (!sn) {
          $('snHint').textContent = '시리얼번호를 입력해 주세요.';
          return;
        }
        try {
          const r = await fetch('/api/serial', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ serialNumber: sn }),
          });
          const j = await r.json();
          $('snHint').textContent = (j && j.ok) ? (j.message || '저장되었습니다. 재시작하면 반영됩니다.') : (j.message || '저장 실패');
          await loadConfig();
        } catch (e) {
          $('snHint').textContent = '저장 실패(네트워크/서버 오류)';
        }
      }

      $('saveSn').addEventListener('click', saveSerial);
      $('newSn').addEventListener('keydown', (e) => { if (e.key === 'Enter') saveSerial(); });

      async function updateMqttStatus() {
        try {
          const r = await fetch('/api/mqtt-status', { cache: 'no-store' });
          const j = await r.json();
          const statuses = (j && j.status) ? j.status : [];
          if (statuses.length === 0) {
            $('mqttStatus').innerHTML = '<span class="muted">MQTT 상태 없음</span>';
            return;
          }
          const html = statuses.map(s => {
            const dotClass = s.connected ? 'ok' : 'fail';
            const labelClass = s.connected ? 'mqtt-ok' : 'mqtt-fail';
            const label = s.connected ? '원활' : '실패';
            return \`<div class="mqtt-item"><span class="mqtt-dot \${dotClass}"></span><span class="mqtt-srv">\${s.server}</span> <span class="muted">/</span> <span class="\${labelClass}">\${label}</span></div>\`;
          }).join('');
          $('mqttStatus').innerHTML = html;
        } catch (e) {
          $('mqttStatus').innerHTML = '<span class="muted">상태 조회 실패</span>';
        }
      }

      async function tick() {
        try {
          const r = await fetch('/api/data', { cache: 'no-store' });
          const j = await r.json();
          const d = (j && j.data) ? j.data : null;

          $('status').textContent = '정상';
          $('status').style.borderColor = '#238636';
          $('status').style.color = '#3fb950';

          $('raw').textContent = JSON.stringify(d, null, 2);

          if (!d) {
            $('summary').innerHTML = kv('상태', '데이터 없음');
            return;
          }

          // 변경: ADS1115(A0~A3) 라인 + 가독성용 색상
          const adsLine =
            w('vl','A0(건구) ') + w('vt', fmt(d.dryBulbTemp)) + w('vu','°C') + '/' + w('vn', fmt(d.dryBulbVoltage)) + w('vu','V') +
            ' | ' + w('vl','A1(습구) ') + w('vt', fmt(d.wetBulbTemp)) + w('vu','°C') + '/' + w('vn', fmt(d.wetBulbVoltage)) + w('vu','V') +
            ' | ' + w('vl','A2(과일) ') + w('vt', fmt(d.fruitTemp)) + w('vu','°C') + '/' + w('vn', fmt(d.fruitVoltage)) + w('vu','V') +
            ' | ' + w('vl','A3(토양) ') + w('vt', fmt(d.soilTemp)) + w('vu','°C') + '/' + w('vn', fmt(d.soilVoltage)) + w('vu','V');

          $('summary').innerHTML = [
            kv('기본정보', w('vl','SN ') + w('vn', fmt(d.serialNumber)) + ' | ' + w('vl','IP ') + w('vn', fmt(d.ipAddress)) + ' | ' + w('vl','HW ') + w('vy', fmt(d.gpi_hv)) + ' | ' + w('vl','SW ') + w('vy', fmt(d.gpi_sv)) + ' | ' + w('vp', fmtSeoulTime(d.timestamp))),
            kv('센서', w('vl','온도 ') + w('vt', fmt(d.temperature)) + w('vu','°C') + ' | ' + w('vl','습도 ') + w('vt', fmt(d.humidity)) + w('vu','%') + ' | ' + w('vl','CO2 ') + w('vn', fmt(d.co2)) + w('vu',' ppm')),
            kv('시스템', w('vl','CPU ') + w('vt', fmt(d.cpuTemp)) + w('vu','°C') + ' | ' + w('vl','CPU ') + w('vy', fmt(d.cpuUsage)) + w('vu','%') + ' | ' + w('vl','RAM ') + w('vy', fmt(d.ramUsage)) + w('vu','%') + ' | ' + w('vl','WiFi ') + w('vn', fmt(d.wifiRssi)) + w('vu',' dBm')),
            kv('이슬/결로', w('vl','이슬점 ') + w('vt', fmt(d.dewpoint)) + w('vu','°C') + ' | ' + w('vl','Gap ') + w('vt', fmt(d.gap)) + w('vu','°C') + ' | ' + w('vl','결로점 ') + w('vy', fmt(d.condensationPoint)) + w('vu','°C')),
            kv('VPD/GDD', w('vl','AirVPD ') + w('vn', fmtFixed(d.airVpd, 2)) + w('vu',' kPa') + ' | ' + w('vl','LeafVPD ') + w('vn', fmtFixed(d.leafVpd, 2)) + w('vu',' kPa') + ' | ' + w('vl','GDD ') + w('vn', fmt(d.dailyGdd)) + w('vu',' °C·day')),
            kv('NTC(A0~A3)', adsLine),
          ].join('');
        } catch (e) {
          $('status').textContent = '오류';
          $('status').style.borderColor = '#da3633';
          $('status').style.color = '#f85149';
        }
      }

      tick();
      loadConfig();
      updateMqttStatus();
      setInterval(tick, 1000);
      setInterval(updateMqttStatus, 1000);
    </script>
    </div>
  </body>
</html>`;
  }
}

module.exports = WebServer;

