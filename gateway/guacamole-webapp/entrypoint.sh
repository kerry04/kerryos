#!/bin/sh
# KerryOS Guacamole webapp entrypoint.
#
# Why: Guacamole 1.5.5 does NOT expand ${VAR} references in guacamole.properties
# (that behavior belongs to the official guacamole/guacamole image's own
# entrypoint, which we don't use because it is AMD64-only). We mounted a
# template at guacamole.properties.template instead; render it with envsubst
# into the real properties file the WAR reads at startup.
set -e

TEMPLATE=/etc/guacamole/guacamole.properties.template
PROPS=/etc/guacamole/guacamole.properties

if [ -f "$TEMPLATE" ]; then
    # Expand only the variables we template; unset vars expand to empty.
    envsubst '${POSTGRES_PASSWORD} ${GUACD_HOSTNAME} ${GUACD_PORT}' \
        < "$TEMPLATE" > "$PROPS.in"
    # envsubst won't expand sed-unfriendly content; we only templated POSTGRES_PASSWORD
    # and friends, so the file is already final here.
    mv "$PROPS.in" "$PROPS"
    chmod 600 "$PROPS"
fi

exec "$@"
