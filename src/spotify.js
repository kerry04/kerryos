// Kerry's rotation on the TV, through Spotify's own embed player.
// Tracks are public Spotify links; the embed plays them for visitors
// (30-second previews unless the visitor is signed in to Spotify).

export const TRACKS = [
  ['4INDiWSKvqSKDEu7mh8HFz', 'Mo Money Mo Problems', 'The Notorious B.I.G.'],
  ['0trHOzAhNpGCsGBEu7dOJo', 'N.Y. State of Mind', 'Nas'],
  ['3anaHXs7z8NwLUatPxqJlE', 'Amen', 'Shaboozey, Jelly Roll'],
  ['4afAkoXCBA515dfVc5bp0V', 'Leka dugite', 'Kigoma All Stars'],
  ['59rtiYOPgMEDf3yPEfU2la', 'Still Tippin’', 'Mike Jones'],
  ['3D7wEIwqXryatRi2xeFM3j', 'LAST DANCE', 'Wakadinali'],
  ['5lc6uffpTFVTlh3KhfxNxh', 'Young Puffy', 'Octopizzo'],
  ['3jlbL2OTD5YmIunYzgQTAN', 'Live Your Life', 'T.I., Rihanna'],
  ['4Zpz77aOKbdE67GHRwsXcB', 'Friendzone', 'Sauti Sol'],
  ['59a0H53cBcHWDVn7eAyk4F', 'Home', 'BigXthaPlug, Shaboozey'],
  ['5kjr4iiG9ObVSxjJrDIGlG', 'Mwanza', 'Rayvanny, Diamond Platnumz'],
  ['6dAm1E7WiKh4CxDBEjgue0', 'Hard Drugs', 'Busy Signal'],
  ['0EjgTTN8AcUAjJPdz9uwU2', 'Knocking On Heavens Door', 'Ed Robinson'],
  ['2pEo8f55UreXarnZCfjr5s', 'Don’t Haffi Dread', 'Morgan Heritage'],
  ['0ectw8g5yRkC7GNsh6gP4h', 'reason', 'Omah Lay'],
  ['25T5W200EXT5y8sacYVOYu', 'One Take Freestyle', '1900Rugrat'],
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
  const st = { on: false, ready: false, playing: false, buffering: false, index: 0, position: 0, duration: 0, error: null };
  const listeners = new Set();
  const emit = () => listeners.forEach((f) => f(st));
  let controller = null, creating = null, wantPlay = false, endGuard = 0;

  function ensure(index) {
    if (controller) return Promise.resolve(controller);
    if (creating) return creating;
    creating = loadApi().then((api) => new Promise((resolve) => {
      api.createController(host, { uri: TRACKS[index].uri, width: '100%', height: 352 }, (c) => {
        controller = c;
        c.addListener('ready', () => { st.ready = true; emit(); if (wantPlay) c.play(); });
        c.addListener('playback_update', (e) => {
          const d = e.data || {};
          st.playing = !d.isPaused && !d.isBuffering;
          st.buffering = !!d.isBuffering;
          st.position = d.position || 0; st.duration = d.duration || 0;
          // move on when a track (or its preview) finishes
          if (d.isPaused && st.duration > 0 && st.position >= st.duration - 400 && performance.now() > endGuard) {
            endGuard = performance.now() + 3000;
            play((st.index + 1) % TRACKS.length);
          }
          emit();
        });
        resolve(c);
      });
    })).catch((err) => { st.error = err.message; st.on = false; creating = null; emit(); throw err; });
    return creating;
  }

  function play(index = st.index) {
    st.on = true; st.index = index; st.error = null; wantPlay = true;
    endGuard = performance.now() + 3000;
    emit();
    return ensure(index).then((c) => {
      c.loadUri(TRACKS[index].uri);
      // the embed needs a beat to swap tracks before play() sticks
      setTimeout(() => c.play(), 350);
    }).catch(() => {});
  }
  function toggle() {
    if (!controller) return play();
    wantPlay = !st.playing;
    controller.togglePlay();
  }
  function stop() {
    wantPlay = false;
    controller?.pause();
    st.on = false; st.playing = false;
    emit();
  }
  return {
    state: st, tracks: TRACKS, play, toggle, stop,
    next: () => play((st.index + 1) % TRACKS.length),
    prev: () => play((st.index + TRACKS.length - 1) % TRACKS.length),
    onChange(f) { listeners.add(f); return () => listeners.delete(f); },
  };
}
