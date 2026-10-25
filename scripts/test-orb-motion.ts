import assert from 'node:assert/strict';
import { mapOrbState, smoothOrbLevel } from '../lib/voice/orbMotion';

const fastRise = smoothOrbLevel(0, 1, 60);
const slowFall = smoothOrbLevel(1, 0, 60);
assert(fastRise > 0.6, 'attack reaches the signal quickly');
assert(slowFall > 0.7, 'release decays more slowly than attack');
assert.equal(smoothOrbLevel(0.5, 4, 10) <= 1, true, 'target is clamped');

const listening = mapOrbState('listening', 0.8, 0.1);
assert.equal(listening.mode, 1);
assert(listening.ice > 0.6 && listening.scale > 1.03);
const speaking = mapOrbState('speaking', 0.1, 0.9);
assert.equal(speaking.mode, 3);
assert(speaking.violet > 0 && speaking.scale > listening.scale);
const thinking = mapOrbState('thinking', 1, 1);
assert.equal(thinking.level, 0);
assert.equal(thinking.scale, 1);

console.log('voice orb smoothing/state mapping: ok');
