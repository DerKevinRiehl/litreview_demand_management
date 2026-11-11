import assert from 'node:assert/strict';
import test from 'node:test';
import {
  playbackEndDay, selectTimelineMonth, TIMELINE_START, TIMELINE_END, TIMELINE_PLAYBACK_MS,
} from '../src/timeline.ts';

const day = (iso: string) => Date.parse(iso) / 86400000;

test('month selection includes the whole month, including leap February', () => {
  assert.deepEqual(selectTimelineMonth([TIMELINE_START, TIMELINE_END], 'from', 2024, 1),
    [day('2024-02-01'), TIMELINE_END]);
  assert.deepEqual(selectTimelineMonth([TIMELINE_START, TIMELINE_END], 'to', 2024, 1),
    [TIMELINE_START, day('2024-02-29')]);
  assert.deepEqual(selectTimelineMonth([TIMELINE_START, TIMELINE_END], 'to', 2023, 1),
    [TIMELINE_START, day('2023-02-28')]);
});

test('crossing date selections moves the opposite boundary to keep a valid month', () => {
  assert.deepEqual(selectTimelineMonth([day('2020-01-01'), day('2021-12-31')], 'from', 2024, 1),
    [day('2024-02-01'), day('2024-02-29')]);
  assert.deepEqual(selectTimelineMonth([day('2024-01-01'), TIMELINE_END], 'to', 2020, 1),
    [day('2020-02-01'), day('2020-02-29')]);
});

test('full-range selections preserve January 1960 and December 2025', () => {
  assert.deepEqual(selectTimelineMonth([TIMELINE_START, TIMELINE_END], 'from', 1960, 0),
    [TIMELINE_START, TIMELINE_END]);
  assert.deepEqual(selectTimelineMonth([TIMELINE_START, TIMELINE_END], 'to', 2025, 11),
    [TIMELINE_START, TIMELINE_END]);
});

test('playback advances, finishes at the maximum, and resumes at the same speed', () => {
  assert.equal(playbackEndDay(TIMELINE_START, 0), TIMELINE_START);
  const midway = playbackEndDay(TIMELINE_START, TIMELINE_PLAYBACK_MS / 2);
  assert.ok(midway > TIMELINE_START && midway < TIMELINE_END);
  assert.equal(playbackEndDay(TIMELINE_START, TIMELINE_PLAYBACK_MS), TIMELINE_END);
  assert.equal(playbackEndDay(midway, TIMELINE_PLAYBACK_MS), TIMELINE_END);
  assert.equal(playbackEndDay(midway, 0), midway);
});
