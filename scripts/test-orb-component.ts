import fs from 'node:fs';

const source = fs.readFileSync('components/voice/ElevenLabsOrb.tsx', 'utf8');
const wrapper = fs.readFileSync('components/VoiceOrb.tsx', 'utf8');
const texture = fs.readFileSync('public/orb-noise.png');

function ok(label: string, condition: boolean) {
  if (!condition) throw new Error(`FAIL: ${label}`);
  console.log(`PASS: ${label}`);
}

ok('orb uses the local noise texture', source.includes("useTexture('/orb-noise.png')"));
ok('orb does not call the ElevenLabs CDN', !source.includes('storage.googleapis.com'));
ok('orb uses the Paramount palette', source.includes("['#CFE3FF', '#1E6FD9']"));
ok('orb is loaded without SSR', wrapper.includes('{ ssr: false }'));
ok('noise asset is a PNG', texture.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])));
ok('noise asset has meaningful content', texture.length > 10_000);
