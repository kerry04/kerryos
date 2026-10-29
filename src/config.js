// Asset paths. In local test mode (served from localhost) the character and
// its clips come from three.js' Mixamo sample rigs so the pose system can be
// exercised without Kerry's own models.
const LOCAL = /^(localhost|127\.0\.0\.1)$/.test(location.hostname) && !new URLSearchParams(location.search).has('real');

export const ASSETS = {
  character: LOCAL ? 'assets/test/Xbot.glb' : 'assets/kerry-human.glb',
  clips: LOCAL
    ? {
        idle: ['assets/test/Xbot.glb', 'idle'],
        walk: ['assets/test/Xbot.glb', 'walk'],
        jog: ['assets/test/Xbot.glb', 'run'],
        dance: ['assets/test/Michelle.glb', 'SambaDance'],
        talk: ['assets/test/Xbot.glb', 'agree'],
        jump: ['assets/test/Xbot.glb', 'headShake'],
      }
    : {
        idle: ['assets/idle.glb'],
        walk: ['assets/walk.glb'],
        jog: ['assets/jog.glb'],
        dance: ['assets/dance.glb'],
        talk: ['assets/talk.glb'],
        jump: ['assets/jump.glb'],
        expr: ['assets/expr.glb'],
      },
  hdr: 'assets/room-env.hdr',
  tex: {
    floor: ['assets/tex/floor-wood_diff.jpg', 'assets/tex/floor-wood_nor.jpg', 'assets/tex/floor-wood_rough.jpg'],
    wall: ['assets/tex/wall-plaster_diff.jpg', 'assets/tex/wall-plaster_nor.jpg', 'assets/tex/wall-plaster_rough.jpg'],
    desk: [LOCAL ? null : 'assets/tex/desk-wood_diff.jpg', 'assets/tex/desk-wood_nor.jpg', 'assets/tex/desk-wood_rough.jpg'],
  },
  poster: LOCAL ? null : 'assets/gta6-art.jpg',
  audio: (name) => `assets/audio/${name}.mp3`,
};

export const IS_LOCAL = LOCAL;

export const LINKS = {
  github: 'https://github.com/kerry04',
  soko: LOCAL ? '/test/frame.html' : 'https://sokoresult.com',
  stock: 'https://soko-stock.vercel.app',
  kerryos: 'https://github.com/kerry04/kerryos',
};

// What each clickable thing in the room is about. Plain facts only.
export const SPOTS = {
  kerry: {
    title: 'Kerry Obai',
    kind: 'Founder · full-stack engineer · Kenya',
    body: [
      'Builds SokoResult, a Kenyan-first prediction market, and the tools around it.',
      'He lives his own life in here. Nobody controls him: he gets tired, bored, restless or in the mood to build, and picks what to do next by himself.',
    ],
    links: [['GitHub', 'github']],
    audio: 'tour-kerry',
  },
  soko: {
    title: 'SokoResult',
    kind: 'Live · prediction market',
    body: [
      'Make calls on politics, sport, entertainment and the economy, priced by an LMSR market maker written in Postgres.',
      'Play money only. Every new account starts with Play KSh 10,000. The house model, Soko AI, puts its own number on every market so you can measure your calls against it.',
      'The monitor is the real site, live. Tap "Use it here" to browse it without leaving the room.',
    ],
    links: [['Open sokoresult.com', 'soko']],
    live: true,
    audio: 'tour-soko',
  },
  stock: {
    title: 'Soko Stock',
    kind: 'In build · market terminal',
    body: [
      'The sister app to SokoResult: a data-first terminal built around a live map of where the signals are coming from.',
      'The second screen runs a sketch of that globe.',
    ],
    links: [['Open Soko Stock', 'stock']],
  },
  deck: {
    title: 'Cyberdeck KD-01',
    kind: 'Hardware · AI shell',
    body: [
      'A Linux terminal in a hard case, with a 40% ortholinear keyboard and a trackball.',
      'Kerry uses it to drive Jarvis, his private, fully local assistant. Jarvis reads, drafts and prepares on its own. Anything that sends, spends or books waits for Kerry’s one-tap approval.',
    ],
    audio: 'tour-deck',
    audio2: 'tour-aishell',
  },
  rack: {
    title: 'KerryOS host',
    kind: 'In build · homelab',
    body: [
      'The box behind KerryOS: a Windows 7-styled portfolio that boots a real, disposable Linux desktop in your browser.',
      'One visitor at a time gets their own container. Sessions end after 5 idle minutes or 20 minutes total, and all outbound traffic goes through an allowlist enforced outside the guest.',
    ],
    links: [['KerryOS on GitHub', 'kerryos']],
    audio: 'tour-server',
  },
  board: {
    title: 'The whiteboard',
    kind: 'Working notes',
    body: [
      'The pricing rule behind every SokoResult market, and what is shipping next.',
      'When Kerry is in a building mood he comes here to think before he types.',
    ],
    audio: 'tour-board',
  },
  tv: {
    title: 'PS5 corner',
    kind: 'Downtime',
    body: [
      'Where most evenings end. When he is playing, the match on the TV is live: it reacts to his inputs and he reacts to the score.',
    ],
    audio: 'tour-ps5',
  },
  guitar: {
    title: 'Acoustic guitar',
    kind: 'Music',
    body: [
      'When he picks it up he plays House of the Rising Sun, a traditional folk song, fingerpicked in A minor.',
      'Every note is synthesized in your browser from a plucked-string model, and the strings move when they are played.',
    ],
    audio: 'tour-music',
  },
  hoop: {
    title: 'The hoop',
    kind: 'Physics',
    body: [
      'Real ball physics: gravity, spin, rim and backboard contact, and a net that gives when the ball goes through.',
      'You can throw the ball too. Drag it and let go.',
    ],
    audio: 'tour-hoop',
    audio2: 'tour-ball',
  },
  jersey: {
    title: 'Matchday shirt',
    kind: 'Matchday',
    body: ['Sky blue, framed above the bed. Kerry is a Manchester City fan.'],
    audio: 'tour-nba',
  },
  bed: {
    title: 'Bed',
    kind: 'Rest',
    body: ['Kerry sleeps when his energy runs low, and more readily late at night, Nairobi time.'],
    audio: 'tour-bed',
  },
  shelf: {
    title: 'The shelf',
    kind: 'Odds and ends',
    body: [
      'The mini PC is where the Virtual Web PC experiment started: a full computer in a browser tab, streamed with Hyperbeam, with a panel that finds cheap cloud GPUs and an AI assistant tab.',
      'That project led to KerryOS.',
    ],
    audio: 'tour-shelf',
  },
  window: {
    title: 'Nairobi',
    kind: 'Live view',
    body: [
      'The sky follows the real time in Nairobi. Come back at night and the city lights are on.',
    ],
    audio: 'tour-city',
  },
  poster: {
    title: 'Poster wall',
    kind: 'Waiting room',
    body: ['Counting down to the next big release.'],
    audio: 'tour-gta',
  },
};

export const TOUR = ['intro', 'kerry', 'soko', 'deck', 'rack', 'board', 'window', 'poster', 'tv', 'shelf', 'guitar', 'hoop', 'jersey', 'bed', 'outro'];
