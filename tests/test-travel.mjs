// tests/test-travel.mjs — 出行配置 + MCP 探针（真的驱动生产函数，不是复述实现）
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as T from '../lib/travel.js';

let pass = 0, fail = 0;
function ok(name, cond, detail) {
  if (cond) { pass++; console.log('PASS ' + name); }
  else { fail++; console.log('FAIL ' + name + (detail ? ' — ' + detail : '')); }
}
function eq(name, got, want) { ok(name + ' = ' + JSON.stringify(want), JSON.stringify(got) === JSON.stringify(want), 'got ' + JSON.stringify(got)); }

// ---------- 1. 输入收敛 ----------
const KEY = 'a'.repeat(32);
eq('裸 key 拼端点', T.buildUrl(KEY).url, 'https://mcp.amap.com/mcp?key=' + KEY);
eq('裸 key 取到 key', T.buildUrl(KEY).key, KEY);
eq('带空白/引号的 key', T.buildUrl('  "' + KEY + '"  ').url, 'https://mcp.amap.com/mcp?key=' + KEY);
const full = T.buildUrl('https://mcp.amap.com/mcp?key=' + KEY);
eq('完整地址原样', full.url, 'https://mcp.amap.com/mcp?key=' + KEY);
eq('完整地址取 key', full.key, KEY);
ok('空输入报错', Boolean(T.buildUrl('   ').error));
ok('乱码报错', Boolean(T.buildUrl('这不是key').error));
ok('非 http 协议报错', Boolean(T.buildUrl('ftp://x/y').error));
ok('过长报错', Boolean(T.buildUrl(KEY + '?'.repeat(600)).error));

// 打码：面板只能看到首尾各 4 位
const masked = T.maskUrl('https://mcp.amap.com/mcp?key=' + KEY);
ok('打码不含完整 key', !masked.includes(KEY), masked);
ok('打码保留开头 4 位', masked.includes('aaaa'), masked);
eq('打码保留其它参数', T.maskUrl('https://mcp.amap.com/mcp?key=' + KEY + '&x=1'), 'https://mcp.amap.com/mcp?key=aaaa…aaaa&x=1');

// ---------- 2. 落盘 / 读回 ----------
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cura-travel-'));
const file = path.join(dir, 'travel.json');
eq('文件不存在 = 未配置', T.state(file).enabled, false);
ok('未配置时无 url', T.state(file).url === '');
eq('未配置不产出 server', T.serverFromTravel(file), null);

T.saveTravel(file, T.buildUrl('https://mcp.amap.com/mcp?key=' + KEY));
const st = T.state(file);
eq('保存后 enabled', st.enabled, true);
eq('保存后 hasKey', st.hasKey, true);
ok('state 只回 masked url', !st.url.includes(KEY), st.url);
eq('state 回 key 末四位', st.keyTail, 'aaaa');
ok('state 带 file 路径', st.file === file);
const server = T.serverFromTravel(file);
eq('产出 server 名', server.serverName, 'amap');
eq('产出 transport', server.transport, 'streamable-http');
eq('产出 url 是明文（挂载需要）', server.url, 'https://mcp.amap.com/mcp?key=' + KEY);

// 坏文件不炸：面板要能打开
fs.writeFileSync(file, '{ 坏 JSON', 'utf8');
eq('坏文件当未配置', T.state(file).enabled, false);
ok('坏文件不抛', T.serverFromTravel(file) === null);

// 关闭
T.saveTravel(file, { enabled: false });
eq('disabled 后不出 server', T.serverFromTravel(file), null);

// ---------- 3. 响应解析（三种形态） ----------
eq('纯 JSON 解析',
  T.parseRpcPayload(JSON.stringify({ jsonrpc: '2.0', id: 2, result: { tools: [{ name: 'maps_weather' }] } }), 'application/json').value.result.tools[0].name,
  'maps_weather');
const sse = 'event: message\ndata: {"jsonrpc":"2.0","id":2,"result":{"tools":[{"name":"maps_geo"}]}}\n\n';
eq('SSE 解析', T.parseRpcPayload(sse, 'text/event-stream').value.result.tools[0].name, 'maps_geo');
const batch = JSON.stringify([{ jsonrpc: '2.0', method: 'notifications/progress' }, { jsonrpc: '2.0', id: 2, result: { tools: [] } }]);
eq('批量数组挑带 result 的那条', T.parseRpcPayload(batch, 'application/json').value.id, 2);
ok('空响应报错', Boolean(T.parseRpcPayload('', 'application/json').error));
ok('非 JSON 报错', Boolean(T.parseRpcPayload('<html>502</html>', 'text/html').error));

