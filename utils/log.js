// 修行记录：本地存储每次完成的练习，算今日/连续天数/累计统计。
// 数据只存在用户手机本地，不上传任何服务器。

const KEY = 'practice_logs';

function dateStr(d) {
  const m = d.getMonth() + 1;
  const day = d.getDate();
  return d.getFullYear() + '-' + (m < 10 ? '0' + m : m) + '-' + (day < 10 ? '0' + day : day);
}

function record(minutes, mode) {
  if (!minutes || minutes <= 0) return;
  let logs = [];
  try { logs = wx.getStorageSync(KEY) || []; } catch (e) { logs = []; }
  logs.push({ date: dateStr(new Date()), minutes: minutes, mode: mode || 'sit', ts: Date.now() });
  try { wx.setStorageSync(KEY, logs); } catch (e) { /* 存储失败不打断练习 */ }
}

function stats() {
  let logs = [];
  try { logs = wx.getStorageSync(KEY) || []; } catch (e) { logs = []; }

  const byDay = {};
  let total = 0;
  for (const l of logs) {
    byDay[l.date] = (byDay[l.date] || 0) + (l.minutes || 0);
    total += l.minutes || 0;
  }

  const today = new Date();
  const todayMin = byDay[dateStr(today)] || 0;

  // 连续天数：从今天往前数；今天还没练则从昨天起算（当天结束前不算断）
  let streak = 0;
  const cursor = new Date(today);
  if (!byDay[dateStr(cursor)]) cursor.setDate(cursor.getDate() - 1);
  while (byDay[dateStr(cursor)]) {
    streak += 1;
    cursor.setDate(cursor.getDate() - 1);
  }

  // 最近 7 天（旧 → 新）
  const last7 = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const ds = dateStr(d);
    last7.push({ date: ds, minutes: byDay[ds] || 0 });
  }

  return { todayMin: todayMin, streak: streak, totalMin: total, last7: last7, sessions: logs.length };
}

module.exports = { record: record, stats: stats };
