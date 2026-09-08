FROM postgis/postgis:16-3.4

# apply.sh / preflight.sh prefer sha256sum from coreutils, which this image
# already ships. Do not apt-get: the Debian 11 bullseye-security InRelease on
# this base can expire and fail production image builds.
RUN command -v psql >/dev/null \
    && command -v sha256sum >/dev/null

WORKDIR /workspace
COPY db ./db

CMD ["bash", "-lc", "db/scripts/apply.sh && db/scripts/preflight.sh"]
