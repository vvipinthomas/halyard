// Harbor crew — original full-body agent characters on soft-3D app-icon tiles. Pure function → SVG string.
// Layers: tile · ground shadow · tail · feet · torso (belly, fur edge, rim light, neck occlusion) · arms with paws ·
// head (species features, iris eyes with lids, glossy nose, sheen) · neck/head accessories · role badge.
// Class hooks drive state animation in crew.css: m-all, m-eyes, m-pupils, m-closed, m-smile, m-talk, m-frown,
// m-arm-l, m-arm-r (rotate about the shoulder), fx-*.
import { iconPaths } from './icons.js';

let seq = 0;
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const hex2 = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
export function mix(a, b, t) { const A = hex2(a), B = hex2(b); return '#' + A.map((v, i) => Math.round(v + (B[i] - v) * t).toString(16).padStart(2, '0')).join(''); }

export const SPECIES_LIST = ['otter', 'owl', 'beaver', 'hedgehog', 'raccoon', 'fox', 'cat', 'parrot', 'dog', 'penguin', 'tortoise', 'bunny', 'ant', 'bear', 'lion', 'robot', 'sloth', 'frog', 'panda', 'axolotl'];
export const ACCESSORY_LIST = ['none', 'glasses', 'headset', 'beanie', 'bowtie', 'crown', 'scarf', 'monocle', 'flower', 'cap'];
export const ROLE_BADGES = ['code', 'bug', 'shield', 'cloud', 'database', 'chart', 'compass', 'flows', 'palette', 'megaphone', 'dollar', 'chat', 'crew', 'scale', 'wrench', 'search', 'pen', 'cap', 'settings', 'rocket', 'eye', 'heart', 'cart', 'building', 'check', 'alert', 'knowledge', 'sparkle'];
const FURRY = new Set(['otter', 'beaver', 'raccoon', 'fox', 'cat', 'dog', 'bunny', 'bear', 'lion', 'sloth', 'hedgehog', 'panda']);
const BIRD = new Set(['owl', 'parrot', 'penguin']);
const IRIS = { owl: ['#ffd36b', '#d98a12'], parrot: ['#ffd36b', '#c97a12'], frog: ['#f3d36a', '#a8841c'], penguin: ['#8a6a4a', '#3a2614'], axolotl: ['#3a3f66', '#161c36'] };

