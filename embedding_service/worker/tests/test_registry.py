import os
import tempfile
import unittest

from worker.models.registry import ModelRegistry


class TestModelRegistry(unittest.TestCase):
    def _write_yaml(self, content: str) -> str:
        fd, path = tempfile.mkstemp(suffix=".yaml")
        with os.fdopen(fd, "w") as handle:
            handle.write(content)
        return path

    def test_missing_default_model_raises(self) -> None:
        path = self._write_yaml("models: {}\n")
        try:
            with self.assertRaises(ValueError):
                ModelRegistry.load(path)
        finally:
            os.remove(path)

    def test_default_model_used_when_missing(self) -> None:
        path = self._write_yaml(
            "models:\n"
            "  default_model:\n"
            "    pooling: mean\n"
            "    normalization: l2\n"
            "    max_sequence_length: 512\n"
            "    supported_pooling: [mean, cls, max]\n"
            "    supported_normalization: [none, l2]\n"
        )
        try:
            registry = ModelRegistry.load(path)
            profile = registry.get_profile("unknown-model")
            self.assertEqual(profile.default_pooling, "mean")
            self.assertEqual(profile.default_normalization, "l2")
        finally:
            os.remove(path)

    def test_explicit_model_requires_fields(self) -> None:
        path = self._write_yaml(
            "models:\n"
            "  default_model:\n"
            "    pooling: mean\n"
            "    normalization: l2\n"
            "    max_sequence_length: 512\n"
            "    supported_pooling: [mean]\n"
            "    supported_normalization: [none, l2]\n"
            "  test-model:\n"
            "    pooling: mean\n"
            "    normalization: l2\n"
        )
        try:
            registry = ModelRegistry.load(path)
            with self.assertRaises(ValueError):
                registry.get_profile("test-model")
        finally:
            os.remove(path)


if __name__ == "__main__":
    unittest.main()
