#!/usr/bin/env node
/** Offline: the shared task queue grants one slot at a time in entry order. */
import assert from "node:assert/strict";
import { createTaskQueue } from "../lib/queue.js";

const queue = createTaskQueue();
const order = [];
const first = queue.enter("analysis");
assert.equal(first.immediate, true);
const second = queue.enter("article:1");
const third = queue.enter("share:2");
assert.equal(second.immediate, false);
assert.equal(queue.position("article:1"), 1);
assert.equal(queue.position("share:2"), 2);
assert.equal(queue.position("analysis"), 0, "the running key is not waiting");
void second.ready.then(() => order.push("article"));
void third.ready.then(() => order.push("share"));

const releaseFirst = await first.ready;
await Promise.resolve();
assert.deepEqual(order, [], "waiters stay blocked while the slot is held");
releaseFirst();
releaseFirst();
const releaseSecond = await second.ready;
await Promise.resolve();
assert.deepEqual(order, ["article"], "a repeated release frees only one slot");
assert.equal(queue.position("share:2"), 1);
releaseSecond();
(await third.ready)();
assert.equal(queue.enter("analysis").immediate, true, "the slot is free after every release");

const disposed = createTaskQueue();
disposed.enter("analysis");
const blocked = disposed.enter("article:1");
disposed.dispose();
await assert.rejects(blocked.ready, /插件已卸载/);
await assert.rejects(disposed.enter("share:1").ready, /插件已卸载/);
console.log("PASS task queue: FIFO order, positions, idempotent release and disposal.");