export function mascotSVG(m = {}, size = 64, label = '', opts = {}) {
  const id = `mx${++seq}`;
  const c = /^#[0-9a-f]{6}$/i.test(m.color || '') ? m.color : '#4f8cff';
  const sp = SPECIES_LIST.includes(m.species) ? m.species : 'otter';
  const ink = '#161c36';
  const hi = mix(c, '#ffffff', 0.45), lo = mix(c, '#0b1020', 0.28), deep = mix(c, '#0b1020', 0.46), pale = mix(c, '#ffffff', 0.8);
  const F = `url(#${id}b)`, FD = `url(#${id}d)`, FL = `url(#${id}l)`, FG = `url(#${id}g)`, FP = `url(#${id}p)`, FT = `url(#${id}k)`;
  const tile = opts.tile !== false;
  const robot = sp === 'robot';
  const [irisHi, irisLo] = IRIS[sp] || ['#9a6436', '#3d2210'];

  const defs = `<defs>
    <linearGradient id="${id}t" x1="0" y1="0" x2="0.4" y2="1"><stop offset="0" stop-color="${mix(c, '#ffffff', 0.9)}"/><stop offset="1" stop-color="${mix(c, '#ffffff', 0.66)}"/></linearGradient>
    <radialGradient id="${id}b" cx="0.34" cy="0.28" r="0.85"><stop offset="0" stop-color="${hi}"/><stop offset="0.5" stop-color="${c}"/><stop offset="1" stop-color="${lo}"/></radialGradient>
    <radialGradient id="${id}d" cx="0.38" cy="0.28" r="0.9"><stop offset="0" stop-color="${mix(c, '#0b1020', 0.06)}"/><stop offset="1" stop-color="${deep}"/></radialGradient>
    <radialGradient id="${id}l" cx="0.42" cy="0.28" r="0.85"><stop offset="0" stop-color="#ffffff"/><stop offset="0.7" stop-color="${mix(c, '#ffffff', 0.86)}"/><stop offset="1" stop-color="${mix(c, '#ffffff', 0.68)}"/></radialGradient>
    <radialGradient id="${id}g" cx="0.38" cy="0.3" r="0.8"><stop offset="0" stop-color="#ffe9a8"/><stop offset="0.6" stop-color="#f2b33d"/><stop offset="1" stop-color="#b8731a"/></radialGradient>
    <radialGradient id="${id}p" cx="0.36" cy="0.28" r="0.85"><stop offset="0" stop-color="#4a5480"/><stop offset="1" stop-color="${ink}"/></radialGradient>
    <radialGradient id="${id}k" cx="0.4" cy="0.3" r="0.8"><stop offset="0" stop-color="#ffcf7a"/><stop offset="1" stop-color="#e08a1e"/></radialGradient>
    <radialGradient id="${id}s" cx="0.5" cy="0.5" r="0.5"><stop offset="0" stop-color="#fff" stop-opacity="0.8"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>
    <radialGradient id="${id}h" cx="0.5" cy="0.5" r="0.5"><stop offset="0" stop-color="#0b1020" stop-opacity="0.32"/><stop offset="1" stop-color="#0b1020" stop-opacity="0"/></radialGradient>
    <radialGradient id="${id}o" cx="0.5" cy="0.5" r="0.5"><stop offset="0" stop-color="#0b1020" stop-opacity="0.35"/><stop offset="1" stop-color="#0b1020" stop-opacity="0"/></radialGradient>
    <radialGradient id="${id}e" cx="0.5" cy="0.5" r="0.5"><stop offset="0" stop-color="#0b0e1c"/><stop offset="0.36" stop-color="#0b0e1c"/><stop offset="0.42" stop-color="${irisHi}"/><stop offset="0.86" stop-color="${irisLo}"/><stop offset="1" stop-color="#0b0e1c"/></radialGradient>
    <linearGradient id="${id}r" x1="0" y1="0" x2="1" y2="0"><stop offset="0.6" stop-color="#fff" stop-opacity="0"/><stop offset="1" stop-color="#fff" stop-opacity="0.4"/></linearGradient>
  </defs>`;

  // ---------- head (drawn in a 100×100 head space, then placed on the body) ----------
  const tri = (d, fill = FD) => `<path d="${d}" fill="${fill}" stroke="${fill}" stroke-width="3" stroke-linejoin="round"/>`;
  const nose = (y = 61) => `<path d="M46.8 ${y} h6.4 a1.1 1.1 0 0 1 .9 1.7 l-3.2 3.6 a1.1 1.1 0 0 1-1.8 0 l-3.2-3.6 a1.1 1.1 0 0 1 .9-1.7z" fill="${ink}"/><ellipse cx="48.6" cy="${y + 1.2}" rx="1.6" ry=".8" fill="#fff" opacity=".55"/>`;
  const muzzle = (rx = 13, ry = 9, y = 64) => `<ellipse cx="50" cy="${y}" rx="${rx}" ry="${ry}" fill="${FL}"/>`;
  const whiskers = () => `<path d="M20 62 L35 60.5 M20 67 L35 64.5 M80 62 L65 60.5 M80 67 L65 64.5" stroke="${ink}" stroke-width="1" stroke-linecap="round" opacity=".3"/>`;
  let back = '', front = '', face = 'circle', headFill = F, eyeY = 50, mouthY = 70;
  switch (sp) {
    case 'cat': back = tri('M24 36 L28 13 L43 27z') + tri('M76 36 L72 13 L57 27z') + `<path d="M29 31 L30 20 L37 27z M71 31 L70 20 L63 27z" fill="#ffb3c7"/>`; front = muzzle(11, 7.5, 64) + nose(60) + whiskers(); break;
    case 'fox': back = tri('M20 38 L25 8 L44 25z') + tri('M80 38 L75 8 L56 25z') + `<path d="M26 31 L28 16 L37 25z M74 31 L72 16 L63 25z" fill="${pale}"/>`; front = `<path d="M26 58 Q50 86 74 58 Q62 70 50 70 Q38 70 26 58z" fill="${FL}"/>` + nose(60); break;
    case 'bunny': back = `<ellipse cx="37" cy="16" rx="7.5" ry="21" fill="${FD}"/><ellipse cx="63" cy="16" rx="7.5" ry="21" fill="${FD}"/><ellipse cx="37" cy="18" rx="3.4" ry="14" fill="#ffc2d4"/><ellipse cx="63" cy="18" rx="3.4" ry="14" fill="#ffc2d4"/>`; front = muzzle(10, 7, 64) + nose(60); break;
    case 'bear': back = `<circle cx="25" cy="26" r="11" fill="${FD}"/><circle cx="75" cy="26" r="11" fill="${FD}"/><circle cx="25" cy="26" r="5.5" fill="${pale}"/><circle cx="75" cy="26" r="5.5" fill="${pale}"/>`; front = muzzle(13, 9.5, 64) + nose(59); break;
    case 'panda': headFill = FL; back = `<circle cx="25" cy="26" r="11" fill="${ink}"/><circle cx="75" cy="26" r="11" fill="${ink}"/>`; front = `<ellipse cx="38" cy="50" rx="8.5" ry="10.5" transform="rotate(-25 38 50)" fill="${ink}"/><ellipse cx="62" cy="50" rx="8.5" ry="10.5" transform="rotate(25 62 50)" fill="${ink}"/>` + nose(60); break;
    case 'owl': back = tri('M23 34 L27 13 L41 27z') + tri('M77 34 L73 13 L59 27z'); front = `<circle cx="38" cy="50" r="12" fill="${FL}"/><circle cx="62" cy="50" r="12" fill="${FL}"/><path d="M45.5 59 h9 L50 68z" fill="${FT}" stroke="#e08a1e" stroke-width="1.6" stroke-linejoin="round"/>`; mouthY = 73; break;
    case 'parrot': back = `<path d="M50 20 C42 4 56 2 52 18 M44 22 C34 9 44 4 47 19 M56 22 C64 8 58 4 54 19" stroke="${FD}" stroke-width="6" stroke-linecap="round" fill="none"/>`; front = `<path d="M43 57 Q50 54 57 57 Q56 68 50 72 Q44 68 43 57z" fill="${FT}"/><path d="M45 61 Q50 64 55 61" stroke="#b8731a" stroke-width="1.5" fill="none"/>`; mouthY = 76; break;
    case 'penguin': face = 'penguin'; front = `<path d="M44.5 59 h11 L50 67z" fill="${FT}" stroke="#e08a1e" stroke-width="1.6" stroke-linejoin="round"/>`; mouthY = 72; break;
    case 'dog': back = `<ellipse cx="21" cy="45" rx="9.5" ry="19" transform="rotate(12 21 45)" fill="${FD}"/><ellipse cx="79" cy="45" rx="9.5" ry="19" transform="rotate(-12 79 45)" fill="${FD}"/>`; front = muzzle(14, 10, 64) + `<ellipse cx="50" cy="59.5" rx="5.5" ry="4" fill="${ink}"/><ellipse cx="48.4" cy="58.4" rx="1.8" ry=".9" fill="#fff" opacity=".5"/>`; break;
    case 'hedgehog': back = Array.from({ length: 11 }, (_, i) => { const a = Math.PI * (1.02 + i * 0.096); const p = (r, d) => `${(50 + r * Math.cos(a + d)).toFixed(1)},${(53 + r * Math.sin(a + d)).toFixed(1)}`; return `<polygon points="${p(30, -0.13)} ${p(45, 0)} ${p(30, 0.13)}" fill="${FD}" stroke="${FD}" stroke-width="2" stroke-linejoin="round"/>`; }).join(''); front = muzzle(12, 9, 64) + nose(60); break;
    case 'raccoon': back = tri('M25 34 L28 16 L40 26z') + tri('M75 34 L72 16 L60 26z'); front = `<path d="M22 46 Q36 38 50 48 Q64 38 78 46 Q72 58 62 56 Q50 52 38 56 Q28 58 22 46z" fill="${deep}"/>` + muzzle(10, 7, 65) + nose(61); break;
    case 'beaver': back = `<circle cx="27" cy="27" r="7.5" fill="${FD}"/><circle cx="73" cy="27" r="7.5" fill="${FD}"/>`; front = muzzle(13, 9, 63) + nose(58) + `<rect x="45.5" y="69" width="9" height="7.5" rx="2" fill="#fffdf6" stroke="${mix(c, '#0b1020', 0.2)}" stroke-width="0.8"/><path d="M50 69 v7.5" stroke="${mix(c, '#0b1020', 0.2)}" stroke-width="0.8"/>`; mouthY = 65; break;
    case 'otter': back = `<circle cx="29" cy="29" r="6.5" fill="${FD}"/><circle cx="71" cy="29" r="6.5" fill="${FD}"/>`; front = muzzle(14, 9.5, 64) + nose(59) + whiskers(); break;
    case 'tortoise': front = `<path d="M22 40 Q50 0 78 40 Q50 32 22 40z" fill="${FD}"/><path d="M36 33 L50 20 L64 33 M50 20 V35" stroke="${hi}" stroke-width="2" fill="none" stroke-linecap="round" opacity=".8"/>`; mouthY = 66; break;
    case 'ant': back = `<path d="M41 24 Q34 8 25 9 M59 24 Q66 8 75 9" stroke="${ink}" stroke-width="2.6" fill="none" stroke-linecap="round"/><circle cx="25" cy="9" r="4" fill="${FD}"/><circle cx="75" cy="9" r="4" fill="${FD}"/>`; mouthY = 66; break;
    case 'lion': back = Array.from({ length: 16 }, (_, i) => { const a = (i / 16) * Math.PI * 2; return `<circle cx="${(50 + 34 * Math.cos(a)).toFixed(1)}" cy="${(52 + 34 * Math.sin(a)).toFixed(1)}" r="11" fill="${FG}"/>`; }).join(''); front = muzzle(12, 8.5, 64) + nose(59); break;
    case 'robot': face = 'square'; back = `<line x1="50" y1="19" x2="50" y2="7" stroke="${deep}" stroke-width="3" stroke-linecap="round"/><circle cx="50" cy="6" r="4.5" fill="#ff6b8a"/><rect x="11" y="44" width="7" height="14" rx="3" fill="${FD}"/><rect x="82" y="44" width="7" height="14" rx="3" fill="${FD}"/>`; front = `<rect x="27" y="40" width="46" height="20" rx="10" fill="${ink}" opacity=".9"/>`; mouthY = 68; break;
    case 'sloth': headFill = FL; front = `<ellipse cx="50" cy="50" rx="31" ry="27" fill="${F}"/><ellipse cx="37" cy="51" rx="11" ry="7.5" transform="rotate(-12 37 51)" fill="${deep}"/><ellipse cx="63" cy="51" rx="11" ry="7.5" transform="rotate(12 63 51)" fill="${deep}"/>` + muzzle(9, 6, 64) + nose(61); break;
    case 'frog': back = `<circle cx="33" cy="27" r="12" fill="${F}"/><circle cx="67" cy="27" r="12" fill="${F}"/>`; eyeY = 29; mouthY = 62; break;
    case 'axolotl': back = [-1, 1].map((sg) => [0, 1, 2].map((i) => `<path d="M${50 + sg * 29} ${40 + i * 10} l${sg * 17} ${-7 + i * 4}" stroke="#ff8fb8" stroke-width="6" stroke-linecap="round"/>`).join('')).join(''); front = `<ellipse cx="50" cy="67" rx="15" ry="7" fill="${FL}" opacity=".7"/>`; mouthY = 65; break;
  }
  const head = face === 'square' ? `<rect x="17" y="20" width="66" height="62" rx="20" fill="${headFill}"/>`
    : face === 'penguin' ? `<circle cx="50" cy="52" r="33" fill="${FP}"/><path d="M50 30 C34 30 24 42 26 58 C28 74 40 82 50 82 C60 82 72 74 74 58 C76 42 66 30 50 30z" fill="${FL}"/>`
    : `<circle cx="50" cy="52" r="33" fill="${headFill}"/>`;
  const furHead = FURRY.has(sp) ? `<circle cx="50" cy="52" r="32.4" fill="none" stroke="${sp === 'panda' ? '#9aa3bf' : deep}" stroke-opacity=".22" stroke-width="2.2" stroke-dasharray="1 2.6" stroke-linecap="round"/>` : '';
  const headRim = face === 'square' ? '' : `<circle cx="50" cy="52" r="33" fill="url(#${id}r)"/>`;
  const spec = face === 'square' ? `<ellipse cx="35" cy="28" rx="13" ry="5.5" fill="url(#${id}s)"/>` : `<ellipse cx="37" cy="31" rx="14" ry="8.5" transform="rotate(-24 37 31)" fill="url(#${id}s)"/>`;
  const eye = (x) => robot
    ? `<ellipse cx="${x}" cy="${eyeY}" rx="4.4" ry="4.4" fill="#7df3ff"/><ellipse cx="${x}" cy="${eyeY}" rx="6.5" ry="6.5" fill="#7df3ff" opacity=".18"/><circle cx="${x + 1.5}" cy="${eyeY - 1.6}" r="1.4" fill="#fff"/>`
    : `<ellipse cx="${x}" cy="${eyeY}" rx="5.2" ry="5.8" fill="url(#${id}e)"/><path d="M${x - 5.4} ${eyeY - 1.2} Q${x} ${eyeY - 7.6} ${x + 5.4} ${eyeY - 1.2} Q${x} ${eyeY - 4.6} ${x - 5.4} ${eyeY - 1.2}z" fill="${ink}" opacity=".35"/><circle cx="${x + 1.9}" cy="${eyeY - 2.1}" r="1.7" fill="#fff"/><circle cx="${x - 1.6}" cy="${eyeY + 2.2}" r=".75" fill="#fff" opacity=".8"/>`;
  const eyes = `<g class="m-eyes"><g class="m-pupils">${eye(38)}${eye(62)}</g></g><g class="m-closed" opacity="0"><path d="M33 ${eyeY} Q38 ${eyeY + 4} 43 ${eyeY} M57 ${eyeY} Q62 ${eyeY + 4} 67 ${eyeY}" stroke="${robot ? '#7df3ff' : ink}" stroke-width="2.4" fill="none" stroke-linecap="round"/></g>`;
  const blush = robot ? '' : `<g class="m-blush"><ellipse cx="27" cy="${eyeY + 11}" rx="5.5" ry="3.2" fill="#ff7f9b" opacity=".32"/><ellipse cx="73" cy="${eyeY + 11}" rx="5.5" ry="3.2" fill="#ff7f9b" opacity=".32"/></g>`;
  const mY = mouthY;
  const mouth = `<path class="m-smile" d="M45.5 ${mY} Q50 ${mY + 4.2} 54.5 ${mY}" stroke="${ink}" stroke-width="2.2" fill="none" stroke-linecap="round"/>`
    + `<ellipse class="m-talk" opacity="0" cx="50" cy="${mY + 1.5}" rx="3.6" ry="3" fill="${ink}"/>`
    + `<path class="m-frown" opacity="0" d="M45.5 ${mY + 3} Q50 ${mY - 1.2} 54.5 ${mY + 3}" stroke="${ink}" stroke-width="2.2" fill="none" stroke-linecap="round"/>`;
  const tear = `<g class="fx fx-tear" opacity="0" fill="#74c0fc"><path d="M70 56 q4 6 0 9 q-4 -3 0 -9z"/></g>`;
  const headAcc = ['bowtie', 'scarf'].includes(m.accessory) ? '' : accessory(m.accessory, ink, id);
  const headGroup = `<g class="m-head" transform="translate(21 3) scale(.58)"><g class="m-back">${back}</g><g class="m-body">${head}${furHead}${front}${headRim}${spec}</g>${eyes}${blush}${mouth}${tear}<g class="m-acc">${headAcc}</g></g>`;

  // ---------- body (character space 0–100, head centred at 50,33) ----------
  const torsoD = 'M50 46 C35 46 28 58 28.5 70 C29 83 38 90 50 90 C62 90 71 83 71.5 70 C72 58 65 46 50 46z';
  let torsoFill = F, bellyFill = FL, limb = FD, paw = F, feetFill = FD, belly = `<ellipse cx="50" cy="73" rx="13.5" ry="13" fill="${FL}"/>`, extra = '', tail = '', armShape = 'paw';
  switch (sp) {
    case 'penguin': torsoFill = FP; limb = FP; paw = FP; feetFill = FT; belly = `<ellipse cx="50" cy="71" rx="15" ry="17" fill="${FL}"/>`; armShape = 'flipper'; break;
    case 'panda': torsoFill = FL; limb = `url(#${id}p)`; paw = limb; feetFill = limb; belly = ''; break;
    case 'owl': case 'parrot': feetFill = FT; armShape = 'wing'; belly = `<ellipse cx="50" cy="72" rx="13" ry="14" fill="${FL}"/>` + [0, 1, 2].map((i) => `<path d="M${43 + i * 3.5} ${66 + i * 4} q2 2 4 0" stroke="${pale}" stroke-width="1.2" fill="none" opacity=".9"/>`).join(''); break;
    case 'robot': armShape = 'robot'; belly = `<rect x="38" y="60" width="24" height="17" rx="5" fill="${ink}" opacity=".88"/><circle cx="44" cy="68.5" r="2.2" fill="#7df3ff"/><circle cx="50" cy="68.5" r="2.2" fill="#ffc83d"/><circle cx="56" cy="68.5" r="2.2" fill="#ff6b8a"/>`; break;
    case 'sloth': torsoFill = F; break;
    case 'ant': belly = [0, 1].map((i) => `<path d="M33 ${64 + i * 9} Q50 ${68 + i * 9} 67 ${64 + i * 9}" stroke="${deep}" stroke-width="2.4" fill="none" opacity=".55"/>`).join(''); break;
    case 'tortoise': extra = `<ellipse cx="50" cy="70" rx="27" ry="21" fill="${FD}"/><path d="M50 52 L62 60 L62 76 L50 84 L38 76 L38 60 Z M50 52 V49 M62 60 L72 56 M62 76 L72 80 M38 60 L28 56 M38 76 L28 80" stroke="${hi}" stroke-width="1.6" fill="none" opacity=".6"/>`; break;
    case 'frog': feetFill = F; break;
    case 'lion': belly = `<ellipse cx="50" cy="73" rx="13" ry="12.5" fill="${FL}"/>`; break;
  }
  switch (sp) {
    case 'fox': tail = `<path d="M62 82 C82 86 92 66 84 50 C82 64 74 70 62 72z" fill="${F}"/><path d="M84 50 C88 56 88 62 85 66 C82 60 80 55 84 50z" fill="#fff"/>`; break;
    case 'cat': tail = `<path d="M66 84 C84 86 86 70 80 61" stroke="${FD}" stroke-width="5" fill="none" stroke-linecap="round"/>`; break;
    case 'dog': tail = `<path d="M69 78 C79 76 82 68 80 62" stroke="${FD}" stroke-width="5.5" fill="none" stroke-linecap="round"/>`; break;
    case 'raccoon': tail = `<path d="M64 84 C80 88 88 78 86 66" stroke="${FD}" stroke-width="8" fill="none" stroke-linecap="round"/><path d="M64 84 C80 88 88 78 86 66" stroke="${ink}" stroke-width="8" fill="none" stroke-dasharray="3.5 4.5" opacity=".55"/>`; break;
    case 'beaver': tail = `<ellipse cx="73" cy="86" rx="12" ry="5.5" transform="rotate(-18 73 86)" fill="${deep}"/><path d="M64 86 L82 80 M66 89 L84 83" stroke="${ink}" stroke-width=".8" opacity=".35"/>`; break;
    case 'otter': tail = `<path d="M63 85 C78 92 88 86 91 78" stroke="${FD}" stroke-width="6" fill="none" stroke-linecap="round"/>`; break;
    case 'bunny': tail = `<circle cx="70" cy="83" r="5.5" fill="#ffffff"/>`; break;
    case 'lion': tail = `<path d="M66 84 C82 88 86 78 84 70" stroke="${FD}" stroke-width="3.5" fill="none" stroke-linecap="round"/><circle cx="84" cy="68" r="4.5" fill="${FG}"/>`; break;
    case 'axolotl': tail = `<path d="M62 84 C78 90 88 84 93 74" stroke="${F}" stroke-width="6" fill="none" stroke-linecap="round"/><path d="M70 88 C80 90 88 84 92 76" stroke="#ff8fb8" stroke-width="2" fill="none" opacity=".8"/>`; break;
    case 'hedgehog': tail = Array.from({ length: 6 }, (_, i) => { const y = 52 + i * 6; return `<polygon points="30,${y} 21,${y + 3} 30,${y + 6}" fill="${FD}"/><polygon points="70,${y} 79,${y + 3} 70,${y + 6}" fill="${FD}"/>`; }).join(''); break;
  }
  const arm = (side) => {
    const sx = side < 0 ? 31 : 69, rot = side < 0 ? 22 : -22;
    let shape;
    if (armShape === 'wing') shape = `<path d="M0 -2 C${-side * -9} 4 ${side * 9} 16 ${side * 2} 22 C${-side * 3} 16 ${-side * 4} 6 0 -2z" fill="${FD}"/><path d="M${side * 1} 6 l${side * 4} 6 M${side * 1} 12 l${side * 3} 5" stroke="${pale}" stroke-width="1" opacity=".6"/>`;
    else if (armShape === 'flipper') shape = `<path d="M-3.5 -2 Q${side * 10} 10 ${side * 4} 22 Q-1 14 -3.5 -2z" fill="${FP}"/>`;
    else if (armShape === 'robot') shape = `<rect x="-3.2" y="-1" width="6.4" height="15" rx="3.2" fill="#9aa3bf"/><circle cx="0" cy="7" r="1.4" fill="#6b7598"/><rect x="-4.6" y="13" width="9.2" height="7" rx="3" fill="${FD}"/>`;
    else shape = `<rect x="-4.6" y="-2" width="9.2" height="19" rx="4.6" fill="${limb}"/><ellipse cx="0" cy="17" rx="5.4" ry="4.6" fill="${paw}"/><path d="M-2.2 19.4 v1.6 M0 19.8 v1.6 M2.2 19.4 v1.6" stroke="${ink}" stroke-width=".7" opacity=".3" stroke-linecap="round"/>`;
    return `<g transform="translate(${sx} 55)"><g class="m-arm m-arm-${side < 0 ? 'l' : 'r'}"><g transform="rotate(${rot})">${shape}</g></g></g>`;
  };
  const feet = `<ellipse cx="41" cy="89" rx="7.6" ry="4.4" fill="${feetFill}"/><ellipse cx="59" cy="89" rx="7.6" ry="4.4" fill="${feetFill}"/>${FURRY.has(sp) ? `<path d="M38.5 91.3 v-1.6 M41 91.6 v-1.6 M43.5 91.3 v-1.6 M56.5 91.3 v-1.6 M59 91.6 v-1.6 M61.5 91.3 v-1.6" stroke="${ink}" stroke-width=".7" opacity=".3" stroke-linecap="round"/>` : ''}`;
  const torso = robot
    ? `<rect x="29" y="47" width="42" height="42" rx="13" fill="${F}"/><rect x="29" y="47" width="42" height="42" rx="13" fill="url(#${id}r)"/>`
    : `<path d="${torsoD}" fill="${torsoFill}"/><path d="${torsoD}" fill="url(#${id}r)"/>${FURRY.has(sp) ? `<path d="${torsoD}" fill="none" stroke="${sp === 'panda' ? '#9aa3bf' : deep}" stroke-opacity=".2" stroke-width="2" stroke-dasharray="1 2.6" stroke-linecap="round"/>` : ''}`;
  const bodySpec = `<ellipse cx="39" cy="61" rx="6" ry="9" transform="rotate(20 39 61)" fill="url(#${id}s)" opacity=".55"/>`;
  const neckAO = `<ellipse cx="50" cy="51" rx="18" ry="6" fill="url(#${id}o)"/>`;
  const neckAcc = ['bowtie', 'scarf'].includes(m.accessory) ? accessory(m.accessory, ink, id, true) : '';

  const fx = `<g class="fx fx-think" opacity="0"><circle cx="77" cy="12" r="2.6"/><circle cx="84" cy="5" r="3.8"/><circle cx="93" cy="-4" r="5"/></g>`
    + `<g class="fx fx-zzz" opacity="0" font-family="ui-rounded, system-ui, sans-serif" font-weight="800" fill="${deep}"><text x="74" y="12" font-size="11">z</text><text x="83" y="2" font-size="15">Z</text></g>`
    + `<g class="fx fx-spark" opacity="0" fill="#ffc83d"><path d="M82 10 l2.6 6 6 2.6 -6 2.6 -2.6 6 -2.6 -6 -6 -2.6 6 -2.6z"/><path d="M12 18 l2 4.6 4.6 2 -4.6 2 -2 4.6 -2 -4.6 -4.6 -2 4.6 -2z"/></g>`
    + `<g class="fx fx-heart" opacity="0" fill="#ff5c7a"><path d="M84 10 c-3.5 -7 -12 -2 -7 5 l7 7 7 -7 c5 -7 -3.5 -12 -7 -5z"/></g>`
    + `<g class="fx fx-tool" opacity="0"><g class="m-gear" fill="${ink}"><circle cx="84" cy="12" r="6"/><circle cx="84" cy="12" r="2.6" fill="#fff"/>${[0, 45, 90, 135, 180, 225, 270, 315].map((r) => `<rect x="82.7" y="3.5" width="2.6" height="4.4" transform="rotate(${r} 84 12)"/>`).join('')}</g></g>`;

  const character = `<g class="m-all">${tail}${extra}${feet}${torso}${belly}${bodySpec}${neckAO}${arm(-1)}${arm(1)}${headGroup}${neckAcc}</g>`;
  const shadow = `<ellipse cx="50" cy="93" rx="25" ry="4.5" fill="url(#${id}h)"/>`;
  const badgePaths = m.badge ? iconPaths(m.badge) : '';
  // Badge grows as the icon shrinks so the role stays legible on cards and lists.
  const br = size <= 48 ? 21 : size <= 72 ? 18 : 13.5; const bc = 100 - br - 3; const bk = (br * 1.06) / 24 * 1.4;
  const badge = tile && badgePaths ? `<g class="m-badge" style="transform-origin:${bc}px ${bc}px"><circle cx="${bc}" cy="${bc}" r="${br}" fill="#fff"/><circle cx="${bc}" cy="${bc}" r="${(br * 0.91).toFixed(1)}" fill="${pale}" opacity=".6"/><g transform="translate(${(bc - 12 * bk).toFixed(2)} ${(bc - 12 * bk).toFixed(2)}) scale(${bk.toFixed(3)})" fill="none" stroke="${deep}" stroke-width="${size <= 72 ? 2.6 : 2.3}" stroke-linecap="round" stroke-linejoin="round">${badgePaths}</g></g>` : '';
  const seed = [...String(m.nickname || sp)].reduce((a, ch) => a + ch.charCodeAt(0), 0);
  const style = `--blink:${(3 + (seed % 7) * 0.45).toFixed(2)}s;--look:${6 + (seed % 5)}s;--phase:-${((seed % 10) / 5).toFixed(1)}s`;
  const aria = esc(label || `${m.nickname || 'Agent'} the ${sp}`);
  if (!tile) return `<svg xmlns="http://www.w3.org/2000/svg" class="mascot" viewBox="-8 -10 116 108" width="${size}" height="${size}" role="img" aria-label="${aria}" style="${style}">${defs}${shadow}${character}${fx}</svg>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" class="mascot tiled" viewBox="0 0 100 100" width="${size}" height="${size}" role="img" aria-label="${aria}" style="${style}">${defs}`
    + `<rect class="m-tile" width="100" height="100" rx="28" fill="url(#${id}t)"/><rect x=".75" y=".75" width="98.5" height="98.5" rx="27.3" fill="none" stroke="#fff" stroke-opacity=".7" stroke-width="1.5"/>`
    + `<g transform="translate(4 4) scale(.92)">${shadow}${character}${fx}</g>${badge}</svg>`;
}

