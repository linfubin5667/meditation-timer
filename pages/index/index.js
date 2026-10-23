// 静心计时 — 冥想计时器（坐禅）
// 引擎：以「阶段结束时刻 − 当前时刻」的绝对时间差计时，切后台被节流也不漂移。
// 结构：一次练习可由多个阶段组成（正坐 → 经行 → 正坐），阶段间双磬、结束三磬。
// 磬声走 BackgroundAudioManager（app.json 已声明后台音频），锁屏可响。
// 完成整场练习后写入本地修行记录（utils/log.js）。

const practiceLog = require('../../utils/log.js');

const DURATIONS = [5, 10, 15, 20, 30, 45, 60];
const INTERVALS = [0, 1, 3, 5, 10]; // 分钟，0 = 不提醒
const STRUCTURES = [
  { id: 'single', name: '单段', desc: '' },
  { id: 'zen-short', name: '坐·行·坐', desc: '正坐15 · 经行5 · 正坐15' },
  { id: 'zen-long', name: '坐·行·坐 长', desc: '正坐20 · 经行5 · 正坐20' }
];
const STRUCTURE_PHASES = {
  'zen-short': [['正坐', 15], ['经行', 5], ['正坐', 15]],
  'zen-long': [['正坐', 20], ['经行', 5], ['正坐', 20]]
};
const BOWL = '/assets/bowl.mp3';
const BOWL_SOFT = '/assets/bowl-soft.mp3';

function fmt(ms) {
  const totalSec = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return (m < 10 ? '0' + m : '' + m) + ':' + (s < 10 ? '0' + s : '' + s);
}

