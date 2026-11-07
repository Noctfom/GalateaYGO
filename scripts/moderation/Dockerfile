FROM node:22.18.0-bookworm-slim AS node
FROM python:3.12-slim-bookworm
COPY --from=node /usr/local/bin/node /usr/local/bin/node
COPY requirements.txt /tmp/requirements.txt
RUN pip install --no-cache-dir -r /tmp/requirements.txt
WORKDIR /app
ENV PYTHONDONTWRITEBYTECODE=1
CMD ["sh", "-c", "node scripts/moderation/run.mjs inspect /input && python scripts/moderation/inspect_package.py /input/package.gkg /input/policy.json /output/report.json"]