// Head accessories are drawn in head space; bowtie/scarf (neck=true) in body space at the neckline.
function accessory(a, ink, id, neck = false) {
  switch (a) {
    case 'glasses': return `<g fill="none" stroke="${ink}" stroke-width="1.8"><circle cx="38" cy="50" r="9" fill="#ffffff" fill-opacity=".12"/><circle cx="62" cy="50" r="9" fill="#ffffff" fill-opacity=".12"/><path d="M47 49.5 Q50 47.5 53 49.5"/></g>`;
    case 'headset': return `<path d="M17 52 Q17 15 50 15 Q83 15 83 52" stroke="#2b3358" stroke-width="3.6" fill="none" stroke-linecap="round"/><rect x="11.5" y="45" width="10" height="16" rx="5" fill="#2b3358"/><rect x="78.5" y="45" width="10" height="16" rx="5" fill="#2b3358"/><path d="M17 60 Q21 74 38 73" stroke="#2b3358" stroke-width="2.2" fill="none" stroke-linecap="round"/><circle cx="39" cy="73" r="2.6" fill="#ff6b5a"/>`;
    case 'beanie': return `<path d="M19 35 Q50 2 81 35 Z" fill="#ff6b6b"/><path d="M19 35 Q50 2 81 35" stroke="#ff9a9a" stroke-width="1.2" fill="none" opacity=".7"/><rect x="17" y="31" width="66" height="9" rx="4.5" fill="#e04848"/><circle cx="50" cy="9" r="5.5" fill="#fff"/>`;
    case 'bowtie': return neck ? `<path d="M42 54 L50 51 L42 47.5 Q40.8 50.8 42 54z M58 54 L50 51 L58 47.5 Q59.2 50.8 58 54z" fill="#ff5c7a"/><rect x="48.2" y="49.2" width="3.6" height="3.6" rx="1.2" fill="#d43b5a"/>` : '';
    case 'crown': return `<path d="M31 25 L35 8 L43.5 18 L50 5 L56.5 18 L65 8 L69 25 Z" fill="url(#${id}g)" stroke="#c9821a" stroke-width="1.2" stroke-linejoin="round"/><circle cx="50" cy="19" r="2.2" fill="#ff5c7a"/>`;
    case 'scarf': return neck ? `<path d="M34 49 Q50 56 66 49 L66 54.5 Q50 61.5 34 54.5z" fill="#4dabf7"/><rect x="56" y="52" width="6" height="14" rx="2.6" transform="rotate(-8 59 52)" fill="#339af0"/>` : '';
    case 'monocle': return `<circle cx="62" cy="50" r="9" fill="#ffffff" fill-opacity=".14" stroke="#c9821a" stroke-width="2.2"/><path d="M71 52 Q76 66 72 80" stroke="#c9821a" stroke-width="1.3" fill="none"/>`;
    case 'flower': return `<g transform="translate(75 25)">${[0, 72, 144, 216, 288].map((r) => `<ellipse rx="4.2" ry="7.2" transform="rotate(${r}) translate(0 -6)" fill="#ffa8cc"/>`).join('')}<circle r="3.8" fill="#ffd43b"/></g>`;
    case 'cap': return `<path d="M21 35 Q50 7 79 35 Z" fill="#20c997"/><path d="M50 32 h31 a3 3 0 0 1 0 6 h-31z" fill="#12b886"/><circle cx="50" cy="12" r="2.4" fill="#12b886"/>`;
    default: return '';
  }
}

// Wrapper with an animation state: idle | thinking | working | tool | talking | happy | sad | sleeping | waving
export const MASCOT_STATES = ['idle', 'thinking', 'working', 'tool', 'talking', 'happy', 'sad', 'sleeping', 'waving'];
export function crewHTML(m, size = 64, state = 'idle', label = '') {
  const st = MASCOT_STATES.includes(state) ? state : 'idle';
  return `<span class="crew" data-state="${st}">${mascotSVG(m, size, label)}</span>`;
}
export function setCrewState(el, state, revertMs = 0) {
  if (!el) return;
  el.dataset.state = MASCOT_STATES.includes(state) ? state : 'idle';
  clearTimeout(el._revert);
  if (revertMs) el._revert = setTimeout(() => { el.dataset.state = 'idle'; }, revertMs);
}
