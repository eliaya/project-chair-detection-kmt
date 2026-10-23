# main.py for the Raspberry Pi (arm64). Built and started by scripts/pi_initial.sh (compose.yaml).

FROM python:3.13-slim-trixie AS base
# No wheels at its top level, so pip goes to PyPI; the offline bundle replaces this stage
# with its wheels directory: --build-context wheels=app/wheels
FROM base AS wheels

FROM base

WORKDIR /app
COPY requirements-pi.txt .
# PIP_OPTS=--no-index (offline bundle) installs only from the wheels context.
# --no-deps: ncnn declares opencv-python (GUI build); the headless build is enough.
ARG PIP_OPTS=
RUN --mount=type=bind,from=wheels,target=/wheels \
    pip install --no-cache-dir $PIP_OPTS --find-links /wheels -r requirements-pi.txt \
 && pip install --no-cache-dir $PIP_OPTS --find-links /wheels --no-deps ncnn==1.0.20260526
# draw_zones.py: camera snapshots for the zone form (--snapshot)
COPY main.py utils.py draw_zones.py ./

# main.py keeps queue.db and config.cache.json in its working directory: the state volume.
# config.json is the fallback when the Worker is unreachable and nothing is cached yet.
WORKDIR /data
COPY config.json .
ENV PYTHONUNBUFFERED=1
CMD ["python", "/app/main.py"]
