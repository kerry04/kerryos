// Kerry's liked songs on the TV, on repeat, through Spotify's own embed
// player. Liked Songs itself is private on Spotify, so this is the set of
// tracks from it as public links; the embed plays them for visitors
// (30-second previews unless the visitor is signed in to Spotify).

export const TRACKS = [
  ['4INDiWSKvqSKDEu7mh8HFz', 'Mo Money Mo Problems', 'The Notorious B.I.G., Mase, Diddy'],
  ['0trHOzAhNpGCsGBEu7dOJo', 'N.Y. State of Mind', 'Nas'],
  ['4afAkoXCBA515dfVc5bp0V', 'Leka dugite', 'Kigoma All Stars'],
  ['3anaHXs7z8NwLUatPxqJlE', 'Amen', 'Shaboozey, Jelly Roll'],
  ['59rtiYOPgMEDf3yPEfU2la', 'Still Tippin’', 'Mike Jones, Slim Thug, Paul Wall'],
  ['3D7wEIwqXryatRi2xeFM3j', 'LAST DANCE', 'Wakadinali'],
  ['3jlbL2OTD5YmIunYzgQTAN', 'Live Your Life', 'T.I., Rihanna'],
  ['4Zpz77aOKbdE67GHRwsXcB', 'Friendzone', 'Sauti Sol'],
  ['59a0H53cBcHWDVn7eAyk4F', 'Home', 'BigXthaPlug, Shaboozey'],
  ['2eBFbJrTEIWVnqsVRWOgVN', 'E No Easy', 'P-Square, J. Martins'],
  ['6D7jtD4GbpX1ujF1KqPr7Y', 'Romping Shop', 'Vybz Kartel, Spice'],
  ['105eBHHDJ4oU0Ea9SyVYEO', 'I Live for You', 'Adawnage'],
  ['2Ct4MxKDrJjFkUITbUoFlH', 'Pas le temps', 'Nerih'],
].map(([id, title, artist]) => ({ id, title, artist, uri: `spotify:track:${id}`, url: `https://open.spotify.com/track/${id}` }));

const API_SRC = 'https://open.spotify.com/embed/iframe-api/v1';
let apiPromise = null;
function loadApi() {
  if (apiPromise) return apiPromise;
  apiPromise = new Promise((resolve, reject) => {
    const prev = window.onSpotifyIframeApiReady;
    window.onSpotifyIframeApiReady = (api) => { prev?.(api); resolve(api); };
    const s = document.createElement('script');
    s.src = API_SRC; s.async = true;
    s.onerror = () => { apiPromise = null; reject(new Error('Spotify embed API failed to load')); };
    document.head.appendChild(s);
    setTimeout(() => reject(new Error('Spotify embed API timed out')), 15000);
  });
  return apiPromise;
}

// mount: the element that becomes the TV's live surface
export function createSpotify(mount) {
  const host = document.createElement('div');
  mount.appendChild(host);
  const st = { on: false, by: null, audible: true, ready: false, playing: false, buffering: false, index: 0, position: 0, duration: 0, error: null };
  const listeners = new Set();
  const emit = () => listeners.forEach((f) => f(st));
  let controller = null, creating = null, wantPlay = false, endGuard = 0;

  function ensure(index) {
    if (controller) return Promise.resolve(controller);
    if (creating) return creating;
    creating = loadApi().then((api) => new Promise((resolve) => {
      api.createController(host, { uri: TRACKS[index].uri, width: '100%', height: 352 }, (c) => {
        controller = c;
        c.addListener('ready', () => { st.ready = true; emit(); if (wantPlay && st.audible) c.play(); });
        c.addListener('playback_update', (e) => {
          const d = e.data || {};
          st.playing = !d.isPaused && !d.isBuffering;
          st.buffering = !!d.isBuffering;
          st.position = d.position || 0; st.duration = d.duration || 0;
          // move on when a track (or its preview) finishes
          if (d.isPaused && st.duration > 0 && st.position >= st.duration - 400 && performance.now() > endGuard) {
            endGuard = performance.now() + 3000;
            play((st.index + 1) % TRACKS.length, 'kerry'); // back to his liked songs, on repeat
          }
          emit();
        });
        resolve(c);
      });
    })).catch((err) => { st.error = err.message; st.on = false; creating = null; emit(); throw err; });
    return creating;
  }

  // by: 'kerry' (he put it on himself) or 'visitor'
  function play(index = st.index, by = st.by || 'visitor') {
    st.on = true; st.by = by; st.index = index; st.error = null; wantPlay = true;
    endGuard = performance.now() + 3000;
    emit();
    return ensure(index).then((c) => {
      c.loadUri(TRACKS[index].uri);
      // the embed needs a beat to swap tracks before play() sticks
      setTimeout(() => { if (wantPlay && st.audible) c.play(); }, 350);
    }).catch(() => {});
  }
  function toggle() {
    if (!controller) return play(st.index, 'visitor');
    wantPlay = !st.playing;
    if (wantPlay) st.audible = true;
    controller.togglePlay();
  }
  function stop() {
    wantPlay = false;
    controller?.pause();
    st.on = false; st.playing = false; st.by = null;
    emit();
  }
  // a visitor who entered quietly (or muted) sees what's on but hears nothing
  function setAudible(on) {
    if (on === st.audible) return;
    st.audible = on;
    if (!controller || !st.on) return;
    if (on && wantPlay) controller.play(); else if (!on) controller.pause();
  }
  return {
    state: st, tracks: TRACKS, play, toggle, stop, setAudible,
    next: () => play((st.index + 1) % TRACKS.length, 'visitor'),
    prev: () => play((st.index + TRACKS.length - 1) % TRACKS.length, 'visitor'),
    onChange(f) { listeners.add(f); return () => listeners.delete(f); },
  };
}
