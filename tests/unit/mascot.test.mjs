import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mascotSVG, crewHTML, SPECIES_LIST, ACCESSORY_LIST, ROLE_BADGES, MASCOT_STATES } from '../../public/js/mascot.js';
import { iconPaths } from '../../public/js/icons.js';

test('every species, accessory and badge renders a tiled SVG with role and label', () => {
  for (const species of SPECIES_LIST) for (const accessory of ACCESSORY_LIST) {
    const s = mascotSVG({ species, accessory, color: '#3366ff', nickname: 'Pip', badge: 'code' }, 64);
    assert.match(s, /^<svg [^>]*role="img"/); assert.match(s, /class="m-tile"/); assert.match(s, /class="m-badge"/);
    assert.ok(!s.includes('undefined') && !s.includes('NaN'), `${species}/${accessory}`);
  }
  for (const b of ROLE_BADGES) assert.ok(iconPaths(b), `badge icon ${b} exists`);
});
test('gradient ids are unique per instance so many icons can share a page', () => {
  const ids = [mascotSVG({}), mascotSVG({})].map((s) => /id="(mx\d+)t"/.exec(s)[1]);
  assert.notEqual(ids[0], ids[1]);
});
test('labels are escaped and bad colours fall back', () => {
  const s = mascotSVG({ color: 'red;}<script>', nickname: '<b>x</b>' }, 40);
  assert.ok(!s.includes('<script>') && !s.includes('<b>')); assert.match(s, /#4f8cff/i);
});
test('state layers are hidden by default so the icon is clean without CSS; states are whitelisted', () => {
  const s = mascotSVG({ badge: 'code' });
  for (const cls of ['m-closed', 'm-talk', 'm-frown', 'fx-think', 'fx-zzz', 'fx-spark', 'fx-heart', 'fx-tear', 'fx-tool']) assert.match(s, new RegExp(`class="[^"]*${cls}"[^>]*opacity="0"|class="[^"]*${cls}" opacity="0"`), cls);
  for (const st of MASCOT_STATES) assert.match(crewHTML({}, 48, st), new RegExp(`data-state="${st}"`));
  assert.match(crewHTML({}, 48, 'evil" onload="x'), /data-state="idle"/);
});
test('badges scale up at small sizes; no badge or tile when asked', () => {
  const r = (size) => Number(/class="m-badge"[^>]*><circle cx="[\d.]+" cy="[\d.]+" r="([\d.]+)"/.exec(mascotSVG({ badge: 'code' }, size))[1]);
  assert.ok(r(40) > r(64) && r(64) > r(120));
  assert.ok(!mascotSVG({}, 64).includes('m-badge'));
  assert.ok(!mascotSVG({ badge: 'code' }, 64, '', { tile: false }).includes('m-tile'));
});
