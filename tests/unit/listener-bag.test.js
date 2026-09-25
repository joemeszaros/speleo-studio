// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';

import { ListenerBag } from '../../src/ui/window/listener-bag.js';

describe('ListenerBag event listeners', () => {
  it('removes what it adds', () => {
    const bag = new ListenerBag();
    const target = new EventTarget();
    const handler = vi.fn();

    bag.on(target, 'ping', handler);
    target.dispatchEvent(new Event('ping'));
    expect(handler).toHaveBeenCalledTimes(1);

    bag.dispose();
    target.dispatchEvent(new Event('ping'));
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('passes the options through to removeEventListener', () => {
    const bag = new ListenerBag();
    const target = { addEventListener: vi.fn(), removeEventListener: vi.fn() };
    const handler = () => {};
    const options = { capture: true };

    bag.on(target, 'ping', handler, options);
    bag.dispose();

    expect(target.addEventListener).toHaveBeenCalledWith('ping', handler, options);
    expect(target.removeEventListener).toHaveBeenCalledWith('ping', handler, options);
  });

  it('unsubscribes from the document event bus', () => {
    const bag = new ListenerBag();
    const handler = vi.fn();

    bag.onDoc('caveChanged', handler);
    document.dispatchEvent(new CustomEvent('caveChanged'));
    expect(handler).toHaveBeenCalledTimes(1);

    bag.dispose();
    document.dispatchEvent(new CustomEvent('caveChanged'));
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('tolerates a missing target', () => {
    const bag = new ListenerBag();
    expect(() => bag.on(null, 'ping', () => {})).not.toThrow();
    expect(() => bag.dispose()).not.toThrow();
  });

  it('returns the handler so it can be reused', () => {
    const bag = new ListenerBag();
    const handler = () => {};
    expect(bag.on(new EventTarget(), 'ping', handler)).toBe(handler);
  });
});

describe('ListenerBag dispose', () => {
  it('runs disposers in reverse order of registration', () => {
    const bag = new ListenerBag();
    const order = [];
    bag.add(() => order.push('first'));
    bag.add(() => order.push('second'));
    bag.add(() => order.push('third'));

    bag.dispose();
    expect(order).toEqual(['third', 'second', 'first']);
  });

  it('is idempotent', () => {
    const bag = new ListenerBag();
    const disposer = vi.fn();
    bag.add(disposer);

    bag.dispose();
    bag.dispose();
    bag.dispose();

    expect(disposer).toHaveBeenCalledTimes(1);
    expect(bag.disposed).toBe(true);
  });

  it('does not let one throwing disposer strand the others', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const bag = new ListenerBag();
    const before = vi.fn();
    const after = vi.fn();

    bag.add(before);
    bag.add(() => {
      throw new Error('boom');
    });
    bag.add(after);

    expect(() => bag.dispose()).not.toThrow();
    expect(before).toHaveBeenCalledTimes(1);
    expect(after).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe('ListenerBag observers and timers', () => {
  it('disconnects an observer', () => {
    const bag = new ListenerBag();
    const observer = { observe: vi.fn(), disconnect: vi.fn() };
    const target = document.createElement('div');

    bag.observe(observer, target, { box: 'border-box' });
    expect(observer.observe).toHaveBeenCalledWith(target, { box: 'border-box' });

    bag.dispose();
    expect(observer.disconnect).toHaveBeenCalledTimes(1);
  });

  it('clears a pending timeout', () => {
    vi.useFakeTimers();
    const bag = new ListenerBag();
    const fn = vi.fn();

    bag.timeout(fn, 100);
    bag.dispose();
    vi.advanceTimersByTime(500);

    expect(fn).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it('clears a running interval', () => {
    vi.useFakeTimers();
    const bag = new ListenerBag();
    const fn = vi.fn();

    bag.interval(fn, 100);
    vi.advanceTimersByTime(250);
    expect(fn).toHaveBeenCalledTimes(2);

    bag.dispose();
    vi.advanceTimersByTime(500);
    expect(fn).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });

  it('cancels a queued animation frame', () => {
    const cancel = vi.spyOn(globalThis, 'cancelAnimationFrame');
    const bag = new ListenerBag();

    const id = bag.raf(() => {});
    bag.dispose();

    expect(cancel).toHaveBeenCalledWith(id);
    cancel.mockRestore();
  });
});
