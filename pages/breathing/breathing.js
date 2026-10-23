// 呼吸引导 — 跟着圆环一呼一吸
// 圆环大小随呼吸阶段变化：吸气放大、屏息保持、呼气回落；阶段交界轻敲木鱼。
// 计时同样用绝对时间（阶段结束时刻 − 当前时刻），切后台不漂移。

const practiceLog = require('../../utils/log.js');

const PATTERNS = [
  { id: '478', name: '4-7-8 安神', inhale: 4, hold: 7, exhale: 8, hold2: 0 },
  { id: 'box', name: '盒式呼吸', inhale: 4, hold: 4, exhale: 4, hold2: 4 },
  { id: 'balance', name: '平衡呼吸', inhale: 4, hold: 0, exhale: 4, hold2: 0 },
  { id: 'relax', name: '放松呼吸', inhale: 4, hold: 0, exhale: 6, hold2: 0 }
];
const MINUTES = [3, 5, 10, 15];
const BOWL = '/assets/bowl.mp3';
const MUYU = '/assets/muyu.mp3';
const BASE_SCALE = 1.0;
const FULL_SCALE = 1.32;

Page({
  data: {
    patterns: PATTERNS,
    minutesOptions: MINUTES,
    patternId: '478',
    totalMin: 5,
    state: 'idle', // idle | running | paused | done
    phaseName: '准备',
    phaseCount: '',
    cycles: 0,
    scale: BASE_SCALE,
    statusText: '选一个节奏，点开始'
  },

  _timer: null,
  _phases: [],        // 当前模式的阶段表 [{name, sec, from, to}]
  _phaseIdx: 0,
  _phaseEndAt: 0,
  _sessionEndAt: 0,
  _phaseLeftMs: 0,
  _sessionLeftMs: 0,
  _cycles: 0,
  _bgm: null,

  onLoad() {
    const bgm = wx.getBackgroundAudioManager();
    bgm.title = '静心计时 · 呼吸引导';
    bgm.singer = '静心计时';
    this._bgm = bgm;
    this._buildPhases();
  },

  onUnload() {
    this._stopTick();
  },

  _buildPhases() {
    const p = PATTERNS.find((x) => x.id === this.data.patternId) || PATTERNS[0];
    const raw = [
      { name: '吸气', sec: p.inhale, from: BASE_SCALE, to: FULL_SCALE },
      { name: '屏息', sec: p.hold, from: FULL_SCALE, to: FULL_SCALE },
      { name: '呼气', sec: p.exhale, from: FULL_SCALE, to: BASE_SCALE },
      { name: '屏息', sec: p.hold2, from: BASE_SCALE, to: BASE_SCALE }
    ];
    this._phases = raw.filter((x) => x.sec > 0);
  },

  setPattern(e) {
    this.setData({ patternId: e.currentTarget.dataset.id });
    this._buildPhases();
  },

  setMinutes(e) {
    this.setData({ totalMin: Number(e.currentTarget.dataset.min) });
  },

  start() {
    this._buildPhases();
    const now = Date.now();
    this._sessionEndAt = now + this.data.totalMin * 60 * 1000;
    this._phaseIdx = 0;
    this._phaseEndAt = now + this._phases[0].sec * 1000;
    this._cycles = 0;
    this.setData({ state: 'running', cycles: 0, statusText: '跟着圆环呼吸' });
    wx.setKeepScreenOn({ keepScreenOn: true });
    this._playMuyu();
    this._startTick();
  },

  pause() {
    this._stopTick();
    const now = Date.now();
    this._phaseLeftMs = Math.max(0, this._phaseEndAt - now);
    this._sessionLeftMs = Math.max(0, this._sessionEndAt - now);
    this.setData({ state: 'paused', statusText: '已暂停' });
    wx.setKeepScreenOn({ keepScreenOn: false });
  },

  resume() {
    const now = Date.now();
    this._phaseEndAt = now + this._phaseLeftMs;
    this._sessionEndAt = now + this._sessionLeftMs;
    this.setData({ state: 'running', statusText: '跟着圆环呼吸' });
    wx.setKeepScreenOn({ keepScreenOn: true });
    this._startTick();
  },

  reset() {
    this._stopTick();
    this.setData({
      state: 'idle',
      phaseName: '准备',
      phaseCount: '',
      scale: BASE_SCALE,
      cycles: 0,
      statusText: '选一个节奏，点开始'
    });
    wx.setKeepScreenOn({ keepScreenOn: false });
  },

  _finish() {
    this._stopTick();
    this.setData({
      state: 'done',
      phaseName: '完成',
      phaseCount: '',
      scale: BASE_SCALE,
      statusText: '这一轮呼吸完成了'
    });
    wx.setKeepScreenOn({ keepScreenOn: false });
    if (wx.vibrateLong) wx.vibrateLong();
    try {
      this._bgm.title = '静心计时 · 磬声';
      this._bgm.src = BOWL;
    } catch (e) { /* 音频失败不影响完成状态 */ }
    practiceLog.record(this.data.totalMin, 'breathing');
  },

  _startTick() {
    this._stopTick();
    this._timer = setInterval(() => this._tick(), 50);
    this._tick();
  },

  _stopTick() {
    if (this._timer) {
      clearInterval(this._timer);
      this._timer = null;
    }
  },

  _tick() {
    const now = Date.now();
    if (now >= this._sessionEndAt) {
      this._finish();
      return;
    }
    if (now >= this._phaseEndAt) {
      // 进入下一阶段（可能跨过多个阶段：后台回来时一次补齐）
      while (now >= this._phaseEndAt && this._phaseEndAt < this._sessionEndAt) {
        this._phaseIdx += 1;
        if (this._phaseIdx >= this._phases.length) {
          this._phaseIdx = 0;
          this._cycles += 1;
        }
        this._phaseEndAt += this._phases[this._phaseIdx].sec * 1000;
      }
      this._playMuyu();
      this.setData({ cycles: this._cycles });
    }
    const phase = this._phases[this._phaseIdx];
    const phaseMs = phase.sec * 1000;
    const leftMs = Math.max(0, this._phaseEndAt - now);
    const progress = Math.min(1, Math.max(0, 1 - leftMs / phaseMs));
    const scale = phase.from + (phase.to - phase.from) * progress;
    this.setData({
      phaseName: phase.name,
      phaseCount: '' + Math.ceil(leftMs / 1000),
      scale: Math.round(scale * 1000) / 1000
    });
  },

  _playMuyu() {
    const ctx = wx.createInnerAudioContext();
    ctx.src = MUYU;
    ctx.onEnded(() => ctx.destroy());
    ctx.onError(() => ctx.destroy());
    ctx.play();
  }
});
