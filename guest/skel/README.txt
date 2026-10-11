KerryOS — disposable visitor desktop
=====================================

This is a real, isolated Linux desktop built just for your visit.

Session rules
- Your session lasts 20 minutes, then it is destroyed. Nothing you do here
  persists: no files, no browser history, no saved logins survive the session.
- All network traffic from this desktop goes through an allowlisted proxy.
  Only approved sites (like sokoresult.com) load; everything else is blocked.
- There is one visitor session at a time. If KerryOS is busy, try again in
  a few minutes.

Things to try
- SokoResult icon: opens https://sokoresult.com in Firefox.
- Portfolio icon: the founder's portfolio site.
- GitHub icon: the source for this very desktop (open-sourced).
- Terminal: open the Whisker menu (bottom-left, on the orb) and launch Terminal, then:
    curl -sI https://sokoresult.com | head -5

Built by Kerry Obai. Enjoy the tour — the desktop resets itself when you leave.
