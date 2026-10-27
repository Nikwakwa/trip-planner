'use strict';

/* pad.js — the practice pad.
   A hidden present for a friend who drums: eight taps on the title of the "What's new"
   sheet (one for each side of the pad) open a practice pad to play. Drawn here and
   sounded by the device itself, so it works offline. */

const PAD_NAME = 'DOTTED LINE';              // the words on the pad
const PAD_TAPS = 8;
const padEgg = { taps: 0, at: 0, audio: null, noise: null };

// The corners of an eight-sided shape around the middle of the drawing, flat side up.
function octagon(r) {
  return Array.from({ length: 8 }, (_, k) => {
    const a = (22.5 + 45 * k) * Math.PI / 180;
    return `${(160 + r * Math.cos(a)).toFixed(1)},${(160 + r * Math.sin(a)).toFixed(1)}`;
  }).join(' ');
}

function openPad() {
  const stick = 'M12 -2.5 L70 -6.5 L340 -6.5 L340 6.5 L70 6.5 L12 2.5 Z';
  $('#about-body').innerHTML = `
    <div class="pad-wrap">
      <svg class="pad" viewBox="0 0 320 320" role="img" aria-label="${T('A practice pad and a drumstick')}">
        <polygon points="${octagon(152)}" fill="#000" opacity=".18" transform="translate(0 5)"/>
        <polygon data-pad="rim" points="${octagon(152)}" fill="#d8b384"/>
        <polygon data-pad="rim" points="${octagon(147)}" fill="#c59c68"/>
        <polygon data-pad="top" points="${octagon(138)}" fill="#474c50"/>
        <text x="160" y="84" text-anchor="middle" font-size="27" font-weight="800" textLength="${Math.min(150, PAD_NAME.length * 19)}" lengthAdjust="spacingAndGlyphs">${esc(PAD_NAME)}</text>
        <g id="pad-rings"></g>
        <g id="pad-stick" class="pad-stick" transform="translate(186 172)">
          <g><g transform="rotate(34)">
            <g transform="translate(3 6)" opacity=".28"><ellipse cx="6" rx="9" ry="6"/><path d="${stick}"/></g>
            <path d="${stick}" fill="#c99b62"/>
            <path d="M70 -6.5 L340 -6.5 L340 -2 L70 -2 Z" fill="#dab27c"/>
            <ellipse cx="6" rx="9" ry="6" fill="#b98a52"/>
          </g></g>
        </g>
      </svg>
      <p class="pad-note">${T('You found it. Go on, play.')}</p>
    </div>`;
  $('#about-body').scrollTop = 0;
}

// One stroke: a short thump with the click of the stick on top. The wooden edge sounds higher and drier.
function padSound(rim) {
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) return;
  const ac = padEgg.audio || (padEgg.audio = new Ctx());
  if (ac.state === 'suspended') ac.resume();
  const t = ac.currentTime;
  const thump = ac.createOscillator();
  const thumpGain = ac.createGain();
  thump.frequency.setValueAtTime(rim ? 950 : 270, t);
  thump.frequency.exponentialRampToValueAtTime(rim ? 700 : 150, t + .05);
  thumpGain.gain.setValueAtTime(rim ? .22 : .5, t);
  thumpGain.gain.exponentialRampToValueAtTime(.001, t + (rim ? .05 : .09));
  thump.connect(thumpGain).connect(ac.destination);
  thump.start(t);
  thump.stop(t + .1);
  if (!padEgg.noise) {
    padEgg.noise = ac.createBuffer(1, Math.round(ac.sampleRate * .03), ac.sampleRate);
    const data = padEgg.noise.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  }
  const click = ac.createBufferSource();
  const high = ac.createBiquadFilter();
  const clickGain = ac.createGain();
  click.buffer = padEgg.noise;
  high.type = 'highpass';
  high.frequency.value = rim ? 3000 : 1500;
  clickGain.gain.setValueAtTime(.3, t);
  clickGain.gain.exponentialRampToValueAtTime(.001, t + .03);
  click.connect(high).connect(clickGain).connect(ac.destination);
  click.start(t);
}

// The stick lands where the pad was touched.
function hitPad(svg, e, rim) {
  const box = svg.getBoundingClientRect();
  if (!box.width) return;
  const x = ((e.clientX - box.left) / box.width * 320).toFixed(1);
  const y = ((e.clientY - box.top) / box.height * 320).toFixed(1);
  const stick = $('#pad-stick');
  stick.setAttribute('transform', `translate(${x} ${y})`);
  padSound(rim);
  if (navigator.vibrate) navigator.vibrate(8);
  if (matchMedia('(prefers-reduced-motion: reduce)').matches || !stick.animate) return;
  stick.firstElementChild.animate(
    [{ transform: 'translate(-6px, -12px) scale(1.06)' }, { transform: 'translate(0, 0) scale(1)' }],
    { duration: 80, easing: 'ease-in' });
  $('#pad-rings').insertAdjacentHTML('beforeend', `<circle class="pad-ring" cx="${x}" cy="${y}" r="26"/>`);
  const ring = $('#pad-rings').lastElementChild;
  ring.animate([{ transform: 'scale(.2)', opacity: .5 }, { transform: 'scale(1)', opacity: 0 }],
    { duration: 320, easing: 'ease-out' }).onfinish = () => ring.remove();
}

// Only the title of "What's new" counts (Privacy shares the sheet).
$('#about-title').addEventListener('click', () => {
  if (!$('#about-body .version')) return;
  const now = Date.now();
  padEgg.taps = now - padEgg.at < 1500 ? padEgg.taps + 1 : 1;
  padEgg.at = now;
  if (padEgg.taps < PAD_TAPS) return;
  padEgg.taps = 0;
  if (navigator.vibrate) navigator.vibrate([10, 40, 10]);
  openPad();
});
$('#about-body').addEventListener('pointerdown', (e) => {
  const part = e.target.closest('[data-pad]');
  if (!part) return;
  e.preventDefault();                        // no text selection or double-tap zoom while playing
  hitPad(part.closest('svg'), e, part.dataset.pad === 'rim');
});
