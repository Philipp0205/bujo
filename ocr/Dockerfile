# bujo OCR service. CPU only. Build from the repo root or from ocr/:
#   docker build -t bujo-ocr ocr
# The container calls the OCR_LLM_BASE gateway, so OCR_LLM_BASE and OCR_LLM_KEY are required (it exits without them).
FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1 \
    OCR_HOST=0.0.0.0 \
    OCR_PORT=8090

WORKDIR /app

COPY requirements.txt .
RUN pip install -r requirements.txt

COPY bujo_ocr ./bujo_ocr

RUN useradd --system --uid 10001 --no-create-home ocr
USER ocr

EXPOSE 8090

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD python -c "import os,urllib.request; urllib.request.urlopen('http://127.0.0.1:%s/healthz' % os.environ.get('OCR_PORT','8090'), timeout=4)"

CMD ["python", "-m", "bujo_ocr.server"]
