# KerryOS Guacamole webapp — official Apache code, built natively for ARM64.
#
# Why this exists: the official guacamole/guacamole image is AMD64-only and
# crash-loops (exit 255) on ARM hosts like brain 67. This builds the IDENTICAL
# official guacamole-client 1.5.5 from source (matching the guacd protocol
# version) so the image is native ARM64. Same /guacamole context, same REST
# API the broker uses, same GUACAMOLE_HOME layout as the official image.
#
# One-time build cost: several minutes (Maven). Rebuild only on version bump.
ARG GUAC_VERSION=1.5.5

FROM maven:3-eclipse-temurin-17 AS builder
ARG GUAC_VERSION
RUN apt-get update && apt-get install -y --no-install-recommends git \
    && rm -rf /var/lib/apt/lists/*
RUN git clone --depth 1 --branch ${GUAC_VERSION} \
        https://github.com/apache/guacamole-client.git /src
WORKDIR /src
# Skip tests for build speed; the war is what we ship.
RUN mvn -DskipTests package

FROM tomcat:9-jre17
ENV GUACAMOLE_HOME=/etc/guacamole
RUN mkdir -p /etc/guacamole
# The war lands as guacamole-<version>.war; deploy it at the /guacamole
# context path exactly like the official image does.
COPY --from=builder /src/guacamole/target/guacamole-*.war \
     /usr/local/tomcat/webapps/guacamole.war
EXPOSE 8080
CMD ["catalina.sh", "run"]
