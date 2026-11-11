FROM python:3.12-slim
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg libglib2.0-0 libgl1 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY replay_processor.py replay_worker.py ./
RUN useradd --system --create-home replay
USER replay
# Run one leased database job at a time. Credentials are runtime secrets only.
ENTRYPOINT ["python", "replay_worker.py"]
