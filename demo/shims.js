'use strict';

// Minimal browser stand-ins for the Node built-ins the shared code uses.

class EventEmitter {
  constructor() { this.handlers = new Map(); }
  on(name, fn) { (this.handlers.get(name) || this.handlers.set(name, []).get(name)).push(fn); return this; }
  emit(name, ...args) { for (const fn of this.handlers.get(name) || []) fn(...args); return true; }
}

function randomBytes(n) {
  const a = new Uint8Array(n);
  globalThis.crypto.getRandomValues(a);
  return a;
}

module.exports = { EventEmitter, randomBytes };
