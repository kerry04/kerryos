# KerryOS egress proxy (Squid)
# Built by the gateway team's compose; static IP 172.28.0.20 on br-kerryos.
# No published ports: the guest reaches it at 172.28.0.20:3128 only.
FROM ubuntu:24.04
ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update && apt-get install -y --no-install-recommends \
        squid \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*
# Policy files owned by the proxy user; squid runs as user 'proxy' on Ubuntu.
COPY squid.conf /etc/squid/squid.conf
COPY domains.txt /etc/squid/domains.txt
RUN chown proxy:proxy /etc/squid/squid.conf /etc/squid/domains.txt \
 && mkdir -p /var/spool/squid /var/log/squid \
 && squid -z -f /etc/squid/squid.conf \
 && rm -f /var/spool/squid/squid.pid \
 && chown -R proxy:proxy /var/spool/squid /var/log/squid
EXPOSE 3128
# NOTE: do NOT run `squid -z` at container startup. On Squid 6, -z bootstraps
# enough of the daemon to write a fresh PID file, and a subsequent `squid -N`
# in the same startup sequence FATALS with "already running" -- a race that
# crash-loops the container. Cache dirs are initialized once here, at build.
# Run unprivileged. The pid file is container-local and goes stale across
# Docker restarts of the same container, so clear it before launching.
USER proxy
CMD ["sh", "-c", "rm -f /var/spool/squid/squid.pid && exec squid -N -f /etc/squid/squid.conf"]
