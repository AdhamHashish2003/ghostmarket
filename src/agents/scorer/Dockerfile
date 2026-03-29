FROM python:3.11-slim
WORKDIR /app
COPY src/agents/scorer/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt
COPY src/shared/training.py ./shared/training.py
COPY src/agents/scorer ./
CMD ["python", "main.py"]