// ---------- 4. probeMcp 打通一个假 MCP server ----------
function startFakeServer(mode) {
  const seen = [];
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      const body = raw ? JSON.parse(raw) : null;
      seen.push({ method: body?.method, sid: req.headers['mcp-session-id'] || '' });
      const send = (obj, opts) => {
        const payload = JSON.stringify(obj);
        if (mode === 'sse' || (opts && opts.sse)) {
          res.writeHead(200, { 'content-type': 'text/event-stream', 'mcp-session-id': 'sess-1' });
          res.end('event: message\ndata: ' + payload + '\n\n');
        } else {
          res.writeHead(200, { 'content-type': 'application/json', 'mcp-session-id': 'sess-1' });
          res.end(payload);
        }
      };
      if (!body || body.method === undefined) { res.writeHead(202, { 'mcp-session-id': 'sess-1' }); res.end(); return; }
      if (body.method === 'initialize') {
        if (mode === 'auth-fail') { res.writeHead(401, { 'content-type': 'application/json' }); res.end('{"error":"INVALID_USER_KEY"}'); return; }
        send({ jsonrpc: '2.0', id: body.id, result: { protocolVersion: '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'fake-amap', version: '1' } } });
        return;
      }
      if (body.method === 'notifications/initialized') { res.writeHead(202); res.end(); return; }
      if (body.method === 'tools/list') {
        send({ jsonrpc: '2.0', id: body.id, result: { tools: [{ name: 'maps_weather' }, { name: 'maps_geo' }, { name: 'maps_distance' }] } });
        return;
      }
      if (body.method === 'tools/call') {
        const name = body.params && body.params.name;
        const args = (body.params && body.params.arguments) || {};
        seen.push({ method: 'tools/call:' + name, sid: req.headers['mcp-session-id'] || '', args: args });
        if (name === 'maps_geo') {
          const hit = String(args.address || '').includes('西湖')
            ? { results: [
                { location: '120.758403,24.539931', province: '台湾省', city: '苗栗县', district: '西湖乡', level: '乡镇' },
                { location: '120.024682,30.293915', province: '浙江省', city: '杭州市', district: '余杭区', level: '兴趣点' },
              ] }
            : args.address === '没有这个地方' ? { results: [] } : { results: [{ location: '120.024682,30.293915', province: '浙江省', city: '杭州市', district: '余杭区', level: '兴趣点' }] };
          send({ jsonrpc: '2.0', id: body.id, result: { content: [{ type: 'text', text: JSON.stringify(hit) }] } });
          return;
        }
        if (name === 'maps_around_search') {
          send({ jsonrpc: '2.0', id: body.id, result: { content: [{ type: 'text', text: JSON.stringify({ pois: [
            { id: 'B1', name: '瑞幸咖啡(假店)', address: '某路 1 号', typecode: '050500' },
            { id: 'B2', name: '库迪咖啡(假店)', address: '某路 2 号', typecode: '050500' },
          ] }) }] } });
          return;
        }
        if (name === 'maps_weather') {
          send({ jsonrpc: '2.0', id: body.id, result: { content: [{ type: 'text', text: '北京 晴 12℃（假数据）' }] } });
          return;
        }
        if (name === 'maps_distance') {
          send({ jsonrpc: '2.0', id: body.id, result: { isError: true, content: [{ type: 'text', text: '缺参数' }] } });
          return;
        }
        send({ jsonrpc: '2.0', id: body.id, result: { content: [{ type: 'text', text: '北京 晴 12℃（假数据）' }] } });
        return;
      }
      res.writeHead(400); res.end('{}');
    });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port, seen })));
}

