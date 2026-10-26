import { pcm16LeToFloat32, pcmBufferBytes } from '../lib/voice/pcmPlayback';

let passed = 0;
let failed = 0;
function check(name: string, condition: boolean) {
  if (condition) {
    console.log(`PASS  ${name}`);
    passed++;
  } else {
    console.error(`FAIL  ${name}`);
    failed++;
  }
}

const decoded = pcm16LeToFloat32(
  new Uint8Array([0x00, 0x80, 0xff, 0xff, 0x00, 0x00, 0xff, 0x7f, 0xaa]),
);
check('PCM decoder ignores a trailing partial sample', decoded.length === 4);
check('PCM decoder preserves negative full scale', decoded[0] === -1);
check('PCM decoder uses little-endian signed samples', decoded[1] === -1 / 32_768);
check('PCM decoder preserves silence', decoded[2] === 0);
check('PCM decoder preserves positive full scale', decoded[3] === 32_767 / 32_768);
check('60 ms at 24 kHz is 2,880 bytes', pcmBufferBytes(24_000, 60) === 2_880);

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
