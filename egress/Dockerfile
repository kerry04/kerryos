# KerryOS egress proxy (Tinyproxy).
#
# Replaces Squid: Squid 6.14's foreground mode (-N) dies silently (exit 1,
# zero output) on ARM64 regardless of config or user -- an environment-level
# failure not worth more debugging. Tinyproxy is a tiny single-purpose
# HTTP(S) forward proxy with a fraction of the moving parts.
#
# Security model (unchanged):
#  - Deny-by-default DOMAIN allowlist via FilterDefaultDeny + /etc/tinyproxy/filter.
#  - Anti-rebinding (private-IP destinations) is enforced by nftables rule 8,
#    which confines this container to public IPs regardless of DNS answers.
#    The proxy never needs to be trusted on that axis.
#  - The guest's ONLY egress is this proxy at 172.28.0.20:3128 (nftables).
FROM ubuntu:24.04
ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update && apt-get install -y --no-install-recommends \
        tinyproxy \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*
COPY tinyproxy.conf /etc/tinyproxy/tinyproxy.conf
COPY filter /etc/tinyproxy/filter
RUN mkdir -p /var/log/tinyproxy /run/tinyproxy \
 && chown -R tinyproxy:tinyproxy /var/log/tinyproxy /run/tinyproxy /etc/tinyproxy
EXPOSE 3128
# -d: stay in foreground (Docker-friendly).
CMD ["tinyproxy", "-d", "-c", "/etc/tinyproxy/tinyproxy.conf"]
