"""Model registry for defaults and supported methods."""
from dataclasses import dataclass
from typing import Dict, List, Optional
import yaml


@dataclass(frozen=True)
class ModelProfile:
    """Resolved model defaults and supported methods."""
    model_id: str
    default_pooling: str
    default_normalization: str
    max_sequence_length: int
    supported_pooling: List[str]
    supported_normalization: List[str]


class ModelRegistry:
    """Loads model defaults and supported methods from YAML."""

    def __init__(self, default_model: dict, models: Dict[str, dict]):
        self._default_model = default_model
        self._models = models

    @classmethod
    def load(cls, path: str) -> "ModelRegistry":
        with open(path, "r", encoding="utf-8") as handle:
            data = yaml.safe_load(handle) or {}
        models = data.get("models", {})
        default_model = models.get("default_model")
        if default_model is None:
            raise ValueError("Model registry is missing required 'models.default_model' entry")
        required_keys = [
            "pooling",
            "normalization",
            "max_sequence_length",
            "supported_pooling",
            "supported_normalization",
        ]
        missing = [key for key in required_keys if key not in default_model]
        if missing:
            raise ValueError(
                f"Default model is missing required registry fields: {missing}"
            )
        return cls(default_model, models)

    def get_profile(
        self,
        model_id: str,
        pooling_override: Optional[str] = None,
        normalization_override: Optional[str] = None,
        max_sequence_length_override: Optional[int] = None,
    ) -> ModelProfile:
        allowed_pooling = {"mean", "cls", "max"}
        allowed_normalization = {"none", "l2"}

        model_data = self._models.get(model_id)

        if model_data is None:
            model_data = self._default_model
            default_pooling = pooling_override or model_data.get("pooling", "mean")
            default_normalization = normalization_override or model_data.get("normalization", "l2")
            max_sequence_length = max_sequence_length_override or model_data.get("max_sequence_length", 512)
            supported_pooling = model_data.get("supported_pooling", ["mean"])
            supported_normalization = model_data.get("supported_normalization", ["none", "l2"])
        else:
            required_keys = [
                "pooling",
                "normalization",
                "max_sequence_length",
                "supported_pooling",
                "supported_normalization",
            ]
            missing = [key for key in required_keys if key not in model_data]
            if missing:
                raise ValueError(
                    f"Model '{model_id}' is missing required registry fields: {missing}"
                )

            default_pooling = pooling_override or model_data["pooling"]
            default_normalization = normalization_override or model_data["normalization"]
            max_sequence_length = max_sequence_length_override or model_data["max_sequence_length"]
            supported_pooling = model_data["supported_pooling"]
            supported_normalization = model_data["supported_normalization"]

        unknown_pooling = [value for value in supported_pooling if value not in allowed_pooling]
        if unknown_pooling:
            raise ValueError(
                f"Unsupported pooling values for model '{model_id}': {unknown_pooling}"
            )
        unknown_normalization = [
            value for value in supported_normalization if value not in allowed_normalization
        ]
        if unknown_normalization:
            raise ValueError(
                f"Unsupported normalization values for model '{model_id}': {unknown_normalization}"
            )

        if default_pooling not in supported_pooling:
            raise ValueError(
                f"Default pooling '{default_pooling}' not supported for model '{model_id}'. "
                f"Supported: {supported_pooling}"
            )
        if default_normalization not in supported_normalization:
            raise ValueError(
                f"Default normalization '{default_normalization}' not supported for model '{model_id}'. "
                f"Supported: {supported_normalization}"
            )

        return ModelProfile(
            model_id=model_id,
            default_pooling=default_pooling,
            default_normalization=default_normalization,
            max_sequence_length=max_sequence_length,
            supported_pooling=supported_pooling,
            supported_normalization=supported_normalization,
        )
