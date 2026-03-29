FROM python:3.11-slim
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends \
    chromium chromium-driver \
    && rm -rf /var/lib/apt/lists/*
COPY src/agents/sourcer/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt && playwright install chromium
COPY src/shared/training.py ./shared/training.py
COPY src/agents/sourcer ./
CMD ["python", "main.py"]
