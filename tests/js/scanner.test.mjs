import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = await readFile(new URL('../../src/main/resources/static/js/scanner.js', import.meta.url), 'utf8');
const { QrScanner } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((accept, fail) => { resolve = accept; reject = fail; });
  return { promise, resolve, reject };
}

function mediaStream(deviceId = 'rear') {
  class Track extends EventTarget {
    stops = 0;
    stop() { this.stops++; }
    getSettings() { return { deviceId }; }
  }
  const videoTrack = new Track();
  const extraTrack = new Track();
  return {
    videoTrack,
    extraTrack,
    getTracks: () => [videoTrack, extraTrack],
    getVideoTracks: () => [videoTrack]
  };
}

const flush = () => new Promise(resolve => setImmediate(resolve));

function environment({ decoder = () => null, detector, getUserMedia, secure = true } = {}) {
  const requests = [];
  const frames = new Map();
  const states = [];
  const errors = [];
  const scans = [];
  const deviceUpdates = [];
  let nextFrame = 1;
  const mediaDevices = new EventTarget();
  mediaDevices.devices = [];
  mediaDevices.enumerateDevices = async () => mediaDevices.devices;
  mediaDevices.getUserMedia = constraints => {
    const pending = deferred();
    requests.push({ constraints, ...pending });
    return getUserMedia ? getUserMedia(constraints) : pending.promise;
  };
  const video = {
    srcObject: null,
    readyState: 4,
    videoWidth: 1280,
    videoHeight: 720,
    plays: 0,
    pauses: 0,
    setAttribute() {},
    play() { this.plays++; return Promise.resolve(); },
    pause() { this.pauses++; }
  };
  const canvas = { width: 0, height: 0 };
  const context = {
    drawImage() {},
    getImageData: () => ({ data: new Uint8ClampedArray(canvas.width * canvas.height * 4) })
  };
  canvas.getContext = () => context;
  const globals = {
    window: { isSecureContext: secure, jsQR: decoder, ...(detector ? { BarcodeDetector: detector } : {}) },
    navigator: { mediaDevices },
    document: { createElement: () => canvas },
    requestAnimationFrame: callback => { const id = nextFrame++; frames.set(id, callback); return id; },
    cancelAnimationFrame: id => frames.delete(id)
  };
  const previous = new Map();
  for (const [key, value] of Object.entries(globals)) {
    previous.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  }
  const scanner = new QrScanner({ video, onScan: value => scans.push(value), onState: state => states.push(state), onError: error => errors.push(error), onDevices: devices => deviceUpdates.push(devices) });
  return {
    scanner, video, canvas, requests, frames, states, errors, scans, deviceUpdates, mediaDevices,
    async frame(time = 1000) {
      const [id, callback] = frames.entries().next().value ?? [];
      assert.ok(callback, 'A scanning frame must be scheduled');
      frames.delete(id);
      await callback(time);
    },
    close() {
      scanner.dispose();
      for (const [key, descriptor] of previous) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor);
        else delete globalThis[key];
      }
    }
  };
}

for (const action of ['stop', 'dispose']) {
  test(`a late camera permission response releases every track after ${action}`, async () => {
    const env = environment();
    try {
      const starting = env.scanner.start();
      await flush();
      assert.equal(env.requests.length, 1);
      env.scanner[action]();
      const stream = mediaStream();
      env.requests[0].resolve(stream);
      assert.equal(await starting, false);
      assert.equal(stream.videoTrack.stops, 1);
      assert.equal(stream.extraTrack.stops, 1);
      assert.equal(env.video.srcObject, null);
      assert.equal(env.scanner.stream, null);
      assert.equal(env.frames.size, 0);
      assert.deepEqual(env.states, ['starting', 'stopped']);
    } finally { env.close(); }
  });
}

test('switching cameras releases the old stream before requesting its replacement', async () => {
  const env = environment();
  try {
    const firstStart = env.scanner.start();
    await flush();
    const first = mediaStream('front');
    env.requests[0].resolve(first);
    assert.equal(await firstStart, true);
    const secondStart = env.scanner.start('rear');
    assert.equal(first.videoTrack.stops, 1);
    assert.equal(first.extraTrack.stops, 1);
    assert.equal(env.video.srcObject, null);
    await flush();
    assert.deepEqual(env.requests[1].constraints.video.deviceId, { exact: 'rear' });
    const second = mediaStream('rear');
    env.requests[1].resolve(second);
    assert.equal(await secondStart, true);
    assert.equal(env.scanner.stream, second);
    assert.equal(env.video.srcObject, second);
    assert.equal(second.videoTrack.stops, 0);
    env.scanner.stop();
    assert.equal(second.videoTrack.stops, 1);
    assert.equal(second.extraTrack.stops, 1);
  } finally { env.close(); }
});

test('a superseded start never attaches its late stream over the selected camera', async () => {
  const env = environment();
  try {
    const firstStart = env.scanner.start('front');
    await flush();
    const secondStart = env.scanner.start('rear');
    await flush();
    const selected = mediaStream('rear');
    env.requests[1].resolve(selected);
    assert.equal(await secondStart, true);
    const stale = mediaStream('front');
    env.requests[0].resolve(stale);
    assert.equal(await firstStart, false);
    assert.equal(stale.videoTrack.stops, 1);
    assert.equal(stale.extraTrack.stops, 1);
    assert.equal(selected.videoTrack.stops, 0);
    assert.equal(env.video.srcObject, selected);
  } finally { env.close(); }
});

