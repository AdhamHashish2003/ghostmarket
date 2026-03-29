FROM python:3.11-slim
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends \
    libgl1-mesa-glx libglib2.0-0 curl \
    && rm -rf /var/lib/apt/lists/*
COPY src/rog-worker/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt
COPY src/shared/training.py ./shared/training.py
COPY src/rog-worker ./
EXPOSE 8500
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8500"]