const fake = await startFakeServer('json');
const r1 = await T.probeMcp('http://127.0.0.1:' + fake.port + '/mcp?key=' + KEY);
ok('假 server 连通', r1.ok === true, r1.error);
eq('拿到 3 个工具', r1.tools.length, 3);
eq('优先试调 maps_weather', r1.sample && r1.sample.tool, 'maps_weather');
ok('试调拿到正文', String(r1.sample && r1.sample.text).includes('北京'), JSON.stringify(r1.sample));
ok('返回里 url 已打码', !JSON.stringify(r1).includes(KEY), 'leak');
ok('报告里有 initialize/tools/list 足迹', r1.steps.length >= 2 && r1.steps.some((s) => s.startsWith('tools/list')), JSON.stringify(r1.steps));
ok('后续请求带上 session id', fake.seen.some((x) => x.method === 'tools/list' && x.sid === 'sess-1'), JSON.stringify(fake.seen));
ok('探针耗时 > 0', r1.ms >= 0);
fake.server.close();

const fakeSse = await startFakeServer('sse');
const r2 = await T.probeMcp('http://127.0.0.1:' + fakeSse.port + '/mcp?key=' + KEY);
ok('SSE 形态也通', r2.ok === true, r2.error);
eq('SSE 形态工具数', r2.tools.length, 3);
fakeSse.server.close();

const fakeAuth = await startFakeServer('auth-fail');
const r3 = await T.probeMcp('http://127.0.0.1:' + fakeAuth.port + '/mcp?key=' + KEY);
ok('鉴权失败不出假成功', r3.ok === false);
ok('鉴权失败带原始错误', String(r3.error).includes('401'), r3.error);
fakeAuth.server.close();

// 连不上：给一个没人监听的端口
const dead = await new Promise((resolve) => {
  const s = http.createServer();
  s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); });
});
const r4 = await T.probeMcp('http://127.0.0.1:' + dead + '/mcp?key=' + KEY, { timeoutMs: 1500 });
ok('连不上时 ok=false', r4.ok === false);
ok('连不上带「连不上」原因', String(r4.error).startsWith('连不上'), r4.error);

// ---------- 5. 常用坐标：收敛 / 落盘 / 去重 / 上限 ----------
eq('坐标合法', T.normalizePlace({ name: '学校', location: '120.024682,30.293915' }).location, '120.024682,30.293915');
eq('坐标非法返 null', T.normalizePlace({ name: 'x', location: '经度,纬度' }), null);
eq('缺坐标返 null', T.normalizePlace({ name: 'x' }), null);
eq('非对象返 null', T.normalizePlace(null), null);
eq('name 缺省用坐标', T.normalizePlace({ location: '1.5,-2.5' }).name, '1.5,-2.5');
ok('name 截到 40 字', T.normalizePlace({ name: 'x'.repeat(80), location: '1,2' }).name.length === 40);

const pfile = path.join(dir, 'places.json');
T.saveTravel(pfile, { url: 'https://mcp.amap.com/mcp?key=' + KEY, key: KEY });
eq('初始没有常用坐标', T.state(pfile).places.length, 0);
T.saveTravel(pfile, { places: [{ name: '学校', address: '余杭塘路', location: '120.024682,30.293915', city: '杭州' }] });
const afterOne = T.state(pfile).places;
eq('存一条', afterOne.length, 1);
eq('存回来的 name', afterOne[0].name, '学校');
eq('存回来的 address', afterOne[0].address, '余杭塘路');
eq('存回来的 city', afterOne[0].city, '杭州');
ok('id = name|location', afterOne[0].id === '学校|120.024682,30.293915', afterOne[0].id);

// 存坐标不能把 key 弄丢（patch 不带 url/key 时沿用）
eq('存坐标保留 url', JSON.parse(fs.readFileSync(pfile, 'utf8')).amap.key, KEY);

// 去重：同一 name+location 只留一条；非法条目被丢掉
T.saveTravel(pfile, { places: [
  { name: '学校', location: '120.024682,30.293915' },
  { name: '学校', location: '120.024682,30.293915' },
  { name: '坏', location: 'nope' },
  { name: '家', location: '120.1,30.1' },
] });
const dedup = T.state(pfile).places;
eq('去重后两条', dedup.length, 2);
eq('去重保留顺序', dedup.map((x) => x.name).join(','), '学校,家');

// 上限 20 条
const many = Array.from({ length: 30 }, (_, i) => ({ name: 'p' + i, location: '120.' + i + ',30.' + i }));
T.saveTravel(pfile, { places: many });
eq('常用坐标上限 20', T.state(pfile).places.length, 20);

// 空 places 显式传数组 = 清空
T.saveTravel(pfile, { places: [] });
eq('显式空数组清空', T.state(pfile).places.length, 0);

// 坏文件不炸
fs.writeFileSync(pfile, '{ 坏', 'utf8');
eq('坏文件 places 为空', T.state(pfile).places.length, 0);

