FROM python:3.11-slim
WORKDIR /app
COPY src/agents/learner/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt
COPY src/shared/training.py ./shared/training.py
COPY src/agents/learner ./
CMD ["python", "main.py"]
