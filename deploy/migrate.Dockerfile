FROM postgis/postgis:16-3.4

# db/scripts/apply.sh records SHA-256 checksums with shasum. Keep the
# migration image self-contained instead of depending on host packages.
RUN apt-get update \
    && apt-get install -y --no-install-recommends perl \
    && rm -rf /var/lib/apt/lists/* \
    && command -v psql >/dev/null \
    && command -v shasum >/dev/null

WORKDIR /workspace
COPY db ./db

CMD ["bash", "-lc", "db/scripts/apply.sh"]
