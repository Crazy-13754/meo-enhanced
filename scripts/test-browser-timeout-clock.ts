import assert from 'node:assert/strict';
import vm from 'node:vm';
import { installBrowserTimeoutClock } from './browser-timeout-clock';

export async function testBrowserTimeoutClock(): Promise<void> {
  const native = new Map<number, () => void>();
  let nextNative = 1;
  const window: any = {
    setTimeout: (callback: () => void) => { const id = nextNative++; native.set(id, callback); return id; },
    clearTimeout: (id: number) => native.delete(id),
    requestAnimationFrame: () => 123,
    performance: { now: () => 456 }
  };
  const descriptors = Object.getOwnPropertyDescriptors(window);
  const events: string[] = [];
  const canceledNative = window.setTimeout(() => events.push('canceled native'));
  const renewingNative = window.setTimeout(() => window.setTimeout(() => events.push('renewed'), 1));
  const lateNative = window.setTimeout(() => window.setTimeout(() => events.push('late renewal leak'), 0));
  vm.runInNewContext('(' + installBrowserTimeoutClock.toString() + ')()', { window });
  const clock = window.__timeoutClock;
  window.clearTimeout(canceledNative);
  assert.equal(native.has(canceledNative), false, 'pre-install cancellation must delegate');
  native.get(renewingNative)!(); native.delete(renewingNative);
  assert.equal(clock.pending().length, 1, 'pre-install renewal must enter the timeout clock');
  window.setTimeout(() => { events.push('first'); Promise.resolve().then(() => events.push('microtask')); window.setTimeout(() => events.push('nested'), 0); }, 1);
  window.setTimeout(() => events.push('second'), 1);
  const canceled = window.setTimeout(() => events.push('canceled'), 1);
  window.clearTimeout(canceled); window.clearTimeout(canceled);
  await clock.advance(1);
  assert.deepEqual(events, ['renewed', 'first', 'microtask', 'second', 'nested']);
  assert.equal(clock.pending().length, 0);
  let receiver: unknown;
  window.setTimeout(function (this: unknown, value: string) { receiver = this; events.push(value); }, 0, 'timer argument');
  await clock.advance(0);
  assert.equal(receiver, window);
  assert.equal(events.at(-1), 'timer argument');
  const stale = window.setTimeout(() => events.push('stale'), 50);
  await clock.advance(33);
  assert.equal(clock.now(), 34);
  window.clearTimeout(stale);
  await clock.advance(34);
  assert.equal(clock.now(), 68);
  assert.equal(events.includes('stale'), false);
  const expected = new Error('callback failure');
  window.setTimeout(() => { throw expected; }, 0);
  await assert.rejects(clock.advance(0), error => error === expected);
  assert.equal(clock.pending().length, 0, 'failed callback must not be retried');
  assert.equal(window.requestAnimationFrame, descriptors.requestAnimationFrame!.value);
  assert.equal(window.performance, descriptors.performance!.value);
  assert.equal(clock.pending().length, 0);
  native.get(lateNative)!(); native.delete(lateNative);
  const abandoned = clock.restore();
  assert.equal(abandoned.length, 1, 'restore must report renewal arriving after the earlier empty snapshot');
  assert.equal(abandoned[0].due, 68);
  assert.equal(clock.restore(), abandoned, 'repeated restore retains the original diagnostic snapshot');
  assert.deepEqual(Object.getOwnPropertyDescriptors(window), descriptors, 'restore must preserve exact native descriptors');
  await assert.rejects(clock.advance(1), /Invalid timeout clock advance/);
  assert.equal(events.includes('late renewal leak'), false);
  const restored = window.setTimeout(() => events.push('native restored'));
  native.get(restored)!(); native.delete(restored);
  assert.equal(events.at(-1), 'native restored');
  console.log('Browser timeout clock lifecycle matrix passed');
}

if (import.meta.main) await testBrowserTimeoutClock();
