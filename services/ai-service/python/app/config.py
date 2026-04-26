from __future__ import annotations
from functools import lru_cache
from pydantic import SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_prefix="AI_")

    host: str = "0.0.0.0"
    port: int = 5001
    debug: bool = False

    # Ollama
    ollama_host: str = "http://localhost:11434"
    ollama_model: str = "llama3"
    ollama_embed_model: str = "nomic-embed-text"

    # Kafka
    kafka_brokers: str = "localhost:9092"
    kafka_group_id: str = "ai-service"

    # Redis
    redis_url: str = "redis://localhost:6379/1"

    # Model paths
    yolo_model_path: str = "yolov8n.pt"
    anomaly_model_path: str = "models/isolation_forest.pkl"
    lstm_model_path: str = "models/lstm_predictor.pt"

    # API Gateway
    api_gateway_url: str = "http://localhost:4000"

    # GPU
    device: str = "cpu"  # cpu, cuda, cuda:0


@lru_cache
def get_settings() -> Settings:
    return Settings()