Page({
  data: {
    durations: DURATIONS,
    intervals: INTERVALS,
    structures: STRUCTURES,
    structureId: 'single',
    durationMin: 20,
    intervalMin: 5,
    state: 'idle', // idle | running | paused | done
    remainText: '20:00',
    phaseText: '',
    progressDeg: 0,
    keepScreenOn: true,
    statusText: '选好时长，点开始',
    stats: null,
    totalText: ''
  },

  // —— 内部状态 ——
  _timer: null,
  _phases: [],          // [{name, ms}]
  _phaseIdx: 0,
  _phaseEndAt: 0,       // 当前阶段结束的墙钟时刻
  _phaseLeftMs: 0,      // 暂停时当前阶段剩余
  _sessionTotalMs: 0,
  _nextBellAt: 0,       // 当前阶段剩余 <= 该值时敲间隔磬；0 = 无
  _bgm: null,
  _chimesLeft: 0,       // 还要连敲的磬数（阶段双磬 / 结束三磬共用）

  onLoad() {
    const bgm = wx.getBackgroundAudioManager();
    bgm.title = '静心计时 · 磬声';
    bgm.singer = '静心计时';
    bgm.onEnded(() => {
      if (this._chimesLeft > 0) {
        this._chimesLeft -= 1;
        this._playBowl(BOWL);
      }
    });
    bgm.onError((err) => {
      console.warn('后台音频出错，改用前台音频兜底', err);
      this._fallbackPlay(BOWL);
    });
    this._bgm = bgm;
    this._buildPhases();
    this._render(0);
    this._refreshStats();
  },

  onShow() {
    if (this.data.state === 'running') this._tick();
    this._refreshStats();
  },

  onUnload() {
    this._stopTick();
  },

  _refreshStats() {
    const s = practiceLog.stats();
    const totalText = s.totalMin >= 60
      ? (Math.round(s.totalMin / 6) / 10) + ' 小时'
      : s.totalMin + ' 分钟';
    this.setData({ stats: s, totalText: totalText });
  },

  goBreathing() {
    wx.navigateTo({ url: '/pages/breathing/breathing' });
  },

  // —— 选参 ——
  setStructure(e) {
    const id = e.currentTarget.dataset.id;
    this.setData({ structureId: id });
    this._buildPhases();
    this._render(0);
  },

  setDuration(e) {
    const min = Number(e.currentTarget.dataset.min);
    this.setData({ durationMin: min });
    this._buildPhases();
    this._render(0);
  },

  setIntervalOption(e) {
    this.setData({ intervalMin: Number(e.currentTarget.dataset.min) });
    if (this.data.state === 'running' || this.data.state === 'paused') {
      this._recomputeNextBell();
    }
  },

  toggleKeepScreenOn(e) {
    const on = !!e.detail.value;
    this.setData({ keepScreenOn: on });
    if (this.data.state === 'running' || this.data.state === 'paused') {
      wx.setKeepScreenOn({ keepScreenOn: on });
    }
  },

  _buildPhases() {
    if (this.data.structureId === 'single') {
      this._phases = [{ name: '正坐', ms: this.data.durationMin * 60 * 1000 }];
    } else {
      this._phases = STRUCTURE_PHASES[this.data.structureId].map(function (p) {
        return { name: p[0], ms: p[1] * 60 * 1000 };
      });
    }
    this._sessionTotalMs = this._phases.reduce(function (a, p) { return a + p.ms; }, 0);
    this._phaseIdx = 0;
  },

  _phaseElapsedMs(leftInPhase) {
    let elapsed = 0;
    for (let i = 0; i < this._phaseIdx; i++) elapsed += this._phases[i].ms;
    return elapsed + (this._phases[this._phaseIdx].ms - leftInPhase);
  },

  // —— 流程 ——
  start() {
    this._buildPhases();
    this._phaseIdx = 0;
    this._phaseEndAt = Date.now() + this._phases[0].ms;
    this._chimesLeft = 0;
    this._recomputeNextBell();
    this.setData({ state: 'running' });
    wx.setKeepScreenOn({ keepScreenOn: this.data.keepScreenOn });
    this._playBowl(BOWL); // 开始一磬
    if (wx.vibrateShort) wx.vibrateShort();
    this._startTick();
  },

  pause() {
    this._stopTick();
    this._phaseLeftMs = Math.max(0, this._phaseEndAt - Date.now());
    this.setData({ state: 'paused', statusText: '已暂停' });
    wx.setKeepScreenOn({ keepScreenOn: false });
    this._render(this._phaseLeftMs);
  },

  resume() {
    this._phaseEndAt = Date.now() + this._phaseLeftMs;
    this.setData({ state: 'running' });
    wx.setKeepScreenOn({ keepScreenOn: this.data.keepScreenOn });
    this._startTick();
  },

  reset() {
    this._stopTick();
    if (this._bgm) this._bgm.stop();
    this._chimesLeft = 0;
    this._buildPhases();
    this.setData({ state: 'idle', statusText: '选好时长，点开始' });
    wx.setKeepScreenOn({ keepScreenOn: false });
    this._render(0);
  },

  _advancePhase() {
    this._phaseIdx += 1;
    const phase = this._phases[this._phaseIdx];
    this._phaseEndAt = Date.now() + phase.ms;
    this._recomputeNextBell();
    this._chimesLeft = 1; // 阶段交界共双磬
    this._playBowl(BOWL);
    if (wx.vibrateShort) wx.vibrateShort();
    this._render(phase.ms);
  },

  _finish() {
    this._stopTick();
    this._chimesLeft = 2; // 结束共三磬
    this.setData({ state: 'done', statusText: '完成', phaseText: '' });
    wx.setKeepScreenOn({ keepScreenOn: false });
    if (wx.vibrateLong) wx.vibrateLong();
    this._playBowl(BOWL);
    this._render(0);
    practiceLog.record(Math.round(this._sessionTotalMs / 60000), 'sit');
    this._refreshStats();
  },

  // —— 计时 ——
  _startTick() {
    this._stopTick();
    this._timer = setInterval(() => this._tick(), 250);
    this._tick();
  },

  _stopTick() {
    if (this._timer) {
      clearInterval(this._timer);
      this._timer = null;
    }
  },

  _tick() {
    const left = this._phaseEndAt - Date.now();

    if (left <= 0) {
      if (this._phaseIdx < this._phases.length - 1) {
        this._advancePhase();
      } else {
        this._finish();
      }
      return;
    }

    if (this._nextBellAt > 0 && left <= this._nextBellAt) {
      this._playBowl(BOWL_SOFT);
      const ivMs = this.data.intervalMin * 60 * 1000;
      let next = this._nextBellAt - ivMs;
      while (next > 0 && next >= left) next -= ivMs;
      this._nextBellAt = next > 0 ? next : 0;
    }

    this._render(left);
  },

  _recomputeNextBell() {
    const iv = this.data.intervalMin;
    if (!iv || !this._phases.length) {
      this._nextBellAt = 0;
      return;
    }
    const ivMs = iv * 60 * 1000;
    const phaseMs = this._phases[this._phaseIdx].ms;
    const left = (this.data.state === 'running' || this.data.state === 'paused')
      ? Math.max(0, this._phaseEndAt - Date.now())
      : phaseMs;
    let next = left - (left % ivMs);
    if (next >= left) next -= ivMs;
    this._nextBellAt = next > 0 ? next : 0;
  },

  _render(leftInPhase) {
    if (!this._phases.length) return;
    const phase = this._phases[this._phaseIdx];
    const left = leftInPhase === 0 && this.data.state === 'idle'
      ? phase.ms
      : leftInPhase;
    const elapsed = this._phaseElapsedMs(left);
    const deg = this._sessionTotalMs > 0
      ? Math.min(360, Math.max(0, elapsed / this._sessionTotalMs * 360))
      : 0;
    let phaseText = '';
    if (this.data.state === 'running' || this.data.state === 'paused') {
      phaseText = this._phases.length > 1
        ? phase.name + ' · 第 ' + (this._phaseIdx + 1) + ' / ' + this._phases.length + ' 段'
        : phase.name;
    }
    this.setData({
      remainText: fmt(left),
      progressDeg: Math.round(deg * 10) / 10,
      phaseText: phaseText,
      statusText: this.data.state === 'running'
        ? '进行中'
        : (this.data.state === 'paused' ? '已暂停' : this.data.statusText)
    });
  },

  // —— 磬声 ——
  _playBowl(src) {
    try {
      const bgm = this._bgm;
      bgm.title = '静心计时 · 磬声';
      bgm.singer = '静心计时';
      bgm.src = src;
    } catch (e) {
      this._fallbackPlay(src);
    }
  },

  _fallbackPlay(src) {
    const ctx = wx.createInnerAudioContext();
    ctx.src = src;
    ctx.onEnded(() => ctx.destroy());
    ctx.onError(() => ctx.destroy());
    ctx.play();
  }
});
