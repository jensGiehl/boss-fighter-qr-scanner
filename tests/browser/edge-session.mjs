import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { access, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, resolve, sep } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

export async function findEdge() {
  const candidates = process.env.EDGE_BINARY ? [process.env.EDGE_BINARY] : [
    join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    join(process.env.ProgramFiles || 'C:\\Program Files', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    join(process.env.LOCALAPPDATA || '', 'Microsoft', 'Edge', 'Application', 'msedge.exe')
  ];
  for (const candidate of candidates) {
    try { await access(candidate); return candidate; } catch { }
  }
  return null;
}

export class EdgeSession {
  constructor(process, directory, socket) {
    this.process = process;
    this.directory = directory;
    this.socket = socket;
    this.sequence = 0;
    this.pending = new Map();
    this.exceptions = [];
    socket.addEventListener('message', event => {
      const message = JSON.parse(event.data);
      if (message.method === 'Runtime.exceptionThrown') this.exceptions.push(message.params.exceptionDetails.exception?.description || message.params.exceptionDetails.text);
      const request = this.pending.get(message.id);
      if (!request) return;
      this.pending.delete(message.id);
      clearTimeout(request.timeout);
      if (message.error) request.reject(new Error(message.error.message));
      else request.resolve(message.result);
    });
    socket.addEventListener('close', () => {
      for (const request of this.pending.values()) {
        clearTimeout(request.timeout);
        request.reject(new Error('The browser connection closed'));
      }
      this.pending.clear();
    });
  }

  static async launch(executable) {
    const directory = await mkdtemp(join(tmpdir(), 'bossqr-editor-test-'));
    const process = spawn(executable, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--remote-debugging-port=0', `--user-data-dir=${directory}`, 'about:blank'], { windowsHide: true, stdio: 'ignore' });
    let failure;
    process.on('error', error => { failure = error; });
    try {
      let port;
      for (let attempt = 0; attempt < 200; attempt++) {
        if (failure) throw failure;
        if (process.exitCode !== null) throw new Error(`Edge exited with code ${process.exitCode}`);
        try {
          port = Number((await readFile(join(directory, 'DevToolsActivePort'), 'utf8')).split('\n')[0]);
          if (port) break;
        } catch { }
        await delay(50);
      }
      if (!port) throw new Error('Edge did not start its debugging endpoint within 10 seconds');
      const pages = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      const page = pages.find(entry => entry.type === 'page');
      if (!page) throw new Error('Edge did not create a test page');
      const socket = new WebSocket(page.webSocketDebuggerUrl);
      await new Promise((accept, reject) => {
        socket.addEventListener('open', accept, { once: true });
        socket.addEventListener('error', () => reject(new Error('Could not connect to the Edge test page')), { once: true });
      });
      const session = new EdgeSession(process, directory, socket);
      await session.send('Runtime.enable');
      await session.send('Page.enable');
      return session;
    } catch (error) {
      process.kill();
      await EdgeSession.removeDirectory(directory);
      throw error;
    }
  }

  send(method, params = {}) {
    const id = ++this.sequence;
    return new Promise((accept, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Browser command timed out: ${method}`));
      }, 5000);
      this.pending.set(id, { resolve: accept, reject, timeout });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  async evaluate(expression) {
    const response = await this.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (response.exceptionDetails) {
      throw new Error(response.exceptionDetails.exception?.description || response.exceptionDetails.text);
    }
    return response.result.value;
  }

  async waitFor(expression, timeout = 5000) {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      if (await this.evaluate(expression)) return;
      await delay(25);
    }
    throw new Error(`Browser condition timed out: ${expression}`);
  }

  async type(text) {
    for (const character of Array.from(text)) await this.send('Input.insertText', { text: character });
  }

  async key(key, code, keyCode, modifiers = 0) {
    const params = { key, code, windowsVirtualKeyCode: keyCode, nativeVirtualKeyCode: keyCode, modifiers };
    await this.send('Input.dispatchKeyEvent', key === 'Enter'
      ? { ...params, type: 'keyDown', text: '\r', unmodifiedText: '\r' }
      : { ...params, type: 'rawKeyDown' });
    await this.send('Input.dispatchKeyEvent', { ...params, type: 'keyUp' });
  }

  async close() {
    await this.send('Browser.close').catch(() => {});
    this.socket.close();
    if (this.process.exitCode === null) {
      await Promise.race([once(this.process, 'exit'), delay(1500)]);
      if (this.process.exitCode === null) this.process.kill();
    }
    await EdgeSession.removeDirectory(this.directory);
  }

  static async removeDirectory(directory) {
    const target = resolve(directory);
    const parent = resolve(tmpdir()) + sep;
    assert.ok(target.startsWith(parent) && basename(target).startsWith('bossqr-editor-test-'), 'Cleanup must remain inside the test temporary directory');
    await rm(target, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
}

export const edge = await findEdge();
export const browserSkipReason = !edge ? 'Optional test: install Microsoft Edge or set EDGE_BINARY' : typeof WebSocket !== 'function' ? 'Optional test requires Node.js 22 or newer' : false;

