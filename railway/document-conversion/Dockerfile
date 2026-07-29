FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

RUN apt-get update && apt-get install -y --no-install-recommends \
    tesseract-ocr \
    tesseract-ocr-eng \
    tesseract-ocr-kor \
    fonts-noto-cjk \
    libpango-1.0-0 \
    libpangoft2-1.0-0 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /service
COPY services/document-conversion/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY services/document-conversion/app.py .

EXPOSE 3003
CMD ["sh", "-c", "uvicorn app:app --host 0.0.0.0 --port ${PORT:-3003}"]
