FROM python:3.12-slim AS dependencies
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1
WORKDIR /app
ARG INSTALL_NEWS_NLP=false
COPY apps/ai-service/requirements*.txt ./
RUN pip install --no-cache-dir -r requirements.txt -r requirements-assistant.txt -r requirements-rag.txt
RUN if [ "$INSTALL_NEWS_NLP" = "true" ]; then pip install --no-cache-dir -r requirements-news.txt; fi
RUN useradd --create-home --uid 10001 appuser && mkdir -p /app/artifacts/huggingface && chown -R appuser:appuser /app/artifacts

FROM dependencies AS source
COPY apps/ai-service/app ./app
COPY apps/ai-service/scripts ./scripts
USER appuser
EXPOSE 8000
HEALTHCHECK --interval=10s --timeout=5s --start-period=60s --retries=5 CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/health/ready', timeout=3)"

FROM source AS development
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--reload", "--reload-dir", "/app/app"]

FROM source AS runtime
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
