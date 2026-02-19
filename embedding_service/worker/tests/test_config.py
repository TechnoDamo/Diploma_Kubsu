import os
import tempfile
import unittest

from worker.infra.config import get_config


class TestConfig(unittest.TestCase):
    def _write_yaml(self, content: str) -> str:
        fd, path = tempfile.mkstemp(suffix=".yaml")
        with os.fdopen(fd, "w") as handle:
            handle.write(content)
        return path

    def test_general_defaults_apply_without_env(self) -> None:
        path = self._write_yaml(
            "general:\n"
            "  grpc_host: 127.0.0.1\n"
            "  grpc_port: 6000\n"
            "  log_level: DEBUG\n"
        )
        old_path = os.environ.get("WORKER_CONFIG_PATH")
        try:
            os.environ["WORKER_CONFIG_PATH"] = path
            config = get_config()
            self.assertEqual(config.grpc_host, "127.0.0.1")
            self.assertEqual(config.grpc_port, 6000)
            self.assertEqual(config.log_level, "DEBUG")
        finally:
            if old_path is None:
                os.environ.pop("WORKER_CONFIG_PATH", None)
            else:
                os.environ["WORKER_CONFIG_PATH"] = old_path
            os.remove(path)

    def test_env_overrides_general(self) -> None:
        path = self._write_yaml(
            "general:\n"
            "  grpc_host: 127.0.0.1\n"
            "  grpc_port: 6000\n"
        )
        old_path = os.environ.get("WORKER_CONFIG_PATH")
        old_host = os.environ.get("WORKER_GRPC_HOST")
        try:
            os.environ["WORKER_CONFIG_PATH"] = path
            os.environ["WORKER_GRPC_HOST"] = "0.0.0.0"
            config = get_config()
            self.assertEqual(config.grpc_host, "0.0.0.0")
            self.assertEqual(config.grpc_port, 6000)
        finally:
            if old_path is None:
                os.environ.pop("WORKER_CONFIG_PATH", None)
            else:
                os.environ["WORKER_CONFIG_PATH"] = old_path
            if old_host is None:
                os.environ.pop("WORKER_GRPC_HOST", None)
            else:
                os.environ["WORKER_GRPC_HOST"] = old_host
            os.remove(path)


if __name__ == "__main__":
    unittest.main()