test('successful QR detection stops every track before delivering a single result', async () => {
  const stream = mediaStream();
  let decoderCalls = 0;
  const env = environment({ decoder: () => { decoderCalls++; return { data: 'bossqr:42' }; }, getUserMedia: async () => stream });
  try {
    env.scanner.onScan = value => {
      assert.equal(stream.videoTrack.stops, 1);
      assert.equal(stream.extraTrack.stops, 1);
      assert.equal(env.video.srcObject, null);
      assert.equal(env.scanner.state, 'stopped');
      env.scans.push(value);
    };
    assert.equal(await env.scanner.start(), true);
    await env.frame();
    assert.deepEqual(env.scans, ['bossqr:42']);
    assert.equal(decoderCalls, 1);
    assert.equal(env.frames.size, 0);
    assert.equal(env.canvas.width, 960);
    assert.equal(env.canvas.height, 540);
    assert.deepEqual(env.states, ['starting', 'scanning', 'stopped']);
  } finally { env.close(); }
});

test('a failing native detector falls back to jsQR without leaving the camera running', async () => {
  let nativeCalls = 0;
  let fallbackCalls = 0;
  class Detector {
    static async getSupportedFormats() { return ['qr_code']; }
    async detect() { nativeCalls++; throw new Error('Native detection unavailable'); }
  }
  const stream = mediaStream();
  const env = environment({ detector: Detector, decoder: () => { fallbackCalls++; return { data: 'fallback' }; }, getUserMedia: async () => stream });
  try {
    assert.equal(await env.scanner.start(), true);
    await env.frame();
    assert.equal(nativeCalls, 1);
    assert.equal(fallbackCalls, 1);
    assert.deepEqual(env.scans, ['fallback']);
    assert.equal(stream.videoTrack.stops, 1);
    assert.equal(stream.extraTrack.stops, 1);
    assert.deepEqual(env.errors, []);
  } finally { env.close(); }
});

test('native decoding remains serialized across a camera switch', async () => {
  const detection = deferred();
  let concurrent = 0;
  let maximum = 0;
  let nativeCalls = 0;
  class Detector {
    static async getSupportedFormats() { return ['qr_code']; }
    async detect() {
      nativeCalls++;
      concurrent++;
      maximum = Math.max(maximum, concurrent);
      const result = nativeCalls === 1 ? await detection.promise : [];
      concurrent--;
      return result;
    }
  }
  const env = environment({ detector: Detector, getUserMedia: async () => mediaStream() });
  try {
    await env.scanner.start('front');
    const pendingFrame = env.frame();
    assert.equal(nativeCalls, 1);
    await env.scanner.start('rear');
    await env.frame(1200);
    assert.equal(nativeCalls, 1);
    detection.resolve([{ rawValue: 'stale-result' }]);
    await pendingFrame;
    assert.deepEqual(env.scans, []);
    await env.frame(1400);
    assert.equal(nativeCalls, 2);
    assert.equal(maximum, 1);
  } finally { env.close(); }
});

test('concurrent starts share native detector initialization and only the current start requests a camera', async () => {
  const supported = deferred();
  let formatRequests = 0;
  class Detector {
    static getSupportedFormats() { formatRequests++; return supported.promise; }
    async detect() { return []; }
  }
  const env = environment({ detector: Detector, decoder: undefined });
  try {
    delete window.jsQR;
    const first = env.scanner.start('front');
    const second = env.scanner.start('rear');
    supported.resolve(['qr_code']);
    await flush();
    assert.equal(formatRequests, 1);
    assert.equal(env.requests.length, 1);
    assert.deepEqual(env.requests[0].constraints.video.deviceId, { exact: 'rear' });
    env.requests[0].resolve(mediaStream());
    assert.equal(await first, false);
    assert.equal(await second, true);
    assert.deepEqual(env.errors, []);
  } finally { env.close(); }
});

test('permission denial reports a useful German error and returns to stopped', async () => {
  const env = environment({ getUserMedia: async () => { throw Object.assign(new Error('Permission denied'), { name: 'NotAllowedError' }); } });
  try {
    assert.equal(await env.scanner.start(), false);
    assert.equal(env.errors.length, 1);
    assert.match(env.errors[0], /Kamerazugriff wurde nicht erlaubt/);
    assert.match(env.errors[0], /Website-Einstellungen/);
    assert.equal(env.video.srcObject, null);
    assert.equal(env.frames.size, 0);
    assert.deepEqual(env.states, ['starting', 'stopped']);
  } finally { env.close(); }
});

test('insecure pages explain HTTPS before requesting camera permission', async () => {
  const env = environment({ secure: false });
  try {
    assert.equal(await env.scanner.start(), false);
    assert.equal(env.requests.length, 0);
    assert.match(env.errors[0], /HTTPS/);
    assert.match(env.errors[0], /localhost/);
  } finally { env.close(); }
});

test('device changes refresh only video devices and disposing removes the listener', async () => {
  const env = environment();
  try {
    env.mediaDevices.devices = [
      { kind: 'audioinput', deviceId: 'microphone', label: 'Microphone' },
      { kind: 'videoinput', deviceId: 'front', groupId: 'a', label: '' }
    ];
    await env.scanner.refreshDevices();
    assert.deepEqual(env.deviceUpdates[0], [{ kind: 'videoinput', deviceId: 'front', groupId: 'a', label: 'Kamera 1' }]);
    env.mediaDevices.devices.push({ kind: 'videoinput', deviceId: 'rear', groupId: 'b', label: 'Rückkamera' });
    env.mediaDevices.dispatchEvent(new Event('devicechange'));
    await flush();
    assert.equal(env.deviceUpdates.length, 2);
    assert.equal(env.deviceUpdates[1].length, 2);
    assert.equal(env.deviceUpdates[1][1].label, 'Rückkamera');
    env.scanner.dispose();
    env.mediaDevices.dispatchEvent(new Event('devicechange'));
    await flush();
    assert.equal(env.deviceUpdates.length, 2);
  } finally { env.close(); }
});
