# KerryOS — Your Pick-Me Checklist

Everything on this page is something **only you can do** (cloud console, DNS, your browser). Everything I could do from inside the server is already done. When you finish a step, tell me its number in chat and I'll verify it from here before you move on.

---

## Step 1 — Open ports 80/443 in the Oracle Cloud console ⏳ REQUIRED

This is why nothing loaded in your browser. The server is fine; Oracle's network edge is dropping the packets before they reach it.

1. Log into https://cloud.oracle.com
2. Hamburger menu (☰) → **Networking** → **Virtual Cloud Networks**
3. Click your VCN (the one this instance lives in — its subnet has your instance)
4. Click **Security Lists** in the left sidebar → click **Default Security List for …**
5. Click **Add Ingress Rules**, and add ONE rule at a time (two total):

| Source CIDR | IP Protocol | Destination Port Range | Description |
|---|---|---|---|
| `0.0.0.0/0` | `TCP` | `80` | KerryOS HTTP |
| `0.0.0.0/0` | `TCP` | `443` | KerryOS HTTPS |

   For each rule: leave Source Type as CIDR, **do not** fill source port range, destination type stays CIDR, destination port range = 80 (then 443 again for the second rule). Click **Add Ingress Rule**.

6. If your subnet also uses **Network Security Groups (NSGs)** (check under the subnet's Security tab), add the same two rules there too. If you don't see any NSG attached, skip it.

**How to know it worked:** tell me "step 1 done" on the next message and I'll probe port 80 from an outside vantage and confirm it's open before we continue.

---

## Step 2 (optional now, needed for the real site) — Create the DNS record

The gateway is configured to serve the site on `kerryos.sokoresult.com`. Without DNS, Caddy can't get an HTTPS certificate and the browser won't load it — you need this before launch.

In whatever panel manages **sokoresult.com** (Oracle DNS if the domain is there, or your registrar like Cloudflare/Namecheap):

- **Type:** `A`
- **Name / Host:** `kerryos`
- **Value / Points to:** `92.5.58.122`
- **TTL:** default (or 300)

If you do Step 2, tell me "step 2 done" — the SSL certificate will issue automatically once the record resolves.

*(If you'd rather serve on a different hostname, tell me the name and I'll update the config instead — that's my side, not yours.)*

---

## Step 3 — Test with me

After Step 1, just say "test". Each time you want a desktop I'll mint a fresh session link. Sessions last **20 minutes**, one visitor at a time, and the machine is destroyed after.

If you prefer to test *right now* without waiting on the firewall, run this from your laptop (port 22 IS open):

```
ssh -L 8081:127.0.0.1:8081 ubuntu@92.5.58.122
```

then open in your browser:

```
http://localhost:8081/guacamole/#/client/1?token=<session token>
```

— I hand you a fresh token every time you ask.

---

## What's already live and working (context)

- Session broker boots a disposable Linux desktop (XFCE) per visitor, hard-enforced 20-minute expiry, 1 session at a time.
- Desktop streams into the browser via Guacamole — you get a real machine, not a simulation.
- All guest traffic forced through an allowlist proxy: **sokoresult.com and github.com work; everything else is 403**; the Oracle metadata endpoint is unreachable from the guest.
- Desktop resets to pristine on every session: no files, history, or cookies survive.
- Fix tree committed (`dba3488`).

## Known limitations before launch

- The Windows 7 theming, boot animation, games, and portfolio icons are **Phase 3** — the desktop you'll see is a stock XFCE skeleton.
- nftables egress belt (ENFORCES that even a savvy visitor can't bypass the proxy with `--noproxy`) is written but **not applied** — we agreed to apply it together before going public. Without it, a visitor in the terminal could fetch un-allowlisted sites directly.
- The current guest is one shared session; multi-visitor concurrency is an MVP-2 design goal.
