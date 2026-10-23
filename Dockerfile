# main.py for the Raspberry Pi (arm64). Built and started by scripts/pi_initial.sh (compose.yaml).
FROM python:3.13-slim-trixie

WORKDIR /app
COPY requirements-pi.txt .
# --no-deps: ncnn declares opencv-python (GUI build); the headless build is enough.
RUN pip install --no-cache-dir -r requirements-pi.txt \
 && pip install --no-cache-dir --no-deps ncnn==1.0.20260526
COPY main.py utils.py ./

# main.py keeps queue.db and config.cache.json in its working directory: the state volume.
# config.json is the fallback when the Worker is unreachable and nothing is cached yet.
WORKDIR /data
COPY config.json .
ENV PYTHONUNBUFFERED=1
CMD ["python", "/app/main.py"]
