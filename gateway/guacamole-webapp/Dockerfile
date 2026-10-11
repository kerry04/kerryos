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
RUN apt-get update && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/* \
    && mkdir -p /etc/guacamole \
    && curl -fsSL -o /tmp/guacamole.war \
         https://archive.apache.org/dist/guacamole/${GUAC_VERSION}/binary/guacamole-${GUAC_VERSION}.war \
    && echo "${GUAC_SHA256}  /tmp/guacamole.war" | sha256sum -c - \
    && mv /tmp/guacamole.war /usr/local/tomcat/webapps/guacamole.war
EXPOSE 8080
CMD ["catalina.sh", "run"]