// ---------- 5.5 注入提示（placesPrompt 是纯函数，直接验文本） ----------
eq('没有地点 = 空串', T.placesPrompt([]), '');
eq('非数组也不炸', T.placesPrompt(null), '');
const hint = T.placesPrompt([
  { name: '学校', location: '120.024682,30.293915', address: '余杭塘路 2318 号' },
  { name: '家', location: '120.155070,30.274085' },
  { name: '坏', location: 'nope' },
]);
ok('提示带标头', hint.includes('【常用坐标】'), hint);
ok('提示带名字与坐标', hint.includes('学校：120.024682,30.293915'), hint);
ok('提示带地址', hint.includes('（余杭塘路 2318 号）'), hint);
ok('提示丢掉非法坐标', !hint.includes('坏'), hint);
ok('提示教它用 maps_geo 查别的', hint.includes('maps_geo'), hint);
ok('提示强调带 city', hint.includes('city'), hint);

// ---------- 6. locatePlace / aroundSearch 打假 server ----------
const fakeLoc = await startFakeServer('json');
const locBase = 'http://127.0.0.1:' + fakeLoc.port + '/mcp';

const good = await T.locatePlace(locBase, '杭州师范大学仓前校区');
ok('locate 成功', good.ok === true, good.error);
eq('locate 取到坐标', good.picked.location, '120.024682,30.293915');
eq('locate 挑第一条', good.matches[0].city, '杭州市');
eq('locate 记录城市', good.matches[0].district, '余杭区');
ok('locate 不泄漏 key', !JSON.stringify(good).includes(KEY));

const amb = await T.locatePlace(locBase, '西湖', { city: '杭州' });
eq('locate 同名歧义时原样回多条', amb.matches.length, 2);
eq('locate 歧义第一条仍是 geo 的第一条', amb.picked.province, '台湾省');

const miss = await T.locatePlace(locBase, '没有这个地方');
ok('locate 没结果 ok=false', miss.ok === false);
ok('locate 没结果带原因', String(miss.error).includes('没解析出坐标'), miss.error);
const emptyIn = await T.locatePlace(locBase, '   ');
ok('locate 空输入不联网也不抛', emptyIn.ok === false && emptyIn.ms === 0);

// city 有没有真的传给工具
const sentGeo = fakeLoc.seen.find((x) => x.method === 'tools/call:maps_geo' && x.args && x.args.city === '杭州');
ok('locate 把 city 传给了 maps_geo', Boolean(sentGeo), JSON.stringify(fakeLoc.seen.filter((x) => x.method === 'tools/call:maps_geo')));

const near = await T.aroundSearch(locBase, '咖啡', { location: '120.024682,30.293915' });
ok('around 成功', near.ok === true, near.error);
eq('around 两条 POI', near.pois.length, 2);
eq('around 第一条名字', near.pois[0].name, '瑞幸咖啡(假店)');
const nearBad = await T.aroundSearch(locBase, '咖啡', { location: '哪里' });
ok('around 坐标非法直接拒', nearBad.ok === false && String(nearBad.error).includes('坐标'), nearBad.error);
const nearNoKw = await T.aroundSearch(locBase, '  ', { location: '120.024682,30.293915' });
ok('around 空关键词直接拒', nearNoKw.ok === false);

// 工具返回 isError 不能当成成功
const errTool = await T.callTool(locBase, 'maps_distance', { origins: '1,2' });
ok('isError 判失败', errTool.ok === false);
ok('isError 带工具原文', String(errTool.error).includes('缺参数'), errTool.error);
fakeLoc.server.close();

const fakeDead = await new Promise((resolve) => {
  const s2 = http.createServer();
  s2.listen(0, '127.0.0.1', () => { const p2 = s2.address().port; s2.close(() => resolve(p2)); });
});
const locDead = await T.locatePlace('http://127.0.0.1:' + fakeDead + '/mcp', '学校', { timeoutMs: 1500 });
ok('locate 连不上不假装成功', locDead.ok === false && String(locDead.error).startsWith('连不上'), locDead.error);

fs.rmSync(dir, { recursive: true, force: true });
console.log('\n' + pass + ' PASS / ' + fail + ' FAIL');
if (fail) { console.log('TRAVEL TESTS FAILED'); process.exit(1); }
console.log('all travel tests passed ✓');
