FROM python:3.12-slim

WORKDIR /app

# Install deps first — separate layer for fast rebuilds.
COPY indexer/requirements.txt indexer/requirements.txt
COPY api/requirements.txt api/requirements.txt

RUN pip install --no-cache-dir \
        -r indexer/requirements.txt \
        -r api/requirements.txt

COPY indexer/ indexer/
COPY api/ api/
COPY start.sh start.sh
RUN chmod +x start.sh

EXPOSE 8000


CMD ["./start.sh"]
