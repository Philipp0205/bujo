# bujo OCR service. CPU only. Build from the repo root or from ocr/:
#   docker build -t bujo-ocr ocr
# The TrOCR model is downloaded while the image is built, so the running container needs no network
# (except for the optional LLM reader, which calls the OCR_LLM_BASE gateway when OCR_LLM_BASE and OCR_LLM_KEY are set).
FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1 \
    HF_HOME=/opt/hf \
    OCR_HOST=0.0.0.0 \
    OCR_PORT=8090

RUN apt-get update \
    && apt-get install -y --no-install-recommends tesseract-ocr tesseract-ocr-eng tesseract-ocr-deu \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# torch first, from the CPU wheel index (no CUDA, no 2 GB of nvidia packages). requirements.txt then finds it installed.
RUN pip install --index-url https://download.pytorch.org/whl/cpu torch
COPY requirements.txt .
RUN pip install -r requirements.txt

# The model goes into HF_HOME inside the image. Online only for this one step.
RUN python -c "from transformers import TrOCRProcessor, VisionEncoderDecoderModel; n='microsoft/trocr-small-handwritten'; TrOCRProcessor.from_pretrained(n); VisionEncoderDecoderModel.from_pretrained(n)"

COPY bujo_ocr ./bujo_ocr

# From here on the container is offline.
ENV HF_HUB_OFFLINE=1 \
    TRANSFORMERS_OFFLINE=1

RUN useradd --system --uid 10001 --no-create-home ocr
USER ocr

EXPOSE 8090

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD python -c "import os,urllib.request; urllib.request.urlopen('http://127.0.0.1:%s/healthz' % os.environ.get('OCR_PORT','8090'), timeout=4)"

CMD ["python", "-m", "bujo_ocr.server"]
