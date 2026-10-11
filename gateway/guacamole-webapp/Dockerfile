# KerryOS Guacamole webapp — official Apache 1.5.5 .war on ARM64 Tomcat.
#
# Why this exists: the official guacamole/guacamole image is AMD64-only and
# crash-loops (exit 255) on ARM hosts like brain 67. The webapp itself is
# pure Java (all native code lives in guacd), so Apache's official prebuilt
# .war runs natively on the multi-arch tomcat:9-jre17 image. Same version
# (1.5.5) as the guacd protocol side, same /guacamole context, same REST API
# the broker uses, same GUACAMOLE_HOME layout as the official image.
#
# No Maven build: the .war is downloaded from Apache's official archive and
# SHA256-verified at build time.
ARG GUAC_VERSION=1.5.5

FROM tomcat:9-jre17
ARG GUAC_VERSION
ENV GUACAMOLE_HOME=/etc/guacamole
# Official SHA256 from https://archive.apache.org/dist/guacamole/1.5.5/binary/
ARG GUAC_SHA256=4267307f3600663723f24af92d596e99c8359425315135052a42d451f9529200
# JDBC auth extension (PostgreSQL) - provides database authentication.
# Without this, Guacamole has no auth backend and all logins fail.
# SHA256 from the same Apache archive directory.
ARG GUAC_JDBC_SHA256=80cca0a02076babad0dc7c76b60daa896f3d9bf10be82708f425fd42ce411393
ARG PGJDBC_VERSION=42.7.3
# JDBC tarball is vendored (./vendor/) rather than curl'd during build: the
# in-container download from archive.apache.org repeatedly came back malformed
# (empty sha256sum input) even with pinned build args, while the host download
# verified clean. Same file, same pinned SHA256, verified before bundling.
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh
COPY vendor/guacamole-auth-jdbc-${GUAC_VERSION}.tar.gz /tmp/guacamole-auth-jdbc.tar.gz
COPY vendor/postgresql-${PGJDBC_VERSION}.jar /tmp/postgresql.jar
RUN apt-get update && apt-get install -y --no-install-recommends curl gettext-base \
    && rm -rf /var/lib/apt/lists/* \
    && mkdir -p /etc/guacamole /etc/guacamole/extensions /etc/guacamole/lib \
    && curl -fsSL -o /tmp/guacamole.war \
         https://archive.apache.org/dist/guacamole/${GUAC_VERSION}/binary/guacamole-${GUAC_VERSION}.war \
    && echo "${GUAC_SHA256}  /tmp/guacamole.war" | sha256sum -c - \
    && mv /tmp/guacamole.war /usr/local/tomcat/webapps/guacamole.war \
    && echo "${GUAC_JDBC_SHA256}  /tmp/guacamole-auth-jdbc.tar.gz" | sha256sum -c - \
    && tar -xzf /tmp/guacamole-auth-jdbc.tar.gz -C /tmp \
    && cp /tmp/guacamole-auth-jdbc-${GUAC_VERSION}/postgresql/guacamole-auth-jdbc-postgresql-${GUAC_VERSION}.jar /etc/guacamole/extensions/ \
    && cp /tmp/postgresql.jar /etc/guacamole/lib/postgresql-${PGJDBC_VERSION}.jar \
    && rm -rf /tmp/guacamole-auth-jdbc.tar.gz /tmp/guacamole-auth-jdbc-${GUAC_VERSION}
EXPOSE 8080
ENTRYPOINT ["/entrypoint.sh"]
CMD ["catalina.sh", "run"]
