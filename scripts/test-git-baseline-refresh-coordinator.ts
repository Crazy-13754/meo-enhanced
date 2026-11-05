import assert from 'node:assert/strict';
import { mock } from 'bun:test';
import fs from 'node:fs';
import path from 'node:path';
import {
  createGitBaselineRefreshCoordinator,
  type GitBaselineRefreshOptions,
  type GitBaselineRefreshTimer
} from '../src/application/gitBaselineRefreshCoordinator';

const drain = async (): Promise<void> => {
  for (let index = 0; index < 8; index += 1) await Promise.resolve();
};

type Scheduled = { delayMs: number; cancelled: boolean; run: () => void };
const scheduled: Scheduled[] = [];
const timer: GitBaselineRefreshTimer = {
  schedule(delayMs, run) {
    const task = { delayMs, cancelled: false, run };
    scheduled.push(task);
    return { cancel: () => { task.cancelled = true; } };
  }
};

let ready = false;
let invalidations = 0;
const published: GitBaselineRefreshOptions[] = [];
let failNextPublish = false;
const coordinator = createGitBaselineRefreshCoordinator({
  timer,
  canRun: () => ready,
  invalidateGitHead: () => { invalidations += 1; },
  prepare: async () => ready,
  publish: async (options) => {
    published.push(options);
    if (failNextPublish) {
      failNextPublish = false;
      throw new Error('transient publish failure');
    }
  }
});

coordinator.request({ forcePost: true, forceReload: true });
await drain();
assert.equal(invalidations, 1, 'forceReload must invalidate Git immediately');
assert.deepEqual(published, [], 'refresh must wait until the Host Session is ready');

ready = true;
coordinator.request();
await drain();
assert.deepEqual(published, [{ forcePost: true, forceReload: true }], 'pre-ready flags must be retained and merged');

published.length = 0;
coordinator.request({ forcePost: true, delayMs: 10 });
coordinator.request({ forceReload: true, delayMs: 20 });
assert.equal(scheduled.at(-2)?.cancelled, true, 'a later delayed request must replace the earlier timer');
assert.equal(scheduled.at(-1)?.delayMs, 20);
assert.deepEqual(published, []);
scheduled.at(-1)?.run();
await drain();
assert.deepEqual(published, [{ forcePost: true, forceReload: true }], 'delayed requests must OR force flags');

published.length = 0;
let unblockFirst!: () => void;
const blocked = new Promise<void>((resolve) => { unblockFirst = resolve; });
let first = true;
const runningCoordinator = createGitBaselineRefreshCoordinator({
  timer,
  canRun: () => true,
  invalidateGitHead: () => undefined,
  prepare: async () => true,
  publish: async (options) => {
    published.push(options);
    if (first) {
      first = false;
      await blocked;
    }
  }
});
runningCoordinator.request({ forcePost: true });
await drain();
runningCoordinator.request({ forceReload: true });
unblockFirst();
await drain();
assert.deepEqual(published, [
  { forcePost: true, forceReload: false },
  { forcePost: false, forceReload: true }
], 'a request arriving during publish must run in the next cycle');

published.length = 0;
failNextPublish = true;
coordinator.request({ forcePost: true });
await drain();
coordinator.request({ forceReload: true });
await drain();
assert.deepEqual(published, [
  { forcePost: true, forceReload: false },
  { forcePost: false, forceReload: true }
], 'a transient failure must not kill later refreshes');

let prepareAttempts = 0;
let prepareReady = false;
const prepareFailureCoordinator = createGitBaselineRefreshCoordinator({
  timer,
  canRun: () => true,
  invalidateGitHead: () => undefined,
  prepare: async () => {
    prepareAttempts += 1;
    return prepareReady;
  },
  publish: async () => undefined
});
prepareFailureCoordinator.request({ forcePost: true });
await drain();
assert.equal(prepareAttempts, 1, 'a failed prepare must wait for a later request instead of spinning');
prepareReady = true;
prepareFailureCoordinator.request();
await drain();
assert.equal(prepareAttempts, 2, 'a later request must resume a refresh retained after prepare failure');
prepareFailureCoordinator.dispose();

