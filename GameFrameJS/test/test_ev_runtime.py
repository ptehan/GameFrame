import os
from pathlib import Path
import subprocess
import sys
import unittest


ROOT = Path(__file__).resolve().parents[1]


class EvRuntimeTest(unittest.TestCase):
    def selected_runtime(self, override=None):
        env = dict(os.environ)
        env.pop("GAMEFRAME_EV_PYTHON", None)
        if override is not None:
            env["GAMEFRAME_EV_PYTHON"] = override
        result = subprocess.run(
            [sys.executable, "-B", "-c", "import clip_server; print(clip_server.EV_PYTHON)"],
            cwd=ROOT / "ev-predictor", env=env, capture_output=True, text=True, check=True,
        )
        return result.stdout.strip()

    def test_project_environment_or_running_interpreter(self):
        local = ROOT / ".venv-ev" / ("Scripts/python.exe" if os.name == "nt" else "bin/python")
        expected = local if local.exists() else Path(sys.executable)
        self.assertEqual(Path(self.selected_runtime()), expected)

    def test_explicit_runtime_override(self):
        self.assertEqual(self.selected_runtime(sys.executable), sys.executable)


if __name__ == "__main__":
    unittest.main()
