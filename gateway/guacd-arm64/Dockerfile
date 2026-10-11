# KerryOS guacd — built from Apache guacamole-server 1.5.5 source.
#
# Why: the official guacamole/guacd:1.5.5 image is AMD64-only (exec format
# error on ARM), and the lscr.io/linuxserver/guacd replacement ships without
# a working guacd (port 4822 never opens). guacamole-server is a small,
# portable autotools build, so compiling the official tarball on Ubuntu
# 24.04 is the reliable path. Same version as the webapp (1.5.5).
#
# The tarball is vendored (./vendor/) and SHA256-verified at build time, the
# same approach as the JDBC extension in ../guacamole-webapp/.
ARG GUAC_VERSION=1.5.5

FROM ubuntu:24.04

ARG GUAC_VERSION
ARG GUAC_SHA256=67499611c2e22d9c933763adc5408e716a4bfd08a3eb8a5ba2fc6f8f70868f6b

RUN apt-get update && apt-get install -y --no-install-recommends \
        build-essential \
        autoconf automake libtool pkg-config \
        libcairo2-dev \
        libjpeg-turbo8-dev \
        libpng-dev \
        libtool-bin \
        libuuid1 \
        uuid-dev \
        freerdp2-dev \
        libssl-dev \
        libvncserver-dev \
        libpulse-dev \
        libvorbis-dev \
        libwebp-dev \
        && rm -rf /var/lib/apt/lists/*

COPY vendor/guacamole-server-${GUAC_VERSION}.tar.gz /tmp/guacamole-server.tar.gz
RUN echo "${GUAC_SHA256}  /tmp/guacamole-server.tar.gz" | sha256sum -c - \
    && tar -xzf /tmp/guacamole-server.tar.gz -C /tmp \
    && cd /tmp/guacamole-server-${GUAC_VERSION} \
    && ./configure --with-init-dir=/etc/init.d --enable-allow-plugins 2>/dev/null || ./configure \
    && make -j"$(nproc)" \
    && make install \
    && ldconfig \
    && rm -rf /tmp/guacamole-server-${GUAC_VERSION} /tmp/guacamole-server.tar.gz

# Run as an unprivileged user; guacd only needs to bind a high port and talk
# out to VNC/RDP hosts on the private network.
RUN useradd --system --no-create-home --shell /usr/sbin/nologin guacd \
    && mkdir -p /var/lib/guacd && chown guacd:guacd /var/lib/guacd

USER guacd

EXPOSE 4822

# Bind all interfaces: with no -b flag guacd listens on ::1 only, which the
# bridge network (IPv4) can never reach.
CMD ["/usr/local/sbin/guacd", "-f", "-b", "0.0.0.0"]
