from __future__ import annotations

from enum import Enum
from functools import lru_cache

from pydantic import SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict


class Environment(str, Enum):
    DEV = "development"
    STAGING = "staging"
    PRODUCTION = "production"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        env_prefix="SENTINEL_",
    )

    environment: Environment = Environment.DEV
    debug: bool = False
    app_name: str = "Sentinel OS API Gateway"
    version: str = "1.0.0"
    host: str = "0.0.0.0"
    port: int = 4000

    # PostgreSQL
    pg_host: str = "localhost"
    pg_port: int = 5432
    pg_user: str = "sentinel"
    pg_password: SecretStr = SecretStr("sentinel_secret")
    pg_database: str = "sentinel_db"

    @property
    def pg_dsn(self) -> str:
        return (
            f"postgresql+asyncpg://{self.pg_user}:{self.pg_password.get_secret_value()}"
            f"@{self.pg_host}:{self.pg_port}/{self.pg_database}"
        )

    # MongoDB
    mongo_uri: str = "mongodb://localhost:27017"
    mongo_database: str = "sentinel_raw"

    # Neo4j
    neo4j_uri: str = "bolt://localhost:7687"
    neo4j_user: str = "neo4j"
    neo4j_password: SecretStr = SecretStr("neo4j_secret")

    # Redis
    redis_url: str = "redis://localhost:6379/0"

    # Kafka
    kafka_brokers: str = "localhost:9092"
    kafka_group_id: str = "api-gateway"

    # Auth / JWT
    jwt_secret: SecretStr = SecretStr("change-me-in-production")
    jwt_algorithm: str = "HS256"
    jwt_expiration_minutes: int = 60
    jwt_refresh_expiration_days: int = 7

    # CORS
    cors_origins: list[str] = ["http://localhost:3000"]

    # Rate limiting
    rate_limit_per_minute: int = 120

    # Observability
    otlp_endpoint: str = "http://localhost:4317"
    log_level: str = "INFO"

    # Vault
    vault_addr: str = "http://localhost:8200"
    vault_token: SecretStr = SecretStr("")

    # Classification
    default_classification: str = "UNCLASSIFIED"


@lru_cache
def get_settings() -> Settings:
    return Settings()
