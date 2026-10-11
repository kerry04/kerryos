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
RUN chown proxy:proxy /etc/squid/squid.conf /etc/squid/domains.txt
EXPOSE 3128
# Foreground; compose handles restarts.
CMD ["squid", "-N", "-f", "/etc/squid/squid.conf"]
