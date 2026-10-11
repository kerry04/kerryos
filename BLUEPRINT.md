# KerryOS — Project Blueprint
**Saved: 2026-10-11 | Status: Spec phase — not started**

## Mission
Cloud-hosted virtual computer presented as a Windows 7-inspired interactive portfolio. Visitors boot into a desktop, open a real browser, visit SokoResult, use a genuine terminal, explore projects, play retro games.

## Key Architectural Decision
Separate the Windows 7 look/feel from the actual computer behind it. Nostalgia on the surface, real Linux OS underneath, security boundary between visitors and infrastructure.

## Technology Stack

**Portfolio/Desktop Interface:** React + TypeScript + Vite + Tailwind CSS
- Boot animation, Aero-style windows, taskbar, Start menu, desktop icons, browser chrome

**Virtual Computer:** KVM/QEMU + Linux VM on cloud hypervisor
- Each visitor gets isolated, disposable VM
- Maintained Linux distro (XFCE) styled as Windows 7 — NOT actual Windows 7 (unsupported, insecure)

**Remote Desktop:** Apache Guacamole or noVNC via WebSocket + HTTPS
- Session broker controls VM creation/access/destruction

**Network Security:** Egress proxy + Firewall + DNS filtering + Session limits
- Allowlist enforced OUTSIDE the guest OS (not browser settings)
- Block internal/cloud metadata destinations

**Data:** PostgreSQL + Redis (optional) + Object storage
- Session state, approved domains, quotas, portfolio assets
- Guest files ephemeral

## Security Zones
- **Zone A:** Public website (Vercel) — portfolio, boot animation, session launch
- **Zone B:** Control plane — auth, session credentials, rate limits, VM lifecycle (never expose cloud creds to browser)
- **Zone C:** Guest computers — private, disposable, no public IP, no cloud API access
- **Zone D:** Restricted internet gateway — egress proxy with allowlist

## Critical Security Rules
1. Force guest traffic through gateway; deny direct outbound at firewall
2. Check actual destination IP on every connection (defend DNS rebinding, redirects)
3. Block internal IP ranges, cloud metadata endpoints, management plane
4. Disable clipboard, drive redirection, uploads/downloads by default
5. Revert VM to clean snapshot after each session
6. Never embed privileged credentials in frontend or guest images

## Allowlist (initial)
| Destination | Policy |
|---|---|
| Portfolio domain | Allow |
| sokoresult.com | Allow |
| github.com | Optional |
| wikipedia.org | Optional |
| Everything else | Deny by default |

## SokoResult Integration
- Desktop shortcut + Start menu entry → opens in guest browser
- "About this project" local file explaining the engineering
- Visitors use THEIR OWN accounts — no personal credentials in the VM

## Build Stages (independently testable)
1. Local VM + themed desktop (XFCE as Win7)
2. Browser-based remote desktop streaming (Guacamole)
3. Portfolio integration + boot experience
4. Egress proxy + firewall enforcement
5. SokoResult integration + allowlist verification
6. Games, sound, accessibility, responsive
7. Session broker, cleanup, monitoring, cloud deploy

## Master Build Prompt
(Full prompt saved in conversation — for Claude Code / Muse / coding agent.
Key instruction: build and verify each stage, don't generate all infrastructure in one pass.)

## KERRY's Assessment (2026-10-11)
**Scope:** This is a 2–3 month project minimum, not a weekend build.
**Cost:** Cloud VMs with KVM = NOT free-tier friendly. Needs a VPS with virtualization support (~$20–40/mo minimum for a single session host).
**Risk:** Security is the hard part. A misconfigured egress proxy = visitors browsing anywhere from your cloud account.
**Recommendation:** Start with Stage 1 (local VM, free) to prove the concept. Don't touch cloud until the local pipeline works.

## Decision Log
- 2026-10-11: Blueprint saved. Awaiting founder's go-ahead on Stage 1.