coordinator.request({ delayMs: 30 });
const disposeTimer = scheduled.at(-1);
coordinator.dispose();
assert.equal(disposeTimer?.cancelled, true, 'dispose must cancel the pending timer');
coordinator.request({ forceReload: true });
disposeTimer?.run();
await drain();
assert.equal(invalidations, 3, 'requests after dispose must be ignored');

const repoRoot = path.resolve(import.meta.dir, '..');
const panelSession = fs.readFileSync(path.join(repoRoot, 'src/extension/panelSession.ts'), 'utf8');
const hostBootstrap = fs.readFileSync(path.join(repoRoot, 'src/extension.ts'), 'utf8');
for (const legacyIdentifier of [
  'gitRefreshRunning',
  'gitRefreshPending',
  'gitRefreshPendingForcePost',
  'gitRefreshPendingForceReload',
  'pendingGitRefreshTimer',
  'runPendingGitRefreshes'
]) {
  assert.equal(panelSession.includes(legacyIdentifier), false, `Legacy refresh state returned: ${legacyIdentifier}`);
}
assert.equal(
  (panelSession.match(/createGitBaselineRefreshCoordinator\s*\(/g) ?? []).length,
  1,
  'Panel Session must create exactly one Git baseline refresh coordinator'
);
assert.equal(
  (hostBootstrap.match(/createGitBaselineRefreshTimerAdapter\s*\(/g) ?? []).length,
  1,
  'Host Bootstrap must inject exactly one refresh timer Adapter per Panel Session'
);
assert.match(panelSession, /gitBaselineRefresh\.request\(options\)/);
assert.match(panelSession, /gitBaselineRefresh\.dispose\(\)/);

console.log('Git baseline refresh coordinator checks passed');

let gitExtension: any;
mock.module('vscode', () => ({
  extensions: { getExtension: () => gitExtension },
  Disposable: class { constructor(private readonly release: () => void) {} dispose() { this.release(); } }
}));
const { createGitApiWatcher } = await import('../src/git/gitApiWatch');
assert.equal(await createGitApiWatcher(() => {}), null);
gitExtension = { isActive: false, activate: async () => { throw new Error('Git unavailable'); } };
assert.equal(await createGitApiWatcher(() => {}), null);
gitExtension = { isActive: true, exports: { getAPI() { throw new Error('Git model not found'); } } };
await assert.doesNotReject(async () => assert.equal(await createGitApiWatcher(() => {}), null),
  'An active Git extension without a model must leave optional baseline watching unavailable');
gitExtension = { isActive: true, exports: {} };
assert.equal(await createGitApiWatcher(() => {}), null);
let gitRepositoryChanged: (() => void) | undefined;
let gitRepositoryDisposed = 0, gitActivations = 0;
const gitChanges: string[] = [];
gitExtension = { isActive: false, activate: async () => { gitActivations++; }, exports: { getAPI: () => ({
  repositories: [{ rootUri: { fsPath: 'C:/git-watcher-fixture' }, state: {
    onDidChange(listener: () => void) { gitRepositoryChanged = listener; return { dispose() { gitRepositoryDisposed++; } }; }
  } }]
}) } };
const gitWatcher = await createGitApiWatcher(root => gitChanges.push(root));
assert.ok(gitWatcher, 'A later available API must still create the existing watcher');
assert.equal(gitActivations, 1);
gitRepositoryChanged!();
assert.deepEqual(gitChanges, ['C:/git-watcher-fixture']);
gitWatcher.dispose();
assert.equal(gitRepositoryDisposed, 1);
console.log('Optional Git API absence, activation failure, missing model, recovery and watcher disposal passed');
